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

test("partial eraser splits a stroke while preserving its ink settings", () => {
  const stroke = {
    id: "ink",
    type: "stroke",
    tool: "highlighter",
    color: "#2f6fa6",
    width: 4,
    points: [
      { x: 0, y: 50, pressure: 0.2 },
      { x: 100, y: 50, pressure: 0.8 },
    ],
  };
  const result = sketch.eraseSketchObjects(
    [stroke],
    [{ x: 50, y: 40, pressure: 0.5 }, { x: 50, y: 60, pressure: 0.5 }],
    12,
    "partial",
  );
  assert.equal(result.length, 2);
  assert.ok(Math.max(...result[0].points.map((point) => point.x)) < 50);
  assert.ok(Math.min(...result[1].points.map((point) => point.x)) > 50);
  assert.ok(result.every((entry) => entry.tool === "highlighter" && entry.color === "#2f6fa6" && entry.width === 4));
});

test("stroke eraser removes a whole stroke and partial eraser removes non-ink objects whole", () => {
  const stroke = {
    id: "ink",
    type: "stroke",
    tool: "pen",
    color: "#211e1d",
    width: 2,
    points: [{ x: 0, y: 20, pressure: 0.5 }, { x: 100, y: 20, pressure: 0.5 }],
  };
  const shape = { id: "shape", type: "shape", shape: "rectangle", color: "#211e1d", width: 2, x: 20, y: 20, w: 60, h: 50 };
  const path = [{ x: 50, y: 10, pressure: 0.5 }, { x: 50, y: 30, pressure: 0.5 }];
  assert.deepEqual(sketch.eraseSketchObjects([stroke], path, 12, "stroke"), []);
  assert.deepEqual(sketch.eraseSketchObjects([shape], path, 12, "partial"), []);
});

test("diagram shape set renders to SVG without changing the document schema", () => {
  const shapes = ["rounded_rectangle", "diamond", "sticky_note", "callout", "bidirectional_arrow"];
  const page = {
    id: "page",
    title: "diagram",
    width: 800,
    height: 600,
    background: "plain",
    objects: shapes.map((shape, index) => ({
      id: shape,
      type: "shape",
      shape,
      color: "#211e1d",
      width: 2,
      x: 40 + index * 100,
      y: 80,
      w: 80,
      h: 60,
    })),
  };
  const svg = sketch.sketchPageToSvg(page);
  assert.match(svg, /rx="/);
  assert.match(svg, /H 372 L 352\.8 140 L 357\.6 120/);
  assert.match(svg, /marker-start="url\(#arrow-start\)"/);
  assert.ok(shapes.every((shape) => page.objects.some((object) => object.shape === shape)));
});

test("Infinite export keeps negative objects in drawing and whole-canvas ranges", () => {
  const page = {
    id: "world",
    title: "world",
    width: 2400,
    height: 1600,
    background: "dot",
    objects: [{
      id: "left",
      type: "shape",
      shape: "rectangle",
      color: "#211e1d",
      width: 2,
      x: -420,
      y: -260,
      w: 120,
      h: 80,
    }],
  };
  const drawing = sketch.cropSketchPageToContent(page);
  assert.ok(drawing.objects[0].x >= 0);
  assert.ok(drawing.objects[0].y >= 0);

  const whole = sketch.infiniteCanvasExportPage(page);
  assert.ok(whole.width > page.width);
  assert.ok(whole.height > page.height);
  assert.ok(whole.objects[0].x >= 0);
  assert.ok(whole.objects[0].y >= 0);
});
