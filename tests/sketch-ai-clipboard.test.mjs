import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const service = read("src/main/services/workspaceService.ts");
const page = read("src/renderer/src/features/workspace/pages/SketchPage.tsx");
const shared = read("src/shared/sketchExport.ts");
const smoke = read("src/main/index.ts");

test("Sketch image clipboard uses an image-only Windows write with read-back verification", () => {
  assert.match(service, /clipboard\.clear\(\)/);
  assert.match(service, /clipboard\.writeImage\(image\)/);
  assert.match(service, /clipboard\.readImage\(\)/);
  assert.match(service, /writtenSize\.width !== expectedSize\.width/);
  assert.doesNotMatch(service, /clipboard\.write\(\{ text: payload\.text, image \}\)/);
  assert.doesNotMatch(shared, /text: string/);
});

test("画像コピーはAI専用ではなく通常のclipboard操作にする（#320）", () => {
  // AI専用文言とpromptの自動付加をやめ、一般のclipboard consumerへ貼れる操作へ戻す。
  assert.doesNotMatch(page, /AIへ画像をコピー/);
  assert.doesNotMatch(page, /AI向け指示をコピー/);
  assert.doesNotMatch(page, /sketchAiPrompt/);
  assert.match(page, /async function copyImage\(\)/);
  assert.match(
    page,
    /<button[^>]*onClick=\{\(\) => void copyImage\(\)\}>\s*<IconCopy size=\{15\} \/>\s*画像をコピー\s*<\/button>/,
  );
  assert.match(page, /setToast\("Sketch画像をコピーしました。", "success"\)/);
});

test("desktop smoke crosses the native Sketch clipboard boundary", () => {
  assert.match(smoke, /sketchClipboardWritten/);
  assert.match(smoke, /sketchClipboardPasted/);
  assert.match(smoke, /window\.api\.clipboard\.writeImage/);
  assert.match(smoke, /window\.webContents\.paste\(\)/);
  assert.match(smoke, /target\?\.querySelector\("img"\)/);
  assert.match(smoke, /&&\s*result\.sketchClipboardWritten/);
  assert.match(smoke, /&&\s*result\.sketchClipboardPasted/);
});
