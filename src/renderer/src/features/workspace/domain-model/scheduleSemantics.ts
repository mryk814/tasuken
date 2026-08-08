import { localDateIso } from "../lib/format";
import type { Schedule, ScheduleRangeSemantics } from "./types";
import {
  daysUntil,
  getScheduleKind,
  inclusiveDays,
  isExecutionWindowOpenOn,
  isOngoingPeriodPastEnd,
  isScheduleAvailableOn,
  isScheduleDueOn,
  isScheduleOngoingOn,
  isScheduleOverdueOn,
} from "../../../../../shared/scheduleSemantics.mjs";

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

export { getScheduleKind, isScheduleAvailableOn, isScheduleDueOn, isScheduleOverdueOn, isScheduleOngoingOn, isExecutionWindowOpenOn, isOngoingPeriodPastEnd, daysUntil, inclusiveDays };

/** 新規の日付範囲は「期間内に一度」を既定にする。既存データは黙って分類しない。 */
export const DEFAULT_RANGE_SEMANTICS: ScheduleRangeSemantics = "once_within_window";

/** 着手してよい日か。開始日前のTaskをTodayへ出さないために使う。 */

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
