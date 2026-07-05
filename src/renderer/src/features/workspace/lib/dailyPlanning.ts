import { scheduledDate } from "./todoRows.js";
import { addDays } from "./format";
import type { Schedule, Task } from "../domain-model/types";

export interface DailyPlanningRow {
  task: Task;
  schedule?: Schedule;
}

export interface DailyPlanningCandidates {
  overdue: DailyPlanningRow[];
  thisWeek: DailyPlanningRow[];
  someday: DailyPlanningRow[];
}

function isOpenTask(task: Task): boolean {
  return task.state !== "done" && task.state !== "cancelled";
}

function byDateThenTitle(a: DailyPlanningRow, b: DailyPlanningRow): number {
  return String(scheduledDate(a.schedule) || "9999-12-31").localeCompare(String(scheduledDate(b.schedule) || "9999-12-31"))
    || a.task.title.localeCompare(b.task.title, "ja");
}
function touchesToday(schedule: Schedule | undefined, today: string): boolean {
  if (!schedule) return false;
  const start = schedule.start_date || schedule.end_date || "";
  const end = schedule.end_date || schedule.start_date || "";
  return Boolean(start && end && start <= today && today <= end);
}

function isOngoingPeriodThisWeek(schedule: Schedule | undefined, today: string, weekEnd: string): boolean {
  if (!schedule?.start_date || !schedule.end_date) return false;
  return schedule.start_date < today && today < schedule.end_date && schedule.end_date <= weekEnd;
}

export function buildDailyPlanningCandidates(rows: DailyPlanningRow[], today: string): DailyPlanningCandidates {
  const openRows = rows.filter((row) => isOpenTask(row.task));
  const weekEnd = addDays(today, 7);
  return {
    overdue: openRows
      .filter((row) => {
        const date = scheduledDate(row.schedule);
        return Boolean(date && date < today);
      })
      .sort(byDateThenTitle),
    thisWeek: openRows
      .filter((row) => {
        const date = scheduledDate(row.schedule);
        return Boolean(date && date > today && date <= weekEnd && (!touchesToday(row.schedule, today) || isOngoingPeriodThisWeek(row.schedule, today, weekEnd)));
      })
      .sort(byDateThenTitle),
    someday: openRows
      .filter((row) => !scheduledDate(row.schedule))
      .sort((a, b) => Number(b.task.priority === "high") - Number(a.task.priority === "high") || a.task.title.localeCompare(b.task.title, "ja")),
  };
}
