import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// 繰り返しTaskを完了したとき、その回だけの印（今日やる日・日ごとの棚）を次の回へ持ち越さない。
const bundled = await build({
  entryPoints: ["src/renderer/src/features/workspace/domain-model/taskRecurrence.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { buildCompleteTaskOperations } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const baseTask = {
  id: "task-1",
  project_id: "theme-1",
  title: "週次の振り返り",
  state: "todo",
  priority: "normal",
  today_date: "2026-10-06",
  planning_shelf: "maybe_today",
  reminder_at: "2026-10-06T00:30:00.000Z",
  repeat_rule: { frequency: "weekly", interval: 1, next_from: "scheduled", weekdays: [] },
};
const schedule = {
  id: "schedule-1",
  owner_type: "task",
  owner_id: "task-1",
  start_date: null,
  end_date: "2026-10-06",
  date_kind: "deadline",
  confidence: "fixed",
  granularity: "day",
};

function savedTasks(operations) {
  return operations
    .filter((op) => op.action === "save" && op.type === "task")
    .map((op) => op.entity);
}

test("the next occurrence does not inherit today's mark or a day-scoped shelf", () => {
  const operations = buildCompleteTaskOperations(baseTask, schedule, {
    now: "2026-10-06T09:00:00.000Z",
  });
  const [completed, next] = savedTasks(operations);
  assert.equal(completed.state, "done");
  assert.equal(completed.today_date, "2026-10-06", "完了した回の記録は変えない");
  assert.equal(next.state, "todo");
  assert.equal(next.repeat_parent_task_id, "task-1");
  assert.equal(next.today_date, null);
  assert.equal(next.planning_shelf, null);
  const nextSchedule = operations.find(
    (op) => op.type === "schedule" && op.entity.owner_id === next.id,
  );
  assert.equal(nextSchedule.entity.end_date, "2026-10-13");
  // リマインダーは期限と同じ7日だけ後ろへ。
  assert.equal(next.reminder_at, "2026-10-13T00:30:00.000Z");
});

test("longer-lived shelves are kept and reminders without a base date are not carried", () => {
  const operations = buildCompleteTaskOperations(
    {
      ...baseTask,
      planning_shelf: "this_week",
      repeat_rule: { frequency: "daily", interval: 1, next_from: "completed", weekdays: [] },
    },
    undefined,
    { now: "2026-10-06T09:00:00.000Z" },
  );
  const [, next] = savedTasks(operations);
  assert.equal(next.planning_shelf, "this_week");
  assert.equal(next.today_date, null);
  assert.equal(next.reminder_at, null);
});
