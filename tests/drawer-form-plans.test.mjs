import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { buildDomainDrawerFormPlan } = await importBundled(
  "src/renderer/src/features/workspace/lib/drawerFormPlans.ts",
);

const emptyData = {
  themes: [],
  items: [],
  notes: [],
  links: [],
  resources: [],
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
  projects: [],
  capture_entrys: [],
  tasks: [],
  waitings: [],
  plan_nodes: [],
  schedules: [],
  references: [],
  task_dependencies: [],
  plan_dependencies: [],
  knowledge_edges: [],
  change_events: [],
  artifacts: [],
};

const emptyDomain = {
  projects: [],
  capture_entries: [],
  tasks: [],
  waitings: [],
  plan_nodes: [],
  schedules: [],
  resources: [],
  notes: [],
  task_dependencies: [],
  plan_dependencies: [],
  knowledge_nodes: [],
  knowledge_edges: [],
  change_events: [],
};

function plan(type, entries, base = {}, data = emptyData) {
  const values = new FormData();
  for (const [key, value] of entries) values.append(key, value);
  return buildDomainDrawerFormPlan({
    type,
    values,
    base,
    data,
    domain: emptyDomain,
    hasField: (name) => entries.some(([key]) => key === name),
  });
}

test("task form plan normalizes reminder, section, schedule, and Artifact Theme sync", () => {
  const data = {
    ...emptyData,
    views: [{
      id: "section-1",
      view_type: "task_section",
      theme_id: "theme-1",
      title: "実験",
      sort_order: 0,
    }],
    artifacts: [{
      id: "artifact-1",
      title: "result.csv",
      file_type: "csv",
      mime_type: "text/csv",
      storage_mode: "managed",
      source_type: "task",
      source_id: "task-1",
      theme_id: null,
    }],
  };
  const result = plan("task", [
    ["title", "解析する"],
    ["theme_id", "theme-1"],
    ["section_id", "section-1"],
    ["state", "todo"],
    ["reminder_at", "2026-07-27T09:30"],
    ["end_date", "2026-07-28"],
  ], { id: "task-1" }, data);

  assert.equal(result.kind, "operations");
  const task = result.operations.find((operation) => operation.type === "task").entity;
  assert.equal(task.section_id, "section-1");
  assert.equal(task.reminder_at, "2026-07-27T09:30");
  assert.equal(result.operations.some((operation) => operation.type === "schedule"), true);
  const artifact = result.operations.find((operation) => operation.type === "artifact").entity;
  assert.equal(artifact.theme_id, "theme-1");
});

test("waiting form plan keeps check reminders on waiting records", () => {
  const result = plan("waiting", [
    ["title", "回答待ち"],
    ["waiting_for", "共同研究先"],
    ["check_reminder_at", "2026-07-29T10:00"],
  ]);

  assert.equal(result.kind, "operations");
  const waiting = result.operations.find((operation) => operation.type === "waiting").entity;
  assert.equal(waiting.check_reminder_at, "2026-07-29T10:00");
});

test("domain form plans report the field that needs focus", () => {
  assert.deepEqual(plan("task", []), {
    kind: "invalid",
    field: "title",
    message: "タイトルを入力してください。",
  });
  assert.deepEqual(plan("waiting", [["title", "回答待ち"]]), {
    kind: "invalid",
    field: "waiting_for",
    message: "相手を入力してください。",
  });
});
