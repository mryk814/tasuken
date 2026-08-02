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

const objects = [
  { id: "moving", type: "shape", shape: "rectangle", color: "#000", width: 2, x: 0, y: 0, w: 100, h: 80 },
  { id: "target", type: "shape", shape: "rectangle", color: "#000", width: 2, x: 200, y: 0, w: 100, h: 80 },
];

test("translation snaps selected bounds to another object edge", () => {
  const result = sketch.snapObjectTranslation(objects, ["moving"], 94, 0);
  assert.equal(result.dx, 100);
  assert.equal(result.dy, 0);
  assert.deepEqual(result.guides.vertical, [200]);
});

test("multi-selection translation keeps relative placement", () => {
  const group = [
    objects[0],
    { ...objects[0], id: "moving-2", x: 120 },
    { ...objects[1], id: "target", x: 400 },
  ];
  const result = sketch.snapObjectTranslation(group, ["moving", "moving-2"], 174, 30);
  const moved = group
    .filter((object) => ["moving", "moving-2"].includes(object.id))
    .map((object) => sketch.translateObject(object, result.dx, result.dy));
  assert.equal(moved[1].x - moved[0].x, 120);
});

test("resize snaps the dragged lower-right edge", () => {
  const result = sketch.snapObjectResize({ x: 0, y: 0, w: 194, h: 80 }, objects, "moving");
  assert.equal(result.bounds.w, 200);
  assert.deepEqual(result.guides.vertical, [200]);
});

test("canvas previews manipulation and owns expected keyboard shortcuts", () => {
  assert.match(canvasSource, /setPreviewObjects\(preview\.objects\)/);
  assert.match(canvasSource, /setAlignmentGuides\(preview\.guides\)/);
  assert.match(canvasSource, /mode\.originObjects/);
  assert.match(canvasSource, /event\.key\.toLowerCase\(\) === "c"/);
  assert.match(canvasSource, /event\.key\.toLowerCase\(\) === "v"/);
  assert.match(canvasSource, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(canvasSource, /event\.key\.toLowerCase\(\) === "y"/);
  assert.match(canvasSource, /event\.key\.toLowerCase\(\) === "d"/);
  assert.match(pageSource, /onUndo=\{undo\}/);
  assert.match(pageSource, /onRedo=\{redo\}/);
});

test("hollow shapes are hit on their outline rather than their empty center", () => {
  const rectangle = [{ id: "rect", type: "shape", shape: "rectangle", color: "#000", width: 2, x: 10, y: 10, w: 100, h: 80 }];
  assert.equal(sketch.hitTest(rectangle, { x: 60, y: 50 }), null);
  assert.equal(sketch.hitTest(rectangle, { x: 10, y: 50 })?.id, "rect");
});

test("selected objects can move to the front or back without changing data", () => {
  const layered = [
    { ...objects[0], id: "a" },
    { ...objects[0], id: "b" },
    { ...objects[0], id: "c" },
  ];
  assert.deepEqual(sketch.moveSketchObjectsToLayer(layered, ["b"], "front").map((object) => object.id), ["a", "c", "b"]);
  assert.deepEqual(sketch.moveSketchObjectsToLayer(layered, ["b"], "back").map((object) => object.id), ["b", "a", "c"]);
});

test("canvas exposes layer actions and resize or move cursor intent", () => {
  assert.match(canvasSource, /moveSketchObjectsToLayer/);
  assert.match(canvasSource, /has-\$\{hoverIntent\}-target/);
  assert.match(canvasSource, /IconStackFront/);
  assert.match(canvasSource, /IconStackBack/);
});
