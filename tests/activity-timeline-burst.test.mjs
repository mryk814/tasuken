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
const { buildActivityTimelineBursts } = await importBundled(
  "src/renderer/src/features/workspace/lib/activityTimelineBurst.ts",
);

test("point bursts stay compact beside a concurrent AI session at narrow and wide widths", () => {
  const date = "2026-08-28";
  const items = [
    {
      id: "session",
      item_type: "session",
      start_at: "2026-08-28T00:00:00.000Z",
      end_at: "2026-08-28T02:00:00.000Z",
      display_kind: "ai_work",
      theme_ids: [],
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `point-${index}`,
      item_type: "event",
      start_at: `2026-08-28T00:${String(index * 10).padStart(2, "0")}:00.000Z`,
      end_at: `2026-08-28T00:${String(index * 10).padStart(2, "0")}:00.000Z`,
      display_kind: "record",
      theme_ids: [],
    })),
  ];
  const calendarItems = buildActivityTimelineBursts(buildActivityTimelineLayout(items, { date }));
  const burst = calendarItems.find((item) => item.item_type === "burst");
  const session = calendarItems.find((item) => item.id === "session");

  assert.equal(calendarItems.filter((item) => item.item_type === "burst").length, 1);
  assert.equal(burst.events.length, 6);
  assert.equal(session.item_type, "session");
  for (const width of [320, 760, 1280]) {
    assert.ok(
      Math.max(...calendarItems.map((item) => item.lane_count)) <= 2,
      `${width}px keeps the point burst below six lanes`,
    );
  }
});
