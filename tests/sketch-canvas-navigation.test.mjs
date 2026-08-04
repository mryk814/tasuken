import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadNavigationModule() {
  const source = fs.readFileSync(path.join(root, "src/renderer/src/features/workspace/lib/sketchNavigation.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function("module", "exports", compiled)(module, module.exports);
  return module.exports;
}

const navigation = loadNavigationModule();
const canvasSource = fs.readFileSync(
  path.join(root, "src/renderer/src/features/workspace/components/SketchCanvas.tsx"),
  "utf8",
);
const shellSource = fs.readFileSync(
  path.join(root, "src/renderer/src/features/workspace/components/shell.tsx"),
  "utf8",
);

test("Ctrl+wheel zoom stays bounded and follows wheel direction", () => {
  assert.ok(navigation.sketchZoomFromWheel(0.82, -120) > 0.82);
  assert.ok(navigation.sketchZoomFromWheel(0.82, 120) < 0.82);
  assert.equal(navigation.sketchZoomFromWheel(1.6, -1000), 1.6);
  assert.equal(navigation.sketchZoomFromWheel(0.35, 1000), 0.35);
});

test("anchored zoom preserves the canvas point below the cursor", () => {
  const before = { zoom: 0.8, scrollLeft: 320, scrollTop: 180, pointerX: 400, pointerY: 300 };
  const nextZoom = 1.2;
  const next = navigation.anchoredSketchScroll({ ...before, nextZoom });
  assert.equal((before.scrollLeft + before.pointerX) / before.zoom, (next.left + before.pointerX) / nextZoom);
  assert.equal((before.scrollTop + before.pointerY) / before.zoom, (next.top + before.pointerY) / nextZoom);
});

test("Infinite camera converts negative world coordinates without moving objects", () => {
  const camera = { x: -420, y: -260, zoom: 0.8 };
  const screen = navigation.sketchWorldToScreen(camera, -220, -60);
  assert.deepEqual(screen, { x: 160, y: 160 });
  assert.deepEqual(navigation.screenToSketchWorld(camera, screen.x, screen.y), { x: -220, y: -60 });

  const panned = navigation.panSketchViewport(camera, 160, 80);
  assert.deepEqual(panned, { x: -620, y: -360, zoom: 0.8 });
});

test("Infinite anchored zoom keeps the world point under the cursor", () => {
  const camera = { x: -300, y: 120, zoom: 0.75 };
  const pointer = { x: 420, y: 260 };
  const before = navigation.screenToSketchWorld(camera, pointer.x, pointer.y);
  const next = navigation.anchoredSketchViewportZoom(camera, 1.25, pointer.x, pointer.y);
  assert.deepEqual(navigation.screenToSketchWorld(next, pointer.x, pointer.y), before);
});

test("Sketch canvas connects common mouse navigation without changing tools", () => {
  assert.match(canvasSource, /event\.button === 1/);
  assert.match(canvasSource, /event\.button === 0 && spacePressedRef\.current/);
  assert.match(canvasSource, /panSketchViewport/);
  assert.match(canvasSource, /onViewportChange\(viewportRef\.current\)/);
  assert.match(canvasSource, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(shellSource, /中ボタン\+ドラッグ/);
  assert.match(shellSource, /Ctrl[\s\S]*ホイール/);
  assert.match(shellSource, /Shift[\s\S]*ホイール/);
});
