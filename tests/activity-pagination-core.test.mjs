import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";

const bundled = await build({
  stdin: {
    contents: `
      export { AgentContextQueryService } from "./src/main/core/services/agentContextQueryService.ts";
      export { ActivityEntriesQueryService } from "./src/main/core/services/activityEntriesQueryService.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { AgentContextQueryService, ActivityEntriesQueryService } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const date = "2026-09-06";
const timezone = "Asia/Tokyo";
const task = {
  id: "pagination-task",
  title: "公開作業",
  state: "doing",
  ai_visibility: ["coding_agent"],
};
const timestamp = (index) =>
  new Date(Date.parse("2026-09-05T15:00:00.000Z") + index * 1000).toISOString();
const makeEvent = (index) =>
  buildActivityEvent({
    id: `core-page-${String(index).padStart(4, "0")}`,
    entity_type: "task",
    entity_id: task.id,
    event_kind: "task_work_recorded",
    occurred_at: timestamp(index),
    after: task,
    metadata: { dedupe_key: `core-page-${index}` },
  });

function fixture(count) {
  const snapshot = {
    workspace: {
      tasks: [{ ...task }, { ...task, id: "other-task", title: "別の公開作業" }],
      change_events: Array.from({ length: count }, (_, index) => makeEvent(index)),
    },
    visibilityThemes: [],
    workspaceAiVisibilityDefault: ["coding_agent"],
  };
  return {
    snapshot,
    activity: new AgentContextQueryService({ readAgentContextSnapshot: () => snapshot }),
    entries: new ActivityEntriesQueryService({ readActivityEntriesSnapshot: () => snapshot }),
  };
}

function assertPage(result, expectedStatus = "ok") {
  assert.equal(result.page.status, expectedStatus);
  assert.equal(result.page.returned_count, result.events.length);
  assert.equal(result.result_meta.returned_count, result.events.length);
  assert.equal(result.result_meta.matched_visible_count, result.page.matched_visible_count);
  assert.equal(result.result_meta.truncated, result.truncated);
  assert.equal(result.truncated, Boolean(result.page.next_cursor));
  assert.equal(result.read_only, true);
  assert.match(result.page.revision, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(result.page.generated_at)));
  if (result.format === "json") assert.deepEqual(result.activity.page, result.page);
  if (expectedStatus !== "ok") {
    assert.deepEqual(result.events, []);
    assert.equal(result.page.offset, null);
    assert.equal(result.page.matched_visible_count, null);
    assert.equal(result.page.next_cursor, null);
  }
}

function collectPages(call, request, expectedCount) {
  const ids = [];
  let cursor;
  let revision;
  do {
    const previousCount = ids.length;
    const result = call({ ...request, ...(cursor ? { cursor } : {}) });
    assertPage(result);
    assert.equal(result.page.limit, request.limit);
    assert.equal(result.page.offset, ids.length);
    assert.equal(result.page.matched_visible_count, expectedCount);
    assert.ok(result.events.length <= 100);
    revision ??= result.page.revision;
    assert.equal(result.page.revision, revision);
    ids.push(...result.events.map((event) => event.id));
    cursor = result.page.next_cursor;
    assert.ok(ids.length <= expectedCount, "cursor must advance without repeating a page");
    assert.ok(!cursor || ids.length > previousCount, "a non-final page must make progress");
  } while (cursor);
  assert.equal(ids.length, expectedCount);
  assert.equal(new Set(ids).size, expectedCount);
  return ids;
}

test("getActivity traverses all 501 records through bounded public responses", () => {
  const { activity, snapshot } = fixture(501);
  const before = JSON.stringify(snapshot);
  const ids = collectPages(
    (request) => activity.getActivity(request),
    { date, timezone, limit: 100 },
    501,
  );
  assert.deepEqual(
    ids,
    snapshot.workspace.change_events.map((event) => event.id),
  );
  assert.equal(JSON.stringify(snapshot), before);
  assert.throws(() => activity.getActivity({ limit: 101 }));
});

test("ActivityEntries daily and Task routes traverse 201 records with their existing descending order", () => {
  const { entries, snapshot } = fixture(201);
  const expected = snapshot.workspace.change_events.map((event) => event.id).reverse();
  for (const scope of [{ date }, { task_id: task.id }]) {
    assert.deepEqual(
      collectPages((request) => entries.execute(request), { ...scope, timezone, limit: 100 }, 201),
      expected,
    );
  }
  assert.throws(() => entries.execute({ task_id: task.id, limit: 101 }));
});

test("Core periods retain offset timestamps and explicit Entries timezone with inclusive boundaries", () => {
  const { activity, entries } = fixture(3);
  const from = "2026-09-06T00:00:00+09:00";
  const to = "2026-09-05T15:00:01Z";
  const result = activity.getActivity({ from, to, timezone });
  assertPage(result);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.page.period, { date: null, from, to, timezone, boundaries: "inclusive" });
  const daily = entries.execute({ date, timezone });
  assertPage(daily);
  assert.equal(daily.events.length, 3);
  assert.deepEqual(daily.page.period, {
    date,
    from: null,
    to: null,
    timezone,
    boundaries: "inclusive",
  });
  const utc = entries.execute({ date, timezone: "UTC" });
  assertPage(utc);
  assert.equal(utc.events.length, 0);
  assert.equal(utc.page.matched_visible_count, 0);
});

test("Core cursor misuse fails explicitly and keeps unknown counts null", () => {
  const { activity, entries } = fixture(3);
  const activityRequest = { date, timezone, limit: 1 };
  const activityCursor = activity.getActivity(activityRequest).page.next_cursor;
  for (const request of [
    { ...activityRequest, cursor: "not-a-cursor" },
    { ...activityRequest, cursor: activityCursor, timezone: "UTC" },
    { ...activityRequest, cursor: activityCursor, profile: "recall" },
  ])
    assertPage(activity.getActivity(request), "invalid_cursor");
  const taskRequest = { task_id: task.id, timezone, limit: 1 };
  const taskCursor = entries.execute(taskRequest).page.next_cursor;
  assertPage(
    entries.execute({ ...taskRequest, cursor: taskCursor, task_id: "other-task" }),
    "invalid_cursor",
  );
  assertPage(
    entries.execute({ date, timezone, limit: 1, cursor: "not-a-cursor" }),
    "invalid_cursor",
  );
});

test("Core continuation rejects additions, deletions and changed visibility instead of combining revisions", () => {
  for (const route of ["activity", "daily", "task"]) {
    for (const change of ["added", "deleted", "private"]) {
      // Hiding the explicitly addressed Task retains its existing not_found
      // contract; daily/general queries must report the changed public result.
      if (route === "task" && change === "private") continue;
      const { activity, entries, snapshot } = fixture(3);
      const request = {
        ...(route === "task" ? { task_id: task.id } : { date }),
        timezone,
        limit: 1,
      };
      const call = (args) =>
        route === "activity" ? activity.getActivity(args) : entries.execute(args);
      const cursor = call(request).page.next_cursor;
      if (change === "added") snapshot.workspace.change_events.push(makeEvent(3));
      if (change === "deleted") snapshot.workspace.change_events.pop();
      if (change === "private") snapshot.workspace.tasks[0].ai_visibility = [];
      const result = call({ ...request, cursor });
      assertPage(result, "resync_required");
      assert.ok(!JSON.stringify(result).includes(task.title));
    }
  }
});

test("JSON and Markdown share continuation cursors while exposing the same page metadata", () => {
  const { activity } = fixture(3);
  const request = { date, timezone, limit: 1 };
  const first = activity.getActivity({ ...request, format: "json" });
  assertPage(first);
  const nextRequest = { ...request, cursor: first.page.next_cursor };
  const json = activity.getActivity({ ...nextRequest, format: "json" });
  const markdown = activity.getActivity({ ...nextRequest, format: "markdown" });
  assertPage(json);
  assertPage(markdown);
  assert.deepEqual(markdown.events, json.events);
  const withoutGenerationTime = ({ generated_at: _generated, ...page }) => page;
  assert.deepEqual(withoutGenerationTime(markdown.page), withoutGenerationTime(json.page));
  assert.equal(typeof markdown.activity, "string");
  assert.ok(markdown.activity.includes(markdown.page.next_cursor));
  assert.ok(markdown.activity.includes(date));
  assert.ok(markdown.activity.includes(markdown.page.status));
  const last = activity.getActivity({
    ...request,
    cursor: markdown.page.next_cursor,
    format: "json",
  });
  assertPage(last);
  assert.equal(last.page.offset, 2);
  assert.equal(last.page.next_cursor, null);
});
