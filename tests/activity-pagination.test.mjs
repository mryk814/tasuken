import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import {
  queryActivityEvents,
  projectActivityJson,
  projectActivityMarkdown,
  projectActivityMcp,
} from "../src/shared/activityProjection.mjs";

const at = "2026-09-06T14:55:00.000Z";
const task = {
  id: "page-task",
  title: "期間内の作業",
  state: "done",
  ai_visibility: ["coding_agent"],
};
function fixture(count) {
  return {
    workspace: { tasks: [{ ...task }] },
    audience: "coding_agent",
    events: Array.from({ length: count }, (_, index) =>
      buildActivityEvent({
        id: `page-${String(index).padStart(5, "0")}`,
        entity_type: "task",
        entity_id: task.id,
        event_kind: "task_completed",
        occurred_at: at,
        after: task,
        metadata: { dedupe_key: `page-${index}` },
      }),
    ),
  };
}

for (const count of [0, 499, 500, 501, 5000]) {
  test(`bounded pages cover all ${count} tied-timestamp events once`, () => {
    const input = fixture(count);
    const ids = [];
    let cursor;
    let revision;
    do {
      const result = queryActivityEvents({ ...input, cursor });
      assert.ok(result.events.length <= 500);
      assert.equal(result.page.returned_count, result.events.length);
      assert.equal(result.page.limit, 500);
      assert.equal(result.page.status, "ok");
      assert.equal(result.page.matched_visible_count, count);
      assert.ok(Number.isFinite(Date.parse(result.page.generated_at)));
      revision ??= result.page.revision;
      assert.equal(result.page.revision, revision);
      ids.push(...result.events.map((event) => event.id));
      cursor = result.page.next_cursor;
      assert.equal(result.truncated, Boolean(cursor));
    } while (cursor);
    assert.equal(ids.length, count);
    assert.equal(new Set(ids).size, count);
    assert.deepEqual(
      ids,
      input.events.map((event) => event.id),
    );
  });
}

test("descending pages preserve stable ID tie ordering and enforce the chosen limit", () => {
  const input = { ...fixture(501), limit: 17, sort_direction: "desc" };
  const ids = [];
  let cursor;
  do {
    const result = queryActivityEvents({ ...input, cursor });
    assert.ok(result.events.length <= 17);
    ids.push(...result.events.map((event) => event.id));
    cursor = result.page.next_cursor;
  } while (cursor);
  assert.deepEqual(ids, input.events.map((event) => event.id).reverse());
});

test("a changed record, event set, or current visibility requires explicit resync", () => {
  const original = fixture(501);
  const cursor = queryActivityEvents(original).page.next_cursor;
  const changes = [
    (input) => {
      input.events.pop();
    },
    (input) => {
      input.events.push({
        ...input.events[0],
        id: "new-event",
        metadata: { dedupe_key: "new-event" },
      });
    },
    (input) => {
      input.events[0].summary = "訂正";
    },
    (input) => {
      input.workspace.tasks[0].title = "訂正した題名";
    },
    (input) => {
      input.workspace.tasks[0].ai_visibility = [];
    },
    (input) => {
      input.workspace.tasks = [];
    },
  ];
  for (const change of changes) {
    const input = structuredClone(original);
    change(input);
    const result = queryActivityEvents({ ...input, cursor });
    assert.equal(result.page.status, "resync_required");
    assert.deepEqual(result.events, []);
    assert.equal(result.page.next_cursor, null);
    assert.equal(result.page.matched_visible_count, null);
    assert.match(projectActivityMarkdown(result), /resync_required/);
  }
});

test("workspace policy changes require resync instead of blaming the client's criteria", () => {
  const input = fixture(2);
  delete input.workspace.tasks[0].ai_visibility;
  const cursor = queryActivityEvents({ ...input, workspaceDefault: ["coding_agent"], limit: 1 })
    .page.next_cursor;
  const result = queryActivityEvents({ ...input, workspaceDefault: [], limit: 1, cursor });
  assert.equal(result.page.status, "resync_required");
  assert.deepEqual(result.events, []);
  assert.equal(result.page.matched_visible_count, null);
});

test("invalid cursors and reuse with other criteria never silently become first-page queries", () => {
  const input = fixture(501);
  const cursor = queryActivityEvents(input).page.next_cursor;
  for (const invalid of ["garbage", cursor + "x", "x".repeat(5000)]) {
    const result = queryActivityEvents({ ...input, cursor: invalid });
    assert.equal(result.page.status, "invalid_cursor");
    assert.deepEqual(result.events, []);
  }
  for (const changed of [
    { date: "2026-09-06" },
    { timezone: "UTC" },
    { limit: 100 },
    { sort_direction: "desc" },
    { profile: "recall" },
    { theme_id: "different" },
    { audience: "external_ai" },
    { event_kinds: ["task_reopened"] },
  ]) {
    const result = queryActivityEvents({ ...input, ...changed, cursor });
    assert.equal(result.page.status, "invalid_cursor");
    assert.deepEqual(result.events, []);
  }
});

test("calendar boundaries use the requested timezone while timestamp boundaries compare instants", () => {
  const input = fixture(1);
  assert.equal(
    queryActivityEvents({ ...input, date: "2026-09-06", timezone: "Asia/Tokyo" }).events.length,
    1,
  );
  assert.equal(
    queryActivityEvents({ ...input, date: "2026-09-06", timezone: "Pacific/Kiritimati" }).events
      .length,
    0,
  );
  assert.equal(
    queryActivityEvents({ ...input, from: "2026-09-06", to: "2026-09-06", timezone: "Asia/Tokyo" })
      .events.length,
    1,
  );
  const result = queryActivityEvents({
    ...input,
    from: "2026-09-06T23:55:00+09:00",
    to: "2026-09-06T23:55:00+09:00",
  });
  assert.equal(result.events.length, 1);
  assert.equal(
    queryActivityEvents({ ...input, from: "2026-09-06T23:55:00.001+09:00" }).events.length,
    0,
  );
  assert.equal(result.page.period.boundaries, "inclusive");
  assert.equal(result.page.period.from, "2026-09-06T23:55:00+09:00");
});

test("all serializers preserve coverage and policy explanations without private identifiers", () => {
  const input = fixture(501);
  const privateTask = { ...task, id: "private-identifier", title: "秘密の題名", ai_visibility: [] };
  input.workspace.tasks.push(privateTask);
  input.events.push(
    buildActivityEvent({
      id: "private-event",
      entity_type: "task",
      entity_id: privateTask.id,
      event_kind: "task_completed",
      occurred_at: at,
      after: privateTask,
    }),
  );
  const result = queryActivityEvents({ ...input, date: "2026-09-06" });
  assert.equal(result.excluded_count, 1);
  assert.deepEqual(projectActivityJson(result).page, result.page);
  assert.deepEqual(projectActivityMcp(result).page, result.page);
  const markdown = projectActivityMarkdown(result);
  assert.match(markdown, /2026-09-06/);
  assert.match(markdown, /500/);
  assert.match(markdown, /truncated: true/);
  assert.match(markdown, /next_cursor:/);
  assert.match(markdown, /Excluded by policy/);
  assert.doesNotMatch(markdown, /private-identifier|秘密の題名|private-event/);
});
