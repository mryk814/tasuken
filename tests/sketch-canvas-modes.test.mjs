import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const sketch = read("src/renderer/src/features/workspace/lib/sketch.ts");
const library = read("src/renderer/src/features/workspace/pages/SketchLibraryPage.tsx");
const editor = read("src/renderer/src/features/workspace/pages/SketchPage.tsx");
const canvas = read("src/renderer/src/features/workspace/components/SketchCanvas.tsx");
const domain = read("src/main/repositories/domain.mjs");
const comparison = read("docs/sketch-canvas-modes.md");

test("new Sketch chooses Page or Infinite while legacy data remains Page", () => {
  assert.match(library, /createSketch\("page"\)/);
  assert.match(library, /createSketch\("infinite"\)/);
  assert.match(sketch, /document\.mode === "infinite" \? "infinite" : "page"/);
  assert.match(domain, /\["page", "infinite"\]\.includes\(document\.mode\)/);
});

test("Page keeps multiple fixed pages and Infinite grows one pannable surface", () => {
  assert.match(sketch, /DEFAULT_PAGE_WIDTH = 1200/);
  assert.match(sketch, /DEFAULT_PAGE_HEIGHT = 850/);
  assert.match(editor, /canvasMode === "page" && <aside/);
  assert.match(editor, /createSketchPage\(String\(document\.pages\.length \+ 1\), "page"\)/);
  assert.match(sketch, /expandInfinitePage/);
  assert.match(sketch, /INFINITE_GROW_STEP = 800/);
  assert.match(canvas, /kind: "pan"/);
  assert.match(canvas, /scroll\.scrollLeft = mode\.scrollLeft/);
});

test("both modes use one tool canvas and Infinite exports an explicit range", () => {
  assert.match(editor, /<SketchCanvas/);
  assert.match(editor, /描画範囲/);
  assert.match(editor, /キャンバス全体/);
  assert.match(editor, /cropSketchPageToContent\(activePage\)/);
});

test("comparison uses one sample and concrete evaluation criteria", () => {
  assert.match(comparison, /実験判断フロー/);
  assert.match(comparison, /Pageでは内容が収まらなければ2ページ目/);
  assert.match(comparison, /Infiniteでは右方向へ続け/);
  assert.match(comparison, /1（つらい）〜5（自然）/);
});
