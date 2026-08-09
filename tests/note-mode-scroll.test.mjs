import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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

const scroll = await importBundled("src/renderer/src/features/workspace/lib/noteModeScroll.ts");

test("Note mode scroll follows the same section across different render heights", () => {
  const editAnchor = scroll.captureNoteModeScroll(900, 2_400, 3_000, [100, 700, 1_500, 2_400]);
  assert.equal(editAnchor.headingIndex, 1);
  assert.equal(editAnchor.sectionProgress, 0.25);

  const previewTop = scroll.restoreNoteModeScroll(
    editAnchor,
    4_100,
    5_000,
    [150, 1_000, 2_600, 4_200],
  );
  assert.equal(previewTop, 1_400);

  const rawTop = scroll.restoreNoteModeScroll(
    editAnchor,
    1_200,
    1_500,
    [50, 350, 950, 1_300],
  );
  assert.equal(rawTop, 500);
});

test("Note mode scroll falls back to document ratio before the first heading", () => {
  const anchor = scroll.captureNoteModeScroll(60, 600, 900, [120, 400]);
  assert.equal(anchor.headingIndex, null);
  assert.equal(scroll.restoreNoteModeScroll(anchor, 1_200, 1_600, [240, 900]), 120);
});

test("Raw heading positions follow source lines instead of evenly dividing heading count", () => {
  const lineCount = 101;
  const scrollHeight = 2_000;

  assert.deepEqual(
    [4, 8, 12, 80, 96].map((sourceLine) => scroll.rawHeadingScrollTop(
      sourceLine,
      lineCount,
      scrollHeight,
    )),
    [80, 160, 240, 1_600, 1_920],
  );
});
