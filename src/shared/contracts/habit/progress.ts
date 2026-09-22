/**
 * Habitの最小実験の契約（#454後半 / O単位）。
 *
 * 正本は `docs/issue-design-plan-2026-09-20.md` の「Habitの最小実験」。
 * 手動記録だけを扱い、**日付ごとのTaskを自動生成しない**。
 * 連続日数・達成率・失敗を強調する表示はここでも持たない。
 */

export type HabitScheduleKind = "daily" | "weekly";

export interface HabitSchedule {
  kind: HabitScheduleKind;
  /** 「週N回」のN。dailyではnull。 */
  weeklyTarget: number | null;
}

export interface HabitEntryRef {
  id: string;
  performed_on: string;
  sequence?: number | null;
}

export interface HabitProgress {
  /** 今日の記録数。 */
  todayCount: number;
  /** 今週の記録数。 */
  weekCount: number;
  /** 今週の目標回数。dailyは7。 */
  weekTarget: number;
  /** 主表示。「今日1回」または「今週2/3回」。 */
  todayLabel: string;
  weekLabel: string;
  met: boolean;
  weekStart: string;
  weekEnd: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function assertDate(value: string, label: string): string {
  if (!DATE_PATTERN.test(value)) throw new Error(`${label}はYYYY-MM-DDで指定してください。`);
  return value;
}

/** 日付だけをUTC正午で扱い、夏時間や時差の影響を受けないようにする。 */
function toDate(value: string): Date {
  assertDate(value, "日付");
  return new Date(`${value}T12:00:00.000Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = toDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

/**
 * 週の区切り。**利用者のローカル日付で月曜開始**にする（仕様として明示する）。
 * 呼び出し側は利用者のタイムゾーンで求めた「今日」を渡す。
 */
export function weekRangeOf(value: string): { start: string; end: string } {
  const date = toDate(value);
  // getUTCDay: 日曜0 … 土曜6。月曜を週の先頭にする。
  const offset = (date.getUTCDay() + 6) % 7;
  const start = addDays(value, -offset);
  return { start, end: addDays(start, 6) };
}

/**
 * 実施記録のID。同じHabit・同じ日・同じ順番では同じIDになる。
 *
 * 連打と通信再送はこれで同じ記録へ畳まれ、意図した2回目は
 * `nextEntrySequence` が返す次の番号で**別の記録**になる。
 * 実施日を後から直しても、記録は作り直さないのでIDは変えない。
 *
 * ハッシュではなく組み立てで一意にする（rendererでも同じ値を計算でき、
 * Node固有のAPIへ依存しない）。
 */
export function habitEntryId(habitId: string, performedOn: string, sequence: number): string {
  const id = habitId.trim();
  if (!id || id.length > 120) throw new Error("HabitのIDは1〜120文字で指定してください。");
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 50)
    throw new Error("実施記録の順番は1〜50で指定してください。");
  return `habit-entry:${id}:${assertDate(performedOn, "実施日")}:${sequence}`;
}

/** その日の次の順番。既存の最大+1を返す。 */
export function nextEntrySequence(entries: readonly HabitEntryRef[], performedOn: string): number {
  const sequences = entries
    .filter((entry) => entry.performed_on === performedOn)
    .map((entry) => (Number.isInteger(entry.sequence) ? Number(entry.sequence) : 0));
  return Math.max(0, ...sequences) + 1;
}

/**
 * 「今日1回」「今週2/3回」を導出する。**連続日数や達成率は出さない。**
 * 一時停止中のHabitは記録対象から外すが、過去の記録は書き換えない。
 */
export function habitProgress(input: {
  schedule: HabitSchedule;
  entries: readonly HabitEntryRef[];
  /** 利用者のタイムゾーンで求めた今日（YYYY-MM-DD）。 */
  today: string;
}): HabitProgress {
  const { start, end } = weekRangeOf(input.today);
  const todayCount = input.entries.filter((entry) => entry.performed_on === input.today).length;
  const weekCount = input.entries.filter(
    (entry) => entry.performed_on >= start && entry.performed_on <= end,
  ).length;
  const weekTarget = input.schedule.kind === "weekly" ? (input.schedule.weeklyTarget ?? 1) : 7;
  return {
    todayCount,
    weekCount,
    weekTarget,
    todayLabel: `今日${todayCount}回`,
    weekLabel: `今週${weekCount}/${weekTarget}回`,
    met: weekCount >= weekTarget,
    weekStart: start,
    weekEnd: end,
  };
}

/**
 * 一時停止と再開。**過去の実績は書き換えない。**
 * `paused_at` は最後に停止した時刻、`resumed_at` は最後に再開した時刻。
 */
export function habitStateAfter(input: { state: string; action: "pause" | "resume"; at: string }): {
  state: "active" | "paused";
  paused_at: string | null;
  resumed_at: string | null;
} {
  if (input.action === "pause") {
    return { state: "paused", paused_at: input.at, resumed_at: null };
  }
  return { state: "active", paused_at: null, resumed_at: input.at };
}

/** 表示用の短い見出し。目標種別を言葉で示す（色だけで判定させない）。 */
export function habitScheduleLabel(schedule: HabitSchedule): string {
  return schedule.kind === "weekly" ? `週${schedule.weeklyTarget ?? 1}回` : "毎日1回";
}
