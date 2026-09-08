import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
const bundled = await build({
  stdin: {
    contents: `export * from './src/main/services/dailyContextAutoSources.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { collectDailyContextAutoChanges: collect } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
function input(workspace = {}) {
  return {
    workspace,
    workspaceDefault: ["m365"],
    sourceHashes: {},
    checkedThrough: null,
    fromDate: "2026-09-01",
    today: "2026-09-08",
    timezone: "Asia/Tokyo",
    publishedDays: {},
  };
}
function checkpoint(value) {
  return { ...value, ...collect(value) };
}
function day(type, id) {
  return { sources: [{ type, id }] };
}
function event(id, type, entity, occurredAt, metadata = {}) {
  return buildActivityEvent({
    id,
    entity_type: type,
    entity_id: entity.id,
    event_kind: `${type === "capture_entry" ? "capture" : type}_created`,
    occurred_at: occurredAt,
    after: entity,
    metadata,
  });
}
test("initial range is bounded and unchanged input produces no dates", () => {
  const value = input();
  assert.equal(collect(value).dates.length, 8);
  assert.deepEqual(collect(checkpoint(value)).dates, []);
});
test("late Android work log selects its reported date rather than receive or creation date", () => {
  const value = checkpoint(input());
  const note = {
    id: "late-note",
    title: "過去日の記録",
    body_markdown: "結果",
    ai_visibility: ["m365"],
  };
  value.workspace = {
    notes: [note],
    change_events: [
      event("late-event", "note", note, "2026-09-08T01:00:00Z", {
        work_log: {
          schema: "tasken-work-log/v1",
          performed_date: "2026-09-03",
          date_precision: "day",
          assertion: "user_report",
        },
      }),
    ],
  };
  assert.deepEqual(collect(value).dates, ["2026-09-03"]);
});
test("capture and ordinary event dates use configured timezone independent of host", () => {
  for (const [timezone, expected] of [
    ["Asia/Tokyo", "2026-09-07"],
    ["America/Los_Angeles", "2026-09-06"],
  ]) {
    const value = checkpoint({ ...input(), timezone });
    const capture = { id: "capture", text: "記録", captured_at: "2026-09-06T16:00:00Z" };
    const note = { id: "note", title: "Note" };
    value.workspace = {
      capture_entries: [capture],
      notes: [note],
      change_events: [event("event", "note", note, "2026-09-06T16:00:00Z")],
    };
    assert.deepEqual(collect(value).dates, [expected]);
  }
});
test("private, deleted and missing sources requeue old published dates outside backfill", () => {
  const note = { id: "old-note", title: "公開Note", ai_visibility: ["m365"] };
  const base = checkpoint({
    ...input({ notes: [note] }),
    publishedDays: { "2026-08-01": day("note", note.id) },
  });
  for (const notes of [
    [{ ...note, ai_visibility: [] }],
    [{ ...note, deleted_at: "2026-09-08T01:00:00Z" }],
    [],
  ]) {
    assert.deepEqual(collect({ ...base, workspace: { notes } }).dates, ["2026-08-01"]);
  }
});
test("Theme movement and visibility policy changes refresh all previously published dates", () => {
  const theme = { id: "theme", name: "Before", ai_visibility: ["m365"] };
  const base = checkpoint({
    ...input({ themes: [theme] }),
    publishedDays: { "2026-08-01": day("note", "old-note") },
  });
  for (const change of [
    { workspace: { themes: [{ ...theme, name: "Renamed", parent_id: "other" }] } },
    { workspaceDefault: [] },
    { workspace: { themes: [{ ...theme, ai_visibility: [] }] } },
  ]) {
    const dates = collect({ ...base, ...change }).dates;
    assert.ok(dates.includes("2026-08-01"));
    assert.ok(dates.includes("2026-09-08"));
  }
});
test("date rollover adds new dates and checkpoints prevent repeating them", () => {
  const base = checkpoint(input());
  const next = { ...base, today: "2026-09-10" };
  assert.deepEqual(collect(next).dates, ["2026-09-08", "2026-09-09", "2026-09-10"]);
  assert.deepEqual(collect(checkpoint(next)).dates, []);
});
