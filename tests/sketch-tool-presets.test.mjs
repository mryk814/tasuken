import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

const presets = await importBundled("src/renderer/src/features/workspace/lib/sketchToolPresets.ts");
const pageSource = readFileSync("src/renderer/src/features/workspace/pages/SketchPage.tsx", "utf8");
const registrySource = readFileSync("src/shared/viewPreferenceRegistry.mjs", "utf8");

test("pen highlighter and eraser start with independent practical defaults", () => {
  assert.deepEqual(presets.DEFAULT_SKETCH_TOOL_PRESETS.pen, { color: "#211e1d", width: 2 });
  assert.deepEqual(presets.DEFAULT_SKETCH_TOOL_PRESETS.highlighter, { color: "#2f6fa6", width: 20 });
  assert.deepEqual(presets.DEFAULT_SKETCH_TOOL_PRESETS.eraser, { color: "#211e1d", width: 28 });
});

test("invalid stored presets fall back per tool without overwriting valid peers", () => {
  const result = presets.normalizeSketchToolPresets({
    pen: { color: "#8a2f3b", width: 7 },
    highlighter: { color: "blue", width: 999 },
  });
  assert.deepEqual(result.pen, { color: "#8a2f3b", width: 7 });
  assert.deepEqual(result.highlighter, presets.DEFAULT_SKETCH_TOOL_PRESETS.highlighter);
  assert.deepEqual(result.eraser, presets.DEFAULT_SKETCH_TOOL_PRESETS.eraser);
});

test("tool presets and shape choice persist as UI state", () => {
  assert.match(pageSource, /usePreference\("sketch\.toolPresets"\)/);
  assert.match(registrySource, /tasken:sketch:tool-presets:v1/);
  assert.match(pageSource, /usePreference\("sketch\.shapeKind"\)/);
  assert.match(pageSource, /usePreference\("sketch\.eraserMode"\)/);
  assert.match(pageSource, /tool !== "eraser"/);
});

test("highlighter width samples remain visually distinct", () => {
  assert.deepEqual(
    presets.SKETCH_TOOL_WIDTHS.highlighter.map((width) => presets.sketchToolWidthSampleSize("highlighter", width)),
    [3, 5, 8, 12],
  );
  assert.match(pageSource, /background: tool === "highlighter" \? activePreset\.color/);
  assert.match(pageSource, /opacity: tool === "highlighter" \? 0\.38/);
});

test("eraser modes and the compact diagram palette are visible toolbar choices", () => {
  assert.match(pageSource, />部分消し</);
  assert.match(pageSource, />線ごと</);
  assert.match(pageSource, /className="sketch-shape-popover"/);
  assert.match(pageSource, /label: "手描き認識"/);
  for (const kind of ["rounded_rectangle", "diamond", "sticky_note", "callout", "bidirectional_arrow"]) {
    assert.match(pageSource, new RegExp(`id: "${kind}"`));
  }
});
