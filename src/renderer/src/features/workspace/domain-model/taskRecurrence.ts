import type { SaveOperation } from "../types";
import { buildSaveScheduleOperations, buildSaveTaskOperations, type SaveContext } from "./persistence";
import type { Schedule, Task, TaskChecklistItem, TaskRepeatRule } from "./types";

function localDateIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateIso(date: Date): string {
  return localDateIso(date);
}

function addDaysIso(value: string, days: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return dateIso(date);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonthsIso(value: string, months: number, dayOfMonth?: number | null): string {
  const base = parseDate(value);
  const target = new Date(base);
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const day = Math.min(dayOfMonth || base.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
  target.setDate(day);
  return dateIso(target);
}

function scheduleDate(schedule?: Schedule): string {
  return String(schedule?.end_date || schedule?.start_date || "");
}

function nextWeeklyDate(base: string, rule: TaskRepeatRule): string {
  const weekdays = [...new Set(rule.weekdays || [])].sort((a, b) => a - b);
  if (!weekdays.length) return addDaysIso(base, 7 * rule.interval);

  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDaysIso(base, offset);
    if (weekdays.includes(parseDate(candidate).getDay())) return candidate;
  }
  return addDaysIso(base, 7 * rule.interval);
}

export function nextRepeatDate(task: Task, schedule?: Schedule, completedDate = localDateIso()): string | null {
  const rule = task.repeat_rule;
  if (!rule) return null;
  const baseDate = rule.next_from === "completed" ? completedDate : scheduleDate(schedule) || completedDate;
  let nextDate = baseDate;
  if (rule.frequency === "daily") nextDate = addDaysIso(baseDate, rule.interval);
  if (rule.frequency === "weekly") nextDate = nextWeeklyDate(baseDate, rule);
  if (rule.frequency === "monthly") {
    nextDate = addMonthsIso(baseDate, rule.interval, rule.month_day);
    if (nextDate <= baseDate) nextDate = addMonthsIso(baseDate, rule.interval + 1, rule.month_day);
  }
  if (rule.until && nextDate > rule.until) return null;
  return nextDate;
}

function resetChecklist(items?: TaskChecklistItem[]): TaskChecklistItem[] | undefined {
  if (!items?.length) return undefined;
  return items.map((item) => ({
    ...item,
    done: false,
    completed_at: null,
  }));
}

export function buildCompleteTaskOperations(task: Task, schedule?: Schedule, context: SaveContext = {}): SaveOperation[] {
  const now = context.now || new Date().toISOString();
  const completedDate = now.slice(0, 10);
  const nextState = task.state === "done" ? "todo" : "done";
  const completedTask: Task = {
    ...task,
    state: nextState,
    completed_at: nextState === "done" ? now : null,
  };
  const operations = buildSaveTaskOperations(completedTask, context);
  const nextDate = nextState === "done" ? nextRepeatDate(task, schedule, completedDate) : null;
  if (!nextDate || !task.repeat_rule) return operations;

  const nextTaskId = crypto.randomUUID();
  const nextTask: Task = {
    ...task,
    id: nextTaskId,
    state: "todo",
    completed_at: null,
    created_at: now,
    updated_at: undefined,
    repeat_series_id: task.repeat_series_id || task.id,
    repeat_parent_task_id: task.id,
    checklist_items: resetChecklist(task.checklist_items),
  };
  const nextSchedule: Schedule = {
    id: crypto.randomUUID(),
    owner_type: "task",
    owner_id: nextTaskId,
    start_date: schedule?.start_date && schedule.start_date !== schedule.end_date ? nextDate : null,
    end_date: nextDate,
    date_kind: schedule?.date_kind === "range" ? "deadline" : schedule?.date_kind || "deadline",
    confidence: schedule?.confidence || "fixed",
    granularity: schedule?.granularity || "day",
  };
  return [
    ...operations,
    ...buildSaveTaskOperations(nextTask, { ...context, reason: "repeat-next" }),
    ...buildSaveScheduleOperations(nextSchedule, { ...context, reason: "repeat-next" }),
  ];
}

export function repeatRuleLabel(rule?: TaskRepeatRule | null): string {
  if (!rule) return "";
  const every = rule.interval > 1 ? `${rule.interval}` : "";
  if (rule.frequency === "daily") return `${every}日ごと`;
  if (rule.frequency === "weekly") return `${every}週ごと`;
  if (rule.frequency === "monthly") return `${every}か月ごと`;
  return "繰り返し";
}
