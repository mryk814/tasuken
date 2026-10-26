import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const service = read("src/main/services/workspaceService.ts");
const page = read("src/renderer/src/features/workspace/pages/SketchPage.tsx");
const shared = read("src/shared/sketchExport.ts");
const smoke = read("src/main/index.ts");

test("Sketch image clipboard uses an image-only ClipboardItem write with read-back verification", () => {
  assert.match(service, /async writeClipboardImage\(payloadValue: unknown\): Promise<boolean>/);
  assert.match(
    service,
    /await clipboard\.write\(\[\s*new ClipboardItem\(\{\s*"image\/png": new Blob\(/s,
  );
  assert.match(service, /const writtenItems = await clipboard\.read\(\)/);
  assert.match(
    service,
    /const imageItem = writtenItems\.find\(\(item\) => item\.types\.includes\("image\/png"\)\)/,
  );
  assert.match(service, /await imageItem\.getType\("image\/png"\)/);
  assert.match(service, /nativeImage\.createFromBuffer/);
  assert.match(service, /writtenSize\.width !== expectedSize\.width/);
  assert.doesNotMatch(
    service,
    /clipboard\.(writeImage|readImage|writeBuffer|readBuffer|availableFormats)/,
  );
  assert.doesNotMatch(shared, /text: string/);
});

test("rich text and SVG clipboard writes use atomic MIME-typed ClipboardItems", () => {
  assert.match(service, /async writeClipboard\(text: unknown\): Promise<boolean>/);
  assert.match(service, /await clipboard\.writeText\(String\(text\)\)/);
  assert.match(service, /async writeClipboardHtml\(payload: unknown\): Promise<boolean>/);
  assert.match(service, /new ClipboardItem\(\{\s*"text\/html": html,\s*"text\/plain": text/s);
  assert.match(
    service,
    /async writeClipboardSvg\(payloadValue: unknown\): Promise<MermaidSvgClipboardResult>/,
  );
  assert.match(service, /"image\/svg\+xml": svg/);
  assert.match(service, /const items = await clipboard\.read\(\)/);
  assert.match(
    service,
    /const svgItem = items\.find\(\(item\) => item\.types\.includes\("image\/svg\+xml"\)\)/,
  );
  assert.match(service, /await \(await svgItem\.getType\("image\/svg\+xml"\)\)\.text\(\)/);
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
