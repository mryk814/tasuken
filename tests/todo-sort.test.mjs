import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transform } from "esbuild";
import { selectTodayTasks, TODAY_TASK_POLICY } from "../src/shared/todayTasks.mjs";

import {
  compareTodoRows,
  isTodayRow,
  scheduledDate,
} from "../src/renderer/src/features/workspace/lib/todoRows.js";

function row(id, title, schedule) {
  return {
    task: {
      id,
      project_id: null,
      title,
      state: "todo",
      priority: "normal",
      created_at: "2026-07-01T00:00:00.000Z",
    },
    schedule,
  };
}

test("scheduledDate uses the end date before the start date for ranges", () => {
  assert.equal(
    scheduledDate({
      id: "schedule-range",
      owner_type: "task",
      owner_id: "range",
      start_date: "2026-07-05",
      end_date: "2026-08-01",
      date_kind: "planned",
      confidence: "fixed",
      granularity: "day",
    }),
    "2026-08-01",
  );
});

test("open todo rows sort by nearest end date without promoting today-starting long tasks", () => {
  const today = "2026-07-05";
  const rows = [
    row("long", "today starting long task", {
      id: "schedule-long",
      owner_type: "task",
      owner_id: "long",
      start_date: today,
      end_date: "2026-08-01",
      date_kind: "planned",
      confidence: "fixed",
      granularity: "day",
    }),
    row("none", "unscheduled task", undefined),
    row("due", "nearest end task", {
      id: "schedule-due",
      owner_type: "task",
      owner_id: "due",
      start_date: "2026-07-04",
      end_date: "2026-07-06",
      date_kind: "planned",
      confidence: "fixed",
      granularity: "day",
    }),
    row("overdue", "overdue task", {
      id: "schedule-overdue",
      owner_type: "task",
      owner_id: "overdue",
      end_date: "2026-07-03",
      date_kind: "deadline",
      confidence: "fixed",
      granularity: "day",
    }),
  ];

  const sorted = [...rows].sort(compareTodoRows(today)).map((entry) => entry.task.id);

  assert.deepEqual(sorted, ["overdue", "due", "long", "none"]);
});

const today = "2026-10-07";
const source = readFileSync("src/renderer/src/features/workspace/pages/TodoPage.tsx", "utf8");

test("ToDo Today filter agrees with the mini for period boundaries and explicit selections", () => {
  for (const range_semantics of ["once_within_window", "ongoing", undefined]) {
    const task = { id: "task", state: "todo", title: "Period task" };
    const schedule = {
      owner_type: "task",
      owner_id: task.id,
      start_date: today,
      end_date: "2026-10-09",
      range_semantics,
    };
    assert.equal(isTodayRow({ task, schedule }, today), false);
    assert.equal(selectTodayTasks([task], [schedule], today).length, 0);
    assert.equal(isTodayRow({ task: { ...task, today_date: today }, schedule }, today), true);
    assert.equal(
      isTodayRow({ task, schedule: { ...schedule, start_date: null, end_date: today } }, today),
      true,
    );
    const endingToday = { ...schedule, start_date: "2026-10-05", end_date: today };
    assert.equal(
      isTodayRow({ task, schedule: endingToday }, today),
      selectTodayTasks([task], [endingToday], today).length > 0,
    );
  }
});

test("actual ToDo Today toggle changes only today_date and makes a period task visible in the mini", async () => {
  const start = source.indexOf("  async function toggleToday(");
  const end = source.indexOf("  async function copyTask", start);
  assert.ok(start >= 0 && end > start);
  const handler = await transform(source.slice(start, end), { loader: "ts", target: "esnext" });
  const operations = [];
  const toggle = new Function(
    "today",
    "saveEntities",
    "buildSaveTaskOperations",
    "buildSaveScheduleOperations",
    `${handler.code}\nreturn toggleToday;`,
  )(
    today,
    async (ops) => operations.push(...ops),
    (task) => [{ type: "task", entity: task }],
    (schedule) => [{ type: "schedule", entity: schedule }],
  );
  for (const range_semantics of ["once_within_window", "ongoing", undefined, "deadline"]) {
    const task = { id: "task", state: "todo", today_date: null };
    const schedule =
      range_semantics === "deadline"
        ? { owner_type: "task", owner_id: task.id, start_date: null, end_date: today }
        : {
            owner_type: "task",
            owner_id: task.id,
            start_date: today,
            end_date: "2026-10-09",
            range_semantics,
          };
    operations.length = 0;
    await toggle(task, schedule);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].type, "task", "Today selection must never change the Schedule");
    const selected = operations[0].entity;
    assert.deepEqual(selected, { ...task, today_date: today });
    assert.equal(
      selectTodayTasks([selected], [schedule], today, TODAY_TASK_POLICY)[0]?.task.id,
      task.id,
    );
    operations.length = 0;
    await toggle(selected, schedule);
    assert.deepEqual(operations, [{ type: "task", entity: task }]);
  }
});
