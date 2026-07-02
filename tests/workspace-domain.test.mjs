import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const adapter = await importBundled("src/renderer/src/features/workspace/domain-model/compat/legacyAdapter.ts");
const persistence = await importBundled("src/renderer/src/features/workspace/domain-model/persistence.ts");
const selectors = await importBundled("src/renderer/src/features/workspace/domain-model/selectors.ts");
const taskDuplication = await importBundled("src/renderer/src/features/workspace/domain-model/taskDuplication.ts");
const timelineProjection = await importBundled("src/renderer/src/features/workspace/domain-model/compat/timelineProjection.ts");
const io = await importBundled("src/renderer/src/features/workspace/lib/io.ts");

function workspace(overrides = {}) {
  return {
    themes: [],
    items: [],
    notes: [],
    links: [],
    views: [],
    status_updates: [],
    source_records: [],
    entity_sources: [],
    field_definitions: [],
    field_values: [],
    log_entries: [],
    import_batchs: [],
    knowledge_nodes: [],
    ai_proposals: [],
    plan_revisions: [],
    ...overrides,
  };
}

test("compat migration: legacy workspace conversion preserves first-class entity meanings", () => {
  const { workspace: domain, report } = adapter.legacyWorkspaceToDomainMigration(workspace({
    themes: [{ id: "theme-1", name: "Project A", status: "on_track" }],
    items: [
      { id: "inbox-1", title: "raw thought", status: "inbox", kind: "idea", source_record_id: "source-1" },
      { id: "waiting-1", title: "ask lab", kind: "waiting", status: "todo", waiting_for: "Lab" },
      { id: "status-waiting-1", title: "blocked task", kind: "task", status: "waiting", waiting_for: "Vendor" },
      { id: "milestone-1", title: "submit", kind: "milestone", status: "todo", planned_end: "2026-06-20" },
      { id: "period-1", title: "phase", kind: "period", status: "todo", planned_start: "2026-06-01", planned_end: "2026-06-30" },
      { id: "task-1", title: "write", kind: "task", status: "todo", due_date: "2026-06-19", parent_item_id: "period-1" },
      { id: "unknown-1", title: "mystery", kind: "surprise", status: "todo" },
    ],
    knowledge_nodes: [
      { id: "knowledge-1", title: "plan evidence", node_type: "evidence", source_item_id: "period-1" },
    ],
    source_records: [
      { id: "source-1", source_type: "clipboard", raw_text: "raw" },
    ],
  }));

  assert.equal(domain.capture_entries.length, 1);
  assert.equal(domain.waitings.length, 2);
  assert.equal(domain.plan_nodes.length, 2);
  assert.equal(domain.tasks.length, 2);
  assert.equal(domain.schedules.length, 3);
  assert.equal(domain.change_events.length, 7);
  assert.equal(domain.capture_entries[0].legacy_item_id, "inbox-1");
  assert.equal(domain.waitings.find((waiting) => waiting.legacy_item_id === "status-waiting-1")?.state, "waiting");
  assert.equal(domain.plan_nodes.find((node) => node.legacy_item_id === "milestone-1")?.type, "milestone");
  assert.equal(domain.plan_nodes.find((node) => node.legacy_item_id === "period-1")?.type, "phase");
  assert.equal(domain.tasks.find((task) => task.legacy_item_id === "task-1")?.plan_node_id, "plan_node-period-1");
  assert.equal(domain.task_dependencies.length, 0);
  assert.equal(domain.plan_dependencies.length, 0);
  assert.equal(domain.references.length, 0);
  assert.equal(domain.knowledge_nodes[0].source_type, "plan_node");
  assert.equal(domain.knowledge_nodes[0].source_id, "plan_node-period-1");
  assert.equal(report.warningCounts.unknownKindToTask, 1);
  assert.equal(report.warningCounts.mixedDependencyToReference, 0);
  assert.equal(report.warningCounts.dueDateOnlyToScheduleEnd, 1);
  assert.match(adapter.formatMigrationReport(report), /Migration report\n----------------\nLegacy items: 7/);

  const legacy = adapter.projectLegacyWorkspace(domain, workspace({
    source_records: [{ id: "source-1", source_type: "clipboard", raw_text: "raw" }],
  }));
  assert.equal(legacy.source_records.length, 1);
  assert.equal(legacy.items.length, 7);
});

test("domain view models keep task, waiting, capture, and timeline concerns separate", () => {
  const domain = {
    projects: [],
    capture_entries: [
      { id: "capture-1", text: "note", captured_at: "2026-06-19T00:00:00.000Z", state: "untriaged" },
    ],
    tasks: [
      { id: "task-1", title: "task", state: "todo", priority: "normal" },
      { id: "task-done", title: "done", state: "done", priority: "normal" },
    ],
    waitings: [
      { id: "waiting-1", title: "waiting", waiting_for: "Lab", state: "waiting" },
    ],
    plan_nodes: [
      { id: "plan-1", title: "phase", type: "phase", state: "planned", sort_order: 1 },
      { id: "milestone-1", title: "milestone", type: "milestone", state: "planned", sort_order: 2, parent_plan_node_id: "plan-1" },
    ],
    schedules: [
      { id: "schedule-task", owner_type: "task", owner_id: "task-1", end_date: "2026-06-19", date_kind: "deadline", confidence: "fixed", granularity: "day" },
      { id: "schedule-waiting", owner_type: "waiting", owner_id: "waiting-1", end_date: "2026-06-19", date_kind: "deadline", confidence: "fixed", granularity: "day" },
      { id: "schedule-milestone", owner_type: "plan_node", owner_id: "milestone-1", end_date: "2026-06-19", date_kind: "point", confidence: "fixed", granularity: "day" },
    ],
    notes: [],
    resources: [],
    knowledge_nodes: [],
    references: [],
    task_dependencies: [],
    plan_dependencies: [],
    knowledge_edges: [],
    change_events: [],
  };

  assert.deepEqual(selectors.buildTodoView(domain).tasks.map((row) => row.task.id), ["task-1", "task-done"]);
  assert.deepEqual(selectors.buildInboxView(domain).entries.map((entry) => entry.id), ["capture-1"]);
  assert.deepEqual(selectors.buildWaitingView(domain).waitings.map((row) => row.waiting.id), ["waiting-1"]);
  assert.deepEqual(selectors.buildTodayView(domain, "2026-06-19").map((entry) => entry.type), ["task", "waiting", "milestone"]);

  const timeline = selectors.buildTimelineView(domain);
  assert.equal(timeline.rows.length, 1);
  assert.equal(timeline.rows[0].planNode.id, "plan-1");
  assert.equal(timeline.rows[0].children[0].planNode.id, "milestone-1");
});

test("task duplication creates an editable new todo without completion state", () => {
  const task = {
    id: "task-done",
    project_id: "theme-1",
    title: "測定条件を確認",
    description: "条件表と照合する",
    state: "done",
    priority: "high",
    completed_at: "2026-06-29T10:00:00.000Z",
    repeat_rule: { frequency: "weekly", interval: 1, weekdays: [1, 3], next_from: "scheduled" },
    repeat_series_id: "series-1",
    repeat_parent_task_id: "parent-1",
    checklist_items: [
      { id: "check-1", title: "表を開く", done: true, completed_at: "2026-06-29T09:00:00.000Z", sort_order: 0 },
      { id: "check-2", title: "結果を確認", done: false, completed_at: null, sort_order: 1 },
    ],
    legacy_item_id: "legacy-task",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-29T10:00:00.000Z",
  };
  const schedule = {
    id: "schedule-done",
    owner_type: "task",
    owner_id: "task-done",
    start_date: "2026-07-01",
    end_date: "2026-07-03",
    date_kind: "range",
    confidence: "fixed",
    granularity: "day",
    legacy_item_id: "legacy-schedule",
  };

  const duplicated = taskDuplication.duplicateTask(task, schedule, "2026-06-30T12:00:00.000Z");

  assert.notEqual(duplicated.task.id, task.id);
  assert.equal(duplicated.task.title, task.title);
  assert.equal(duplicated.task.description, task.description);
  assert.equal(duplicated.task.project_id, task.project_id);
  assert.equal(duplicated.task.priority, "high");
  assert.equal(duplicated.task.state, "todo");
  assert.equal(duplicated.task.completed_at, null);
  assert.equal(duplicated.task.created_at, "2026-06-30T12:00:00.000Z");
  assert.equal(duplicated.task.updated_at, undefined);
  assert.equal(duplicated.task.repeat_series_id, null);
  assert.equal(duplicated.task.repeat_parent_task_id, null);
  assert.equal(duplicated.task.legacy_item_id, null);
  assert.deepEqual(duplicated.task.repeat_rule, task.repeat_rule);
  assert.deepEqual(duplicated.task.checklist_items.map((item) => ({
    title: item.title,
    done: item.done,
    completed_at: item.completed_at,
    sort_order: item.sort_order,
  })), [
    { title: "表を開く", done: false, completed_at: null, sort_order: 0 },
    { title: "結果を確認", done: false, completed_at: null, sort_order: 1 },
  ]);
  assert.notEqual(duplicated.task.checklist_items[0].id, task.checklist_items[0].id);
  assert.notEqual(duplicated.schedule.id, schedule.id);
  assert.equal(duplicated.schedule.owner_id, duplicated.task.id);
  assert.equal(duplicated.schedule.owner_type, "task");
  assert.equal(duplicated.schedule.start_date, schedule.start_date);
  assert.equal(duplicated.schedule.end_date, schedule.end_date);
  assert.equal(duplicated.schedule.legacy_item_id, null);
});

test("inbox view sorts untriaged captures by newest timestamp", () => {
  const domain = {
    projects: [],
    capture_entries: [
      { id: "cap-date-a", text: "date only a", captured_at: "2026-06-23", state: "untriaged" },
      { id: "cap-new", text: "new", captured_at: "2026-06-23T10:30:00.000", state: "untriaged" },
      { id: "cap-old", text: "old", captured_at: "2026-06-23T09:00:00.000", state: "untriaged" },
      { id: "cap-date-b", text: "date only b", captured_at: "2026-06-23", state: "untriaged" },
      { id: "cap-triaged", text: "done", captured_at: "2026-06-23T11:00:00.000", state: "triaged" },
      { id: "cap-memo", text: "scratch", kind: "micro_memo", captured_at: "2026-06-23T12:00:00.000", state: "untriaged" },
    ],
    tasks: [],
    waitings: [],
    plan_nodes: [],
    schedules: [],
    notes: [],
    resources: [],
    knowledge_nodes: [],
    references: [],
    task_dependencies: [],
    plan_dependencies: [],
    knowledge_edges: [],
    change_events: [],
  };

  assert.deepEqual(selectors.buildInboxView(domain).entries.map((entry) => entry.id), [
    "cap-new",
    "cap-old",
    "cap-date-b",
    "cap-date-a",
  ]);
  assert.deepEqual(selectors.buildMicroMemoView(domain).entries.map((entry) => entry.id), ["cap-memo"]);
});

test("micro memo can be sent back to the untriaged inbox lane", () => {
  const memo = {
    id: "cap-memo",
    text: "scratch",
    title: null,
    kind: "micro_memo",
    captured_at: "2026-06-23T12:00:00.000",
    state: "untriaged",
  };

  const ops = persistence.buildSendMicroMemoToInboxOperations(memo, { now: "2026-06-23T12:05:00.000Z" });

  assert.equal(ops.length, 2);
  assert.equal(ops[0].type, "capture_entry");
  assert.equal(ops[0].entity.id, "cap-memo");
  assert.equal(ops[0].entity.kind, null);
  assert.equal(ops[0].entity.state, "untriaged");
  assert.equal(ops[1].type, "change_event");
  assert.equal(ops[1].entity.entity_type, "capture_entry");
  assert.equal(ops[1].entity.entity_id, "cap-memo");
  assert.equal(ops[1].entity.change_type, "updated");
  assert.equal(ops[1].entity.before_json.kind, "micro_memo");
  assert.equal(ops[1].entity.after_json.kind, null);
});

test("compat timeline projection: plan nodes into legacy-compatible gantt items", () => {
  const domain = {
    projects: [],
    capture_entries: [],
    tasks: [
      { id: "task-1", title: "task", state: "todo", priority: "normal" },
    ],
    waitings: [
      { id: "waiting-1", title: "waiting", waiting_for: "Lab", state: "waiting" },
    ],
    plan_nodes: [
      { id: "plan-1", legacy_item_id: "legacy-plan-1", title: "phase", type: "phase", state: "planned", sort_order: 1, project_id: "theme-1" },
      { id: "milestone-1", legacy_item_id: "legacy-ms-1", title: "milestone", type: "milestone", state: "planned", sort_order: 2, parent_plan_node_id: "plan-1" },
    ],
    schedules: [
      { id: "schedule-plan", owner_type: "plan_node", owner_id: "plan-1", start_date: "2026-06-01", end_date: "2026-06-30", date_kind: "range", confidence: "fixed", granularity: "day" },
      { id: "schedule-ms", owner_type: "plan_node", owner_id: "milestone-1", end_date: "2026-06-19", date_kind: "point", confidence: "fixed", granularity: "day" },
      { id: "schedule-task", owner_type: "task", owner_id: "task-1", end_date: "2026-06-19", date_kind: "deadline", confidence: "fixed", granularity: "day" },
    ],
    notes: [],
    resources: [],
    knowledge_nodes: [],
    references: [],
    task_dependencies: [],
    plan_dependencies: [
      { id: "dep-plan", plan_node_id: "milestone-1", depends_on_plan_node_id: "plan-1" },
    ],
    knowledge_edges: [],
    change_events: [],
  };

  const items = timelineProjection.v2TimelineItems(domain);
  assert.deepEqual(items.map((item) => item.id), ["legacy-plan-1", "legacy-ms-1"]);
  assert.equal(items[0].kind, "period");
  assert.equal(items[1].kind, "milestone");
  assert.equal(items[1].parent_item_id, "legacy-plan-1");
  assert.equal(items[0].planned_start, "2026-06-01");
  assert.equal(items[1].planned_end, "2026-06-19");

  const dependencies = timelineProjection.v2TimelineDependencies(domain);
  assert.deepEqual(dependencies, [{
    id: "dep-plan",
    source_item_id: "legacy-plan-1",
    target_item_id: "legacy-ms-1",
    dependency_type: undefined,
  }]);
});

test("post-migration smoke: legacy items=[] still produces meaningful views and export", () => {
  const domainOnly = {
    projects: [{ id: "proj-1", name: "材料A評価", state: "active" }],
    capture_entries: [
      { id: "cap-1", text: "quick note", captured_at: "2026-06-20T00:00:00.000Z", state: "untriaged" },
    ],
    tasks: [
      { id: "task-1", project_id: "proj-1", title: "測定結果を確認", state: "todo", priority: "high" },
      { id: "task-2", project_id: "proj-1", title: "完了タスク", state: "done", priority: "normal", completed_at: "2026-06-18T00:00:00.000Z" },
    ],
    waitings: [
      { id: "wait-1", project_id: "proj-1", title: "試薬待ち", waiting_for: "Lab", state: "waiting" },
    ],
    plan_nodes: [
      { id: "pn-1", project_id: "proj-1", title: "Phase 1", type: "phase", state: "active", sort_order: 1 },
      { id: "ms-1", project_id: "proj-1", title: "初回報告", type: "milestone", state: "planned", sort_order: 2, parent_plan_node_id: "pn-1" },
    ],
    schedules: [
      { id: "s-task", owner_type: "task", owner_id: "task-1", end_date: "2026-06-20", date_kind: "deadline", confidence: "fixed", granularity: "day" },
      { id: "s-wait", owner_type: "waiting", owner_id: "wait-1", end_date: "2026-06-25", date_kind: "deadline", confidence: "tentative", granularity: "day" },
      { id: "s-pn", owner_type: "plan_node", owner_id: "pn-1", start_date: "2026-06-01", end_date: "2026-06-30", date_kind: "range", confidence: "fixed", granularity: "day" },
      { id: "s-ms", owner_type: "plan_node", owner_id: "ms-1", end_date: "2026-06-20", date_kind: "point", confidence: "fixed", granularity: "day" },
    ],
    notes: [],
    resources: [],
    knowledge_nodes: [],
    references: [],
    task_dependencies: [],
    plan_dependencies: [],
    knowledge_edges: [],
    change_events: [],
  };

  const todo = selectors.buildTodoView(domainOnly);
  assert.equal(todo.tasks.length, 2);

  const waiting = selectors.buildWaitingView(domainOnly);
  assert.equal(waiting.waitings.length, 1);
  assert.equal(waiting.waitings[0].waiting.waiting_for, "Lab");

  const inbox = selectors.buildInboxView(domainOnly);
  assert.equal(inbox.entries.length, 1);

  const today = selectors.buildTodayView(domainOnly, "2026-06-20");
  assert.ok(today.length >= 2, `expected >= 2 today entries, got ${today.length}`);
  const types = today.map((e) => e.type);
  assert.ok(types.includes("task"), "today should include task");
  assert.ok(types.includes("milestone"), "today should include milestone");

  const timeline = selectors.buildTimelineView(domainOnly);
  assert.equal(timeline.rows.length, 1);
  assert.equal(timeline.rows[0].planNode.id, "pn-1");
  assert.equal(timeline.rows[0].children.length, 1);

  const emptyWorkspace = workspace({
    themes: [{ id: "proj-1", name: "材料A評価" }],
    items: [],
    projects: [{ id: "proj-1", name: "材料A評価", state: "active" }],
    tasks: domainOnly.tasks,
    waitings: domainOnly.waitings,
    plan_nodes: domainOnly.plan_nodes,
    schedules: domainOnly.schedules,
  });
  const exportData = io.buildExportData({
    data: emptyWorkspace,
    domain: domainOnly,
    themes: [{ id: "proj-1", name: "材料A評価" }],
    items: [],
    activeTheme: null,
    scope: "all",
  });
  assert.ok(exportData.items.length >= 4, `expected >= 4 export items from domain, got ${exportData.items.length}`);
  const exportHasTask = exportData.items.some((item) => item.title === "測定結果を確認");
  const exportHasWaiting = exportData.items.some((item) => item.kind === "waiting");
  const exportHasMilestone = exportData.items.some((item) => item.kind === "milestone");
  assert.ok(exportHasTask, "export should include task from domain");
  assert.ok(exportHasWaiting, "export should include waiting from domain");
  assert.ok(exportHasMilestone, "export should include milestone from domain");

  const markdown = io.exportMarkdown(exportData);
  assert.match(markdown, /測定結果を確認/);
  assert.match(markdown, /試薬待ち/);

  const report = io.exportProgressReport(exportData);
  assert.match(report, /週報/);
  assert.match(report, /試薬待ち/);
});

test("export data excludes notes explicitly removed from export target", () => {
  const data = workspace({
    themes: [{ id: "theme-1", name: "材料A評価" }],
    notes: [
      { id: "note-1", title: "公開文書", theme_id: "theme-1", body_markdown: "共有する", properties_json: { export_enabled: true } },
      { id: "note-2", title: "下書き文書", theme_id: "theme-1", body_markdown: "まだ出さない", properties_json: { export_enabled: false } },
      { id: "note-3", title: "従来メモ", theme_id: "theme-1", body_markdown: "未設定は対象" },
    ],
  });
  const exportData = io.buildExportData({
    data,
    domain: { resources: [], tasks: [], waitings: [], plan_nodes: [], schedules: [], task_dependencies: [], knowledge_edges: [] },
    themes: data.themes,
    items: [],
    activeTheme: null,
    scope: "all",
  });

  assert.deepEqual(exportData.notes.map((note) => note.title), ["公開文書", "従来メモ"]);
  const markdown = io.exportMarkdown(exportData);
  assert.match(markdown, /公開文書/);
  assert.match(markdown, /従来メモ/);
  assert.doesNotMatch(markdown, /下書き文書/);
});

test("document publish flag is separate from AI export inclusion", () => {
  assert.equal(io.notePublishEnabled({ properties_json: { publish_enabled: true, ai_export_enabled: false } }), true);
  assert.equal(io.notePublishEnabled({ properties_json: { ai_export_enabled: true } }), false);
  assert.equal(io.noteAiExportEnabled({ properties_json: { publish_enabled: false, ai_export_enabled: true } }), true);
  assert.equal(io.noteAiExportEnabled({ properties_json: { publish_enabled: true, ai_export_enabled: false } }), false);
});

test("post-migration smoke: MCP mergedItems includes plan_nodes", async () => {
  const { ReadOnlyTaskenContext } = await import("../src/main/mcp/readOnlyContext.mjs");
  const ctx = new ReadOnlyTaskenContext("in-memory.sqlite", {
    workspace: {
      themes: [{ id: "theme-1", name: "A", updated_at: "2026-06-20T00:00:00.000Z" }],
      items: [],
      notes: [],
      links: [],
      status_updates: [],
      knowledge_nodes: [],
      knowledge_edges: [],
      tasks: [{ id: "t1", title: "task", project_id: "theme-1", state: "todo", priority: "normal", updated_at: "2026-06-20T00:00:00.000Z" }],
      waitings: [{ id: "w1", title: "wait", project_id: "theme-1", waiting_for: "Lab", state: "waiting", updated_at: "2026-06-20T00:00:00.000Z" }],
      plan_nodes: [{ id: "pn1", title: "milestone", project_id: "theme-1", type: "milestone", state: "planned", sort_order: 1, updated_at: "2026-06-20T00:00:00.000Z" }],
      schedules: [
        { id: "s1", owner_type: "task", owner_id: "t1", end_date: "2026-06-20", date_kind: "deadline", confidence: "fixed", granularity: "day", updated_at: "2026-06-20T00:00:00.000Z" },
        { id: "s2", owner_type: "plan_node", owner_id: "pn1", end_date: "2026-06-25", date_kind: "point", confidence: "fixed", granularity: "day", updated_at: "2026-06-20T00:00:00.000Z" },
      ],
      capture_entrys: [],
    },
  });
  try {
    const merged = ctx.mergedItems();
    assert.equal(merged.length, 3, `expected 3 merged items (task+waiting+plan_node), got ${merged.length}`);
    assert.ok(merged.some((i) => i.kind === "milestone"), "merged should include milestone from plan_node");

    const open = ctx.toolListOpenItems({});
    assert.ok(open.items.length >= 2, "open items should include task and plan_node");

    const health = ctx.buildPlanHealth("theme-1");
    assert.equal(health.open_tasks, 1);
    assert.equal(health.open_waitings, 1);
    assert.equal(health.open_plan_nodes, 1);
    assert.equal(health.open_count, 3);
  } finally {
    ctx.close();
  }
});
