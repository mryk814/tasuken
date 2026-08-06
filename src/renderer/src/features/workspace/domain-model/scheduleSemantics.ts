import { localDateIso } from "../lib/format";
import type { Schedule, ScheduleRangeSemantics } from "./types";

/**
 * 日付範囲の意味を判定する唯一の場所（#309）。
 *
 * `start_date` / `end_date` の値だけから意味を推定しない。範囲は少なくとも二つの
 * 別物を含むため、画面ごとに独自解釈すると同じデータがToday・Timeline・完了操作で
 * 食い違う。判定はここに集約し、各画面はここが返す種別だけを見る。
 *
 * - point          … 単日。従来どおりの一回Task
 * - deadline       … 終了日だけを持つ。期限
 * - execution_window … 期間内のどこかで一度やる。一回の完了でTask全体が終わる
 * - ongoing_period … 期間中ずっと継続する。日々の実施と全体の完了を分ける
 * - unspecified_range … 意味未設定の既存範囲。#95の表示規則をそのまま維持する
 * - none           … 日付なし
 */
export type ScheduleKind =
  | "none"
  | "point"
  | "deadline"
  | "execution_window"
  | "ongoing_period"
  | "unspecified_range";

/** 期限までの切迫度。期間開始直後から毎日同じ強さで督促しないために使う。 */
export type ExecutionWindowUrgency = "before_start" | "in_window" | "due_soon" | "due_today" | "overdue";

export const DUE_SOON_DAYS = 2;

export function todayIso(): string {
  return localDateIso(new Date());
}

function isRange(schedule: Schedule): schedule is Schedule & { start_date: string; end_date: string } {
  return Boolean(schedule.start_date && schedule.end_date && schedule.end_date > schedule.start_date);
}

export function getScheduleKind(schedule?: Schedule | null): ScheduleKind {
  if (!schedule) return "none";
  const { start_date: start, end_date: end } = schedule;
  if (!start && !end) return "none";
  if (!start && end) return "deadline";
  if (start && (!end || end === start)) return "point";
  if (!isRange(schedule)) return "point";
  if (schedule.range_semantics === "once_within_window") return "execution_window";
  if (schedule.range_semantics === "ongoing") return "ongoing_period";
  return "unspecified_range";
}

/** 新規の日付範囲は「期間内に一度」を既定にする。既存データは黙って分類しない。 */
export const DEFAULT_RANGE_SEMANTICS: ScheduleRangeSemantics = "once_within_window";

/** 着手してよい日か。開始日前のTaskをTodayへ出さないために使う。 */
export function isScheduleAvailableOn(schedule: Schedule | undefined | null, date: string): boolean {
  if (!schedule) return false;
  const kind = getScheduleKind(schedule);
  switch (kind) {
    case "none":
      return false;
    case "deadline":
      return Boolean(schedule.end_date && date <= schedule.end_date);
    case "point":
      return schedule.start_date === date || schedule.end_date === date;
    default:
      return Boolean(schedule.start_date && schedule.start_date <= date);
  }
}

/** 遅くともその日に終える必要があるか。期限超過の判定と対で使う。 */
export function isScheduleDueOn(schedule: Schedule | undefined | null, date: string): boolean {
  if (!schedule) return false;
  const kind = getScheduleKind(schedule);
  if (kind === "none") return false;
  if (kind === "point") return schedule.start_date === date || schedule.end_date === date;
  return schedule.end_date === date;
}

/** その日に期限を過ぎているか。完了していないTaskの督促に使う。 */
export function isScheduleOverdueOn(schedule: Schedule | undefined | null, date: string): boolean {
  if (!schedule?.end_date) return false;
  if (getScheduleKind(schedule) === "none") return false;
  return schedule.end_date < date;
}

/** その日に「継続中」であるか。ongoing だけが真になる。 */
export function isScheduleOngoingOn(schedule: Schedule | undefined | null, date: string): boolean {
  if (!schedule?.start_date || !schedule.end_date) return false;
  if (getScheduleKind(schedule) !== "ongoing_period") return false;
  return schedule.start_date <= date && date <= schedule.end_date;
}

/** その日が実行可能期間の中か。期間内に一度やるTaskの候補表示に使う。 */
export function isExecutionWindowOpenOn(schedule: Schedule | undefined | null, date: string): boolean {
  if (getScheduleKind(schedule) !== "execution_window") return false;
  return Boolean(schedule?.start_date && schedule.start_date <= date && date <= String(schedule.end_date));
}

export function executionWindowUrgency(
  schedule: Schedule & { start_date: string; end_date: string },
  date: string,
): ExecutionWindowUrgency {
  if (date < schedule.start_date) return "before_start";
  if (date > schedule.end_date) return "overdue";
  if (date === schedule.end_date) return "due_today";
  return daysUntil(date, schedule.end_date) <= DUE_SOON_DAYS ? "due_soon" : "in_window";
}

/** from から to までの日数。同日は0。 */
export function daysUntil(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return 0;
  return Math.round((toTime - fromTime) / 86400000);
}

/** 期間の総日数（両端を含む）。 */
export function inclusiveDays(start: string, end: string): number {
  return daysUntil(start, end) + 1;
}

/**
 * 継続期間が終了予定日を過ぎたまま完了していないか。
 * 終了日が来ただけで自動完了はしないので、利用者へ確認を出すための判定。
 */
export function isOngoingPeriodPastEnd(schedule: Schedule | undefined | null, date: string): boolean {
  if (getScheduleKind(schedule) !== "ongoing_period") return false;
  return String(schedule?.end_date) < date;
}
