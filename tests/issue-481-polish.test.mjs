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
  assert.match(settings, /formatShortcutLabel\(definition\.accelerator/);
});
