import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

function source(relativePath) {
  return readFileSync(path.resolve(relativePath), "utf8");
}

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

test("Sticky defaults to normal z-order and keeps the full palette reachable", () => {
  const controller = source("src/main/memoStickyController.ts");
  const markup = source("src/renderer/memo-sticky.html");
  assert.match(controller, /alwaysOnTop:\s*false/);
  const menuBlock = markup.match(/\.menu\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
  assert.match(menuBlock, /max-height:\s*calc\(100vh - 52px\)/);
  assert.match(menuBlock, /overflow-y:\s*auto/);
  assert.match(markup, /data-color="neutral"/);
});

test("Sticky windows can be minimized without closing the memo and restored from Inbox", () => {
  const controller = source("src/main/memoStickyController.ts");
  const markup = source("src/renderer/memo-sticky.html");
  const inbox = source("src/renderer/src/features/workspace/pages/InboxPage.tsx");
  assert.match(controller, /IPC\.memoStickyMinimize/);
  assert.match(controller, /await flushWindow\(window\)/);
  assert.match(controller, /window\.minimize\(\)/);
  assert.match(markup, /id="minimize"/);
  assert.match(markup, /api\.minimize\(\)/);
  assert.match(inbox, /showMicroMemoSticky/);
  assert.match(inbox, /title="表示"/);
});

test("Inbox Sticky filters and color picker use named visual swatches", () => {
  const inbox = source("src/renderer/src/features/workspace/pages/InboxPage.tsx");
  const styles = source("src/renderer/src/styles/app.css");
  assert.match(inbox, /function StickyColorSwatch/);
  assert.match(inbox, /function StickyColorFilter/);
  assert.match(inbox, /function StickyColorPicker/);
  assert.match(inbox, /StickyColorSwatch color=/);
  assert.match(styles, /\.sticky-color-swatch/);
  assert.match(styles, /\.sticky-color-filter-options/);
  assert.match(styles, /\.micro-memo-color-options/);
});

test("quick capture keeps the record action stable when preview text is long", () => {
  const capture = source("src/renderer/capture.html");
  const sticky = source("src/renderer/memo-sticky.html");
  assert.match(capture, /\.capture-form[\s\S]*min-width: 0[\s\S]*overflow: hidden/);
  assert.match(capture, /\.due-preview[\s\S]*text-overflow: ellipsis/);
  assert.match(capture, /\.capture-actions[\s\S]*flex: 0 0 auto/);
  assert.match(capture, /white-space: nowrap/);
  assert.match(sticky, /\.palette button \{ width: 100%/);
});

test("Checklist persistence does not put mutable rows in the TaskFields key", () => {
  const drawer = source("src/renderer/src/features/workspace/components/drawer.tsx");
  const keyBlock = drawer.match(/const taskChecklistEditorKey[\s\S]*?: "";/)?.[0] || "";
  assert.match(keyBlock, /entityId/);
  assert.match(keyBlock, /_focusChecklistItem/);
  assert.doesNotMatch(keyBlock, /JSON\.stringify|checklist_items/);
});

test("Focus finish defaults to task completion while scratchpad promotion stays explicit", () => {
  const focus = source("src/renderer/src/features/workspace/components/FocusSessionDialog.tsx");
  assert.match(focus, /const \[completeTask, setCompleteTask\] = useState\(true\);/);
  assert.match(focus, /const \[keepScratchpad, setKeepScratchpad\] = useState\(false\);/);
  assert.match(focus, /keepScratchpad\s*&&\s*scratchpad\.trim\(\)/);
});

test("Chat Refs exposes a direct original-chat action on rows with URLs", () => {
  const page = source("src/renderer/src/features/workspace/pages/ChatRefsPage.tsx");
  assert.match(page, /chat-open-original-action/);
  assert.match(page, /openChatUrl\(r\)/);
  assert.match(page, /title="元チャットを開く"/);
  assert.match(page, /IconExternalLink/);
});

test("Chat Refs uses a fixed right-to-up connector beside the favorite action", () => {
  const page = source("src/renderer/src/features/workspace/pages/ChatRefsPage.tsx");
  assert.match(page, /className="chat-thread-connector"/);
  assert.match(page, /d="M21 17H4V4"/);
  assert.match(page, /d="m1 7 3-3 3 3"/);
  assert.match(page, /chat-row-drag-handle[\s\S]*chat-thread-connector[\s\S]*chat-star/);
});

test("Timeline restores the stored scroll after preferences load and exposes empty Theme milestone lanes", async () => {
  const page = source("src/renderer/src/features/workspace/pages/TimelinePage.tsx");
  assert.match(page, /preferenceLoad\.isReady/);
  assert.match(page, /preferenceLoad\.hasStoredValue/);
  assert.match(page, /createMilestone\(/);
  assert.match(page, /マイルストーンを追加/);
  assert.match(page, /gantt-name-meta/);

  const timeline = await importBundled("src/renderer/src/features/workspace/lib/timeline.ts");
  const rows = timeline.buildTimelineRows({
    items: [],
    themes: [{ id: "theme-empty", name: "空Theme" }],
    collapsedThemes: [],
    scale: "month",
  });
  assert.deepEqual(
    rows.map((row) => row.rowType),
    ["theme", "milestones"],
  );
  assert.equal(rows[1].milestones.length, 0);
});

test("Todo supports an explicit bulk Theme reassignment without hidden rows", () => {
  const page = source("src/renderer/src/features/workspace/pages/TodoPage.tsx");
  assert.match(page, /selectedVisibleRows/);
  assert.match(page, /bulk_theme_reassigned/);
  assert.match(page, /buildSaveTaskOperations/);
  assert.match(page, /todo-bulk-bar/);
  assert.match(page, /todo-row-selector/);
});

test("Theme report prompts use the canonical prompt contract and keep copy/edit separate", () => {
  const page = source("src/renderer/src/features/workspace/pages/ThemePage.tsx");
  const addPrompt = page.match(/function addPrompt\(\)[\s\S]*?function editPrompt/)?.[0] || "";
  assert.match(addPrompt, /note_type: "prompt"/);
  assert.match(addPrompt, /prompt_purpose: "report"/);
  assert.doesNotMatch(addPrompt, /note_type: "report_prompt"/);
  assert.match(page, /function editPrompt/);
  assert.match(page, /プロンプトを編集/);
  assert.match(page, /copyNoteText\(defaultPrompt/);
});

test("Shortcut labels follow the host OS without changing accelerator storage", async () => {
  const taskenRoot = await importBundled("src/shared/taskenRoot.ts");
  assert.equal(
    taskenRoot.formatShortcutLabel("CommandOrControl+Shift+Space", "Win32"),
    "Ctrl+Shift+Space",
  );
  assert.equal(
    taskenRoot.formatShortcutLabel("CommandOrControl+Shift+Space", "MacIntel"),
    "⌘⇧Space",
  );
  assert.equal(taskenRoot.DEFAULT_ROOT_SHORTCUT, "CommandOrControl+Shift+Space");
  const settings = source("src/renderer/src/features/workspace/pages/SettingsPage.tsx");
  assert.match(settings, /formatShortcutLabel\(\s*definition\.accelerator/);
});
