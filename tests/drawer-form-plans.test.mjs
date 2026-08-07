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

test("AI共通metadataは欄がある編集では保存され、欄が無い保存では消えない（#294）", () => {
  const base = {
    id: "task-1",
    ai_summary: "既存の概要",
    ai_summary_authority: "user_confirmed",
    ai_authority: "user_confirmed",
    ai_visibility: ["coding_agent"],
    ai_source_refs: [{ kind: "url", locator: "https://example.com" }],
  };

  // 欄が無い保存経路（一覧からの状態変更など）は既存値をそのまま持ち回る。
  const carried = plan("task", [["title", "解析する"], ["state", "doing"]], base);
  const carriedTask = carried.operations.find((operation) => operation.type === "task").entity;
  assert.equal(carriedTask.ai_summary, "既存の概要");
  assert.deepEqual(carriedTask.ai_visibility, ["coding_agent"]);
  assert.deepEqual(carriedTask.ai_source_refs, [{ kind: "url", locator: "https://example.com" }]);

  const edited = plan("task", [
    ["title", "解析する"],
    ["state", "doing"],
    ["ai_context_present", "true"],
    ["ai_summary", "新しい概要"],
    ["ai_summary_authority", "user_confirmed"],
    ["ai_freshness", "current"],
    ["ai_authority", "user_confirmed"],
    ["ai_last_verified_at", "2026-08-06"],
    ["ai_visibility_override", "true"],
    ["ai_visibility", "m365"],
  ], base);
  const editedTask = edited.operations.find((operation) => operation.type === "task").entity;
  assert.equal(editedTask.ai_summary, "新しい概要");
  assert.equal(editedTask.ai_freshness, "current");
  assert.equal(editedTask.ai_last_verified_at, "2026-08-06");
  assert.deepEqual(editedTask.ai_visibility, ["m365"]);

  // 個別設定を外したら未設定（null）へ戻し、Theme・全体の既定へ継承させる。
  const inherited = plan("task", [
    ["title", "解析する"],
    ["state", "doing"],
    ["ai_context_present", "true"],
    ["ai_visibility", "m365"],
  ], base);
  const inheritedTask = inherited.operations.find((operation) => operation.type === "task").entity;
  assert.equal(inheritedTask.ai_visibility, null);

  // 置き換え先が無いままsupersededにはしない。
  const superseded = plan("task", [
    ["title", "解析する"],
    ["state", "doing"],
    ["ai_context_present", "true"],
    ["ai_freshness", "superseded"],
  ], base);
  const supersededTask = superseded.operations.find((operation) => operation.type === "task").entity;
  assert.equal(supersededTask.ai_freshness, null);
});

test("出典は空行を捨て、Import由来のlocator情報を保つ（#294）", () => {
  const base = {
    id: "task-1",
    ai_source_refs: [
      { kind: "canonical_document", locator: "材料A/測定メモ.md", title: "測定メモ", storage_root_id: "sync", relative_path: "材料A/測定メモ.md" },
    ],
  };
  const result = plan("task", [
    ["title", "解析する"],
    ["state", "todo"],
    ["ai_context_present", "true"],
    ["ai_source_ref_kind", "canonical_document"],
    ["ai_source_ref_locator", "材料A/測定メモ.md"],
    ["ai_source_ref_title", "測定メモ"],
    ["ai_source_ref_kind", "url"],
    ["ai_source_ref_locator", "https://example.com/spec"],
    ["ai_source_ref_title", "仕様"],
    // 追加用の空行は保存しない。
    ["ai_source_ref_kind", "url"],
    ["ai_source_ref_locator", "  "],
    ["ai_source_ref_title", ""],
  ], base);
  const task = result.operations.find((operation) => operation.type === "task").entity;
  assert.equal(task.ai_source_refs.length, 2);
  // フォームで触らないstorage_root_id / relative_pathは既存値を引き継ぐ。
  assert.equal(task.ai_source_refs[0].storage_root_id, "sync");
  assert.equal(task.ai_source_refs[0].relative_path, "材料A/測定メモ.md");
  assert.deepEqual(task.ai_source_refs[1], { kind: "url", locator: "https://example.com/spec", title: "仕様" });

  // 場所を空にした行は外れる（削除）。
  const removed = plan("task", [
    ["title", "解析する"],
    ["state", "todo"],
    ["ai_context_present", "true"],
    ["ai_source_ref_kind", "canonical_document"],
    ["ai_source_ref_locator", ""],
    ["ai_source_ref_title", "測定メモ"],
  ], base);
  const removedTask = removed.operations.find((operation) => operation.type === "task").entity;
  assert.deepEqual(removedTask.ai_source_refs, []);
});
