import type { Dependency, Item, WorkspaceData } from "../../workspace/types";
import { addDays } from "../../workspace/lib/format";
import type { PlanNode, Schedule, WorkspaceV2 } from "./types";

type TimelineItem = Item;

function scheduleByOwner(v2: WorkspaceV2): Map<string, Schedule> {
  return new Map(v2.schedules.map((schedule) => [`${schedule.owner_type}:${schedule.owner_id}`, schedule]));
}

function legacyPlanKind(planNode: PlanNode): string {
  if (planNode.type === "milestone") return "milestone";
  if (planNode.type === "deliverable") return "deliverable";
  return "period";
}

function legacyPlanStatus(planNode: PlanNode): string {
  if (planNode.state === "planned") return "todo";
  return planNode.state;
}

export function v2TimelineItems(v2: WorkspaceV2): TimelineItem[] {
  const schedules = scheduleByOwner(v2);
  return v2.plan_nodes.map((planNode) => {
    const schedule = schedules.get(`plan_node:${planNode.id}`);
    return {
      id: planNode.legacy_item_id || planNode.id,
      title: planNode.title,
      kind: legacyPlanKind(planNode),
      level: "plan",
      theme_id: planNode.project_id,
      parent_item_id: planNode.parent_plan_node_id
        ? v2.plan_nodes.find((parent) => parent.id === planNode.parent_plan_node_id)?.legacy_item_id || planNode.parent_plan_node_id
        : null,
      status: legacyPlanStatus(planNode),
      sort_order: planNode.sort_order,
      planned_start: schedule?.start_date,
      planned_end: schedule?.end_date,
      due_date: null,
      baseline_start: schedule?.baseline_start,
      baseline_end: schedule?.baseline_end,
      actual_start: schedule?.actual_start,
      actual_end: schedule?.actual_end,
      schedule_confidence: schedule?.confidence,
      date_granularity: schedule?.granularity,
      source_record_id: planNode.source_record_id,
      description: planNode.description || undefined,
    };
  });
}

export function v2TimelineDependencies(v2: WorkspaceV2): Dependency[] {
  return v2.plan_dependencies.map((dependency) => {
    const planNode = v2.plan_nodes.find((node) => node.id === dependency.plan_node_id);
    const dependsOn = v2.plan_nodes.find((node) => node.id === dependency.depends_on_plan_node_id);
    return {
      id: dependency.legacy_dependency_id || dependency.id,
      source_item_id: dependsOn?.legacy_item_id || dependency.depends_on_plan_node_id,
      target_item_id: planNode?.legacy_item_id || dependency.plan_node_id,
      dependency_type: dependency.dependency_type || undefined,
    };
  });
}

export function timelineRangeItems(v2: WorkspaceV2): TimelineItem[] {
  return v2TimelineItems(v2);
}

export function isTimelineCompleted(item: TimelineItem): boolean {
  return item.status === "done";
}

export function timelineThemeId(item: TimelineItem): string | null {
  return item.theme_id || null;
}

export function timelineItemHasSchedule(item: Pick<TimelineItem, "planned_start" | "planned_end">): boolean {
  return Boolean(item.planned_start || item.planned_end);
}

export function timelineItemLevel(item: TimelineItem): string {
  return item.level || "plan";
}

export function timelineItemIsMilestone(item: TimelineItem): boolean {
  return item.kind === "milestone";
}

export function timelineItemStatusLabel(item: TimelineItem): string {
  if (item.status === "todo") return "計画中";
  if (item.status === "active") return "進行中";
  if (item.status === "done") return "完了";
  if (item.status === "cancelled") return "中止";
  return item.status || "未設定";
}

export function timelineItemStatusValue(item: TimelineItem): string {
  return item.status || "";
}

export function timelineItemDateSpan(item: TimelineItem): { start?: string | null; end?: string | null } {
  return {
    start: item.planned_start,
    end: item.planned_end,
  };
}

export function timelineShiftItemDraft(item: TimelineItem, delta: number, mode: "move" | "start" | "end"): TimelineItem | null {
  if (!timelineItemHasSchedule(item)) return null;
  const next: TimelineItem = { ...item };
  if (mode === "start") next.planned_start = addDays(item.planned_start, delta);
  else if (mode === "end") next.planned_end = addDays(item.planned_end, delta);
  else {
    next.planned_start = addDays(item.planned_start, delta);
    next.planned_end = addDays(item.planned_end, delta);
    next.due_date = null;
  }
  return next;
}

export function timelineReparentItemDraft(item: TimelineItem, targetParent?: TimelineItem | null): TimelineItem {
  if (!targetParent || targetParent.id === item.id || targetParent.id === item.parent_item_id) return item;
  return {
    ...item,
    parent_item_id: targetParent.id,
    theme_id: targetParent.theme_id || null,
  };
}

export function timelineAddPlanDraft(parent: TimelineItem): Partial<TimelineItem> {
  return {
    kind: "period",
    level: "plan",
    parent_item_id: parent.id,
    theme_id: parent.theme_id,
    planned_start: parent.planned_start,
    planned_end: parent.planned_end,
  };
}


export function legacyTimelineWorkspace(data: WorkspaceData, v2: WorkspaceV2): WorkspaceData {
  return {
    ...data,
    items: v2TimelineItems(v2),
    dependencys: v2TimelineDependencies(v2),
  };
}
