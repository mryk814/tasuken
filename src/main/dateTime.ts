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

export function normalizeReminderDateTime(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return "";
  const [hour, minute] = match[2].split(":");
  const normalizedHour = String(Number(hour)).padStart(2, "0");
  const normalizedMinute = String(Number(minute)).padStart(2, "0");
  if (!/^(?:[01]\d|2[0-3])$/.test(normalizedHour)) return "";
  if (!/^[0-5]\d$/.test(normalizedMinute)) return "";
  return `${match[1]}T${normalizedHour}:${normalizedMinute}`;
}

export function reminderIsDueToday(
  value: unknown,
  nowMinute = localDateTimeMinute(),
  today = localDateString(),
): string {
  const at = normalizeReminderDateTime(value);
  if (!at || at.slice(0, 10) !== today || at > nowMinute) return "";
  return at;
}
