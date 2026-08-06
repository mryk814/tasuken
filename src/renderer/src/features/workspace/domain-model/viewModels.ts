import type { ExecutionWindowUrgency } from "./scheduleSemantics";
import type { CaptureEntry, PlanNode, Schedule, Task, Waiting } from "./types";

export type TodayEntry =
  | { type: "task"; task: Task; schedule?: Schedule }
  | { type: "waiting"; waiting: Waiting; schedule?: Schedule }
  | { type: "milestone"; planNode: PlanNode; schedule?: Schedule }
  | { type: "capture"; captureEntry: CaptureEntry };

export interface TodoView {
  tasks: Array<{ task: Task; schedule?: Schedule }>;
}

export interface InboxView {
  entries: CaptureEntry[];
}

export interface MicroMemoView {
  entries: CaptureEntry[];
}

export interface WaitingView {
  waitings: Array<{ waiting: Waiting; schedule?: Schedule }>;
}

/**
 * 継続中のTask（#309 ongoing_period）と、意味未設定の既存範囲Task。
 * 一回の完了で閉じないので、今日の実施記録と全体完了を別の操作として扱う。
 */
export interface OngoingPeriodTaskRow {
  task: Task;
  schedule: Schedule;
  dayIndex: number;
  totalDays: number;
  daysRemaining: number;
  /** 意味未設定の既存範囲。分類を促すために区別する。 */
  unspecified: boolean;
  /** 終了予定日を過ぎたまま完了していない。完了 / 延長 / 継続を確認する。 */
  pastEnd: boolean;
}

/** 期間内に一度やるTask（#309 execution_window）。 */
export interface ExecutionWindowTaskRow {
  task: Task;
  schedule: Schedule & { start_date: string; end_date: string };
  urgency: ExecutionWindowUrgency;
  /** 終了日まであと何日か。終了日当日は0、超過は負。 */
  daysRemaining: number;
}

export interface TimelineRow {
  planNode: PlanNode;
  schedule?: Schedule;
  children: TimelineRow[];
}

export interface TimelineView {
  rows: TimelineRow[];
}
