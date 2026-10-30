import { scheduledDate } from "./todoRows.js";
import { addDays } from "./format";
import {
  CAPTURE_ENTRY_STATE_LABELS,
  PLAN_NODE_STATE_LABELS,
  PLAN_NODE_TYPE_LABELS,
  TASK_STATE_LABELS,
  WAITING_STATE_LABELS,
} from "../domain-model/labels";
import {
  buildExecutionWindowTaskView,
  buildOngoingPeriodTaskView,
  buildTodayView,
  todayTaskProgress,
} from "../domain-model/selectors";
import type {
  CaptureEntry,
  PlanNode,
  Schedule,
  Task,
  Waiting,
  WorkspaceDomain,
} from "../domain-model/types";
import type {
  ExecutionWindowTaskRow,
  OngoingPeriodTaskRow,
  TodayEntry,
} from "../domain-model/viewModels";

export interface DailyPlanningRow {
  task: Task;
  schedule?: Schedule;
}

export interface DailyPlanningCandidates {
  overdue: DailyPlanningRow[];
  thisWeek: DailyPlanningRow[];
  someday: DailyPlanningRow[];
}

function isOpenTask(task: Task): boolean {
  return task.state !== "done" && task.state !== "cancelled";
}

function byDateThenTitle(a: DailyPlanningRow, b: DailyPlanningRow): number {
  return String(scheduledDate(a.schedule) || "9999-12-31").localeCompare(String(scheduledDate(b.schedule) || "9999-12-31"))
    || a.task.title.localeCompare(b.task.title, "ja");
}
function touchesToday(schedule: Schedule | undefined, today: string): boolean {
  if (!schedule) return false;
  const start = schedule.start_date || schedule.end_date || "";
  const end = schedule.end_date || schedule.start_date || "";
  return Boolean(start && end && start <= today && today <= end);
}

function isOngoingPeriodThisWeek(schedule: Schedule | undefined, today: string, weekEnd: string): boolean {
  if (!schedule?.start_date || !schedule.end_date) return false;
  return schedule.start_date < today && today < schedule.end_date && schedule.end_date <= weekEnd;
}

export function buildDailyPlanningCandidates(rows: DailyPlanningRow[], today: string): DailyPlanningCandidates {
  const openRows = rows.filter((row) => isOpenTask(row.task) && row.task.today_date !== today);
  const weekEnd = addDays(today, 7);
  return {
    overdue: openRows
      .filter((row) => {
        const date = scheduledDate(row.schedule);
        return Boolean(date && date < today);
      })
      .sort(byDateThenTitle),
    thisWeek: openRows
      .filter((row) => {
        const date = scheduledDate(row.schedule);
        return Boolean(date && date > today && date <= weekEnd && (!touchesToday(row.schedule, today) || isOngoingPeriodThisWeek(row.schedule, today, weekEnd)));
      })
      .sort(byDateThenTitle),
    someday: openRows
      .filter((row) => !scheduledDate(row.schedule))
      .sort((a, b) => Number(b.task.priority === "high") - Number(a.task.priority === "high") || a.task.title.localeCompare(b.task.title, "ja")),
  };
}

export type TodayDomainRow =
  | { type: "task"; task: Task; schedule?: Schedule }
  | { type: "waiting"; waiting: Waiting; schedule?: Schedule }
  | { type: "milestone"; planNode: PlanNode; schedule?: Schedule }
  | { type: "capture"; captureEntry: CaptureEntry };

export type TodayRow = {
  id: string;
  title: string;
  projectId?: string | null;
  date?: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  priority?: "normal" | "high";
  waitingFor?: string | null;
  v2?: TodayDomainRow;
};

function scheduleDate(schedule?: Schedule): string {
  return String(schedule?.end_date || schedule?.start_date || "");
}

function scheduleTouchesRange(schedule: Schedule | undefined, start: string, end: string): boolean {
  const date = scheduleDate(schedule);
  return Boolean(date && date >= start && date <= end);
}

function isActivePlanNode(planNode: PlanNode): boolean {
  return planNode.state !== "done" && planNode.state !== "cancelled";
}

function schedulesByOwner(domain: WorkspaceDomain): Map<string, Schedule> {
  return new Map(
    domain.schedules.map((schedule) => [`${schedule.owner_type}:${schedule.owner_id}`, schedule]),
  );
}

function rowDate(row: TodayRow): string {
  return String(row.date || "9999-12-31");
}

function compareRows(a: TodayRow, b: TodayRow): number {
  return rowDate(a).localeCompare(rowDate(b)) || a.title.localeCompare(b.title, "ja");
}

function taskToRow(task: Task, schedule: Schedule | undefined): TodayRow {
  return {
    id: task.id,
    title: task.title,
    projectId: task.project_id,
    date: scheduleDate(schedule),
    kindLabel: "タスク",
    status: task.state,
    statusLabel: TASK_STATE_LABELS[task.state],
    priority: task.priority,
    v2: { type: "task", task, schedule },
  };
}

function waitingToRow(waiting: Waiting, schedule: Schedule | undefined): TodayRow {
  return {
    id: waiting.id,
    title: waiting.title,
    projectId: waiting.project_id,
    date: scheduleDate(schedule),
    kindLabel: "待ち",
    status: waiting.state,
    statusLabel: WAITING_STATE_LABELS[waiting.state],
    waitingFor: waiting.waiting_for,
    v2: { type: "waiting", waiting, schedule },
  };
}

function planNodeToRow(planNode: PlanNode, schedule: Schedule | undefined): TodayRow {
  return {
    id: planNode.id,
    title: planNode.title,
    projectId: planNode.project_id,
    date: scheduleDate(schedule),
    kindLabel: PLAN_NODE_TYPE_LABELS[planNode.type],
    status: planNode.state,
    statusLabel:
      planNode.type === "milestone" ? "マイルストーン" : PLAN_NODE_STATE_LABELS[planNode.state],
    v2: { type: "milestone", planNode, schedule },
  };
}

function captureToRow(captureEntry: CaptureEntry): TodayRow {
  return {
    id: captureEntry.id,
    title: captureEntry.title || captureEntry.text,
    date: captureEntry.captured_at,
    kindLabel: "Capture",
    status: captureEntry.state,
    statusLabel: CAPTURE_ENTRY_STATE_LABELS[captureEntry.state],
    v2: { type: "capture", captureEntry },
  };
}

function todayEntryToRow(entry: TodayEntry): TodayRow {
  if (entry.type === "task") return taskToRow(entry.task, entry.schedule);
  if (entry.type === "waiting") return waitingToRow(entry.waiting, entry.schedule);
  if (entry.type === "milestone") return planNodeToRow(entry.planNode, entry.schedule);
  return captureToRow(entry.captureEntry);
}

function compareWaitingRows(a: TodayRow, b: TodayRow, today: string): number {
  const aDate = a.date || "";
  const bDate = b.date || "";
  const aOverdue = aDate && aDate < today ? 0 : 1;
  const bOverdue = bDate && bDate < today ? 0 : 1;
  if (aOverdue !== bOverdue) return aOverdue - bOverdue;
  const aHasDate = aDate ? 0 : 1;
  const bHasDate = bDate ? 0 : 1;
  if (aHasDate !== bHasDate) return aHasDate - bHasDate;
  return aDate.localeCompare(bDate) || a.title.localeCompare(b.title, "ja");
}

export interface TodayPageProjection {
  todayRows: TodayRow[];
  periodRows: OngoingPeriodTaskRow[];
  executionWindowRows: ExecutionWindowTaskRow[];
  dailyCandidates: DailyPlanningCandidates;
  overdue: TodayRow[];
  milestones: TodayRow[];
  openWaitings: TodayRow[];
  overdueWaitingCount: number;
  progress: { done: number; total: number };
}

/**
 * Today画面が表示する一覧をまとめて作る（#684）。
 * Domainと日付だけに依存させ、入力欄やdrawerなどのローカルstateでは作り直さない。
 */
export function buildTodayPageProjection(
  domain: WorkspaceDomain,
  today: string,
): TodayPageProjection {
  const soon = addDays(today, 14);
  const schedules = schedulesByOwner(domain);
  // 今日やることは人が手を動かす面。AI作業中のTaskはFeed側で追う。
  // 予定終了が当日のTaskはここに残す（#454の「期限の確認」撤去後、受け皿はここだけ）。
  // 過去日の締切はbuildTodayViewの対象外で、候補棚「期限切れ」に集約する。
  const todayRows = buildTodayView(domain, today)
    .map((entry) => todayEntryToRow(entry))
    .filter((row) => {
      if (row.v2?.type !== "task") return true;
      const task = row.v2.task;
      return !(task.intended_executor === "ai_agent" && task.work_state === "in_progress");
    });
  const dailyTaskRows: DailyPlanningRow[] = domain.tasks.map((task) => ({
    task,
    schedule: schedules.get(`task:${task.id}`),
  }));
  const taskRows = domain.tasks.map((task) => taskToRow(task, schedules.get(`task:${task.id}`)));
  const waitingRows = domain.waitings.map((waiting) =>
    waitingToRow(waiting, schedules.get(`waiting:${waiting.id}`)),
  );
  const planNodeRows = domain.plan_nodes.map((planNode) =>
    planNodeToRow(planNode, schedules.get(`plan_node:${planNode.id}`)),
  );
  const overdue = [
    ...taskRows.filter(
      (row) => row.status !== "done" && row.status !== "cancelled" && row.date && row.date < today,
    ),
    ...waitingRows.filter((row) => row.status === "waiting" && row.date && row.date < today),
    ...planNodeRows.filter(
      (row) => row.status !== "done" && row.status !== "cancelled" && row.date && row.date < today,
    ),
  ].sort(compareRows);
  const milestones = domain.plan_nodes
    .filter(
      (planNode) =>
        planNode.type === "milestone" &&
        isActivePlanNode(planNode) &&
        scheduleTouchesRange(schedules.get(`plan_node:${planNode.id}`), today, soon),
    )
    .map((planNode) => planNodeToRow(planNode, schedules.get(`plan_node:${planNode.id}`)))
    .sort(compareRows);
  const openWaitings = waitingRows
    .filter((row) => row.status === "waiting")
    .sort((a, b) => compareWaitingRows(a, b, today));

  return {
    todayRows,
    periodRows: buildOngoingPeriodTaskView(domain, today),
    executionWindowRows: buildExecutionWindowTaskView(domain, today),
    dailyCandidates: buildDailyPlanningCandidates(dailyTaskRows, today),
    overdue,
    milestones,
    openWaitings,
    overdueWaitingCount: openWaitings.filter((row) => row.date && row.date < today).length,
    progress: todayTaskProgress(domain, today),
  };
}
