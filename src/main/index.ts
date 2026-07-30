import { app, BrowserWindow, globalShortcut, Menu, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { registerIpc } from "./ipc/registerIpc";
import { registerAttachmentProtocol, registerAttachmentScheme } from "./attachmentProtocol";
import { getAppIconPath, migrateLegacyUserDataIfNeeded } from "./platformPaths";
import {
  createQuickCaptureController,
  type QuickCaptureController,
} from "./quickCaptureController";
import { createReminderController, type ReminderController } from "./reminderController";
import { createTodayMiniController, type TodayMiniController } from "./todayMiniController";
import { createTrayController, type TrayController } from "./trayController";
import { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { WorkspaceService } from "./services/workspaceService";
import { SharedFolderSyncService } from "./services/sharedFolderSync.mjs";
import type { Entity, EntityType } from "../shared/types/workspace";

const isSmokeTest = process.argv.includes("--smoke-test");
const userDataArgument = process.argv.find((argument) => argument.startsWith("--user-data-dir="));
const requestedUserDataPath = userDataArgument?.slice("--user-data-dir=".length);
const smokeResultPath = path.join(os.tmpdir(), "research-desk-smoke-result.json");
const APP_NAME = "Tasken";
const MAIN_WINDOW_DEFAULT_WIDTH = 1760;
const MAIN_WINDOW_DEFAULT_HEIGHT = 1024;
let workspaceRepository: InstanceType<typeof WorkspaceDatabase>;
let trayController: TrayController | null = null;
let quickCaptureController: QuickCaptureController | null = null;
let todayMiniController: TodayMiniController | null = null;
let reminderController: ReminderController | null = null;
let sharedFolderSyncService: SharedFolderSyncService | null = null;
registerAttachmentScheme();

function openAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) return false;
    void shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

function showMainContextMenu(window: BrowserWindow, params: Electron.ContextMenuParams): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(quickCaptureController?.menuItems() || []),
  ];
  if (params.isEditable) {
    template.push(
      { type: "separator" },
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    );
  } else if (params.selectionText) {
    template.push(
      { type: "separator" },
      { role: "copy" },
    );
  }
  Menu.buildFromTemplate(template).popup({ window });
}

function notifyMainWindowRefresh(change?: { type: EntityType; entity: Entity } | { entities: Array<{ type: EntityType; entity: Entity }> }): void {
  const captureWindow = quickCaptureController?.getWindow();
  const todayMiniWindow = todayMiniController?.getWindow();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== captureWindow && win !== todayMiniWindow && !win.isDestroyed()) {
      win.webContents.send("workspace:changed", change);
    }
  }
  if (todayMiniWindow && !todayMiniWindow.isDestroyed()) {
    todayMiniWindow.webContents.send("today-mini:refresh");
  }
}

function findMainWindow(): BrowserWindow | null {
  const captureWindow = quickCaptureController?.getWindow();
  const todayMiniWindow = todayMiniController?.getWindow();
  return BrowserWindow.getAllWindows()
    .find((win) => win !== captureWindow && win !== todayMiniWindow && !win.isDestroyed()) || null;
}

function showMainWindow(): BrowserWindow {
  const win = findMainWindow() || createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

interface SmokeCreatedResult {
  title: string;
  rootReady: boolean;
  smokeTaskId: string;
  smokeTaskTitle: string;
  todayMiniWindowOpened: boolean;
  saved: boolean;
  markdownSaved: boolean;
  markdownPreviewRendered: boolean;
  markdownFrontmatterRendered: boolean;
  markdownMathRendered: boolean;
  markdownImageRendered: boolean;
  notesPanePreviewRendered: boolean;
  notesPaneMathRendered: boolean;
  notesLiveEditSaved: boolean;
  notesMarkdownPasteRendered: boolean;
  notesEditPreviewAligned: boolean;
  notesEditReopened: boolean;
  notesMermaidRenderedInEdit: boolean;
  notesCodeBlockFullWidth: boolean;
  notesFootnoteEditPreviewAligned: boolean;
  rawCopyNotified: boolean;
  themeMode: string;
  clipboardWritten: boolean;
}

interface SmokeReloadResult {
  persisted: boolean;
  markdownPersisted: boolean;
  markdownThemeLinked: boolean;
  markdownFrontmatterPersisted: boolean;
  markdownLiveEditPersisted: boolean;
  markdownPastePersisted: boolean;
  themeMode: string;
}

interface SmokeMiniResult {
  todayMiniOpened: boolean;
  todayMiniAlwaysOnTop: boolean;
  todayMiniTaskVisible: boolean;
  todayMiniCompletionSaved: boolean;
  todayMiniOpenDetail: boolean;
}

function recordSmoke(stage: string, details: Record<string, unknown> = {}): void {
  if (!isSmokeTest) return;
  fs.writeFileSync(smokeResultPath, JSON.stringify({ stage, argv: process.argv, ...details }, null, 2));
}

app.disableHardwareAcceleration();
if (process.platform === "win32") app.setAppUserModelId("jp.personal.tasken");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("in-process-gpu");
// Chromium EditContext は Windows 日本語 IME の候補位置がずれる事例がある（CodeMirror 等でも無効化が定石）。
// 従来の contenteditable キャレット基準に戻す。
app.commandLine.appendSwitch("disable-blink-features", "EditContext");
app.commandLine.appendSwitch("disable-features", "EditContext");

if (requestedUserDataPath) {
  app.setPath("userData", path.resolve(requestedUserDataPath));
} else if (isSmokeTest) {
  const smokeUserDataPath = path.join(app.getPath("temp"), "research-desk-smoke-test");
  fs.rmSync(smokeUserDataPath, { recursive: true, force: true });
  app.setPath("userData", smokeUserDataPath);
  recordSmoke("main-started");
  setTimeout(() => {
    recordSmoke("timeout");
    app.exit(1);
  }, 45000);
}

async function runSmokeTest(window: BrowserWindow): Promise<void> {
  recordSmoke("renderer-loaded");
  const testTitle = `デスクトップ動作確認 ${Date.now()}`;
  const markdownTitle = `Markdown動作確認 ${Date.now()}`;
  const footnoteTitle = `脚注動作確認 ${Date.now()}`;
  const smokeTaskTitle = `Todayミニ動作確認 ${Date.now()}`;
  const smokeTaskId = randomUUID();
  const smokeThemeId = `smoke-theme-${Date.now()}`;
  const markdownBody = `---
theme: smoke
type: report
---
# Markdown Preview
- 箇条書き
本文中の式 $a^2 + b^2 = c^2$ を確認します。

$$
E = mc^2
$$

![Smoke Image](__SMOKE_IMAGE_URL__)

\`\`\`
code block
\`\`\`

\`\`\`mermaid
flowchart LR
  Edit --> Preview
\`\`\``;
  const footnoteBody = `# Footnote Preview

本文の根拠[^smoke]。

[^smoke]: Smoke脚注本文。

## 続き

編集前の本文。`;
  const created = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const setInputValue = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const waitFor = async (finder, label, attempts = 50) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const target = finder();
          if (target) return target;
          await delay(100);
        }
        throw new Error(label + " が見つかりません。画面: " + document.body.innerText.slice(0, 1000));
      };
      const waitForButton = async (label) => waitFor(() => {
        return [...document.querySelectorAll("button")].find((button) => {
          const firstLabel = button.querySelector("span")?.textContent?.trim();
          return firstLabel === label || button.textContent.trim() === label;
        });
      }, label + " ボタン");
      const clickPaneButton = (pane, label) => {
        const button = [...pane.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
        if (!button) throw new Error(label + " ボタンがNotesパネル内に見つかりません。");
        button.click();
        return button;
      };
      const selectNoteRow = async (title) => {
        const row = await waitFor(
          () => [...document.querySelectorAll(".note-row-main")].find((button) => button.textContent.includes(title)),
          "Note行 " + title,
        );
        row.click();
        await delay(120);
        return row;
      };
      const setNoteBodyRaw = async (body) => {
        const notesPane = document.querySelector(".note-preview-panel");
        if (!notesPane) throw new Error("Notes中央パネルが見つかりません");
        clickPaneButton(notesPane, "Raw");
        await delay(80);
        const rawArea = notesPane.querySelector("textarea.note-main-editor-raw");
        if (!rawArea) throw new Error("Raw編集エリアが見つかりません");
        setInputValue(rawArea, body);
        await delay(40);
        return notesPane;
      };

      // Note 作成: ドロワーはタイトル等のメタのみ。本文は中央エリアが正本。
      (await waitForButton("Notes")).click();
      await delay(80);
      (await waitForButton("Note")).click();
      await delay(100);

      const form = await waitFor(() => document.querySelector(".drawer-form"), "メモ入力フォーム");
      const title = form.querySelector('input[name="title"]');
      if (!title) throw new Error("メモ入力フォームにタイトル欄がありません");
      setInputValue(title, ${JSON.stringify(testTitle)});
      form.requestSubmit();
      await delay(200);

      await selectNoteRow(${JSON.stringify(testTitle)});
      await setNoteBodyRaw("Electron内で入力と保存を確認しました。");
      clickPaneButton(document.querySelector(".note-preview-panel"), "保存");
      await delay(200);

      await window.api.entities.save("theme", { id: ${JSON.stringify(smokeThemeId)}, name: "Smoke Theme", code: "SMOKE", status: "active" });
      const smokeImage = await window.api.attachments.saveMarkdownImage({
        fileName: "smoke.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
      });
      const markdownContent = ${JSON.stringify(markdownBody)}.replace("__SMOKE_IMAGE_URL__", smokeImage.url);

      // Markdown 確認用 Note を作成（本文は中央 Raw で投入）
      (await waitForButton("Note")).click();
      await delay(100);
      const markdownForm = await waitFor(() => document.querySelector(".drawer-form"), "Markdown入力フォーム");
      const markdownTitleInput = markdownForm.querySelector('input[name="title"]');
      const markdownTheme = markdownForm.querySelector('input[name="theme_id"]');
      if (!markdownTitleInput || !markdownTheme) throw new Error("Markdown入力フォームの項目が見つかりません");
      setInputValue(markdownTitleInput, ${JSON.stringify(markdownTitle)});
      setInputValue(markdownTheme, ${JSON.stringify(smokeThemeId)});
      markdownForm.requestSubmit();
      await delay(220);

      await selectNoteRow(${JSON.stringify(markdownTitle)});
      let notesPane = await setNoteBodyRaw(markdownContent);
      clickPaneButton(notesPane, "保存");
      await delay(200);

      // Preview で Markdown 描画を確認
      clickPaneButton(notesPane, "Preview");
      await delay(120);
      const preview = notesPane.querySelector(".note-main-preview.markdown-preview") || notesPane.querySelector(".markdown-preview");
      const markdownPreviewRendered = Boolean(
        preview?.querySelector("h1")?.textContent?.includes("Markdown Preview")
        && preview?.querySelector("li")?.textContent?.includes("箇条書き")
        && [...(preview?.querySelectorAll("code") || [])].some((code) => code.textContent?.includes("code block"))
      );
      const markdownFrontmatterRendered = Boolean(preview?.querySelector(".md-frontmatter")?.textContent?.includes("type: report"));
      const markdownMathRendered = Boolean(
        preview?.querySelector(".md-math-inline")?.textContent?.includes("a^2")
        && preview?.querySelector(".md-math-block")?.textContent?.includes("E = mc^2")
      );
      const smokePreviewImage = preview?.querySelector('.md-image img[alt="Smoke Image"]');
      if (smokePreviewImage && !smokePreviewImage.complete) {
        await new Promise((resolve) => {
          smokePreviewImage.addEventListener("load", resolve, { once: true });
          smokePreviewImage.addEventListener("error", resolve, { once: true });
          setTimeout(resolve, 700);
        });
      }
      const markdownImageRendered = Boolean(
        smokePreviewImage?.getAttribute("src")?.startsWith("tasken-attachment://")
        && smokePreviewImage?.naturalWidth > 0
      );

      clickPaneButton(notesPane, "本文をコピー");
      await delay(140);
      const rawCopyNotified = document.body.innerText.includes("本文をコピーしました。");

      // Edit（Live Preview）面での追記・貼り付け
      clickPaneButton(notesPane, "Edit");
      await delay(200);
      notesPane = document.querySelector(".note-preview-panel");
      const liveEditable = await waitFor(
        () => notesPane?.querySelector(".note-mdx-content[contenteditable='true']"),
        "Live Preview編集面",
        40,
      );
      const notesPanePreviewRendered = Boolean(
        notesPane?.querySelector("h2")?.textContent?.includes(${JSON.stringify(markdownTitle)})
        && (notesPane?.querySelector(".note-live-editor h1")?.textContent?.includes("Markdown Preview")
          || liveEditable?.querySelector("h1")?.textContent?.includes("Markdown Preview"))
        && notesPane?.querySelector(".document-publish-panel")
      );
      const notesPaneMathRendered = Boolean(
        notesPane?.querySelector(".note-editor-math-inline")
        && notesPane?.querySelector(".note-editor-math-block")
      );
      const mermaidPreviewInEdit = await waitFor(
        () => notesPane?.querySelector(".note-mermaid-code-block.is-preview .md-mermaid-svg svg"),
        "Edit面のMermaid Preview",
        30,
      );
      const notesMermaidRenderedInEdit = Boolean(mermaidPreviewInEdit);
      mermaidPreviewInEdit.closest(".note-mermaid-code-block")?.click();
      const mermaidCodeEditor = await waitFor(
        () => notesPane?.querySelector(".note-mermaid-code-block.is-editing .cm-editor"),
        "Mermaidコード編集面",
        30,
      );
      const notesCodeBlockFullWidth = mermaidCodeEditor.getBoundingClientRect().width >= liveEditable.getBoundingClientRect().width * 0.8;

      liveEditable.focus();
      let liveTextNode = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const walker = document.createTreeWalker(liveEditable, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node.nodeValue?.includes("本文中")) {
            liveTextNode = node;
            break;
          }
          node = walker.nextNode();
        }
        if (liveTextNode) break;
        await delay(100);
      }
      if (!liveTextNode) throw new Error("Live Preview編集対象の本文が見つかりません。表示: " + liveEditable.textContent?.slice(0, 500));
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(liveTextNode, liveTextNode.nodeValue?.length || 0);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand("insertText", false, " Live edit smoke");
      await delay(80);
      const pasteData = new DataTransfer();
      pasteData.setData("text/plain", "\\n\\n## Pasted Markdown Heading\\n\\n**Pasted Bold Text**\\n");
      const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, "clipboardData", { value: pasteData });
      liveEditable.dispatchEvent(pasteEvent);
      await delay(200);
      const notesLiveEditRendered = Boolean(notesPane?.querySelector(".note-live-editor")?.textContent?.includes("Live edit smoke"));
      const notesMarkdownPasteRendered = Boolean(
        notesPane?.querySelector(".note-live-editor h2")?.textContent?.includes("Pasted Markdown Heading")
        && notesPane?.querySelector(".note-live-editor strong")?.textContent?.includes("Pasted Bold Text")
      );
      const editStructure = {
        h1: liveEditable.querySelector("h1")?.textContent?.trim() || "",
        h2: liveEditable.querySelector("h2")?.textContent?.trim() || "",
        strong: liveEditable.querySelector("strong")?.textContent?.trim() || "",
        list: liveEditable.querySelector("li")?.textContent?.trim() || "",
      };
      const saveDraftButton = [...(notesPane?.querySelectorAll(".note-preview-actions button") || [])].find((button) => button.textContent.trim() === "保存");
      saveDraftButton?.click();
      await delay(220);
      const notesLiveEditSaved = notesLiveEditRendered && document.body.innerText.includes("保存しました。");
      clickPaneButton(notesPane, "Preview");
      await delay(180);
      const editedPreview = notesPane.querySelector(".note-main-preview.markdown-preview");
      const previewStructure = {
        h1: editedPreview?.querySelector("h1")?.textContent?.trim() || "",
        h2: editedPreview?.querySelector("h2")?.textContent?.trim() || "",
        strong: editedPreview?.querySelector("strong")?.textContent?.trim() || "",
        list: editedPreview?.querySelector("li")?.textContent?.trim() || "",
      };
      const notesEditPreviewAligned = Object.keys(editStructure).every((key) => editStructure[key] === previewStructure[key])
        && Boolean(editedPreview?.textContent?.includes("Live edit smoke"));
      clickPaneButton(notesPane, "Edit");
      await delay(180);
      const notesEditReopened = Boolean(notesPane.querySelector(".note-mdx-content[contenteditable='true']")?.textContent?.includes("Live edit smoke"));

      // 脚注MarkdownをEditで更新し、Previewへ切り替えて脚注表示と保存値を確認する。
      (await waitForButton("Note")).click();
      await delay(100);
      const footnoteForm = await waitFor(() => document.querySelector(".drawer-form"), "脚注Note入力フォーム");
      const footnoteTitleInput = footnoteForm.querySelector('input[name="title"]');
      if (!footnoteTitleInput) throw new Error("脚注Note入力フォームにタイトル欄がありません");
      setInputValue(footnoteTitleInput, ${JSON.stringify(footnoteTitle)});
      footnoteForm.requestSubmit();
      await delay(220);
      await selectNoteRow(${JSON.stringify(footnoteTitle)});
      notesPane = await setNoteBodyRaw(${JSON.stringify(footnoteBody)});
      clickPaneButton(notesPane, "保存");
      await delay(180);
      clickPaneButton(notesPane, "Edit");
      await delay(160);
      const footnoteEditor = await waitFor(
        () => notesPane?.querySelector("textarea.note-editor-footnotes"),
        "脚注Markdown編集面",
      );
      setInputValue(footnoteEditor, ${JSON.stringify(footnoteBody)} + "\\n\\nEdit脚注入力確認。");
      await delay(100);
      clickPaneButton(notesPane, "保存");
      await delay(180);
      clickPaneButton(notesPane, "Preview");
      await delay(160);
      const footnotePreview = notesPane.querySelector(".note-main-preview");
      const notesFootnoteEditPreviewAligned = Boolean(
        footnotePreview?.querySelector(".md-footnote-ref")
        && footnotePreview?.querySelector(".md-footnotes")?.textContent?.includes("Smoke脚注本文")
        && footnotePreview?.textContent?.includes("Edit脚注入力確認")
      );
      await window.api.preferences.set("themeMode", "dark");
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      await window.api.entities.save("task", {
        id: ${JSON.stringify(smokeTaskId)},
        title: ${JSON.stringify(smokeTaskTitle)},
        project_id: ${JSON.stringify(smokeThemeId)},
        state: "todo",
        priority: "high",
        checklist_items: [{ id: "mini-1", title: "smoke", done: false, sort_order: 0 }],
        created_at: new Date().toISOString()
      }, { source: "smoke" });
      await window.api.entities.save("schedule", {
        id: crypto.randomUUID(),
        owner_type: "task",
        owner_id: ${JSON.stringify(smokeTaskId)},
        start_date: today,
        end_date: today,
        date_kind: "point",
        confidence: "fixed",
        granularity: "day"
      }, { source: "smoke" });
      const todayMiniWindowOpened = await window.api.app.showTodayMiniWindow();
      const themeMode = await window.api.preferences.get("themeMode");
      const clipboardWritten = await window.api.clipboard.writeText("Tasken smoke test");

      return {
        title: document.title,
        rootReady: Boolean(document.querySelector("#root > *")),
        smokeTaskId: ${JSON.stringify(smokeTaskId)},
        smokeTaskTitle: ${JSON.stringify(smokeTaskTitle)},
        todayMiniWindowOpened,
        saved: [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(testTitle)})),
        markdownSaved: [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(markdownTitle)})),
        markdownPreviewRendered,
        markdownFrontmatterRendered,
        markdownMathRendered,
        markdownImageRendered,
        notesPanePreviewRendered,
        notesPaneMathRendered,
        notesLiveEditSaved,
        notesMarkdownPasteRendered,
        notesEditPreviewAligned,
        notesEditReopened,
        notesMermaidRenderedInEdit,
        notesCodeBlockFullWidth,
        notesFootnoteEditPreviewAligned,
        rawCopyNotified,
        themeMode,
        clipboardWritten,
      };
    })()
  `) as SmokeCreatedResult;

  let mini: SmokeMiniResult = {
    todayMiniOpened: false,
    todayMiniAlwaysOnTop: false,
    todayMiniTaskVisible: false,
    todayMiniCompletionSaved: false,
    todayMiniOpenDetail: false,
  };
  const todayMiniWindow = todayMiniController?.getWindow();
  const todayMini = todayMiniWindow && !todayMiniWindow.isDestroyed() ? todayMiniWindow : null;
  if (todayMini) {
    if (todayMini.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        todayMini.webContents.once("did-finish-load", () => resolve());
        setTimeout(resolve, 1200);
      });
    }
    mini.todayMiniOpened = created.todayMiniWindowOpened && todayMini.isVisible();
    mini.todayMiniAlwaysOnTop = todayMini.isAlwaysOnTop();
    const miniInteraction = await todayMini.webContents.executeJavaScript(`
      (async () => {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (document.body.innerText.includes(${JSON.stringify(smokeTaskTitle)})) break;
          await delay(100);
        }
        const todayMiniTaskVisible = document.body.innerText.includes(${JSON.stringify(smokeTaskTitle)});
        await window.todayMiniApi.toggle(${JSON.stringify(smokeTaskId)});
        await delay(140);
        const afterToggle = await window.todayMiniApi.list();
        const todayMiniCompletionSaved = !afterToggle.some((task) => task.id === ${JSON.stringify(smokeTaskId)});
        const todayMiniOpenDetail = await window.todayMiniApi.openTask(${JSON.stringify(smokeTaskId)});
        return { todayMiniTaskVisible, todayMiniCompletionSaved, todayMiniOpenDetail };
      })()
    `) as Pick<SmokeMiniResult, "todayMiniTaskVisible" | "todayMiniCompletionSaved" | "todayMiniOpenDetail">;
    mini = { ...mini, ...miniInteraction };
  }
  const detailOpened = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const drawer = document.querySelector(".drawer-form");
        const title = drawer?.querySelector('input[name="title"]');
        if (title?.value === ${JSON.stringify(smokeTaskTitle)}) return true;
        await delay(100);
      }
      return false;
    })()
  `) as boolean;
  mini.todayMiniOpenDetail = mini.todayMiniOpenDetail && detailOpened;

  window.webContents.once("did-finish-load", async () => {
    try {
      const afterReload = await window.webContents.executeJavaScript(`
        Promise.all([
          window.api.entities.list("note"),
          window.api.preferences.get("themeMode"),
        ]).then(([notes, themeMode]) => {
          const markdown = notes.find((note) => note.title === ${JSON.stringify(markdownTitle)});
          return ({
          persisted: notes.some((note) => note.title === ${JSON.stringify(testTitle)}),
          markdownPersisted: Boolean(markdown?.body_markdown?.includes("Markdown Preview")),
          markdownThemeLinked: markdown?.theme_id === ${JSON.stringify(smokeThemeId)},
          markdownFrontmatterPersisted: Boolean(markdown?.body_markdown?.includes("type: report")),
          markdownLiveEditPersisted: Boolean(markdown?.body_markdown?.includes("Live edit smoke")),
          markdownPastePersisted: Boolean(markdown?.body_markdown?.includes("## Pasted Markdown Heading") && markdown?.body_markdown?.includes("**Pasted Bold Text**")),
          themeMode,
        });
        })
      `) as SmokeReloadResult;
      const result = {
        ...created,
        persistedAfterReload: afterReload.persisted,
        markdownPersistedAfterReload: afterReload.markdownPersisted,
        markdownThemeLinkedAfterReload: afterReload.markdownThemeLinked,
        markdownFrontmatterPersistedAfterReload: afterReload.markdownFrontmatterPersisted,
        markdownLiveEditPersistedAfterReload: afterReload.markdownLiveEditPersisted,
        markdownPastePersistedAfterReload: afterReload.markdownPastePersisted,
        themeModeAfterReload: afterReload.themeMode,
        ...mini,
      };
      console.log(JSON.stringify(result));
      recordSmoke("passed", result);
      app.exit(
        result.persistedAfterReload
        && result.markdownPersistedAfterReload
        && result.markdownThemeLinkedAfterReload
        && result.markdownFrontmatterPersistedAfterReload
        && result.markdownLiveEditPersistedAfterReload
        && result.markdownPastePersistedAfterReload
        && result.saved
        && result.markdownSaved
        && result.markdownPreviewRendered
        && result.markdownFrontmatterRendered
        && result.markdownMathRendered
        && result.markdownImageRendered
        && result.notesPanePreviewRendered
        && result.notesPaneMathRendered
        && result.notesLiveEditSaved
        && result.notesMarkdownPasteRendered
        && result.notesEditPreviewAligned
        && result.notesEditReopened
        && result.notesMermaidRenderedInEdit
        && result.notesCodeBlockFullWidth
        && result.notesFootnoteEditPreviewAligned
        && result.rawCopyNotified
        && result.rootReady
        && result.todayMiniOpened
        && result.todayMiniAlwaysOnTop
        && result.todayMiniTaskVisible
        && result.todayMiniCompletionSaved
        && result.todayMiniOpenDetail
        && result.clipboardWritten
        && result.themeMode === "dark"
        && result.themeModeAfterReload === "dark"
          ? 0
          : 1,
      );
    } catch (error) {
      console.error(error);
      recordSmoke("reload-check-failed", { error: String(error) });
      app.exit(1);
    }
  });
  window.reload();
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    minWidth: 980,
    minHeight: 680,
    show: !isSmokeTest,
    backgroundColor: "#F4EEEC",
    title: APP_NAME,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#FBF8F6",
      symbolColor: "#3D3532",
      height: 40,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // TODO: sandbox:true currently prevents window.api/window.researchDesk from being exposed.
      // Keep the verified contextIsolation/nodeIntegration boundary until the preload bridge is migrated.
      sandbox: false,
      preload: path.join(__dirname, "../preload/index.mjs"),
    },
  });

  if (!isSmokeTest) window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => {
    if (isSmokeTest) {
      runSmokeTest(window).catch((error: unknown) => {
        console.error(error);
        app.exit(1);
      });
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    recordSmoke("load-failed", { code, description });
    if (isSmokeTest) app.exit(1);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    recordSmoke("renderer-gone", { ...details });
    if (isSmokeTest) app.exit(1);
  });
  window.webContents.on("context-menu", (_event, params) => {
    showMainContextMenu(window, params);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!openAllowedExternalUrl(url)) {
      console.warn(`Blocked external URL: ${url}`);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      if (!openAllowedExternalUrl(url)) {
        console.warn(`Blocked navigation URL: ${url}`);
      }
    }
  });
  return window;
}

void app.whenReady().then(() => {
  migrateLegacyUserDataIfNeeded();
  registerAttachmentProtocol();
  workspaceRepository = new WorkspaceDatabase(path.join(app.getPath("userData"), "research-desk.sqlite"));
  sharedFolderSyncService = new SharedFolderSyncService(workspaceRepository, notifyMainWindowRefresh);
  registerIpc(
    workspaceRepository,
    new WorkspaceService(workspaceRepository, app.getPath("userData")),
    sharedFolderSyncService,
  );
  quickCaptureController = createQuickCaptureController({
    repository: workspaceRepository,
    notifyWorkspaceChanged: notifyMainWindowRefresh,
  });
  quickCaptureController.registerIpc();
  todayMiniController = createTodayMiniController({
    repository: workspaceRepository,
    getAppIconPath,
    showMainWindow,
    notifyWorkspaceChanged: notifyMainWindowRefresh,
  });
  todayMiniController.registerIpc();
  reminderController = createReminderController({
    repository: workspaceRepository,
    getAppIconPath,
    openTask: (taskId) => {
      todayMiniController?.openTask(taskId);
    },
    showMainWindow: () => {
      showMainWindow();
    },
  });
  trayController = createTrayController({
    appName: APP_NAME,
    getAppIconPath,
    showTodayMini: () => todayMiniController?.show(),
    quickCaptureMenuItems: () => quickCaptureController?.menuItems() || [],
    showQuickCapture: () => quickCaptureController?.show("inbox"),
    showMainWindow: () => {
      showMainWindow();
    },
  });
  recordSmoke("app-ready");
  createWindow();

  if (!isSmokeTest) {
    sharedFolderSyncService.start();
    trayController.setup();
    reminderController.start();
    globalShortcut.register("CmdOrCtrl+Shift+N", () => quickCaptureController?.show("inbox"));
    globalShortcut.register("CmdOrCtrl+Shift+M", () => quickCaptureController?.show("today-task"));
    globalShortcut.register("CmdOrCtrl+Shift+,", () => quickCaptureController?.show("done-task"));
    globalShortcut.register("CmdOrCtrl+Shift+.", () => quickCaptureController?.show("micro-memo"));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error: unknown) => {
  console.error("Tasken failed to start.", error);
  recordSmoke("startup-failed", { error: String(error) });
  app.exit(1);
});

app.on("window-all-closed", () => {
  // トレイ常駐中はメインウィンドウを閉じてもアプリを終了しない
  if (process.platform === "darwin") return;
  if (trayController?.isActive()) return;
  app.quit();
});

app.on("before-quit", () => {
  sharedFolderSyncService?.stop();
});

app.on("will-quit", () => {
  reminderController?.stop();
  globalShortcut.unregisterAll();
});
