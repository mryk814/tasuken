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

const adapter = await importBundled("src/renderer/src/features/workspace-v2/domain/legacyAdapter.ts");
const selectors = await importBundled("src/renderer/src/features/workspace-v2/domain/selectors.ts");

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

test("legacy workspace conversion preserves first-class entity meanings", () => {
  const { workspace: v2, report } = adapter.legacyWorkspaceToV2Migration(workspace({
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

  assert.equal(v2.capture_entries.length, 1);
  assert.equal(v2.waitings.length, 2);
  assert.equal(v2.plan_nodes.length, 2);
  assert.equal(v2.tasks.length, 2);
  assert.equal(v2.schedules.length, 3);
  assert.equal(v2.change_events.length, 7);
  assert.equal(v2.capture_entries[0].legacy_item_id, "inbox-1");
  assert.equal(v2.waitings.find((waiting) => waiting.legacy_item_id === "status-waiting-1")?.state, "waiting");
  assert.equal(v2.plan_nodes.find((node) => node.legacy_item_id === "milestone-1")?.type, "milestone");
  assert.equal(v2.plan_nodes.find((node) => node.legacy_item_id === "period-1")?.type, "phase");
  assert.equal(v2.tasks.find((task) => task.legacy_item_id === "task-1")?.plan_node_id, "plan_node-period-1");
  assert.equal(v2.task_dependencies.length, 1);
  assert.equal(v2.plan_dependencies.length, 1);
  assert.equal(v2.references.length, 1);
  assert.equal(v2.knowledge_nodes[0].source_type, "plan_node");
  assert.equal(v2.knowledge_nodes[0].source_id, "plan_node-period-1");
  assert.equal(report.warningCounts.unknownKindToTask, 1);
  assert.equal(report.warningCounts.mixedDependencyToReference, 1);
  assert.equal(report.warningCounts.dueDateOnlyToScheduleEnd, 1);
  assert.match(adapter.formatMigrationReport(report), /Migration report\n----------------\nLegacy items: 7/);

  const legacy = adapter.v2ToLegacyWorkspace(v2, workspace({
    source_records: [{ id: "source-1", source_type: "clipboard", raw_text: "raw" }],
  }));
  assert.equal(legacy.source_records.length, 1);
  assert.equal(legacy.items.length, 7);
});

test("v2 view models keep task, waiting, capture, and timeline concerns separate", () => {
  const v2 = {
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

  assert.deepEqual(selectors.buildTodoView(v2).tasks.map((row) => row.task.id), ["task-1", "task-done"]);
  assert.deepEqual(selectors.buildInboxView(v2).entries.map((entry) => entry.id), ["capture-1"]);
  assert.deepEqual(selectors.buildWaitingView(v2).waitings.map((row) => row.waiting.id), ["waiting-1"]);
  assert.deepEqual(selectors.buildTodayView(v2, "2026-06-19").map((entry) => entry.type), ["task", "waiting", "milestone", "capture"]);

  const timeline = selectors.buildTimelineView(v2);
  assert.equal(timeline.rows.length, 1);
  assert.equal(timeline.rows[0].planNode.id, "plan-1");
  assert.equal(timeline.rows[0].children[0].planNode.id, "milestone-1");
});
