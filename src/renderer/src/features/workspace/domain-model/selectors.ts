import {
  daysUntil,
  executionWindowUrgency,
  getScheduleKind,
  inclusiveDays,
  isOngoingPeriodPastEnd,
  todayIso,
} from "./scheduleSemantics";
import type { CaptureEntry, PlanNode, Schedule, Task, WorkspaceDomain } from "./types";
import { selectTodayTasks, TODAY_TASK_POLICY } from "../../../../../shared/todayTasks.mjs";
import type { ExecutionWindowTaskRow, InboxView, MicroMemoView, OngoingPeriodTaskRow, TimelineRow, TimelineView, TodayEntry, TodoView, WaitingView } from "./viewModels";

// 日付境界はローカル日付で揃える（UTC変換で前日へずれるため toISOString は使わない）。
const todayString = todayIso;

function scheduleKey(ownerType: Schedule["owner_type"], ownerId: string): string {
  return `${ownerType}:${ownerId}`;
}

function schedulesByOwner(domain: WorkspaceDomain): Map<string, Schedule> {
  return new Map(domain.schedules.map((schedule) => [scheduleKey(schedule.owner_type, schedule.owner_id), schedule]));
}

function dateValue(schedule?: Schedule): string {
  return String(schedule?.end_date || schedule?.start_date || "9999-12-31");
}

function isActiveTask(state: string): boolean {
  return !["done", "cancelled"].includes(state);
}

/**
 * 「今日やること」へ出すか（#95 / #309）。
 * 範囲に入っただけでは出さず、範囲の意味ごとに出し方を分ける。
 * - 継続中Taskは専用セクションが受け持つので、ここには出さない
 * - 期間内に一度やるTaskは終了日当日だけ、見逃さないようここへ出す
 */
function scheduleHasExplicitDate(schedule: Schedule | undefined, date: string): boolean {
  if (!schedule) return false;
  if (getScheduleKind(schedule) === "ongoing_period") return false;
  if (schedule.start_date === date && schedule.end_date && schedule.end_date > date) return false;
  return schedule.start_date === date || schedule.end_date === date;
}

/**
 * 「継続中」として扱う範囲（#309）。
 * ongoing と、意味が未設定の既存範囲だけを対象にする。`期間内に一度`は
 * 期間中ずっと継続しているわけではないので、ここには入れない。
 */
function isContinuingRange(schedule: Schedule | undefined, date: string): schedule is Schedule & { start_date: string; end_date: string } {
  const kind = getScheduleKind(schedule);
  if (kind !== "ongoing_period" && kind !== "unspecified_range") return false;
  // 未分類の既存範囲は #95 の規則（終了日当日は今日やることへ出す）を維持する。
  const openEnd = kind === "unspecified_range" ? date < String(schedule?.end_date) : date <= String(schedule?.end_date);
  return String(schedule?.start_date) <= date && openEnd;
}

function compareScheduledRows<T extends { schedule?: Schedule }>(a: T, b: T): number {
  return dateValue(a.schedule).localeCompare(dateValue(b.schedule));
}

function todayEntryDate(entry: TodayEntry): string {
  switch (entry.type) {
    case "capture":
      return entry.captureEntry.captured_at;
    case "task":
    case "waiting":
    case "milestone":
      return dateValue(entry.schedule);
  }
}

export function captureSortKey(entry: CaptureEntry & { created_at?: string; updated_at?: string }): string {
  return String(entry.captured_at || entry.updated_at || entry.created_at || "");
}

export function compareCapturesNewestFirst(
  a: CaptureEntry & { created_at?: string; updated_at?: string },
  b: CaptureEntry & { created_at?: string; updated_at?: string },
): number {
  return captureSortKey(b).localeCompare(captureSortKey(a)) || b.id.localeCompare(a.id);
}

export function buildTodoView(domain: WorkspaceDomain): TodoView {
  const schedules = schedulesByOwner(domain);
  return {
    tasks: domain.tasks
      .map((task) => ({ task, schedule: schedules.get(scheduleKey("task", task.id)) }))
      .sort(compareScheduledRows),
  };
}

export function buildInboxView(domain: WorkspaceDomain): InboxView {
  return {
    entries: domain.capture_entries
      .filter((entry) => entry.state === "untriaged" && entry.kind !== "micro_memo")
      .sort(compareCapturesNewestFirst),
  };
}

export function buildMicroMemoView(domain: WorkspaceDomain): MicroMemoView {
  return {
    entries: domain.capture_entries
      .filter((entry) => entry.kind === "micro_memo" && entry.state !== "archived")
      .sort(compareCapturesNewestFirst),
  };
}

/**
 * 上部バーのTodayパネル用（#299）。今日の予定を持つTaskを、完了済みも含めて返す。
 * パネルを開いたまま完了を取り消せるよう、完了で行を消さないのが目的。
 */
export function buildTodayTaskShortlist(domain: WorkspaceDomain, date = todayString()): Task[] {
  const schedules = schedulesByOwner(domain);
  return domain.tasks
    .filter((task) => task.state !== "cancelled" && scheduleHasExplicitDate(schedules.get(scheduleKey("task", task.id)), date));
}

export function buildWaitingView(domain: WorkspaceDomain): WaitingView {
  const schedules = schedulesByOwner(domain);
  return {
    waitings: domain.waitings
      .filter((waiting) => waiting.state === "waiting")
      .map((waiting) => ({ waiting, schedule: schedules.get(scheduleKey("waiting", waiting.id)) }))
      .sort(compareScheduledRows),
  };
}

export function buildTodayView(domain: WorkspaceDomain, date = todayString()): TodayEntry[] {
  const schedules = schedulesByOwner(domain);
  const entries: TodayEntry[] = [];

  const taskRows = selectTodayTasks(domain.tasks, domain.schedules, date, TODAY_TASK_POLICY) as Array<{ task: Task; schedule?: Schedule }>;
  for (const row of taskRows) {
    entries.push({ type: "task", task: row.task, schedule: row.schedule });
  }

  for (const waiting of domain.waitings) {
    const schedule = schedules.get(scheduleKey("waiting", waiting.id));
    if (waiting.state === "waiting" && scheduleHasExplicitDate(schedule, date)) entries.push({ type: "waiting", waiting, schedule });
  }

  for (const planNode of domain.plan_nodes) {
    const schedule = schedules.get(scheduleKey("plan_node", planNode.id));
    if (planNode.type === "milestone" && planNode.state !== "done" && scheduleHasExplicitDate(schedule, date)) {
      entries.push({ type: "milestone", planNode, schedule });
    }
  }

  return entries.sort((a, b) => todayEntryDate(a).localeCompare(todayEntryDate(b)));
}

/**
 * 継続中Task（#309）。終了予定日を過ぎたものも、完了 / 延長 / 継続を選べるよう残す。
 * 一回の完了で閉じるTaskはここに出さない（buildExecutionWindowTaskView が受け持つ）。
 */
export function buildOngoingPeriodTaskView(domain: WorkspaceDomain, date = todayString()): OngoingPeriodTaskRow[] {
  const schedules = schedulesByOwner(domain);
  return domain.tasks
    .map((task) => ({ task, schedule: schedules.get(scheduleKey("task", task.id)) }))
    .filter((row): row is { task: typeof row.task; schedule: Schedule & { start_date: string; end_date: string } } => (
      isActiveTask(row.task.state) && (isContinuingRange(row.schedule, date) || isOngoingPeriodPastEnd(row.schedule, date))
    ))
    .map(({ task, schedule }) => ({
      task,
      schedule,
      dayIndex: inclusiveDays(schedule.start_date, date),
      totalDays: inclusiveDays(schedule.start_date, schedule.end_date),
      daysRemaining: Math.max(0, daysUntil(date, schedule.end_date)),
      unspecified: getScheduleKind(schedule) === "unspecified_range",
      pastEnd: isOngoingPeriodPastEnd(schedule, date),
    }))
    .sort((a, b) => Number(b.pastEnd) - Number(a.pastEnd)
      || a.schedule.end_date.localeCompare(b.schedule.end_date)
      || a.task.title.localeCompare(b.task.title, "ja"));
}

/**
 * 期間内に一度やるTask（#309）。
 * 期間に入っただけでは「今日必ずやること」にせず、この候補セクションから拾う。
 * 終了日が近いものほど前に出し、超過は最優先で見せる。
 */
export function buildExecutionWindowTaskView(domain: WorkspaceDomain, date = todayString()): ExecutionWindowTaskRow[] {
  const schedules = schedulesByOwner(domain);
  return domain.tasks
    .map((task) => ({ task, schedule: schedules.get(scheduleKey("task", task.id)) }))
    .filter((row): row is { task: typeof row.task; schedule: Schedule & { start_date: string; end_date: string } } => (
      isActiveTask(row.task.state)
      && getScheduleKind(row.schedule) === "execution_window"
      // 開始日前はTodayへ出さない。超過は見逃さないよう残す。
      && String(row.schedule?.start_date) <= date
    ))
    .map(({ task, schedule }) => ({
      task,
      schedule,
      urgency: executionWindowUrgency(schedule, date),
      daysRemaining: daysUntil(date, schedule.end_date),
    }))
    .sort((a, b) => a.daysRemaining - b.daysRemaining || a.task.title.localeCompare(b.task.title, "ja"));
}

function comparePlanNodes(schedules: Map<string, Schedule>, a: PlanNode, b: PlanNode): number {
  const order = a.sort_order - b.sort_order;
  if (order !== 0) return order;
  return dateValue(schedules.get(scheduleKey("plan_node", a.id)))
    .localeCompare(dateValue(schedules.get(scheduleKey("plan_node", b.id))));
}

export function buildTimelineView(domain: WorkspaceDomain): TimelineView {
  const schedules = schedulesByOwner(domain);
  const childrenByParent = new Map<string, PlanNode[]>();
  const roots: PlanNode[] = [];

  for (const planNode of domain.plan_nodes) {
    if (planNode.parent_plan_node_id) {
      const children = childrenByParent.get(planNode.parent_plan_node_id) || [];
      children.push(planNode);
      childrenByParent.set(planNode.parent_plan_node_id, children);
    } else {
      roots.push(planNode);
    }
  }

  const buildRow = (planNode: PlanNode): TimelineRow => {
    const children = childrenByParent.get(planNode.id) || [];
    children.sort((a, b) => comparePlanNodes(schedules, a, b));
    return {
      planNode,
      schedule: schedules.get(scheduleKey("plan_node", planNode.id)),
      children: children.map(buildRow),
    };
  };

  roots.sort((a, b) => comparePlanNodes(schedules, a, b));
  return { rows: roots.map(buildRow) };
}
