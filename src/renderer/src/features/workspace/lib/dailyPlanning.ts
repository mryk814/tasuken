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
        return Boolean(date && date >= today && date <= weekEnd);
      })
      .sort(byDateThenTitle),
    someday: openRows
      .filter((row) => !scheduledDate(row.schedule))
      .sort((a, b) => Number(b.task.priority === "high") - Number(a.task.priority === "high") || a.task.title.localeCompare(b.task.title, "ja")),
  };
}

export function defaultDailyPlanSelection(candidates: DailyPlanningCandidates): Set<string> {
  return new Set([
    ...candidates.overdue.map((row) => row.task.id),
    ...candidates.thisWeek.map((row) => row.task.id),
  ]);
}
