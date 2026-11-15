import { normalizeReminderDateTime } from "../shared/taskNotifications.ts";

export function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localDateTimeString(date = new Date()): string {
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${localDateString(date)}T${time}.${ms}`;
}

export function localDateTimeMinute(date = new Date()): string {
  return localDateTimeString(date).slice(0, 16);
}

export { normalizeReminderDateTime };

export function reminderIsDueToday(
  value: unknown,
  nowMinute = localDateTimeMinute(),
  today = localDateString(),
): string {
  const at = normalizeReminderDateTime(value);
  if (!at || at.slice(0, 10) !== today || at > nowMinute) return "";
  return at;
}
