import type { CalendarErrorCode, CalendarEventsResult } from "../../../../../shared/calendar";

/**
 * Todayのカレンダー欄が示す状態（#273）。
 *
 * 正本は `docs/issue-design-plan-2026-09-20.md` の「Calendarの残作業」にある5状態。
 * **「取得できていない」と「0件」を混同しない**ことを型で固定する。
 *
 * | 状態 | 見せ方 |
 * | --- | --- |
 * | 当日の取得成功で0件 | 「今日の予定はありません」 |
 * | 更新中 | 前回の結果を保持し、更新操作に進行状態を出す |
 * | offlineでキャッシュあり | 既存予定と「最終更新 14:20／更新できません」 |
 * | 接続したが取得成功履歴なし | 「予定を取得できません」（0件とは書かない） |
 * | 認証失効 | 「再接続」でSettingsの連携へ戻す。Taskの一覧は残す |
 */
export type TodayCalendarState =
  "hidden" | "loading" | "error" | "reconnect" | "stale" | "unavailable" | "empty" | "events";

/** 利用者の操作で復帰できる失敗。Settingsの接続からやり直す。 */
export const CALENDAR_RECONNECT_ERROR_CODES: readonly CalendarErrorCode[] = [
  "authentication_required",
  "token_expired",
  "consent_required",
  "not_connected",
];

export function isCalendarReconnectCode(code: CalendarErrorCode | undefined): boolean {
  return code !== undefined && CALENDAR_RECONNECT_ERROR_CODES.includes(code);
}

export function todayCalendarState(input: {
  connected: boolean;
  loading: boolean;
  result: CalendarEventsResult | null;
}): TodayCalendarState {
  // 未接続では予定欄そのものを出さない（入口はSettingsだけ）。
  if (!input.connected) return "hidden";
  const result = input.result;
  if (!result) return "loading";
  // 取得に失敗し、前回の結果も無い。0件とは書かない。
  if (result.error && !result.stale) {
    return isCalendarReconnectCode(result.errorCode) ? "reconnect" : "error";
  }
  // 前回の結果は残っている（更新中もここへ入る）。
  if (result.stale) return "stale";
  if (result.events.length > 0) return "events";
  // 成功した取得の記録が無いまま空。0件と断定しない。
  if (!result.fetchedAt) return "unavailable";
  return "empty";
}

/**
 * 「最終更新 14:20／更新できません」のように、取得できた時刻と今の状態を短く示す。
 *
 * 表示はカレンダー結果の `timeZone` で行う。実行環境のタイムゾーンで整形すると、
 * 同じ取得時刻でも端末ごとに違う時刻を出してしまう（CIはUTC、利用者はJSTなど）。
 */
export function calendarFetchedLabel(input: {
  fetchedAt: string;
  stale: boolean;
  locale?: string;
  timeZone?: string;
}): string {
  if (!input.fetchedAt) return "";
  const at = new Date(input.fetchedAt);
  if (Number.isNaN(at.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  if (input.timeZone) options.timeZone = input.timeZone;
  let time: string;
  try {
    time = at.toLocaleTimeString(input.locale || "ja-JP", options);
  } catch {
    // providerが未知のタイムゾーンを返した場合も、取得時刻の表示自体は落とさない。
    time = at.toLocaleTimeString(input.locale || "ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  return input.stale ? `最終更新 ${time}／更新できません` : `最終更新 ${time}`;
}

/** 状態ごとの見出し文言。画面はここだけを見る。 */
export function calendarStateMessage(state: TodayCalendarState): string {
  switch (state) {
    case "loading":
      return "予定を取得中…";
    case "unavailable":
      return "予定を取得できません";
    case "empty":
      return "今日の予定はありません";
    default:
      return "";
  }
}
