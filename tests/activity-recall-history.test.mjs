import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { queryActivityEvents } from "../src/shared/activityProjection.mjs";

const at = "2026-09-01T00:00:00.000Z";
const themeA = { id: "theme-a", name: "現在のA名" };
const themeB = { id: "theme-b", name: "現在のB名" };
const oldTask = { id: "task-1", title: "当時のTask名", project_id: themeA.id, state: "todo" };
const currentTask = { ...oldTask, title: "現在のTask名", project_id: themeB.id };
const completed = buildActivityEvent({
  id: "old-event",
  entity_type: "task",
  entity_id: oldTask.id,
  event_kind: "task_work_recorded",
  after: oldTask,
  occurred_at: at,
  summary: "当時の作業記録",
});
const themeCreated = buildActivityEvent({
  id: "theme-created",
  entity_type: "theme",
  entity_id: themeA.id,
  change_type: "created",
  after: { ...themeA, name: "当時のA名" },
  occurred_at: "2026-08-01T00:00:00.000Z",
});
const fixture = (extra = {}) => ({
  events: [completed],
  workspace: {
    tasks: [currentTask],
    themes: [themeA, themeB],
    change_events: [completed, themeCreated],
  },
  profile: "recall",
  ...extra,
});

test("recall retains historical Task/Theme names and affiliation after move; default stays current", () => {
  const input = fixture();
  const historical = queryActivityEvents({ ...input, theme_id: themeA.id }).events[0];
  assert.equal(historical.entity_title, oldTask.title);
  assert.equal(historical.theme_ref.id, themeA.id);
  assert.equal(historical.recall.history.theme_title, "当時のA名");
  assert.equal(historical.recall.history.entity_title_source, "after_snapshot");
  assert.equal(historical.recall.history.current_entity_title, currentTask.title);
  assert.equal(historical.recall.history.current_theme_ref.id, themeB.id);
  assert.equal(queryActivityEvents({ ...input, theme_id: themeB.id }).events.length, 0);
  assert.equal(
    queryActivityEvents({ ...input, profile: "default" }).events[0].entity_title,
    currentTask.title,
  );
});

test("archived entities retain history; deleted or missing entities cannot revive snapshot bodies", () => {
  const archived = fixture();
  archived.workspace.tasks = [{ ...currentTask, state: "archived" }];
  archived.workspace.themes = [{ ...themeA, state: "archived" }, themeB];
  assert.equal(queryActivityEvents(archived).events[0].entity_title, oldTask.title);
  for (const tasks of [[{ ...currentTask, deleted_at: "2026-09-03T00:00:00.000Z" }], []]) {
    const result = queryActivityEvents({
      ...archived,
      workspace: { ...archived.workspace, tasks },
    });
    assert.equal(result.events.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /当時のTask名|当時の作業記録/);
  }
});

test("legacy events without historical evidence explicitly use current names without inventing past affiliation", () => {
  const legacy = {
    id: "legacy",
    entity_type: "task",
    entity_id: oldTask.id,
    changed_at: at,
    change_type: "completed",
    summary: "legacy summary",
  };
  const input = fixture({ events: [legacy] });
  const result = queryActivityEvents(input).events[0];
  assert.equal(result.id, legacy.id);
  assert.equal(result.entity_title, currentTask.title);
  assert.equal(result.recall.history.entity_title_source, "current_fallback");
  assert.equal(result.recall.history.theme_ref_source, "unknown");
  assert.equal(result.recall.history.theme_title_source, "unknown");
  assert.deepEqual(result.theme_ref, { kind: "none", id: null });
  assert.equal(queryActivityEvents({ ...input, theme_id: themeB.id }).events.length, 0);
  const knownRef = queryActivityEvents({
    ...input,
    events: [{ ...legacy, theme_ref: completed.theme_ref }],
  }).events[0];
  assert.equal(knownRef.theme_ref.id, themeA.id);
  assert.equal(knownRef.recall.history.entity_title_source, "current_fallback");
  assert.equal(knownRef.recall.history.theme_ref_source, "event");
});

test("saved before snapshots and Theme rename evidence remain distinguishable from current fallback", () => {
  const beforeOnly = {
    id: "before-only",
    entity_type: "task",
    entity_id: oldTask.id,
    event_kind: "task_work_recorded",
    changed_at: at,
    before_json: JSON.stringify(oldTask),
    metadata: { schema_version: 1 },
    entity_ref: completed.entity_ref,
    occurred_at: at,
  };
  const themeRename = {
    id: "theme-rename",
    entity_type: "theme",
    entity_id: themeA.id,
    changed_at: "2026-09-02T00:00:00.000Z",
    before_json: { ...themeA, name: "変更前A" },
    after_json: themeA,
  };
  const input = fixture({ events: [beforeOnly] });
  input.workspace.change_events = [beforeOnly, themeRename];
  const result = queryActivityEvents(input).events[0];
  assert.equal(result.entity_title, oldTask.title);
  assert.equal(result.recall.history.entity_title_source, "before_snapshot");
  assert.equal(result.recall.history.theme_ref_source, "before_snapshot");
  assert.equal(result.recall.history.theme_title, "変更前A");
  assert.equal(result.recall.history.theme_title_source, "theme_event_before");
  input.workspace.change_events = [];
  const fallback = queryActivityEvents(input).events[0];
  assert.equal(fallback.recall.history.theme_title, themeA.name);
  assert.equal(fallback.recall.history.theme_title_source, "current_fallback");
});
