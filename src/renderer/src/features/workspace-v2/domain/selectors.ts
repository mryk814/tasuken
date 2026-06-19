import type { PlanNode, Schedule, WorkspaceV2 } from "./types";
import type { InboxView, TimelineRow, TimelineView, TodayEntry, TodoView, WaitingView } from "./viewModels";

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function scheduleKey(ownerType: Schedule["owner_type"], ownerId: string): string {
  return `${ownerType}:${ownerId}`;
}

function schedulesByOwner(v2: WorkspaceV2): Map<string, Schedule> {
  return new Map(v2.schedules.map((schedule) => [scheduleKey(schedule.owner_type, schedule.owner_id), schedule]));
}

function dateValue(schedule?: Schedule): string {
  return String(schedule?.end_date || schedule?.start_date || "9999-12-31");
}

function isActiveTask(state: string): boolean {
  return !["done", "cancelled"].includes(state);
}

function scheduleTouchesDate(schedule: Schedule | undefined, date: string): boolean {
  if (!schedule) return false;
  if (schedule.start_date === date || schedule.end_date === date) return true;
  if (schedule.start_date && schedule.end_date) return schedule.start_date <= date && schedule.end_date >= date;
  return false;
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

export function buildTodoView(v2: WorkspaceV2): TodoView {
  const schedules = schedulesByOwner(v2);
  return {
    tasks: v2.tasks
      .map((task) => ({ task, schedule: schedules.get(scheduleKey("task", task.id)) }))
      .sort(compareScheduledRows),
  };
}

export function buildInboxView(v2: WorkspaceV2): InboxView {
  return {
    entries: v2.capture_entries
      .filter((entry) => entry.state === "untriaged")
      .sort((a, b) => b.captured_at.localeCompare(a.captured_at)),
  };
}

export function buildWaitingView(v2: WorkspaceV2): WaitingView {
  const schedules = schedulesByOwner(v2);
  return {
    waitings: v2.waitings
      .filter((waiting) => waiting.state === "waiting")
      .map((waiting) => ({ waiting, schedule: schedules.get(scheduleKey("waiting", waiting.id)) }))
      .sort(compareScheduledRows),
  };
}

export function buildTodayView(v2: WorkspaceV2, date = todayString()): TodayEntry[] {
  const schedules = schedulesByOwner(v2);
  const entries: TodayEntry[] = [];

  for (const task of v2.tasks) {
    const schedule = schedules.get(scheduleKey("task", task.id));
    if (isActiveTask(task.state) && scheduleTouchesDate(schedule, date)) entries.push({ type: "task", task, schedule });
  }

  for (const waiting of v2.waitings) {
    const schedule = schedules.get(scheduleKey("waiting", waiting.id));
    if (waiting.state === "waiting" && scheduleTouchesDate(schedule, date)) entries.push({ type: "waiting", waiting, schedule });
  }

  for (const planNode of v2.plan_nodes) {
    const schedule = schedules.get(scheduleKey("plan_node", planNode.id));
    if (planNode.type === "milestone" && planNode.state !== "done" && scheduleTouchesDate(schedule, date)) {
      entries.push({ type: "milestone", planNode, schedule });
    }
  }

  for (const captureEntry of v2.capture_entries) {
    if (captureEntry.state === "untriaged" && captureEntry.captured_at.slice(0, 10) === date) {
      entries.push({ type: "capture", captureEntry });
    }
  }

  return entries.sort((a, b) => todayEntryDate(a).localeCompare(todayEntryDate(b)));
}

function comparePlanNodes(schedules: Map<string, Schedule>, a: PlanNode, b: PlanNode): number {
  const order = a.sort_order - b.sort_order;
  if (order !== 0) return order;
  return dateValue(schedules.get(scheduleKey("plan_node", a.id)))
    .localeCompare(dateValue(schedules.get(scheduleKey("plan_node", b.id))));
}

export function buildTimelineView(v2: WorkspaceV2): TimelineView {
  const schedules = schedulesByOwner(v2);
  const childrenByParent = new Map<string, PlanNode[]>();
  const roots: PlanNode[] = [];

  for (const planNode of v2.plan_nodes) {
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
