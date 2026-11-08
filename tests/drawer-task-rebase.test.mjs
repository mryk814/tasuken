import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { build } from "esbuild";
import path from "node:path";
import test from "node:test";

// 編集ドロワーを開いたまま外（Android・MCP）で同じTaskが変わったとき、
// ドロワーの保存がその変更を開いた時点の値へ巻き戻さないことを確かめる。
// WorkspaceAppの保存と同じく、前回の保存時と今のフォームから計画を作り、最新のTaskへ乗せる。

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64")
  );
}

const { buildDomainDrawerFormPlan } = await importBundled(
  "src/renderer/src/features/workspace/lib/drawerFormPlans.ts",
);
const { rebaseDrawerTaskOperations, describeOverwrittenFields } = await importBundled(
  "src/renderer/src/features/workspace/lib/drawerTaskRebase.ts",
);

const base = {
  id: "task-1",
  title: "元の題名",
  project_id: "theme-personal-default",
  state: "todo",
  requester: "self",
  intended_executor: "self",
  work_state: "not_delegated",
  priority: "normal",
  today_date: null,
  description: null,
  checklist_items: [],
  created_at: "2026-11-01T00:00:00.000Z",
  version: 1,
};

function form(fields) {
  const values = new FormData();
  for (const [key, value] of Object.entries(fields)) values.append(key, value);
  return values;
}

const openedFields = {
  title: "元の題名",
  theme_id: "theme-personal-default",
  state: "todo",
  description: "",
  _schedule_id: "schedule-1",
  end_date: "2026-11-10",
};

function plan(fields) {
  const values = form(fields);
  const result = buildDomainDrawerFormPlan({
    type: "task",
    values,
    base,
    data: { views: [], artifacts: [] },
    domain: {},
    hasField: (name) => name in fields,
  });
  assert.equal(result?.kind, "operations");
  return result.operations;
}

function save({ edited, currentTask, currentSchedule }) {
  return rebaseDrawerTaskOperations({
    initial: plan(openedFields),
    edited: plan(edited),
    currentTask,
    currentSchedule,
  });
}

const currentSchedule = {
  id: "schedule-1",
  owner_type: "task",
  owner_id: "task-1",
  start_date: null,
  end_date: "2026-11-10",
  date_kind: "deadline",
  range_semantics: null,
  confidence: "fixed",
  granularity: "day",
  version: 1,
};

test("ドロワーの保存は、開いている間に外で変わった欄を巻き戻さない", () => {
  const currentTask = {
    ...base,
    title: "AIが直した題名",
    today_date: "2026-11-08",
    version: 2,
  };
  const { operations, overwritten } = save({
    edited: { ...openedFields, description: "本人のメモ" },
    currentTask,
    currentSchedule,
  });
  const task = operations.find((operation) => operation.type === "task").entity;
  assert.equal(task.title, "AIが直した題名");
  assert.equal(task.today_date, "2026-11-08");
  assert.equal(task.description, "本人のメモ");
  assert.deepEqual(overwritten, []);
});

test("日程に触れていなければ、外で変わった日程を送り直さない", () => {
  const { operations } = save({
    edited: { ...openedFields, description: "本人のメモ" },
    currentTask: { ...base, version: 2 },
    currentSchedule: { ...currentSchedule, end_date: "2026-11-12", version: 2 },
  });
  assert.equal(
    operations.some((operation) => operation.type === "schedule"),
    false,
  );
});

test("両方で変わった欄はこの画面の値で保存し、上書きしたことを返す", () => {
  const { operations, overwritten } = save({
    edited: { ...openedFields, title: "本人の題名", end_date: "2026-11-20" },
    currentTask: { ...base, title: "AIが直した題名", version: 2 },
    currentSchedule: { ...currentSchedule, end_date: "2026-11-12", version: 2 },
  });
  const task = operations.find((operation) => operation.type === "task").entity;
  const schedule = operations.find((operation) => operation.type === "schedule").entity;
  assert.equal(task.title, "本人の題名");
  assert.equal(schedule.end_date, "2026-11-20");
  assert.deepEqual(overwritten, ["title", "schedule"]);
  assert.equal(
    describeOverwrittenFields(overwritten),
    "題名・日程は、ほかで変わっていた値をこの画面の値で上書きしました。",
  );
});
