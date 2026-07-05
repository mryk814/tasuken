import { scheduledDate } from "./todoRows.js";
import type { Schedule, Task } from "../domain-model/types";

export interface DailyPlanningRow {
  task: Task;
  schedule?: Schedule;
}

export interface DailyPlanningCandidates {
  overdue: DailyPlanningRow[];
  carryover: DailyPlanningRow[];
  dueToday: DailyPlanningRow[];
  unscheduled: DailyPlanningRow[];
}

function isOpenTask(task: Task): boolean {
  return task.state !== "done" && task.state !== "cancelled";
}

function byDateThenTitle(a: DailyPlanningRow, b: DailyPlanningRow): number {
  return String(scheduledDate(a.schedule) || "9999-12-31").localeCompare(String(scheduledDate(b.schedule) || "9999-12-31"))
    || a.task.title.localeCompare(b.task.title, "ja");
}

export function buildDailyPlanningCandidates(rows: DailyPlanningRow[], today: string): DailyPlanningCandidates {
  const openRows = rows.filter((row) => isOpenTask(row.task));
  return {
    overdue: openRows
      .filter((row) => {
        const date = scheduledDate(row.schedule);
        return Boolean(date && date < today);
      })
      .sort(byDateThenTitle),
    carryover: openRows
      .filter((row) => Boolean(row.schedule?.start_date && row.schedule.start_date < today && scheduledDate(row.schedule) >= today))
      .sort(byDateThenTitle),
    dueToday: openRows
      .filter((row) => scheduledDate(row.schedule) === today)
      .sort(byDateThenTitle),
    unscheduled: openRows
      .filter((row) => !scheduledDate(row.schedule))
      .sort((a, b) => Number(b.task.priority === "high") - Number(a.task.priority === "high") || a.task.title.localeCompare(b.task.title, "ja")),
  };
}

export function defaultDailyPlanSelection(candidates: DailyPlanningCandidates): Set<string> {
  return new Set([
    ...candidates.overdue.map((row) => row.task.id),
    ...candidates.dueToday.map((row) => row.task.id),
  ]);
}
