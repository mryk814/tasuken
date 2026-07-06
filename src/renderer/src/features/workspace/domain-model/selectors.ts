import type { CaptureEntry, PlanNode, Schedule, WorkspaceDomain } from "./types";
import type { InboxView, MicroMemoView, OngoingPeriodTaskRow, TimelineRow, TimelineView, TodayEntry, TodoView, WaitingView } from "./viewModels";

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

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

function scheduleHasExplicitDate(schedule: Schedule | undefined, date: string): boolean {
  if (!schedule) return false;
  if (schedule.start_date === date && schedule.end_date && schedule.end_date > date) return false;
  return schedule.start_date === date || schedule.end_date === date;
}

function isOngoingPeriod(schedule: Schedule | undefined, date: string): schedule is Schedule & { start_date: string; end_date: string } {
  if (!schedule?.start_date || !schedule.end_date) return false;
  if (schedule.start_date >= schedule.end_date) return false;
  return schedule.start_date <= date && date < schedule.end_date;
}

function inclusiveDays(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  return Math.floor((endTime - startTime) / 86400000) + 1;
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

  for (const task of domain.tasks) {
    const schedule = schedules.get(scheduleKey("task", task.id));
    if (isActiveTask(task.state) && scheduleHasExplicitDate(schedule, date)) entries.push({ type: "task", task, schedule });
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

export function buildOngoingPeriodTaskView(domain: WorkspaceDomain, date = todayString()): OngoingPeriodTaskRow[] {
  const schedules = schedulesByOwner(domain);
  return domain.tasks
    .map((task) => ({ task, schedule: schedules.get(scheduleKey("task", task.id)) }))
    .filter((row): row is { task: typeof row.task; schedule: Schedule & { start_date: string; end_date: string } } => (
      isActiveTask(row.task.state) && isOngoingPeriod(row.schedule, date)
    ))
    .map(({ task, schedule }) => ({
      task,
      schedule,
      dayIndex: inclusiveDays(schedule.start_date, date),
      totalDays: inclusiveDays(schedule.start_date, schedule.end_date),
      daysRemaining: Math.max(0, inclusiveDays(date, schedule.end_date) - 1),
    }))
    .sort((a, b) => a.dayIndex - b.dayIndex || a.schedule.end_date.localeCompare(b.schedule.end_date) || a.task.title.localeCompare(b.task.title, "ja"));
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
