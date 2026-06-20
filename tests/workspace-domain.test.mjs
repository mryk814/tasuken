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
const selectors = await importBundled("src/renderer/src/features/workspace/domain-model/selectors.ts");
const timelineProjection = await importBundled("src/renderer/src/features/workspace/domain-model/compat/timelineProjection.ts");
const io = await importBundled("src/renderer/src/features/workspace/lib/io.ts");

function workspace(overrides = {}) {
  return {
    themes: [],
    items: [],
    notes: [],
    links: [],
    dependencys: [],
    views: [],
    status_updates: [],
    source_records: [],
    entity_sources: [],
    relations: [],
    field_definitions: [],
    field_values: [],
    log_entries: [],
    import_batchs: [],
    knowledge_nodes: [],
    knowledge_relations: [],
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
    dependencys: [
      { id: "dep-task", source_item_id: "task-1", target_item_id: "unknown-1" },
      { id: "dep-plan", source_item_id: "period-1", target_item_id: "milestone-1" },
      { id: "dep-mixed", source_item_id: "task-1", target_item_id: "milestone-1" },
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
  assert.equal(domain.task_dependencies.length, 1);
  assert.equal(domain.plan_dependencies.length, 1);
  assert.equal(domain.references.length, 1);
  assert.equal(domain.knowledge_nodes[0].source_type, "plan_node");
  assert.equal(domain.knowledge_nodes[0].source_id, "plan_node-period-1");
  assert.equal(report.warningCounts.unknownKindToTask, 1);
  assert.equal(report.warningCounts.mixedDependencyToReference, 1);
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
  assert.deepEqual(selectors.buildTodayView(domain, "2026-06-19").map((entry) => entry.type), ["task", "waiting", "milestone", "capture"]);

  const timeline = selectors.buildTimelineView(domain);
  assert.equal(timeline.rows.length, 1);
  assert.equal(timeline.rows[0].planNode.id, "plan-1");
  assert.equal(timeline.rows[0].children[0].planNode.id, "milestone-1");
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
      knowledge_relations: [],
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
