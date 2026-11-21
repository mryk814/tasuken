/**
 * やることの画面の絞り込み条件と、その当てはめ。条件を名前を付けて保存する機能（view_type が task の
 * view）は #755 束6 で外し、保存済みの記録は起動時に Markdown へ書き出す（savedViewRetirementExport.ts）。
 */
import { addDays } from "./format";
import { isTodayRow, scheduledDate } from "./todoRows.js";
import type { Schedule, Task } from "../domain-model/types";
import { getScheduleKind, type ScheduleKind } from "../domain-model/scheduleSemantics";
import { isScheduleOverdueAt } from "../../../../../shared/scheduleSemantics.mjs";

export type TaskViewTab = "open" | "today" | "overdue" | "no-schedule" | "done";
export type TaskViewSchedule = "" | "scheduled" | "no-schedule" | "overdue" | "this-week" | "today";
export type TaskViewPriority = "" | "high" | "normal";
export type TaskViewRangeSemantics =
  "" | Extract<ScheduleKind, "execution_window" | "ongoing_period" | "unspecified_range">;

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
  rangeSemantics: TaskViewRangeSemantics;
}

const TASK_VIEW_TABS = new Set(["open", "today", "overdue", "no-schedule", "done"]);
const TASK_VIEW_SCHEDULES = new Set([
  "",
  "scheduled",
  "no-schedule",
  "overdue",
  "this-week",
  "today",
]);
const TASK_VIEW_PRIORITIES = new Set(["", "high", "normal"]);
const TASK_VIEW_RANGE_SEMANTICS = new Set([
  "",
  "execution_window",
  "ongoing_period",
  "unspecified_range",
]);
const TASK_STATES = new Set(["", "todo", "doing", "waiting", "review", "done", "cancelled"]);

export const DEFAULT_TASK_VIEW_FILTERS: TaskViewFilters = {
  tab: "open",
  themeId: "all",
  state: "",
  priority: "",
  schedule: "",
  rangeSemantics: "",
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isDoneRow(row: TodoRow): boolean {
  return row.task.state === "done" || row.task.state === "cancelled";
}

export function normalizeTaskViewFilters(value: unknown): TaskViewFilters {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const tab = text(raw.tab);
  const priority = text(raw.priority);
  const schedule = text(raw.schedule);
  const state = text(raw.state);
  const rangeSemantics = text(raw.rangeSemantics);
  const themeId = typeof raw.themeId === "string" ? raw.themeId : DEFAULT_TASK_VIEW_FILTERS.themeId;
  return {
    tab: (TASK_VIEW_TABS.has(tab) ? tab : DEFAULT_TASK_VIEW_FILTERS.tab) as TaskViewTab,
    themeId,
    state: TASK_STATES.has(state) ? state : "",
    priority: (TASK_VIEW_PRIORITIES.has(priority) ? priority : "") as TaskViewPriority,
    schedule: (TASK_VIEW_SCHEDULES.has(schedule) ? schedule : "") as TaskViewSchedule,
    rangeSemantics: (TASK_VIEW_RANGE_SEMANTICS.has(rangeSemantics)
      ? rangeSemantics
      : "") as TaskViewRangeSemantics,
  };
}

/**
 * 予定超過の行か。予定の日が過ぎたものに加え、期限の日のうちでも時刻を過ぎたもの（#785）。
 * now（現地時刻の分）を渡さなければ日付だけで決める。数と行が食い違わないよう、件数もこれで数える。
 */
export function isTodoRowOverdue(row: TodoRow, today: string, now?: string): boolean {
  const date = scheduledDate(row.schedule);
  if (!date) return false;
  if (date < today) return true;
  return Boolean(now) && isScheduleOverdueAt(row.schedule, String(now));
}

export function filterTodoRows(
  rows: TodoRow[],
  filters: Partial<TaskViewFilters>,
  today: string,
  now?: string,
): TodoRow[] {
  const normalized = normalizeTaskViewFilters(filters);
  const weekEnd = addDays(today, 6);
  return rows.filter((row) => {
    const date = scheduledDate(row.schedule);
    if (normalized.tab === "today" && (isDoneRow(row) || !isTodayRow(row, today))) return false;
    if (normalized.tab === "done" && !isDoneRow(row)) return false;
    if (normalized.tab === "no-schedule" && (isDoneRow(row) || date)) return false;
    if (normalized.tab === "overdue" && (isDoneRow(row) || !isTodoRowOverdue(row, today, now)))
      return false;
    if (normalized.tab === "open" && isDoneRow(row)) return false;
    if (normalized.themeId !== "all") {
      if (!normalized.themeId && row.task.project_id) return false;
      if (normalized.themeId && row.task.project_id !== normalized.themeId) return false;
    }
    if (normalized.state && row.task.state !== normalized.state) return false;
    if (normalized.priority && row.task.priority !== normalized.priority) return false;
    if (normalized.schedule === "scheduled" && !date) return false;
    if (normalized.schedule === "no-schedule" && date) return false;
    if (normalized.schedule === "overdue" && !isTodoRowOverdue(row, today, now)) return false;
    if (normalized.schedule === "this-week" && (!date || date < today || date > weekEnd))
      return false;
    if (normalized.schedule === "today" && !isTodayRow(row, today)) return false;
    if (normalized.rangeSemantics && getScheduleKind(row.schedule) !== normalized.rangeSemantics)
      return false;
    return true;
  });
}

/** ボードの工程列は一覧のタブ・状態条件から独立させる。一覧の条件は変更しない。 */
export function filterTaskBoardRows(
  rows: TodoRow[],
  filters: Partial<TaskViewFilters>,
  today: string,
  now?: string,
): TodoRow[] {
  const sharedFilters = { ...filters, state: "", priority: "" as const };
  return [
    ...filterTodoRows(rows, { ...sharedFilters, tab: "open" }, today, now),
    ...filterTodoRows(rows, { ...sharedFilters, tab: "done" }, today, now),
  ];
}
