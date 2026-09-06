import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { queryActivityEvents } from "../src/shared/activityProjection.mjs";
import { buildThemeAiPackPlan } from "../src/shared/themeAiPack.mjs";

const at = "2026-09-01T00:00:00.000Z";
const themeA = {
  id: "theme-a",
  name: "現在のA名",
  default_ai_visibility: ["coding_agent", "m365"],
};
const themeB = {
  id: "theme-b",
  name: "現在のB名",
  default_ai_visibility: ["coding_agent", "m365"],
};
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
  audience: "coding_agent",
  profile: "recall",
  ...extra,
});

test("recall retains historical Task/Theme names and affiliation after move; default and Current Work stay current", () => {
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
  const pack = (theme) =>
    buildThemeAiPackPlan({ theme, candidates: [{ type: "task", entity: currentTask }] });
  const currentWork = (plan) =>
    plan.files.find((file) => file.name === "01 Current Work.md").content;
  assert.ok(!currentWork(pack(themeA)).includes(currentTask.title));
  assert.ok(currentWork(pack(themeB)).includes(currentTask.title));
});

test("recall never republishes historical titles or bodies after current entity or either Theme becomes private", () => {
  for (const audience of ["coding_agent", "m365", "external_ai"]) {
    const visibleThemes = [themeA, themeB].map((theme) => ({
      ...theme,
      default_ai_visibility: [audience],
    }));
    const base = fixture({
      audience,
      workspace: { tasks: [currentTask], themes: visibleThemes, change_events: [themeCreated] },
    });
    assert.equal(queryActivityEvents(base).events.length, 1);
    const variants = [
      { ...base.workspace, tasks: [{ ...currentTask, ai_visibility: [] }] },
      {
        ...base.workspace,
        themes: visibleThemes.map((theme) =>
          theme.id === themeA.id ? { ...theme, default_ai_visibility: [] } : theme,
        ),
      },
      {
        ...base.workspace,
        themes: visibleThemes.map((theme) =>
          theme.id === themeB.id ? { ...theme, default_ai_visibility: [] } : theme,
        ),
      },
      { ...base.workspace, themes: [visibleThemes[1]] },
    ];
    for (const workspace of variants) {
      const result = queryActivityEvents({ ...base, workspace });
      assert.equal(result.events.length, 0);
      assert.equal(result.excluded_count, 1);
      assert.doesNotMatch(
        JSON.stringify(result),
        /当時のTask名|当時のA名|当時の作業記録|現在のTask名/,
      );
    }
  }
});

test("archived visible entities retain history; deleted or missing entities cannot revive snapshot bodies", () => {
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
    assert.equal(result.excluded_count, 1);
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

test("private, deleted or missing source references never disclose old links; query does not mutate history", () => {
  const input = fixture();
  const privateNote = {
    id: "source-note",
    project_id: themeA.id,
    ai_visibility: [],
    title: "private source",
  };
  input.workspace.notes = [privateNote];
  input.events = [
    {
      ...completed,
      source_refs: [{ type: "note", id: privateNote.id }],
      relation_refs: [{ type: "note", id: privateNote.id }],
    },
  ];
  const before = JSON.stringify(input);
  const result = queryActivityEvents(input).events[0];
  assert.deepEqual(result.source_refs, []);
  assert.deepEqual(result.relation_refs, []);
  assert.equal(result.id, completed.id);
  assert.deepEqual(result.entity_ref, completed.entity_ref);
  assert.equal(JSON.stringify(input), before);
  input.workspace.notes = [{ ...privateNote, ai_visibility: ["coding_agent"], deleted_at: at }];
  assert.deepEqual(queryActivityEvents(input).events[0].source_refs, []);
  input.workspace.notes = [];
  assert.deepEqual(queryActivityEvents(input).events[0].source_refs, []);
});
