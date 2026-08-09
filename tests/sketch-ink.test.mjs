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

const sketch = await importBundled("src/renderer/src/features/workspace/lib/sketch.ts");
const canvasSource = readFileSync("src/renderer/src/features/workspace/components/SketchCanvas.tsx", "utf8");
const pageSource = readFileSync("src/renderer/src/features/workspace/pages/SketchPage.tsx", "utf8");

test("stroke smoothing preserves endpoints and reduces the longest jump", () => {
  const raw = [
    { x: 0, y: 0, pressure: 0.2 },
    { x: 100, y: 0, pressure: 0.6 },
    { x: 100, y: 100, pressure: 1 },
  ];
  const smoothed = sketch.smoothSketchPoints(raw);
  const longest = (points) => Math.max(...points.slice(1).map((point, index) => (
    Math.hypot(point.x - points[index].x, point.y - points[index].y)
  )));
  assert.deepEqual(smoothed[0], raw[0]);
  assert.deepEqual(smoothed.at(-1), raw.at(-1));
  assert.ok(smoothed.length > raw.length);
  assert.ok(longest(smoothed) < longest(raw));
});

test("canvas consumes coalesced pointer samples and previews final ink style", () => {
  assert.match(canvasSource, /getCoalescedEvents/);
  assert.match(canvasSource, /drawSketchObject\(context, \{/);
  assert.match(canvasSource, /tool === "highlighter" \? "highlighter" : "pen"/);
  assert.doesNotMatch(canvasSource, /Math\.max\(12, strokeWidth \* 5\)/);
  assert.match(canvasSource, /width: strokeWidth/);
  assert.doesNotMatch(canvasSource, /draftPoints: tool === "lasso"/);
});

test("tool-specific width is selected from visual samples", () => {
  assert.match(pageSource, /className=\{`sketch-width-options is-\$\{tool\}`\}/);
  assert.match(pageSource, /role="radiogroup"/);
  assert.match(pageSource, /SKETCH_TOOL_WIDTHS\[tool\]/);
  assert.doesNotMatch(pageSource, /<option value=\{1\}>1 px/);
});
