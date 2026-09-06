import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { queryActivityEvents, projectActivityMarkdown } from "../src/shared/activityProjection.mjs";

const bundled = await build({
  stdin: {
    contents: `export { planWorkLog } from './src/main/services/workLogCommand.ts';
      export { publicActivityEntrySchema } from './src/shared/contracts/task/activityEntries.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { planWorkLog, publicActivityEntrySchema } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/work-log-v1.json", import.meta.url), "utf8"),
);
const theme = { id: "recall-theme", name: "測定", ai_visibility: ["coding_agent"] };
function workLog(id, performedDate, issuedAt = "2026-09-08T12:30:00+09:00") {
  return planWorkLog(
    {
      ...fixture,
      commandId: id,
      performedDate,
      issuedAt,
      themeId: theme.id,
      taskId: null,
    },
    "2026-09-08T04:00:00Z",
    theme.id,
    { kind: "user", id: "desktop-user" },
  );
}
function input(plans) {
  return {
    profile: "recall",
    audience: "coding_agent",
    timezone: "Asia/Tokyo",
    workspace: { notes: plans.map((plan) => plan.note), themes: [theme] },
    events: plans.map((plan) => plan.companion.event),
  };
}

test("a Tuesday input about Sunday belongs to the performed day without inventing an instant", () => {
  const plan = workLog("sunday-report", "2026-09-06");
  const source = input([plan]);
  const before = JSON.stringify(source);
  const sunday = queryActivityEvents({ ...source, date: "2026-09-06" });
  assert.equal(sunday.events.length, 1);
  const entry = publicActivityEntrySchema.parse(sunday.events[0]);
  assert.equal(entry.recall.stage, "work_recorded");
  assert.equal(entry.recall.date_basis, "performed_day");
  assert.notEqual(entry.recall.authority, "user_confirmed");
  assert.equal(entry.local_date, "2026-09-06");
  assert.equal(entry.local_time, "");
  assert.equal(Date.parse(entry.occurred_at), Date.parse("2026-09-08T12:30:00+09:00"));
  assert.equal(entry.metadata.work_log.entered_at, "2026-09-08T12:30:00+09:00");
  assert.equal(entry.metadata.work_log.date_precision, "day");
  assert.equal(entry.metadata.work_log.assertion, "user_report");
  assert.equal(queryActivityEvents({ ...source, date: "2026-09-08" }).events.length, 0);
  assert.equal(
    queryActivityEvents({ ...source, date: "2026-09-06", timezone: "Pacific/Kiritimati" }).events
      .length,
    1,
  );
  assert.equal(
    queryActivityEvents({ ...source, profile: "default", date: "2026-09-08" }).events.length,
    1,
  );
  const markdown = projectActivityMarkdown(sunday);
  assert.match(markdown, /2026-09-06 \(day precision\)/);
  assert.match(markdown, /entered_at: 2026-09-08T12:30:00\+09:00/);
  assert.equal(JSON.stringify(source), before);
});

test("performed days and precise task operations retain chronological coverage across pages", () => {
  const sunday = workLog("sunday", "2026-09-06");
  const monday = workLog("monday", "2026-09-07", "2026-09-07T10:00:00+09:00");
  const source = input([monday, sunday]);
  const task = {
    id: "task",
    title: "測定を完了",
    project_id: theme.id,
    ai_visibility: ["coding_agent"],
  };
  source.workspace.tasks = [task];
  source.events.push(
    buildActivityEvent({
      id: "task-completion",
      entity_type: "task",
      entity_id: task.id,
      event_kind: "task_completed",
      occurred_at: "2026-09-06T23:55:00+09:00",
      after: task,
    }),
  );
  const ids = [];
  let cursor;
  do {
    const result = queryActivityEvents({
      ...source,
      from: "2026-09-06",
      to: "2026-09-07",
      limit: 1,
      cursor,
    });
    ids.push(...result.events.map((event) => event.id));
    cursor = result.page.next_cursor;
  } while (cursor);
  assert.deepEqual(ids, [sunday.receipt.eventId, "task-completion", monday.receipt.eventId]);
  assert.deepEqual(
    queryActivityEvents({ ...source, sort_direction: "desc" }).events.map((event) => event.id),
    [...ids].reverse(),
  );
});

test("timestamp periods include intersecting reported days but never claim an exact work time", () => {
  const source = input([workLog("day-report", "2026-09-06")]);
  const result = queryActivityEvents({
    ...source,
    from: "2026-09-06T23:00:00+09:00",
    to: "2026-09-06T23:00:00+09:00",
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].local_time, "");
  assert.equal(result.events[0].recall.date_basis, "performed_day");
  assert.equal(
    queryActivityEvents({ ...source, from: "2026-09-07T00:00:00+09:00" }).events.length,
    0,
  );
});

test("ordinary edits and malformed work dates are not promoted, while current privacy still applies", () => {
  const source = input([workLog("private-report", "2026-09-06")]);
  const original = source.events[0];
  for (const event of [
    { ...original, event_kind: "note_updated" },
    {
      ...original,
      metadata: { work_log: { ...original.metadata.work_log, performed_date: "2026-02-30" } },
    },
    { ...original, metadata: {} },
  ]) {
    const result = queryActivityEvents({ ...source, events: [event] });
    assert.equal(result.events[0].recall.stage, "changed");
    assert.equal(result.events[0].recall.date_basis, "event_time");
  }
  source.workspace.notes[0].ai_visibility = [];
  const hidden = queryActivityEvents({ ...source, date: "2026-09-06" });
  assert.equal(hidden.events.length, 0);
  assert.equal(hidden.excluded_count, 1);
});
