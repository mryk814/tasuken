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

const {
  ACTIVITY_TIMELINE_DAY_HEIGHT,
  ACTIVITY_TIMELINE_PIXELS_PER_HOUR,
  buildActivityTimelineLayout,
} = await importBundled("src/renderer/src/features/workspace/lib/activityTimelineLayout.ts");

const date = "2026-08-28";

test("Activity calendar layout maps time and duration onto the review-scale day", () => {
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

  assert.equal(layout[1].top - layout[0].top, 3 * ACTIVITY_TIMELINE_PIXELS_PER_HOUR);
  assert.equal(layout[1].height, 1.5 * ACTIVITY_TIMELINE_PIXELS_PER_HOUR);
});

test("Activity calendar layout assigns deterministic lanes and reuses a lane at an exact boundary", () => {
  const layout = buildActivityTimelineLayout(
    [
      { id: "long", start_at: "2026-08-28T00:00:00.000Z", end_at: "2026-08-28T02:00:00.000Z" },
      { id: "first", start_at: "2026-08-28T00:30:00.000Z", end_at: "2026-08-28T01:30:00.000Z" },
      { id: "reused", start_at: "2026-08-28T01:30:00.000Z", end_at: "2026-08-28T02:30:00.000Z" },
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
    [
      crossing.start_minutes,
      crossing.end_minutes,
      crossing.anchor_top,
      crossing.anchor_height,
      crossing.anchor_offset,
      crossing.top,
      crossing.height,
    ],
    [
      1410,
      1440,
      23.5 * ACTIVITY_TIMELINE_PIXELS_PER_HOUR,
      0.5 * ACTIVITY_TIMELINE_PIXELS_PER_HOUR,
      10,
      ACTIVITY_TIMELINE_DAY_HEIGHT - 32,
      32,
    ],
  );
  assert.deepEqual(
    [point.anchor_top, point.anchor_height, point.anchor_offset, point.top, point.height],
    [9 * ACTIVITY_TIMELINE_PIXELS_PER_HOUR, 0, 0, 9 * ACTIVITY_TIMELINE_PIXELS_PER_HOUR, 32],
  );
  assert.equal(point.height, 32);
  assert.equal(
    layout.some((item) => item.id === "outside"),
    false,
  );
});

test("Activity calendar keeps late and short controls usable within the day canvas", () => {
  const layout = buildActivityTimelineLayout(
    [
      {
        id: "late-point",
        start_at: "2026-08-28T14:59:00.000Z",
        end_at: "2026-08-28T14:59:00.000Z",
      },
      {
        id: "short-session",
        start_at: "2026-08-28T00:00:00.000Z",
        end_at: "2026-08-28T00:00:30.000Z",
      },
      {
        id: "visual-overlap",
        start_at: "2026-08-28T00:30:00.000Z",
        end_at: "2026-08-28T00:30:30.000Z",
      },
    ],
    { date },
  );
  const latePoint = layout.find((item) => item.id === "late-point");
  const shortSession = layout.find((item) => item.id === "short-session");
  const visualOverlap = layout.find((item) => item.id === "visual-overlap");

  assert.equal(latePoint.start_minutes, 1439);
  assert.equal(latePoint.end_minutes, 1439);
  assert.ok(
    Math.abs(latePoint.anchor_top - (1439 / 60) * ACTIVITY_TIMELINE_PIXELS_PER_HOUR) < 1e-9,
  );
  assert.equal(latePoint.anchor_height, 0);
  assert.equal(latePoint.top, ACTIVITY_TIMELINE_DAY_HEIGHT - 32);
  assert.equal(latePoint.height, 32);
  assert.equal(latePoint.top + latePoint.height, ACTIVITY_TIMELINE_DAY_HEIGHT);
  assert.ok(
    Math.abs(
      latePoint.anchor_offset - ((1439 / 60) * ACTIVITY_TIMELINE_PIXELS_PER_HOUR - latePoint.top),
    ) < 1e-9,
  );
  assert.deepEqual(
    [
      shortSession.start_minutes,
      shortSession.end_minutes,
      shortSession.anchor_top,
      shortSession.anchor_height,
      shortSession.anchor_offset,
      shortSession.top,
      shortSession.height,
    ],
    [
      540,
      540.5,
      9 * ACTIVITY_TIMELINE_PIXELS_PER_HOUR,
      (0.5 / 60) * ACTIVITY_TIMELINE_PIXELS_PER_HOUR,
      0,
      9 * ACTIVITY_TIMELINE_PIXELS_PER_HOUR,
      32,
    ],
  );
  assert.deepEqual(
    [shortSession.lane, shortSession.lane_count, visualOverlap.lane, visualOverlap.lane_count],
    [0, 2, 1, 2],
  );
});
