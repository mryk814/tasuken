import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const result = await build({
  entryPoints: [path.resolve("src/renderer/src/features/workspace/lib/sketch.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const sketch = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);

test("Sketch dot and grid backgrounds remain visible at the default reduced zoom", () => {
  assert.deepEqual(sketch.SKETCH_BACKGROUND_RENDERING, {
    paperColor: "#fffdfb",
    dotColor: "#b9aaad",
    gridColor: "#d0c2c4",
    spacing: 24,
    dotRadius: 1.55,
    gridLineWidth: 1.35,
  });
  assert.ok(sketch.SKETCH_BACKGROUND_RENDERING.dotRadius * 0.82 >= 1.25);
  assert.ok(sketch.SKETCH_BACKGROUND_RENDERING.gridLineWidth * 0.82 >= 1);
});
