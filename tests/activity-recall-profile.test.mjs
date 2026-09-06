import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { queryActivityEvents, projectActivityMarkdown } from "../src/shared/activityProjection.mjs";

const at = "2026-09-05T23:00:00.000Z";
const task = { id: "task-1", title: "実験を計画", state: "todo", ai_visibility: ["coding_agent"] };
const capture = {
  id: "capture-1",
  text: "未整理の観測",
  captured_at: at,
  state: "untriaged",
  ai_visibility: ["coding_agent"],
};
const event = (kind, fields = {}) =>
  buildActivityEvent({
    id: kind,
    entity_type: "task",
    entity_id: task.id,
    event_kind: kind,
    occurred_at: at,
    after: task,
    ...fields,
  });
const query = (events, extra = {}) =>
  queryActivityEvents({
    events,
    workspace: { tasks: [task], capture_entries: [capture] },
    audience: "coding_agent",
    profile: "recall",
    ...extra,
  });

test("default stays unchanged; recall separates input, plans, recorded work and AI acceptance", () => {
  const events = [
    "task_created",
    "task_completed",
    "task_work_recorded",
    "task_ai_reported",
    "task_ai_accepted",
  ].map((kind) => event(kind));
  const normal = query(events, { profile: "default" });
  assert.equal(normal.events.length, 4);
  assert.ok(normal.events.every((entry) => !entry.recall));
  const recalled = query(events);
  assert.deepEqual(
    Object.fromEntries(recalled.events.map((entry) => [entry.event_kind, entry.recall.stage])),
    {
      entity_updated: "input",
      task_created: "planned",
      task_completed: "work_recorded",
      task_work_recorded: "work_recorded",
      task_ai_reported: "ai_reported",
      task_ai_accepted: "human_accepted",
    },
  );
  assert.match(projectActivityMarkdown(recalled), /Recall: ai_reported/);
  assert.match(projectActivityMarkdown(recalled), /authority: unknown/);
});

test("Capture source rows are stable, bounded, read-only and do not duplicate creation or formalization", () => {
  const created = buildActivityEvent({
    id: "capture-created",
    entity_type: "capture_entry",
    entity_id: capture.id,
    change_type: "created",
    after: capture,
    occurred_at: at,
  });
  const workspace = { capture_entries: [{ ...capture, text: "X".repeat(12000) }] };
  const before = JSON.stringify(workspace);
  const result = query([created], { workspace });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, created.id);
  assert.equal(result.events[0].summary.length, 2000);
  const offsetWorkspace = {
    capture_entries: [{ ...capture, captured_at: "2026-09-06T08:00:00+09:00" }],
  };
  assert.equal(query([created], { workspace: offsetWorkspace }).events[0].occurred_at, at);
  assert.equal(query([], { workspace: offsetWorkspace }).events[0].occurred_at, at);
  assert.equal(
    query([created, { ...created, id: "replayed", occurred_at: "2026-09-08T00:00:00.000Z" }], {
      workspace,
      date: "2026-09-06",
    }).events.length,
    1,
  );
  assert.equal(JSON.stringify(workspace), before);
  assert.equal(query([], { workspace }).events[0].id, `capture-input:${capture.id}`);
  const firstRead = query([], { workspace });
  const nextRead = query([], { workspace });
  assert.ok(Number.isFinite(Date.parse(firstRead.page.generated_at)));
  assert.ok(Number.isFinite(Date.parse(nextRead.page.generated_at)));
  nextRead.page.generated_at = firstRead.page.generated_at;
  assert.deepEqual(firstRead, nextRead);
  const organized = { ...capture, state: "processed" };
  assert.equal(query([created], { workspace: { capture_entries: [organized] } }).events.length, 0);
  const formalized = buildActivityEvent({
    id: "formalized",
    entity_type: "capture_entry",
    entity_id: capture.id,
    event_kind: "capture_formalized",
    after: organized,
    occurred_at: at,
    metadata: { formalized: true },
  });
  const rows = query([created, formalized, event("task_created")], {
    workspace: { capture_entries: [organized], tasks: [task] },
  }).events;
  assert.deepEqual(rows.map((row) => row.recall.stage).sort(), ["organized", "planned"]);
});

test("recall includes meaningful plan changes, omits autosave, and explicit kinds replace selection", () => {
  const events = [
    event("task_updated", { id: "plan", changed_fields: ["today_date"] }),
    event("task_updated", {
      id: "autosave",
      changed_fields: ["updated_at", "version"],
      metadata: { dedupe_key: "autosave" },
    }),
    event("task_updated", {
      id: "title",
      changed_fields: ["title"],
      metadata: { dedupe_key: "title" },
    }),
  ];
  assert.deepEqual(
    query(events, { workspace: { tasks: [task] } }).events.map((row) => row.id),
    ["plan"],
  );
  assert.equal(
    query(events, { profile: "default", event_kinds: ["task_updated"] }).events.length,
    3,
  );
  assert.equal(query(events, { event_kinds: ["unknown"] }).events.length, 0);
});

test("recall preserves current visibility, source privacy, AI authority, exclusion counts and limits", () => {
  const privateCapture = { ...capture, ai_visibility: [] };
  const aiTask = { ...task, source: "ai" };
  const reported = event("task_ai_reported", {
    source_refs: [{ type: "capture_entry", id: capture.id }],
  });
  const result = query([reported, event("task_created")], {
    workspace: { tasks: [aiTask], capture_entries: [privateCapture] },
    limit: 1,
    include_match_metadata: true,
  });
  assert.equal(result.excluded_count, 1);
  assert.equal(result.matched_count, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.events[0].recall.stage, "ai_reported");
  assert.equal(result.events[0].recall.authority, "ai_generated");
  assert.deepEqual(result.events[0].source_refs, []);
  const privateRelation = {
    id: "private-relation",
    source_type: "task",
    source_id: task.id,
    target_type: "task",
    target_id: "other-task",
    relation_type: "related_to",
    ai_visibility: [],
  };
  const relations = query([reported], {
    workspace: {
      tasks: [task, { ...task, id: "other-task" }],
      references: [privateRelation],
    },
  });
  assert.deepEqual(relations.events[0].relation_refs, []);
  assert.ok(!JSON.stringify(result).includes(capture.text));
  assert.equal(query([], { workspace: {} }).events.length, 0);
  assert.equal(query([], { date: "2026-09-05" }).events.length, 0);
  assert.equal(query([], { date: "2026-09-06" }).events.length, 1);
});

test("recall schedule changes require a visible owner and ignore timestamp autosave", () => {
  const schedule = {
    id: "schedule-1",
    owner_type: "task",
    owner_id: task.id,
    start_date: "2026-09-06",
    ai_visibility: ["coding_agent"],
  };
  const change = buildActivityEvent({
    id: "schedule-change",
    entity_type: "schedule",
    entity_id: schedule.id,
    event_kind: "schedule_updated",
    after: schedule,
    occurred_at: at,
    changed_fields: ["start_date"],
  });
  const workspace = { tasks: [task], schedules: [schedule] };
  assert.equal(query([change], { workspace, profile: "default" }).events.length, 0);
  assert.equal(query([change], { workspace }).events[0].recall.stage, "planned");
  const hidden = query([change], {
    workspace: { ...workspace, tasks: [{ ...task, ai_visibility: [] }] },
  });
  assert.equal(hidden.events.length, 0);
  assert.equal(hidden.excluded_count, 1);
  assert.equal(
    query([{ ...change, changed_fields: ["updated_at"] }], { workspace }).events.length,
    0,
  );
});

const bundled = await build({
  stdin: {
    contents: `
  export { AgentContextQueryService } from "./src/main/core/services/agentContextQueryService.ts";
  export { ActivityEntriesQueryService } from "./src/main/core/services/activityEntriesQueryService.ts";
  export { getActivityRequestSchema, getActivityEntriesRequestSchema } from "./src/shared/contracts/task/public.ts";
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const {
  AgentContextQueryService,
  ActivityEntriesQueryService,
  getActivityRequestSchema,
  getActivityEntriesRequestSchema,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("Core query and ActivityEntries consumers validate and carry recall through the public schema", () => {
  const snapshot = {
    workspace: {
      tasks: [task],
      capture_entries: [capture],
      change_events: [event("task_created")],
    },
    visibilityThemes: [],
    workspaceAiVisibilityDefault: ["coding_agent"],
  };
  const before = JSON.stringify(snapshot);
  const agent = new AgentContextQueryService({ readAgentContextSnapshot: () => snapshot });
  assert.equal(agent.getActivity({}).events.length, 0);
  const result = agent.getActivity({ profile: "recall" });
  assert.equal(result.events.length, 2);
  assert.equal(result.read_only, true);
  const entries = new ActivityEntriesQueryService({ readActivityEntriesSnapshot: () => snapshot });
  assert.equal(
    entries.execute({ task_id: task.id, profile: "recall" }).events[0].recall.stage,
    "planned",
  );
  assert.equal(
    entries.execute({ date: "2026-09-06", timezone: "Asia/Tokyo", profile: "recall" }).events
      .length,
    2,
  );
  assert.equal(
    entries.execute({ date: "2026-09-06", timezone: "UTC", profile: "recall" }).events.length,
    0,
  );
  assert.equal(
    entries.execute({ date: "2026-09-05", timezone: "UTC", profile: "recall" }).events.length,
    2,
  );
  assert.equal(JSON.stringify(snapshot), before);
  assert.throws(() => getActivityRequestSchema.parse({ profile: "typo" }));
  assert.throws(() => getActivityEntriesRequestSchema.parse({ task_id: task.id, profile: "typo" }));
});
