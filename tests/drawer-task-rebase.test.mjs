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

test("自分で日程（日付・時刻）だけ変えた保存は、外で変わっていなければ「上書き」と言わない（#785 で見つけた）", () => {
  const currentTask = { ...base };
  // storeの日程は、保存の時に付く欄（version・source・device_id）と、時刻の欄の無い古い形を持つ。
  const stored = {
    ...currentSchedule,
    source: "manual",
    device_id: "device-1",
    deleted_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
  };
  const opened = { ...openedFields, end_time: "" };
  const dateOnly = rebaseDrawerTaskOperations({
    initial: plan(opened),
    edited: plan({ ...opened, end_date: "2026-11-12" }),
    currentTask,
    currentSchedule: stored,
  });
  assert.deepEqual(dateOnly.overwritten, []);
  assert.equal(
    dateOnly.operations.find((operation) => operation.type === "schedule").entity.end_date,
    "2026-11-12",
  );
  const timed = rebaseDrawerTaskOperations({
    initial: plan(opened),
    edited: plan({ ...opened, end_time: "23:59", notify_before_minutes: "30" }),
    currentTask,
    currentSchedule: stored,
  });
  assert.deepEqual(timed.overwritten, []);
  const schedule = timed.operations.find((operation) => operation.type === "schedule").entity;
  assert.equal(schedule.end_time, "23:59");
  assert.equal(schedule.notify_before_minutes, 30);
  // 外で時刻が変わっていたら、今までどおり知らせる。
  const external = rebaseDrawerTaskOperations({
    initial: plan(opened),
    edited: plan({ ...opened, end_date: "2026-11-12" }),
    currentTask,
    currentSchedule: { ...stored, end_time: "09:00", notify_before_minutes: 30 },
  });
  assert.deepEqual(external.overwritten, ["schedule"]);
});

test("開いている間に外で付いた期限の時刻を、時刻の欄に触れない日付の保存が消さない（#785 のレビューで見つけた）", () => {
  const opened = { ...openedFields, end_time: "" };
  const { operations } = rebaseDrawerTaskOperations({
    initial: plan(opened),
    edited: plan({ ...opened, end_date: "2026-11-12" }),
    currentTask: { ...base },
    currentSchedule: {
      ...currentSchedule,
      end_time: "17:00",
      notify_before_minutes: 30,
      version: 2,
    },
  });
  const schedule = operations.find((operation) => operation.type === "schedule").entity;
  assert.equal(schedule.end_date, "2026-11-12");
  // 送らなければ Core は保存済みの時刻と知らせを残す（null を送ると外す）。
  assert.equal(Object.hasOwn(schedule, "end_time"), false);
  assert.equal(Object.hasOwn(schedule, "notify_before_minutes"), false);

  // 本人が時刻の欄を変えた時は、その値を送る。
  const timed = rebaseDrawerTaskOperations({
    initial: plan(opened),
    edited: plan({ ...opened, end_time: "18:30" }),
    currentTask: { ...base },
    currentSchedule,
  });
  const timedSchedule = timed.operations.find((operation) => operation.type === "schedule").entity;
  assert.equal(timedSchedule.end_time, "18:30");
});
