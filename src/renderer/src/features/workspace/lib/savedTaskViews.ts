import { addDays } from "./format";
import { isTodayRow, scheduledDate } from "./todoRows.js";
import type { Schedule, Task } from "../domain-model/types";

export type TaskViewTab = "open" | "today" | "overdue" | "no-schedule" | "done";
export type TaskViewSchedule = "" | "scheduled" | "no-schedule" | "overdue" | "this-week" | "today";
export type TaskViewPriority = "" | "high" | "normal";

export interface TodoRow {
  task: Task;
  schedule?: Schedule;
}

export interface TaskViewFilters {
  tab: TaskViewTab;
  themeId: string;
  state: string;
  priority: TaskViewPriority;
  schedule: TaskViewSchedule;
}

export interface SavedTaskView {
  id: string;
  title: string;
  filters: TaskViewFilters;
}

const TASK_VIEW_TABS = new Set(["open", "today", "overdue", "no-schedule", "done"]);
const TASK_VIEW_SCHEDULES = new Set(["", "scheduled", "no-schedule", "overdue", "this-week", "today"]);
const TASK_VIEW_PRIORITIES = new Set(["", "high", "normal"]);
const TASK_STATES = new Set(["", "todo", "doing", "waiting", "review", "done", "cancelled"]);

export const DEFAULT_TASK_VIEW_FILTERS: TaskViewFilters = {
  tab: "open",
  themeId: "",
  state: "",
  priority: "",
  schedule: "",
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isDoneRow(row: TodoRow): boolean {
  return row.task.state === "done" || row.task.state === "cancelled";
}

export function normalizeTaskViewFilters(value: unknown): TaskViewFilters {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const tab = text(raw.tab);
  const priority = text(raw.priority);
  const schedule = text(raw.schedule);
  const state = text(raw.state);
  return {
    tab: (TASK_VIEW_TABS.has(tab) ? tab : DEFAULT_TASK_VIEW_FILTERS.tab) as TaskViewTab,
    themeId: text(raw.themeId),
    state: TASK_STATES.has(state) ? state : "",
    priority: (TASK_VIEW_PRIORITIES.has(priority) ? priority : "") as TaskViewPriority,
    schedule: (TASK_VIEW_SCHEDULES.has(schedule) ? schedule : "") as TaskViewSchedule,
  };
}

export function normalizeSavedTaskView(record: Record<string, unknown>): SavedTaskView {
  const filters = normalizeTaskViewFilters(record.filters);
  return {
    id: text(record.id),
    title: text(record.title) || text(record.name) || "保存済みビュー",
    filters,
  };
}

export function isTaskSavedView(record: Record<string, unknown>): boolean {
  return text(record.view_type) === "task" || text(record.scope) === "task";
}

export function filterTodoRows(rows: TodoRow[], filters: Partial<TaskViewFilters>, today: string): TodoRow[] {
  const normalized = normalizeTaskViewFilters(filters);
  const weekEnd = addDays(today, 6);
  return rows.filter((row) => {
    const date = scheduledDate(row.schedule);
    if (normalized.tab === "today" && (isDoneRow(row) || !isTodayRow(row, today))) return false;
    if (normalized.tab === "done" && !isDoneRow(row)) return false;
    if (normalized.tab === "no-schedule" && (isDoneRow(row) || date)) return false;
    if (normalized.tab === "overdue" && (isDoneRow(row) || !date || date >= today)) return false;
    if (normalized.tab === "open" && isDoneRow(row)) return false;
    if (normalized.themeId && row.task.project_id !== normalized.themeId) return false;
    if (normalized.state && row.task.state !== normalized.state) return false;
    if (normalized.priority && row.task.priority !== normalized.priority) return false;
    if (normalized.schedule === "scheduled" && !date) return false;
    if (normalized.schedule === "no-schedule" && date) return false;
    if (normalized.schedule === "overdue" && (!date || date >= today)) return false;
    if (normalized.schedule === "this-week" && (!date || date < today || date > weekEnd)) return false;
    if (normalized.schedule === "today" && !isTodayRow(row, today)) return false;
    return true;
  });
}

export function countTodoRowsForView(view: SavedTaskView, rows: TodoRow[], today: string): number {
  return filterTodoRows(rows, view.filters, today).length;
}
