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

test("point bursts stay within two lanes beside a concurrent AI session", () => {
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
      origin: "tasken",
      theme_ids: [],
    })),
  ];
  const calendarItems = buildActivityTimelineBursts(buildActivityTimelineLayout(items, { date }));
  const burst = calendarItems.find((item) => item.item_type === "burst");
  const session = calendarItems.find((item) => item.id === "session");

  assert.equal(calendarItems.filter((item) => item.item_type === "burst").length, 1);
  assert.equal(burst.events.length, 6);
  assert.equal(burst.display_kind, "record");
  assert.equal(burst.origin, "tasken");
  assert.notEqual(burst.origin, "ai");
  assert.equal(session.item_type, "session");
  assert.ok(Math.max(...calendarItems.map((item) => item.lane_count)) <= 2);
});

test("bursts derive uniform and mixed display kinds and origins from every event", () => {
  const items = [
    ["record", "tasken"],
    ["record", "tasken"],
    ["outcome", "ai"],
  ].map(([display_kind, origin], index) => ({
    id: `mixed-${index}`,
    item_type: "event",
    start_at: `2026-08-28T01:${String(index * 5).padStart(2, "0")}:00.000Z`,
    end_at: `2026-08-28T01:${String(index * 5).padStart(2, "0")}:00.000Z`,
    display_kind,
    origin,
    theme_ids: [],
  }));
  const [burst] = buildActivityTimelineBursts(
    buildActivityTimelineLayout(items, {
      date: "2026-08-28",
    }),
  );

  assert.equal(burst.item_type, "burst");
  assert.equal(burst.display_kind, "mixed");
  assert.equal(burst.origin, "mixed");
  assert.deepEqual(
    burst.events.map((event) => [event.display_kind, event.origin]),
    [
      ["record", "tasken"],
      ["record", "tasken"],
      ["outcome", "ai"],
    ],
  );
});

test("event origin objects classify Tasken saves separately from AI origins", () => {
  const items = ["manual", "renderer_save", "mcp"].map((kind, index) => ({
    id: `origin-${index}`,
    item_type: "event",
    start_at: `2026-08-28T02:${String(index * 5).padStart(2, "0")}:00.000Z`,
    end_at: `2026-08-28T02:${String(index * 5).padStart(2, "0")}:00.000Z`,
    display_kind: "record",
    event: { origin: { kind } },
    theme_ids: [],
  }));
  const [burst] = buildActivityTimelineBursts(
    buildActivityTimelineLayout(items, {
      date: "2026-08-28",
    }),
  );

  assert.equal(burst.origin, "mixed");
});
