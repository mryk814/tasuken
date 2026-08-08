import { URL } from "node:url";

import type {
  CalendarAdapter,
  CalendarEvent,
  CalendarErrorCode,
  CalendarOccurrenceType,
  CalendarRange,
  CalendarRecurrence,
  CalendarRecurrencePattern,
  CalendarRecurrenceRange,
} from "../../shared/calendar";
import { localDateTimeToIso } from "../../shared/calendar";

export const MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAX_CALENDAR_PAGES = 100;

type FetchLike = typeof fetch;

export class CalendarProviderError extends Error {
  constructor(
    public readonly code: CalendarErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CalendarProviderError";
  }
}

export class MicrosoftCalendarAdapter implements CalendarAdapter {
  readonly provider = "microsoft" as const;

  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly graphBase = MICROSOFT_GRAPH_BASE,
  ) {}

  async listEvents(accessToken: string, range: CalendarRange): Promise<CalendarEvent[]> {
    const headers = this.requestHeaders(accessToken, range.timeZone);
    const calendarName = await this.fetchCalendarName(headers);
    const events: CalendarEvent[] = [];
    let nextUrl = this.buildCalendarViewUrl(range);

    for (let page = 0; nextUrl; page += 1) {
      if (page >= MAX_CALENDAR_PAGES) {
        throw new CalendarProviderError("invalid_response", "カレンダーAPIのページ数が上限を超えました。");
      }
      const response = await this.fetcher(nextUrl, { headers });
      if (!response.ok) throw await providerErrorFromResponse(response, "カレンダー予定の取得に失敗しました。");
      const payload = await readJsonObject(response, "カレンダーAPIの応答形式が不正です。");
      const values = payload.value;
      if (!Array.isArray(values)) {
        throw new CalendarProviderError("invalid_response", "カレンダーAPIの予定一覧が不正です。");
      }
      for (const value of values) {
        events.push(parseGraphEvent(value, calendarName, range.timeZone));
      }

      const candidate = typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : "";
      nextUrl = candidate ? validateNextLink(candidate, this.graphBase) : "";
    }

    return dedupeEvents(events);
  }

  private buildCalendarViewUrl(range: CalendarRange): string {
    const url = new URL(`${this.graphBase}/me/calendarview`);
    url.search = new URLSearchParams({
      startDateTime: range.start,
      endDateTime: range.end,
      $select: "id,subject,start,end,isAllDay,location,onlineMeeting,onlineMeetingUrl,sensitivity,calendar,recurrence,seriesMasterId,type",
      $expand: "calendar($select=name)",
      $orderby: "start/dateTime",
      $top: "1000",
    }).toString();
    return url.toString();
  }

  private async fetchCalendarName(headers: HeadersInit): Promise<string> {
    const url = new URL(`${this.graphBase}/me/calendar`);
    url.search = new URLSearchParams({ $select: "name" }).toString();
    const response = await this.fetcher(url.toString(), { headers });
    if (!response.ok) throw await providerErrorFromResponse(response, "既定カレンダーの取得に失敗しました。");
    const payload = await readJsonObject(response, "既定カレンダーの応答形式が不正です。");
    return text(payload.name);
  }

  private requestHeaders(accessToken: string, timeZone: string): HeadersInit {
    return {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.timezone="${timeZone}"`,
    };
  }
}

export function parseGraphEvent(raw: unknown, defaultCalendarName: string, timeZone: string): CalendarEvent {
  const event = record(raw);
  const start = record(event.start);
  const end = record(event.end);
  const location = record(event.location);
  const onlineMeeting = record(event.onlineMeeting);
  const calendar = record(event.calendar);
  const sensitivity = calendarSensitivity(event.sensitivity);
  const occurrenceType = occurrenceTypeValue(event.type);
  const seriesMasterId = text(event.seriesMasterId) || (occurrenceType === "seriesMaster" ? text(event.id) : "") || null;
  const recurrence = parseRecurrence(event.recurrence, seriesMasterId);
  const restricted = sensitivity === "private" || sensitivity === "confidential";

  return {
    id: text(event.id),
    title: restricted ? "非公開の予定" : text(event.subject),
    startTime: localDateTimeToIso(text(start.dateTime), timeZone),
    endTime: localDateTimeToIso(text(end.dateTime), timeZone),
    startTimeZone: text(start.timeZone) || timeZone,
    endTimeZone: text(end.timeZone) || timeZone,
    isAllDay: event.isAllDay === true,
    location: restricted ? "" : text(location.displayName),
    meetingUrl: restricted ? "" : safeMeetingUrl(text(onlineMeeting.joinUrl) || text(event.onlineMeetingUrl)),
    calendarName: text(calendar.name) || defaultCalendarName,
    sensitivity,
    seriesMasterId,
    occurrenceType,
    recurrence,
  };
}

export function calendarErrorMessage(code: CalendarErrorCode): string {
  switch (code) {
    case "not_configured":
      return "Microsoft連携が未設定です。TASKEN_MICROSOFT_CLIENT_IDにアプリケーションIDを設定してください。";
    case "not_connected":
      return "カレンダーが接続されていません。Settingsから接続してください。";
    case "storage_unavailable":
      return "この端末では資格情報を安全に保存できません。OSの資格情報保護を有効にしてください。";
    case "consent_required":
      return "Microsoftのカレンダー権限への同意が必要です。ブラウザで再接続してください。";
    case "admin_approval_required":
      return "組織の管理者承認が必要です。Microsoft 365管理者にCalendars.ReadBasicの承認を依頼してください。個人Microsoftアカウントでの接続も試せます。";
    case "conditional_access":
      return "組織のConditional Access、MFA、または端末ポリシーで接続できません。管理者にポリシーと端末条件を確認してください。個人Microsoftアカウントでの接続も試せます。";
    case "permission_denied":
      return "カレンダー権限が拒否されました。権限を確認してSettingsから再接続してください。";
    case "authentication_required":
      return "Microsoftの認証が必要です。Settingsから再接続してください。";
    case "token_expired":
      return "Microsoftの認証が期限切れです。Settingsから再接続してください。";
    case "rate_limited":
      return "カレンダーAPIの利用制限に達しました。時間をおいて再試行してください。";
    case "offline":
      return "カレンダーAPIへ接続できません。ネットワークを確認して再試行してください。";
    case "provider_unavailable":
      return "Microsoftカレンダーが一時的に利用できません。時間をおいて再試行してください。";
    case "invalid_response":
      return "Microsoftカレンダーの応答を解釈できませんでした。再試行してください。";
    case "unsupported_provider":
      return "このカレンダープロバイダーはまだ対応していません。";
    case "unknown":
    default:
      return "カレンダーの取得に失敗しました。Settingsから再接続するか、時間をおいて再試行してください。";
  }
}

export function classifyCalendarProviderError(status: number, body: string, fallback: CalendarErrorCode = "unknown"): CalendarProviderError {
  const normalized = body.toLowerCase();
  if (hasAny(normalized, ["conditional access", "aadsts53000", "aadsts53001", "aadsts53003", "device policy", "multifactor"])) {
    return new CalendarProviderError("conditional_access", calendarErrorMessage("conditional_access"), status);
  }
  if (hasAny(normalized, ["admin consent", "admin approval", "aadsts65001", "aadsts90094", "authorization_requestdenied"])) {
    return new CalendarProviderError("admin_approval_required", calendarErrorMessage("admin_approval_required"), status);
  }
  if (hasAny(normalized, ["consent_required", "consent required", "consent" ])) {
    return new CalendarProviderError("consent_required", calendarErrorMessage("consent_required"), status);
  }
  if (status === 401 || hasAny(normalized, ["invalid_grant", "login_required", "interaction_required"])) {
    return new CalendarProviderError("authentication_required", calendarErrorMessage("authentication_required"), status);
  }
  if (status === 403) {
    return new CalendarProviderError("permission_denied", calendarErrorMessage("permission_denied"), status);
  }
  if (status === 429) {
    return new CalendarProviderError("rate_limited", calendarErrorMessage("rate_limited"), status);
  }
  if (status >= 500) {
    return new CalendarProviderError("provider_unavailable", calendarErrorMessage("provider_unavailable"), status);
  }
  return new CalendarProviderError(fallback, calendarErrorMessage(fallback), status);
}

async function providerErrorFromResponse(response: Response, fallbackMessage: string): Promise<CalendarProviderError> {
  const body = await response.text().catch(() => "");
  const error = classifyCalendarProviderError(response.status, body);
  if (error.code === "unknown") return new CalendarProviderError("unknown", fallbackMessage, response.status);
  return error;
}

async function readJsonObject(response: Response, message: string): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json() as unknown;
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("object");
    }
    return payload as Record<string, unknown>;
  } catch {
    throw new CalendarProviderError("invalid_response", message);
  }
}

function validateNextLink(value: string, graphBase: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(graphBase).origin) throw new Error("origin");
    return url.toString();
  } catch {
    throw new CalendarProviderError("invalid_response", "カレンダーAPIのページリンクが不正です。");
  }
}

function parseRecurrence(raw: unknown, seriesMasterId: string | null): CalendarRecurrence | null {
  const recurrence = record(raw);
  if (!seriesMasterId && Object.keys(recurrence).length === 0) return null;
  return {
    seriesMasterId: seriesMasterId || "",
    pattern: parsePattern(recurrence.pattern),
    range: parseRange(recurrence.range),
  };
}

function parsePattern(raw: unknown): CalendarRecurrencePattern | null {
  const value = record(raw);
  if (Object.keys(value).length === 0) return null;
  return {
    type: text(value.type),
    interval: numberValue(value.interval),
    daysOfWeek: stringArray(value.daysOfWeek),
    dayOfMonth: numberValue(value.dayOfMonth),
    month: numberValue(value.month),
    index: text(value.index),
  };
}

function parseRange(raw: unknown): CalendarRecurrenceRange | null {
  const value = record(raw);
  if (Object.keys(value).length === 0) return null;
  return {
    type: text(value.type),
    startDate: text(value.startDate),
    endDate: text(value.endDate),
    numberOfOccurrences: numberValue(value.numberOfOccurrences),
  };
}

function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = event.id || `${event.startTime}|${event.endTime}|${event.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeMeetingUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function occurrenceTypeValue(value: unknown): CalendarOccurrenceType {
  if (value === "singleInstance" || value === "occurrence" || value === "exception" || value === "seriesMaster") return value;
  return "unknown";
}

function calendarSensitivity(value: unknown): CalendarEvent["sensitivity"] {
  if (value === "personal" || value === "private" || value === "confidential") return value;
  return "normal";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === "string");
  return values.length > 0 ? values : undefined;
}

function hasAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}
