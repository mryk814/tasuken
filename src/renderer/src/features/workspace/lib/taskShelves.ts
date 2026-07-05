import { scheduledDate } from "./todoRows.js";
import type { Schedule, Task } from "../domain-model/types";

export type TaskShelf = "maybe_today" | "this_evening" | "this_week" | "someday" | "backlog";

export interface TaskShelfOption {
  id: TaskShelf;
  label: string;
}

export interface TaskShelfRow {
  task: Task;
  schedule?: Schedule;
}

export const TASK_SHELF_OPTIONS: TaskShelfOption[] = [
  { id: "maybe_today", label: "今日できたら" },
  { id: "this_evening", label: "夜/後で" },
  { id: "this_week", label: "今週" },
  { id: "someday", label: "いつか" },
  { id: "backlog", label: "Backlog" },
];

export const TASK_SHELF_LABELS: Record<TaskShelf, string> = Object.fromEntries(
  TASK_SHELF_OPTIONS.map((option) => [option.id, option.label]),
) as Record<TaskShelf, string>;

const TASK_SHELVES = new Set(TASK_SHELF_OPTIONS.map((option) => option.id));

export function normalizeTaskShelf(value: unknown): TaskShelf | null {
  return typeof value === "string" && TASK_SHELVES.has(value as TaskShelf) ? value as TaskShelf : null;
}

export function taskShelfLabel(value: unknown): string {
  const shelf = normalizeTaskShelf(value);
  return shelf ? TASK_SHELF_LABELS[shelf] : "棚なし";
}

export function isOpenShelfTask(row: TaskShelfRow): boolean {
  return row.task.state !== "done" && row.task.state !== "cancelled" && normalizeTaskShelf(row.task.planning_shelf) != null;
}

export function taskShelfStatus(row: TaskShelfRow, today: string): "" | "overdue" | "due-today" {
  const date = scheduledDate(row.schedule);
  if (!date) return "";
  if (date < today) return "overdue";
  if (date === today) return "due-today";
  return "";
}
