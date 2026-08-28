import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { build } from "esbuild";
import path from "node:path";
import test from "node:test";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { buildActivityTimelineLayout } = await importBundled(
  "src/renderer/src/features/workspace/lib/activityTimelineLayout.ts",
);

const date = "2026-08-28";

test("Activity calendar layout maps time and duration onto the fixed 36px/hour day", () => {
  const layout = buildActivityTimelineLayout(
    [
      { id: "nine", start_at: "2026-08-28T00:00:00.000Z" },
      {
        id: "twelve",
        start_at: "2026-08-28T03:00:00.000Z",
        end_at: "2026-08-28T04:30:00.000Z",
      },
    ],
    { date },
  );

  assert.equal(layout[1].top - layout[0].top, 108);
  assert.equal(layout[1].height, 54);
});

test("Activity calendar layout assigns deterministic lanes and reuses a lane at an exact boundary", () => {
  const layout = buildActivityTimelineLayout(
    [
      { id: "long", start_at: "2026-08-28T00:00:00.000Z", end_at: "2026-08-28T02:00:00.000Z" },
      { id: "first", start_at: "2026-08-28T00:30:00.000Z", end_at: "2026-08-28T01:00:00.000Z" },
      { id: "reused", start_at: "2026-08-28T01:00:00.000Z", end_at: "2026-08-28T01:30:00.000Z" },
    ],
    { date },
  );

  assert.deepEqual(
    layout.map((item) => [item.id, item.lane, item.lane_count]),
    [
      ["long", 0, 2],
      ["first", 1, 2],
      ["reused", 1, 2],
    ],
  );
});

test("Activity calendar layout clips intervals to the selected day and keeps point events usable", () => {
  const layout = buildActivityTimelineLayout(
    [
      {
        id: "crosses-midnight",
        start_at: "2026-08-28T14:30:00.000Z",
        end_at: "2026-08-28T16:00:00.000Z",
      },
      { id: "point", start_at: "2026-08-28T00:00:00.000Z", end_at: "2026-08-28T00:00:00.000Z" },
      { id: "outside", start_at: "2026-08-28T16:00:00.000Z" },
    ],
    { date },
  );
  const crossing = layout.find((item) => item.id === "crosses-midnight");
  const point = layout.find((item) => item.id === "point");

  assert.deepEqual(
    [crossing.start_minutes, crossing.end_minutes, crossing.top, crossing.height],
    [1410, 1440, 846, 18],
  );
  assert.equal(point.height, 32);
  assert.equal(
    layout.some((item) => item.id === "outside"),
    false,
  );
});
