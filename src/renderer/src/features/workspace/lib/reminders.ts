import { normalizeStartTime } from "./timeboxing";
import type { BaseRecord } from "../types";
import type { Task, Waiting } from "../domain-model/types";

export const REMINDER_SETTINGS_VIEW_ID = "daily-reminder-settings";

export interface ReminderSettings {
  enabled: boolean;
  daily_plan_time: string;
  activity_log_time: string;
}

export type ReminderAlert =
  | { id: string; type: "task"; title: string; at: string; task: Task }
  | { id: string; type: "waiting"; title: string; at: string; waiting: Waiting }
  | { id: string; type: "daily_plan"; title: string; at: string }
  | { id: string; type: "activity_log"; title: string; at: string };

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  daily_plan_time: "",
  activity_log_time: "",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDateTimeMinute(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeReminderDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return null;
  const time = normalizeStartTime(match[2]);
  return time ? `${match[1]}T${time}` : null;
}

export function normalizeReminderSettings(record: unknown): ReminderSettings {
  const source = record && typeof record === "object" ? record as Record<string, unknown> : {};
  return {
    enabled: source.enabled !== false,
    daily_plan_time: normalizeStartTime(source.daily_plan_time),
    activity_log_time: normalizeStartTime(source.activity_log_time),
  };
}

export function findReminderSettingsView(views: BaseRecord[] = []): BaseRecord | null {
  return views.find((view) => view.id === REMINDER_SETTINGS_VIEW_ID || view.view_type === "daily_reminder_settings") || null;
}

export function buildReminderSettingsView(settings: ReminderSettings): BaseRecord {
  return {
    id: REMINDER_SETTINGS_VIEW_ID,
    title: "Daily reminder settings",
    view_type: "daily_reminder_settings",
    enabled: settings.enabled,
    daily_plan_time: normalizeStartTime(settings.daily_plan_time),
    activity_log_time: normalizeStartTime(settings.activity_log_time),
  };
}

function dailyReminderAt(today: string, time: string): string | null {
  const normalized = normalizeStartTime(time);
  return normalized ? `${today}T${normalized}` : null;
}

export function buildReminderAlerts({
  tasks,
  waitings,
  settings,
  now,
  today,
}: {
  tasks: Task[];
  waitings: Waiting[];
  settings: ReminderSettings;
  now: string;
  today: string;
}): ReminderAlert[] {
  const normalizedSettings = normalizeReminderSettings(settings);
  if (!normalizedSettings.enabled) return [];

  const alerts: ReminderAlert[] = [];
  for (const task of tasks) {
    const at = normalizeReminderDateTime(task.reminder_at);
    if (!at || at > now || task.state === "done" || task.state === "cancelled") continue;
    alerts.push({ id: `task:${task.id}`, type: "task", title: task.title, at, task });
  }
  for (const waiting of waitings) {
    const at = normalizeReminderDateTime(waiting.check_reminder_at);
    if (!at || at > now || waiting.state === "received" || waiting.state === "cancelled") continue;
    alerts.push({ id: `waiting:${waiting.id}`, type: "waiting", title: waiting.title, at, waiting });
  }

  const dailyPlanAt = dailyReminderAt(today, normalizedSettings.daily_plan_time);
  if (dailyPlanAt && dailyPlanAt <= now) {
    alerts.push({ id: `daily-plan:${today}`, type: "daily_plan", title: "今日の計画", at: dailyPlanAt });
  }
  const activityLogAt = dailyReminderAt(today, normalizedSettings.activity_log_time);
  if (activityLogAt && activityLogAt <= now) {
    alerts.push({ id: `activity-log:${today}`, type: "activity_log", title: "Activity Log", at: activityLogAt });
  }

  return alerts.sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title, "ja"));
}
