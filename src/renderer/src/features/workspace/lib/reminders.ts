import { normalizeReminderDateTime as normalizeSharedReminderDateTime } from "../../../../../shared/taskNotifications";
import type { BaseRecord } from "../types";
import type { Task } from "../domain-model/types";

export const REMINDER_SETTINGS_VIEW_ID = "daily-reminder-settings";

export interface ReminderSettings {
  enabled: boolean;
  activity_log_time: string;
}

export type ReminderAlert =
  | { id: string; type: "task"; title: string; at: string; task: Task }
  | { id: string; type: "activity_log"; title: string; at: string };

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  activity_log_time: "",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 「H:mm」「HH:mm」を「HH:mm」にそろえる。時刻として読めなければ空文字。 */
function normalizeStartTime(value: unknown): string {
  const match = typeof value === "string" ? value.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${pad(hours)}:${pad(minutes)}`;
}

export function localDateTimeMinute(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** リマインダーの時刻を現地時刻の分にそろえる（時差つきの値は瞬間として読む。決まりは shared 側）。 */
export function normalizeReminderDateTime(value: unknown): string | null {
  return normalizeSharedReminderDateTime(value) || null;
}

/**
 * 引き出しの時刻の欄から保存する値。本人が欄を変えていない時は、保存されている値をそのまま返す
 * （時差つきの値を時差なしに書き替えて版を進めない。ほかの欄の保存やチェックリストの自動保存でも同じ）。
 */
export function reminderAtFromForm(formValue: unknown, stored: unknown): string | null {
  const edited = normalizeReminderDateTime(formValue);
  if (edited === normalizeReminderDateTime(stored))
    return typeof stored === "string" && stored ? stored : null;
  return edited;
}

export function normalizeReminderSettings(record: unknown): ReminderSettings {
  const source = record && typeof record === "object" ? (record as Record<string, unknown>) : {};
  return {
    enabled: source.enabled !== false,
    activity_log_time: normalizeStartTime(source.activity_log_time),
  };
}

export function findReminderSettingsView(views: BaseRecord[] = []): BaseRecord | null {
  return (
    views.find(
      (view) =>
        view.id === REMINDER_SETTINGS_VIEW_ID || view.view_type === "daily_reminder_settings",
    ) || null
  );
}

export function buildReminderSettingsView(settings: ReminderSettings): BaseRecord {
  return {
    id: REMINDER_SETTINGS_VIEW_ID,
    title: "Daily reminder settings",
    view_type: "daily_reminder_settings",
    enabled: settings.enabled,
    activity_log_time: normalizeStartTime(settings.activity_log_time),
  };
}

function dailyReminderAt(today: string, time: string): string | null {
  const normalized = normalizeStartTime(time);
  return normalized ? `${today}T${normalized}` : null;
}

export function buildReminderAlerts({
  tasks,
  settings,
  now,
  today,
}: {
  tasks: Task[];
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

  const activityLogAt = dailyReminderAt(today, normalizedSettings.activity_log_time);
  if (activityLogAt && activityLogAt <= now) {
    alerts.push({
      id: `activity-log:${today}`,
      type: "activity_log",
      title: "Activity Log",
      at: activityLogAt,
    });
  }

  return alerts.sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title, "ja"));
}

/** リマインダーの時刻を過ぎているか。時刻のない値・不正な値は過ぎていない扱い。 */
export function isReminderDue(value: unknown, now: string): boolean {
  const at = normalizeReminderDateTime(value);
  return Boolean(at && at <= now);
}

/** 「あとで」の先送り。今からminutes分後の分単位の現地時刻（reminder_atの形式）を返す。 */
export function snoozedReminderAt(minutes: number, base = new Date()): string {
  return localDateTimeMinute(new Date(base.getTime() + minutes * 60_000));
}

/**
 * 時刻を過ぎたTaskのリマインダー（Activity Logの日次通知は含めない）。古い順。
 * 待ちの確認の時刻は、待ちを Task に写した時に Task のリマインダーへ移した（#755 束7）。
 */
export function dueItemReminders(tasks: Task[], now: string): ReminderAlert[] {
  return buildReminderAlerts({
    tasks,
    settings: { enabled: true, activity_log_time: "" },
    now,
    today: now.slice(0, 10),
  });
}
