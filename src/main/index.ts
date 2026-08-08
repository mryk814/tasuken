import { app, BrowserWindow, globalShortcut, ipcMain, Menu, safeStorage, shell } from "electron";
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
import { createSatelliteWindowRegistry, type SatelliteWindowRegistry } from "./satelliteWindowRegistry";
import { createMemoStickyController, type MemoStickyController } from "./memoStickyController";
import { createNoteWindowController, type NoteWindowController } from "./noteWindowController";
import { createTrayController, type TrayController } from "./trayController";
import { McpProposalInboxService } from "./mcp/proposalInbox.mjs";
import { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { WorkspaceService } from "./services/workspaceService";
import { AiProviderService } from "./services/aiProviderService";
import { CalendarService } from "./services/calendarService";
import { SharedFolderSyncService } from "./services/sharedFolderSync.mjs";
import type { Entity, EntityType } from "../shared/types/workspace";
import { ApplicationCommandService } from "./services/applicationCommandService";
import type { CommandReceipt } from "../shared/applicationCommand";
import { IPC, type SatelliteWindowStatePayload } from "../shared/ipc/contracts";

const isSmokeTest = process.argv.includes("--smoke-test");
const userDataArgument = process.argv.find((argument) => argument.startsWith("--user-data-dir="));
const requestedUserDataPath = userDataArgument?.slice("--user-data-dir=".length);
const smokeRunArgument = process.argv.find((argument) => argument.startsWith("--smoke-run-id="));
const smokeRunId = smokeRunArgument?.slice("--smoke-run-id=".length).replace(/[^a-zA-Z0-9_-]/g, "_") || String(process.pid);
const smokeResultArgument = process.argv.find((argument) => argument.startsWith("--smoke-result-path="));
const smokeResultPath = path.resolve(smokeResultArgument?.slice("--smoke-result-path=".length) || path.join(os.tmpdir(), `tasken-smoke-${smokeRunId}-result.json`));
const APP_NAME = "Tasken";
const MAIN_WINDOW_DEFAULT_WIDTH = 1760;
const MAIN_WINDOW_DEFAULT_HEIGHT = 1024;
let workspaceRepository: InstanceType<typeof WorkspaceDatabase>;
let trayController: TrayController | null = null;
let quickCaptureController: QuickCaptureController | null = null;
let todayMiniController: TodayMiniController | null = null;
let reminderController: ReminderController | null = null;
let satelliteWindows: SatelliteWindowRegistry | null = null;
let memoStickyController: MemoStickyController | null = null;
let noteWindowController: NoteWindowController | null = null;
let sharedFolderSyncService: SharedFolderSyncService | null = null;
let mcpProposalInboxService: McpProposalInboxService | null = null;
let lastSmokeStage = "startup";
const smokeTrace: string[] = [];
const readyMainWindows = new WeakSet<BrowserWindow>();
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

/**
 * 既定メニューの Ctrl+R（再読み込み）を外し、Markdown Editorの置換へ譲る（#286）。
 * 再読み込みは Ctrl+Shift+R、開発者ツールは F12 の開発者向け操作として残す。
 */
function applyApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "編集",
      submenu: [
        { role: "undo", label: "元に戻す" },
        { role: "redo", label: "やり直す" },
        { type: "separator" },
        { role: "cut", label: "切り取り" },
        { role: "copy", label: "コピー" },
        { role: "paste", label: "貼り付け" },
        { role: "selectAll", label: "すべて選択" },
      ],
    },
    {
      label: "表示",
      submenu: [
        { role: "forceReload", accelerator: "CmdOrCtrl+Shift+R", label: "再読み込み" },
        { role: "toggleDevTools", accelerator: "F12", label: "開発者ツール" },
        { type: "separator" },
        { role: "resetZoom", label: "拡大率をリセット" },
        { role: "zoomIn", label: "拡大" },
        { role: "zoomOut", label: "縮小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全画面表示" },
      ],
    },
  ]));
}

/**
 * 本体ウィンドウ以外の補助ウィンドウか。
 * 補助ウィンドウを増やすたびに各所の除外条件へ書き足すと漏れるので、判定はここだけに置く。
 * 切り離しウィンドウ（#290 / #298）は registry へ問い合わせる。
 */
function isAuxiliaryWindow(win: BrowserWindow): boolean {
  if (win === quickCaptureController?.getWindow()) return true;
  if (win === todayMiniController?.getWindow()) return true;
  return satelliteWindows?.has(win) === true;
}

function isVisibleWindow(win: BrowserWindow | null): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible());
}

/** 開いている付箋の一覧を本体へ配る。本体側で「付箋表示中」を区別するために使う（#298）。 */
function notifyMemoStickyWindowsChanged(): void {
  const openMemoIds = memoStickyController?.openMemoIds() || [];
  const stickyMemoIds = memoStickyController?.stickyMemoIds() || [];
  const openNoteIds = noteWindowController?.openNoteIds() || [];
  const state: SatelliteWindowStatePayload = {
    todayOpen: isVisibleWindow(todayMiniController?.getWindow() || null),
    openMemoIds,
    stickyMemoIds,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (isAuxiliaryWindow(win) || win.isDestroyed() || win.webContents.isLoading()) continue;
    win.webContents.send(IPC.memoStickyOpenChanged, openMemoIds);
    win.webContents.send(IPC.noteWindowOpenChanged, openNoteIds);
    win.webContents.send(IPC.satelliteWindowState, state);
  }
}

function notifyMainWindowRefresh(change?: { type: EntityType; entity: Entity } | { entities: Array<{ type: EntityType; entity: Entity }> }): void {
  const todayMiniWindow = todayMiniController?.getWindow();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!isAuxiliaryWindow(win) && !win.isDestroyed()) {
      win.webContents.send(IPC.workspaceChanged, change);
    }
  }
  // 切り離したウィンドウも同じ正本を見ているので、同じ変更を配る（#290）。
  satelliteWindows?.broadcast(IPC.workspaceChanged, change);
  if (todayMiniWindow && !todayMiniWindow.isDestroyed()) {
    todayMiniWindow.webContents.send(IPC.todayMiniRefresh);
  }
}

// 「今日やること」の一覧結果へ影響しうるEntity。ここに載らない種類では前面ウィンドウを更新しない。
const TODAY_MINI_ENTITY_TYPES = new Set<EntityType>(["task", "schedule", "theme", "project"]);

function notifyTodayMiniRefresh(types: EntityType[]): void {
  if (!types.some((type) => TODAY_MINI_ENTITY_TYPES.has(type))) return;
  const todayMiniWindow = todayMiniController?.getWindow();
  if (!todayMiniWindow || todayMiniWindow.isDestroyed()) return;
  if (todayMiniWindow.webContents.isLoading()) return;
  todayMiniWindow.webContents.send(IPC.todayMiniRefresh);
}

function notifyCommandApplied(input: CommandReceipt | CommandReceipt[], senderId: number): void {
  const receipts = (Array.isArray(input) ? input : [input]).filter((receipt) => (
    receipt.status !== "no_change" && !(receipt as CommandReceipt & { replayed?: boolean }).replayed
  ));
  if (!receipts.length) return;
  const entityChanges = receipts.flatMap((receipt) => receipt.changes);
  const eventChanges = receipts.flatMap((receipt) => receipt.eventChanges || receipt.events
    .map((eventId) => workspaceRepository?.get("change_event", eventId, true))
    .filter((event): event is Entity => Boolean(event))
    .map((event) => ({ type: "change_event" as const, entity: event })));
  const changes = [...entityChanges, ...eventChanges];
  if (!changes.length) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || isAuxiliaryWindow(win)) continue;
    const delta = win.webContents.id === senderId ? eventChanges : changes;
    if (delta.length) win.webContents.send(IPC.workspaceChanged, { entities: delta });
  }
  // Satellite windows do not issue the main command IPC, so they can always
  // receive the delta.  The mini window refreshes its projection from the same
  // repository rather than applying a second delta.
  satelliteWindows?.broadcast(IPC.workspaceChanged, { entities: changes });
  if (changes.some(({ type }) => TODAY_MINI_ENTITY_TYPES.has(type))) {
    const mini = todayMiniController?.getWindow();
    if (mini && !mini.isDestroyed() && mini.webContents.id !== senderId) mini.webContents.send(IPC.todayMiniRefresh);
  }
}

function findMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()
    .find((win) => !isAuxiliaryWindow(win) && !win.isDestroyed()) || null;
}

function showMainWindow(): BrowserWindow {
  const win = findMainWindow() || createWindow();
  const reveal = () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  if (readyMainWindows.has(win)) {
    reveal();
  } else {
    win.once("ready-to-show", reveal);
  }
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
  sketchClipboardWritten: boolean;
  sketchClipboardPasted: boolean;
  /** AI共通metadata（#294）の保存・継承・検証。 */
  aiMetadataPersisted: boolean;
  aiThemeDefaultPersisted: boolean;
  aiMetadataRejectedInvalid: boolean;
  aiVisibilityDefaultSaved: string;
}

interface SmokeReloadResult {
  persisted: boolean;
  markdownPersisted: boolean;
  markdownThemeLinked: boolean;
  markdownFrontmatterPersisted: boolean;
  markdownLiveEditPersisted: boolean;
  markdownPastePersisted: boolean;
  themeMode: string;
  aiVisibilityDefault: string;
  aiTaskMetadataPersisted: boolean;
  settingsReloadRestored: boolean;
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
  lastSmokeStage = stage;
  smokeTrace.push(stage);
  if (smokeTrace.length > 40) smokeTrace.shift();
  fs.mkdirSync(path.dirname(smokeResultPath), { recursive: true });
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
    const smokeUserDataPath = path.join(app.getPath("temp"), `tasken-smoke-${smokeRunId}-userData`);
    app.setPath("userData", smokeUserDataPath);
    recordSmoke("main-started");
    setTimeout(() => {
      const previousStage = lastSmokeStage;
      recordSmoke("timeout", { previousStage, trace: [...smokeTrace] });
      app.exit(1);
    }, 180000);
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
  recordSmoke("core-start");
  const created = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.__taskenSmokeDiagnostics = { rendererErrors: [] };
      window.addEventListener("error", (event) => {
        window.__taskenSmokeDiagnostics.rendererErrors.push({
          kind: "error",
          message: event.message,
          filename: event.filename,
          line: event.lineno,
          column: event.colno,
        });
      });
      window.addEventListener("unhandledrejection", (event) => {
        window.__taskenSmokeDiagnostics.rendererErrors.push({
          kind: "unhandledrejection",
          message: String(event.reason?.stack || event.reason || "unknown rejection"),
        });
      });
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
      // Notesの作成は一つのprimary actionへ集約した（#313）。filterの種別buttonと取り違えない。
      const clickCreateNote = async () => {
        const button = await waitFor(
          () => document.querySelector(".notes-page .note-create-primary"),
          "Note作成ボタン",
        );
        button.click();
      };
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
      const mermaidDiagnostics = () => ({
        activeElement: document.activeElement?.outerHTML?.slice(0, 300) || "",
        notePane: Boolean(document.querySelector(".note-preview-panel")),
        mermaidBlocks: [...document.querySelectorAll(".note-mermaid-code-block")].map((block) => ({
          className: block.className,
          text: block.textContent?.slice(0, 300) || "",
          svgCount: block.querySelectorAll(".md-mermaid-svg svg").length,
          errorText: block.querySelector(".md-mermaid-error")?.textContent || "",
          html: block.innerHTML.slice(0, 1200),
        })),
        markdownBlocks: [...document.querySelectorAll("[data-mermaid='true']")].map((block) => ({
          className: block.className,
          text: block.textContent?.slice(0, 300) || "",
          svgCount: block.querySelectorAll(".md-mermaid-svg svg").length,
          errorText: block.querySelector(".md-mermaid-error")?.textContent || "",
        })),
        rendererErrors: window.__taskenSmokeDiagnostics.rendererErrors,
      });

      // Note 作成: ドロワーはタイトル等のメタのみ。本文は中央エリアが正本。
      (await waitForButton("Notes")).click();
      await waitFor(() => document.querySelector(".notes-page"), "Notes page");
      await clickCreateNote();
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
      await clickCreateNote();
      await delay(100);
      const markdownForm = await waitFor(() => document.querySelector(".drawer-form"), "Markdown入力フォーム");
      const markdownTitleInput = markdownForm.querySelector('input[name="title"]');
      const markdownTheme = markdownForm.querySelector('input[name="theme_id"]');
      if (!markdownTitleInput || !markdownTheme) throw new Error("Markdown入力フォームの項目が見つかりません");
      setInputValue(markdownTitleInput, ${JSON.stringify(markdownTitle)});
      // Theme保存のworkspace change通知を待って、実際の共通ThemeSelectを操作する。
      // hidden inputへの直接fallbackはproduct pathを検証しないため持たない。
      const smokeThemeChip = await waitFor(
        () => [...markdownForm.querySelectorAll(".theme-chip")]
          .find((candidate) => candidate.textContent?.trim() === "Smoke Theme"),
        "Smoke Theme chip",
      );
      smokeThemeChip.click();
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
          // 画面チャンクのアイドル先読み中でも、添付プロトコルの画像デコード完了を待つ。
          setTimeout(resolve, 2000);
        });
      }
      const markdownImageRendered = Boolean(
        smokePreviewImage?.getAttribute("src")?.startsWith("tasken-attachment://")
        && smokePreviewImage?.naturalWidth > 0
      );

      // 全文コピーは「この文書」menuの項目へ移した（#313 / #331）。
      clickPaneButton(notesPane, "この文書");
      await delay(160);
      const copyBodyItem = [...notesPane.querySelectorAll(".toolbar-menu-list button")]
        .find((candidate) => candidate.textContent.trim() === "本文をすべてコピー");
      if (!copyBodyItem) throw new Error("本文をすべてコピー が「この文書」menuに見つかりません。");
      copyBodyItem.click();
      await delay(160);
      const rawCopyNotified = document.body.innerText.includes("本文をコピーしました。");

      // Edit（Live Preview）面での追記・貼り付け
      clickPaneButton(notesPane, "Edit");
      const liveEditable = await waitFor(
        () => document.querySelector(".note-preview-panel .note-mdx-content[contenteditable='true']"),
        "Live Preview編集面",
        40,
      );
      notesPane = liveEditable.closest(".note-preview-panel");
      if (!notesPane) throw new Error("Live Preview編集面の親パネルが見つかりません。");
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
      const mermaidPreviewTarget = notesPane?.querySelector(".note-mermaid-preview .md-mermaid-block")
        || notesPane?.querySelector(".note-mermaid-preview-frame");
      mermaidPreviewTarget?.scrollIntoView({ block: "center", inline: "nearest" });
      await delay(0);
      let mermaidPreviewInEdit;
      try {
        mermaidPreviewInEdit = await waitFor(
          () => notesPane?.querySelector(".note-mermaid-code-block.is-preview .md-mermaid-svg svg"),
          "Edit面のMermaid Preview",
          80,
        );
      } catch (error) {
        const diagnostics = mermaidDiagnostics();
        console.error("Mermaid smoke diagnostics: " + JSON.stringify(diagnostics));
        throw new Error(String(error) + " diagnostics=" + JSON.stringify(diagnostics));
      }
      const notesMermaidRenderedInEdit = Boolean(mermaidPreviewInEdit);
      mermaidPreviewInEdit.closest(".note-mermaid-preview-frame")?.click();
      const mermaidCodeEditor = await waitFor(
        () => notesPane?.querySelector(".note-mermaid-code-block.is-editing .cm-editor"),
        "Mermaidコード編集面",
        80,
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
      const savedNotesPane = await waitFor(
        () => {
          const currentNotesPane = document.querySelector(".note-preview-panel");
          return currentNotesPane?.querySelector(".note-draft-state")?.textContent?.trim() === "保存しました"
            ? currentNotesPane
            : null;
        },
        "Live Preview保存状態",
        40,
      );
      notesPane = savedNotesPane;
      const notesLiveEditSaved = notesLiveEditRendered && Boolean(savedNotesPane);
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
      await clickCreateNote();
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
      // AI共通metadata（#294）: 保存 → 再読込 → 公開範囲の継承まで正本データで確認する。
      await window.api.preferences.set("aiVisibilityDefault", ["coding_agent"]);
      const aiVisibilityDefaultSaved = await window.api.preferences.get("aiVisibilityDefault");
      await window.api.entities.save("theme", {
        id: ${JSON.stringify(smokeThemeId)},
        name: "Smoke Theme",
        code: "SMOKE",
        status: "active",
        default_ai_visibility: ["m365"]
      });
      const smokeTaskReceipt = await window.api.commands.execute({
        commandId: crypto.randomUUID(),
        name: "CreateTask",
        payload: { task: {
          id: ${JSON.stringify(smokeTaskId)},
          title: ${JSON.stringify(smokeTaskTitle)},
          project_id: ${JSON.stringify(smokeThemeId)},
          state: "todo",
          priority: "high",
          checklist_items: [{ id: "mini-1", title: "smoke", done: false, sort_order: 0 }],
          created_at: new Date().toISOString(),
          ai_summary: "Todayミニの動作確認",
          ai_summary_authority: "user_confirmed",
          ai_freshness: "current",
          ai_authority: "user_confirmed",
          ai_visibility: ["coding_agent"],
          ai_source_refs: [{ kind: "canonical_document", locator: "smoke.md", storage_root_id: "smoke-root" }]
        } },
        actor: { kind: "user", id: "electron-smoke" },
        source: "main_ui",
        issuedAt: new Date().toISOString(),
      });
      const smokeTaskVersion = smokeTaskReceipt.saved.find((entry) => entry.type === "task")?.version || 0;
      let aiMetadataRejectedInvalid = false;
      try {
        await window.api.commands.execute({
          commandId: crypto.randomUUID(),
          name: "UpdateTask",
          payload: { task: {
            id: ${JSON.stringify(smokeTaskId)},
            title: ${JSON.stringify(smokeTaskTitle)},
            state: "todo",
            ai_authority: "guessed"
          } },
          actor: { kind: "user", id: "electron-smoke" },
          source: "main_ui",
          expectedVersions: [{ type: "task", id: ${JSON.stringify(smokeTaskId)}, version: smokeTaskVersion }],
          issuedAt: new Date().toISOString(),
        });
      } catch {
        aiMetadataRejectedInvalid = true;
      }
      const reloadedWorkspace = await window.api.workspace.load();
      const reloadedSmokeTask = (reloadedWorkspace.tasks || []).find((task) => task.id === ${JSON.stringify(smokeTaskId)});
      const reloadedSmokeTheme = (reloadedWorkspace.themes || []).find((theme) => theme.id === ${JSON.stringify(smokeThemeId)});
      const aiMetadataPersisted = reloadedSmokeTask?.ai_summary === "Todayミニの動作確認"
        && reloadedSmokeTask?.ai_freshness === "current"
        && Array.isArray(reloadedSmokeTask?.ai_visibility)
        && reloadedSmokeTask.ai_visibility.join(",") === "coding_agent"
        && reloadedSmokeTask?.ai_source_refs?.[0]?.storage_root_id === "smoke-root";
      const aiThemeDefaultPersisted = reloadedSmokeTheme?.default_ai_visibility?.join(",") === "m365";
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
      const sketchClipboardCanvas = document.createElement("canvas");
      sketchClipboardCanvas.width = 8;
      sketchClipboardCanvas.height = 8;
      const sketchClipboardContext = sketchClipboardCanvas.getContext("2d");
      if (!sketchClipboardContext) throw new Error("Sketch clipboard smoke canvas is unavailable.");
      sketchClipboardContext.fillStyle = "#8a2f3b";
      sketchClipboardContext.fillRect(0, 0, 8, 8);
      const sketchClipboardWritten = await window.api.clipboard.writeImage({
        dataUrl: sketchClipboardCanvas.toDataURL("image/png")
      });
      const savedBeforeSettingsRoute = [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(testTitle)}));
      const markdownSavedBeforeSettingsRoute = [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(markdownTitle)}));

      return {
        title: document.title,
        rootReady: Boolean(document.querySelector("#root > *")),
        smokeTaskId: ${JSON.stringify(smokeTaskId)},
        smokeTaskTitle: ${JSON.stringify(smokeTaskTitle)},
        todayMiniWindowOpened,
        saved: savedBeforeSettingsRoute,
        markdownSaved: markdownSavedBeforeSettingsRoute,
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
        sketchClipboardWritten,
        aiMetadataPersisted,
        aiThemeDefaultPersisted,
        aiMetadataRejectedInvalid,
        aiVisibilityDefaultSaved: Array.isArray(aiVisibilityDefaultSaved)
          ? aiVisibilityDefaultSaved.join(",")
          : String(aiVisibilityDefaultSaved),
      };
    })()
  `) as SmokeCreatedResult;

  await window.webContents.executeJavaScript(`
    (() => {
      const target = document.createElement("div");
      target.id = "sketch-clipboard-smoke-target";
      target.contentEditable = "true";
      target.style.position = "fixed";
      target.style.left = "-10000px";
      document.body.append(target);
      target.focus();
    })()
  `);
  window.webContents.paste();
  await new Promise((resolve) => setTimeout(resolve, 100));
  created.sketchClipboardPasted = await window.webContents.executeJavaScript(`
    (() => {
      const target = document.querySelector("#sketch-clipboard-smoke-target");
      const pasted = Boolean(target?.querySelector("img"));
      target?.remove();
      return pasted;
    })()
  `) as boolean;

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
  recordSmoke("markdown-edit-complete");

  window.show();
  window.focus();
  window.webContents.focus();
  const settingsNavigation = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (finder, label, attempts = 50) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const target = finder();
          if (target) return target;
          await delay(100);
        }
        throw new Error(label + " が見つかりません。画面: " + document.body.innerText.slice(0, 1000));
      };
      const activeCategory = (label) => [...document.querySelectorAll(".settings-category-nav button")]
        .find((button) => button.getAttribute("aria-current") === "page" && button.querySelector("strong")?.textContent?.trim() === label);
      const storageIsActive = () => window.location.hash === "#settings/storage" && Boolean(activeCategory("Storage & Files"));
      window.location.hash = "settings/storage";
      await waitFor(storageIsActive, "Settings Storage deep link");
      const appearanceButton = [...document.querySelectorAll(".settings-category-nav button")]
        .find((button) => button.querySelector("strong")?.textContent?.trim() === "Appearance");
      if (!appearanceButton) throw new Error("Appearance category button が見つかりません。");
      appearanceButton.focus();
      return {
        storageDeepLink: storageIsActive(),
        categoryButtonFocused: document.activeElement === appearanceButton,
      };
    })()
  `) as {
    storageDeepLink: boolean;
    categoryButtonFocused: boolean;
  };
  const nativeFocusBeforeKey = await window.webContents.executeJavaScript(`
    (() => {
      const target = [...document.querySelectorAll(".settings-category-nav button")]
        .find((button) => button.querySelector("strong")?.textContent?.trim() === "Appearance");
      window.__taskenSmokeInputTrusted = false;
      window.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.isTrusted) window.__taskenSmokeInputTrusted = true;
      });
      target?.focus();
      return { focused: document.activeElement === target };
    })()
  `) as {
    focused: boolean;
  };
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
  window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
  const settingsKeyboard = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const appearanceIsActive = () => window.location.hash === "#settings/appearance"
        && Boolean([...document.querySelectorAll(".settings-category-nav button")]
          .find((button) => button.getAttribute("aria-current") === "page" && button.querySelector("strong")?.textContent?.trim() === "Appearance"));
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (appearanceIsActive()) break;
        await delay(100);
      }
      return {
        appearanceIsActive: appearanceIsActive(),
        inputTrusted: Boolean(window.__taskenSmokeInputTrusted),
      };
    })()
  `) as {
    appearanceIsActive: boolean;
    inputTrusted: boolean;
  };
  const settingsHistory = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (finder, label, attempts = 50) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const target = finder();
          if (target) return target;
          await delay(100);
        }
        throw new Error(label + " が見つかりません。画面: " + document.body.innerText.slice(0, 1000));
      };
      const storageIsActive = () => window.location.hash === "#settings/storage"
        && Boolean([...document.querySelectorAll(".settings-category-nav button")]
          .find((button) => button.getAttribute("aria-current") === "page" && button.querySelector("strong")?.textContent?.trim() === "Storage & Files"));
      history.back();
      await waitFor(storageIsActive, "Settings history.back Storage restore");
      return { storageRestored: storageIsActive() };
    })()
  `) as { storageRestored: boolean };
  recordSmoke("settings-complete");
  const settingsStorageBeforeReload = settingsHistory.storageRestored;

  window.webContents.once("did-finish-load", async () => {
    try {
      const afterReload = await window.webContents.executeJavaScript(`
        Promise.all([
          window.api.entities.list("note"),
          window.api.preferences.get("themeMode"),
          window.api.preferences.get("aiVisibilityDefault"),
          window.api.entities.list("task"),
        ]).then(async ([notes, themeMode, aiVisibilityDefault, tasks]) => {
          const markdown = notes.find((note) => note.title === ${JSON.stringify(markdownTitle)});
          const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const settingsReloadRestored = await (async () => {
            for (let attempt = 0; attempt < 50; attempt += 1) {
              const restored = window.location.hash === "#settings/storage"
                && [...document.querySelectorAll(".settings-category-nav button")]
                  .some((button) => button.getAttribute("aria-current") === "page" && button.querySelector("strong")?.textContent?.trim() === "Storage & Files");
              if (restored) return true;
              await delay(100);
            }
            return false;
          })();
          return ({
          persisted: notes.some((note) => note.title === ${JSON.stringify(testTitle)}),
          markdownPersisted: Boolean(markdown?.body_markdown?.includes("Markdown Preview")),
          // Smoke Theme chipの選択値がcanonical Noteへ届くことを厳密に確認する。
          markdownThemeLinked: markdown?.project_id === ${JSON.stringify(smokeThemeId)},
          markdownFrontmatterPersisted: Boolean(markdown?.body_markdown?.includes("type: report")),
          markdownLiveEditPersisted: Boolean(markdown?.body_markdown?.includes("Live edit smoke")),
          markdownPastePersisted: Boolean(markdown?.body_markdown?.includes("## Pasted Markdown Heading") && markdown?.body_markdown?.includes("**Pasted Bold Text**")),
          themeMode,
          aiVisibilityDefault: Array.isArray(aiVisibilityDefault) ? aiVisibilityDefault.join(",") : String(aiVisibilityDefault),
          aiTaskMetadataPersisted: Boolean(
            tasks.find((task) => task.id === ${JSON.stringify(smokeTaskId)})?.ai_summary === "Todayミニの動作確認"
          ),
          settingsReloadRestored,
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
        aiVisibilityDefaultAfterReload: afterReload.aiVisibilityDefault,
        aiMetadataPersistedAfterReload: afterReload.aiTaskMetadataPersisted,
        settingsDeepLink: settingsNavigation.storageDeepLink,
        settingsKeyboardFocus: settingsNavigation.categoryButtonFocused && nativeFocusBeforeKey.focused,
        settingsKeyboardTransition: settingsKeyboard.appearanceIsActive,
        settingsHistoryBackRestored: settingsHistory.storageRestored,
        settingsReloadRestored: afterReload.settingsReloadRestored,
        settingsKeyboardInputTrusted: settingsKeyboard.inputTrusted,
        settingsStorageBeforeReload,
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
        && result.sketchClipboardWritten
        && result.sketchClipboardPasted
        && result.themeMode === "dark"
        && result.themeModeAfterReload === "dark"
        && result.aiMetadataPersisted
        && result.aiThemeDefaultPersisted
        && result.aiMetadataRejectedInvalid
        && result.aiVisibilityDefaultSaved === "coding_agent"
        && result.aiMetadataPersistedAfterReload
        && result.aiVisibilityDefaultAfterReload === "coding_agent"
        && result.settingsDeepLink
        && result.settingsKeyboardFocus
        && result.settingsKeyboardInputTrusted
        && result.settingsKeyboardTransition
        && result.settingsHistoryBackRestored
        && result.settingsStorageBeforeReload
        && result.settingsReloadRestored
          ? 0
          : 1,
      );
    } catch (error) {
      console.error(error);
      recordSmoke("reload-check-failed", { error: String(error) });
      app.exit(1);
    }
  });
  recordSmoke("reload-start");
  window.reload();
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    minWidth: 980,
    minHeight: 680,
    show: false,
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

  if (isSmokeTest) {
    // Show the smoke-only window before the renderer starts so IntersectionObserver
    // observes the same visible lazy path as production without stealing focus.
    window.setOpacity(0);
    window.showInactive();
  }

  window.once("ready-to-show", () => {
    readyMainWindows.add(window);
    if (!isSmokeTest) window.show();
  });
  window.webContents.once("did-finish-load", () => {
    if (isSmokeTest) {
      runSmokeTest(window).catch(async (error: unknown) => {
        let diagnostics: unknown = null;
        try {
          diagnostics = await window.webContents.executeJavaScript(`
            (() => ({
              url: location.href,
              title: document.title,
              notePane: Boolean(document.querySelector(".note-preview-panel")),
              mermaidBlocks: [...document.querySelectorAll(".note-mermaid-code-block")].map((block) => ({
                className: block.className,
                text: block.textContent?.slice(0, 300) || "",
                svgCount: block.querySelectorAll(".md-mermaid-svg svg").length,
                errorText: block.querySelector(".md-mermaid-error")?.textContent || "",
                html: block.innerHTML.slice(0, 1200),
              })),
              rendererErrors: window.__taskenSmokeDiagnostics?.rendererErrors || [],
            }))()
          `);
        } catch (diagnosticError) {
          diagnostics = { captureError: String(diagnosticError) };
        }
        const failure = { error: String(error), diagnostics };
        console.error("Electron smoke failure: " + JSON.stringify(failure));
        recordSmoke("failed", failure);
        app.exit(1);
      });
    }
  });
  window.webContents.on("console-message", ({ level, message, lineNumber: line, sourceId }) => {
    if (!isSmokeTest) return;
    if (level !== "warning" && level !== "error" && !/mermaid|markdown|unhandled|exception/i.test(message)) return;
    const entry = { level, message, line, sourceId };
    recordSmoke("renderer-console", entry);
    console.error("Renderer console: " + JSON.stringify(entry));
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

async function startDesktopApp(): Promise<void> {
  await app.whenReady();
  migrateLegacyUserDataIfNeeded();
  registerAttachmentProtocol();
  workspaceRepository = new WorkspaceDatabase(path.join(app.getPath("userData"), "research-desk.sqlite"));
  const applicationCommands = new ApplicationCommandService(workspaceRepository);
  sharedFolderSyncService = new SharedFolderSyncService(
    workspaceRepository,
    notifyMainWindowRefresh,
    path.join(app.getPath("userData"), "attachments", "markdown-images"),
  );
  registerIpc(
    workspaceRepository,
    new WorkspaceService(workspaceRepository, app.getPath("userData")),
    sharedFolderSyncService,
    new AiProviderService(app.getPath("userData")),
    new CalendarService(app.getPath("userData"), safeStorage, fetch, (url) => shell.openExternal(url)),
    applicationCommands,
    (types) => {
      notifyMainWindowRefresh();
      notifyTodayMiniRefresh(types);
    },
    notifyCommandApplied,
  );
  mcpProposalInboxService = new McpProposalInboxService(
    workspaceRepository,
    app.getPath("userData"),
    (entities: Entity[]) => notifyMainWindowRefresh({
      entities: entities.map((entity) => ({ type: "ai_proposal", entity })),
    }),
  );
  mcpProposalInboxService.start();
  // 切り離しウィンドウの共通基盤（#290）。位置・サイズは端末ごとの見え方なので
  // 正本DBではなくuserData配下のJSONへ置き、別端末へ同期させない。
  satelliteWindows = createSatelliteWindowRegistry({
    stateFilePath: path.join(app.getPath("userData"), "satellite-windows.json"),
    getAppIconPath,
    // 付箋の開閉を本体の一覧へ即時反映する（#298）。
    onChanged: () => notifyMemoStickyWindowsChanged(),
    resolvePageUrl: (page) => (
      process.env.ELECTRON_RENDERER_URL
        ? { url: `${process.env.ELECTRON_RENDERER_URL}/${page}.html` }
        : { file: path.join(__dirname, `../renderer/${page}.html`) }
    ),
  });
  ipcMain.handle(IPC.satelliteWindowState, () => ({
    todayOpen: isVisibleWindow(todayMiniController?.getWindow() || null),
    openMemoIds: memoStickyController?.openMemoIds() || [],
    stickyMemoIds: memoStickyController?.stickyMemoIds() || [],
  } satisfies SatelliteWindowStatePayload));
  memoStickyController = createMemoStickyController({
    repository: workspaceRepository,
    satelliteWindows,
    showMainWindow,
    notifyWorkspaceChanged: notifyMainWindowRefresh,
  });
  memoStickyController.registerIpc();
  noteWindowController = createNoteWindowController({
    repository: workspaceRepository,
    satelliteWindows,
    showMainWindow,
  });
  noteWindowController.registerIpc();
  quickCaptureController = createQuickCaptureController({
    repository: workspaceRepository,
    notifyWorkspaceChanged: notifyMainWindowRefresh,
    notifyCommandApplied,
    executeCommand: (envelope) => applicationCommands.execute(envelope),
  });
  quickCaptureController.registerIpc();
  todayMiniController = createTodayMiniController({
    repository: workspaceRepository,
    satelliteWindows,
    showMainWindow,
    notifyWorkspaceChanged: notifyMainWindowRefresh,
    notifyCommandApplied,
    executeCommand: (envelope) => applicationCommands.execute(envelope),
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
  applyApplicationMenu();
  createWindow();

  if (!isSmokeTest) {
    sharedFolderSyncService.start();
    trayController.setup();
    reminderController.start();
    globalShortcut.register("CmdOrCtrl+Shift+N", () => quickCaptureController?.show("inbox"));
    globalShortcut.register("CmdOrCtrl+Shift+M", () => quickCaptureController?.show("today-task"));
    globalShortcut.register("CmdOrCtrl+Shift+D", () => quickCaptureController?.show("due-task"));
    globalShortcut.register("CmdOrCtrl+Shift+,", () => quickCaptureController?.show("done-task"));
    globalShortcut.register("CmdOrCtrl+Shift+.", () => quickCaptureController?.show("micro-memo"));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  console.warn("Tasken is already running. Reusing the existing application instance.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) showMainWindow();
  });
  void startDesktopApp().catch((error: unknown) => {
    console.error("Tasken failed to start.", error);
    recordSmoke("startup-failed", { error: String(error) });
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
    // トレイ常駐中はメインウィンドウを閉じてもアプリを終了しない
    if (process.platform === "darwin") return;
    if (trayController?.isActive()) return;
    app.quit();
});

app.on("before-quit", () => {
    sharedFolderSyncService?.stop();
    mcpProposalInboxService?.stop();
});

app.on("will-quit", () => {
    reminderController?.stop();
    globalShortcut.unregisterAll();
});
