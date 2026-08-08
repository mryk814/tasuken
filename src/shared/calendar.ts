export type CalendarProvider = "microsoft" | "google";

export const CALENDAR_PROVIDERS = ["microsoft", "google"] as const;

export type CalendarOccurrenceType = "singleInstance" | "occurrence" | "exception" | "seriesMaster" | "unknown";

export interface CalendarRecurrencePattern {
  type: string;
  interval?: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  month?: number;
  index?: string;
}

export interface CalendarRecurrenceRange {
  type: string;
  startDate?: string;
  endDate?: string;
  numberOfOccurrences?: number;
}

export interface CalendarRecurrence {
  seriesMasterId: string;
  pattern: CalendarRecurrencePattern | null;
  range: CalendarRecurrenceRange | null;
}

export interface CalendarRange {
  date: string;
  timeZone: string;
  start: string;
  end: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  startTimeZone: string;
  endTimeZone: string;
  isAllDay: boolean;
  location: string;
  meetingUrl: string;
  calendarName: string;
  sensitivity: "normal" | "personal" | "private" | "confidential";
  seriesMasterId: string | null;
  occurrenceType: CalendarOccurrenceType;
  recurrence: CalendarRecurrence | null;
}

export type CalendarErrorCode =
  | "not_configured"
  | "not_connected"
  | "storage_unavailable"
  | "consent_required"
  | "admin_approval_required"
  | "conditional_access"
  | "permission_denied"
  | "authentication_required"
  | "token_expired"
  | "rate_limited"
  | "offline"
  | "provider_unavailable"
  | "invalid_response"
  | "unsupported_provider"
  | "unknown";

export interface CalendarEventsResult {
  provider: CalendarProvider;
  events: CalendarEvent[];
  fetchedAt: string;
  timeZone: string;
  stale: boolean;
  error?: string;
  errorCode?: CalendarErrorCode;
}

export interface CalendarConnectionStatus {
  provider: CalendarProvider | null;
  accountName: string;
  connected: boolean;
  lastFetchedAt: string;
}

export interface CalendarConnectRequest {
  provider: CalendarProvider;
}

export interface CalendarDisconnectRequest {
  provider: CalendarProvider;
}

export interface CalendarAdapter {
  readonly provider: CalendarProvider;
  listEvents(accessToken: string, range: CalendarRange): Promise<CalendarEvent[]>;
}

export function buildCalendarRange(date: string, timeZone: string): CalendarRange {
  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) throw new Error("カレンダー取得の日付形式が不正です。");
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const dateCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    dateCheck.getUTCFullYear() !== year
    || dateCheck.getUTCMonth() !== month - 1
    || dateCheck.getUTCDate() !== day
  ) {
    throw new Error("カレンダー取得の日付が不正です。");
  }

  assertTimeZone(timeZone);
  const nextDate = toIsoDate(new Date(Date.UTC(year, month - 1, day + 1)));
  return {
    date,
    timeZone,
    start: `${date}T00:00:00${formatOffset(offsetForWallClock(date, timeZone, 0, 0, 0))}`,
    end: `${nextDate}T00:00:00${formatOffset(offsetForWallClock(nextDate, timeZone, 0, 0, 0))}`,
  };
}

export function localDateTimeToIso(dateTime: string, timeZone: string): string {
  const match = dateTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
  if (!match) return dateTime;
  const [hour, minute, secondWithFraction] = match[2].split(":");
  const [second, fraction = ""] = secondWithFraction.split(".");
  const offset = offsetForWallClock(match[1], timeZone, Number(hour), Number(minute), Number(second));
  const normalizedFraction = fraction ? fraction.slice(0, 3).padEnd(3, "0") : "";
  return `${match[1]}T${hour}:${minute}:${second}${normalizedFraction ? `.${normalizedFraction}` : ""}${formatOffset(offset)}`;
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new Error(`対応していないタイムゾーンです: ${timeZone}`);
  }
}

function offsetForWallClock(date: string, timeZone: string, hour: number, minute: number, second: number): number {
  const [year, month, day] = date.split("-").map(Number);
  let candidate = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = getOffsetMinutes(new Date(candidate), timeZone);
    const adjusted = Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000;
    if (adjusted === candidate) return offset;
    candidate = adjusted;
  }
  return getOffsetMinutes(new Date(candidate), timeZone);
}

function getOffsetMinutes(date: Date, timeZone: string): number {
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT";
  if (timeZoneName === "GMT") return 0;
  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) throw new Error(`タイムゾーンのoffsetを解釈できません: ${timeZoneName}`);
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return (match[1] === "-" ? -1 : 1) * minutes;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
