import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canvas = readFileSync(
  "src/renderer/src/features/workspace/components/SketchCanvas.tsx",
  "utf8",
);
const page = readFileSync("src/renderer/src/features/workspace/pages/SketchPage.tsx", "utf8");
const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

test("right mouse button temporarily erases with the saved eraser width", () => {
  assert.match(page, /temporaryEraserWidth=\{toolPresets\.eraser\.width\}/);
  assert.match(canvas, /event\.button === 2/);
  assert.match(canvas, /kind: "erase"[\s\S]*?width: temporaryEraserWidth/);
  assert.match(canvas, /onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(canvas, /setTemporaryErasing\(false\)/);
});

test("live strokes render on animation frames without React point state", () => {
  assert.match(canvas, /draftPointsRef = useRef<SketchPoint\[\]>/);
  assert.match(canvas, /window\.requestAnimationFrame/);
  assert.match(canvas, /pointerMode\.points\.push\(\.\.\.coalescedPointerPoints/);
  assert.doesNotMatch(canvas, /useState<SketchPoint\[\]>\(\[\]\)/);
});

test("live ink uses a separate transparent surface and reports input latency", () => {
  assert.match(canvas, /baseCanvasRef = useRef<HTMLCanvasElement/);
  assert.match(canvas, /const renderBase = useCallback/);
  assert.match(canvas, /const renderLive = useCallback/);
  assert.match(canvas, /className="sketch-canvas-base"/);
  assert.match(canvas, /sketch-canvas-interaction/);
  assert.match(canvas, /pendingInputAtRef\.current = performance\.now\(\)/);
  assert.match(canvas, /Input \{latencyMetrics\.latest\.toFixed\(1\)\}ms/);
  assert.match(styles, /\.sketch-canvas \{\s*background: transparent;\s*touch-action: none;/);
});

test("drawing tools use a persistent circular cursor", () => {
  assert.match(styles, /data:image\/svg\+xml/);
  assert.match(styles, /%3Ccircle/);
  assert.match(styles, /\.sketch-canvas\.is-temporary-erasing \{\s*cursor: none;/);
});

test("the Sketch canvas keeps its center column when the detail drawer is open", () => {
  assert.match(
    styles,
    /\.app-shell\.is-canvas-route\.has-drawer \{\s*grid-template-columns: var\(--sidebar-width, 220px\) minmax\(0, 1fr\) clamp\(390px, 30vw, 460px\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1680px\)[\s\S]*?\.app-shell\.is-canvas-route\.has-drawer \{\s*grid-template-columns: var\(--sidebar-width, 200px\) minmax\(0, 1fr\);/,
  );
});
