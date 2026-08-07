import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const sketch = read("src/renderer/src/features/workspace/lib/sketch.ts");
const library = read("src/renderer/src/features/workspace/pages/SketchLibraryPage.tsx");
const editor = read("src/renderer/src/features/workspace/pages/SketchPage.tsx");
const canvas = read("src/renderer/src/features/workspace/components/SketchCanvas.tsx");
const pageSizePicker = read("src/renderer/src/features/workspace/components/SketchPageSizePicker.tsx");
const domain = read("src/main/repositories/domain.mjs");
const comparison = read("docs/sketch-canvas-modes.md");

test("new Sketch chooses Page or Infinite while legacy data remains Page", () => {
  assert.match(library, /setCreateMode\("page"\)/);
  assert.match(library, /setCreateMode\("infinite"\)/);
  // 既定titleは自動採番になった（#320）。modeとsizeの引き渡しだけを見る。
  assert.match(library, /createSketchDraft\(defaultSketchTitle\([\s\S]*?mode, size\)/);
  assert.match(sketch, /document\.mode === "infinite" \? "infinite" : "page"/);
  assert.match(domain, /\["page", "infinite"\]\.includes\(document\.mode\)/);
});

test("Page keeps multiple fixed pages and Infinite uses one camera-driven world", () => {
  assert.match(sketch, /landscape: \{ width: 1200, height: 850 \}/);
  assert.match(editor, /canvasMode === "page" && <aside/);
  assert.match(editor, /createSketchPage\([\s\S]*String\(document\.pages\.length \+ 1\),[\s\S]*"page"/);
  assert.match(sketch, /viewport\?:/);
  assert.match(editor, /onViewportChange=\{changeViewport\}/);
  assert.match(canvas, /kind: "pan"/);
  assert.match(canvas, /panSketchViewport/);
  assert.match(canvas, /screenToSketchWorld/);
  assert.match(canvas, /sketchWorldToScreen/);
});

test("Page chooses landscape portrait square or custom size and new pages inherit it", () => {
  assert.match(pageSizePicker, /\"landscape\" \| \"portrait\" \| \"square\" \| \"custom\"/);
  assert.match(pageSizePicker, /幅と高さは/);
  assert.match(library, /<SketchPageSizePicker value=\{pageSize\}/);
  assert.match(library, /void startSketch\(createMode, resolvedPageSize\)/);
  assert.match(editor, /width: activePage\.width, height: activePage\.height/);
  assert.match(editor, /minimumSketchPageSize\(activePage\)/);
  assert.match(editor, /用紙: \{sketchPageSizeLabel\(activePage\)\}/);
});

test("both modes use one tool canvas and Infinite exports an explicit range", () => {
  assert.match(editor, /<SketchCanvas/);
  assert.match(editor, /描画範囲/);
  assert.match(editor, /キャンバス全体/);
  assert.match(editor, /cropSketchPageToContent\(activePage\)/);
  assert.match(editor, /infiniteCanvasExportPage\(activePage\)/);
});

test("comparison uses one sample and concrete evaluation criteria", () => {
  assert.match(comparison, /実験判断フロー/);
  assert.match(comparison, /Pageでは内容が収まらなければ2ページ目/);
  assert.match(comparison, /Infiniteでは原点から上下左右へ続け/);
  assert.match(comparison, /1（つらい）〜5（自然）/);
});
