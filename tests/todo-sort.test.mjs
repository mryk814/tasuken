import assert from "node:assert/strict";
import test from "node:test";

import { compareTodoRows, scheduledDate } from "../src/renderer/src/features/workspace/lib/todoRows.js";

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
