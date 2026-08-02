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

test("AI handoff is an explicit image-then-prompt flow", () => {
  assert.match(page, /1\. AIへ画像をコピー/);
  assert.match(page, /2\. AI向け指示をコピー/);
  assert.match(page, /copyImageForAi/);
  assert.match(page, /copyAiPrompt/);
  assert.match(page, /workspaceApi\.copyText\(sketchAiPrompt\(selected\.title\)\)/);
});

test("desktop smoke crosses the native Sketch clipboard boundary", () => {
  assert.match(smoke, /sketchClipboardWritten/);
  assert.match(smoke, /sketchClipboardPasted/);
  assert.match(smoke, /window\.api\.clipboard\.writeSketch/);
  assert.match(smoke, /window\.webContents\.paste\(\)/);
  assert.match(smoke, /target\?\.querySelector\("img"\)/);
  assert.match(smoke, /&& result\.sketchClipboardWritten/);
  assert.match(smoke, /&& result\.sketchClipboardPasted/);
});
