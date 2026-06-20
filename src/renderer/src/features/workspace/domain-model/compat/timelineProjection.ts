import type { BaseRecord, Item, SaveOperation, WorkspaceData } from "../../types";
import { addDays } from "../../lib/format";
import type { PlanDependency, PlanNode, Schedule, WorkspaceDomain } from "../types";
import { buildSavePlanNodeOperations, buildSaveScheduleOperations } from "../persistence";

type TimelineItem = Item;

function scheduleByOwner(domain: WorkspaceDomain): Map<string, Schedule> {
  return new Map(domain.schedules.map((schedule) => [`${schedule.owner_type}:${schedule.owner_id}`, schedule]));
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

export function v2TimelineItems(domain: WorkspaceDomain): TimelineItem[] {
  const schedules = scheduleByOwner(domain);
  return domain.plan_nodes.map((planNode) => {
    const schedule = schedules.get(`plan_node:${planNode.id}`);
    return {
      id: planNode.legacy_item_id || planNode.id,
      _planNodeId: planNode.id,
      title: planNode.title,
      kind: legacyPlanKind(planNode),
      level: "plan",
      theme_id: planNode.project_id,
      parent_item_id: planNode.parent_plan_node_id
        ? domain.plan_nodes.find((parent) => parent.id === planNode.parent_plan_node_id)?.legacy_item_id || planNode.parent_plan_node_id
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

export function v2TimelineDependencies(domain: WorkspaceDomain): BaseRecord[] {
  return domain.plan_dependencies.map((dependency) => {
    const planNode = domain.plan_nodes.find((node) => node.id === dependency.plan_node_id);
    const dependsOn = domain.plan_nodes.find((node) => node.id === dependency.depends_on_plan_node_id);
    return {
      id: dependency.id,
      source_item_id: dependsOn?.legacy_item_id || dependency.depends_on_plan_node_id,
      target_item_id: planNode?.legacy_item_id || dependency.plan_node_id,
      dependency_type: dependency.dependency_type || undefined,
    };
  });
}

export function timelineRangeItems(domain: WorkspaceDomain): TimelineItem[] {
  return v2TimelineItems(domain);
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


export interface TimelineWorkspace {
  items: Item[];
  dependencies: BaseRecord[];
}

export function legacyTimelineWorkspace(_data: WorkspaceData, domain: WorkspaceDomain): TimelineWorkspace {
  return {
    items: v2TimelineItems(domain),
    dependencies: v2TimelineDependencies(domain),
  };
}

function findPlanNode(domain: WorkspaceDomain, itemId: string): PlanNode | undefined {
  return domain.plan_nodes.find((node) => node.legacy_item_id === itemId || node.id === itemId);
}

function resolvePlanNodeId(domain: WorkspaceDomain, itemId: string | null | undefined): string | null {
  if (!itemId) return null;
  const node = findPlanNode(domain, itemId);
  return node?.id || itemId;
}

export function timelineSaveItemOperations(item: TimelineItem, domain: WorkspaceDomain): SaveOperation[] {
  const planNode = findPlanNode(domain, item.id);
  if (!planNode) return [];

  const parentPlanNodeId = resolvePlanNodeId(domain, item.parent_item_id);
  const updated: PlanNode = {
    ...planNode,
    title: item.title,
    project_id: item.theme_id || null,
    parent_plan_node_id: parentPlanNodeId,
  };

  const schedules = scheduleByOwner(domain);
  const existing = schedules.get(`plan_node:${planNode.id}`);
  const schedule: Schedule = {
    id: existing?.id || crypto.randomUUID(),
    owner_type: "plan_node",
    owner_id: planNode.id,
    start_date: item.planned_start || null,
    end_date: item.planned_end || null,
    date_kind: existing?.date_kind || "range",
    confidence: (item.schedule_confidence as Schedule["confidence"]) || existing?.confidence || "tentative",
    granularity: (item.date_granularity as Schedule["granularity"]) || existing?.granularity || "day",
    baseline_start: item.baseline_start || existing?.baseline_start || null,
    baseline_end: item.baseline_end || existing?.baseline_end || null,
    actual_start: item.actual_start || existing?.actual_start || null,
    actual_end: item.actual_end || existing?.actual_end || null,
  };

  return [...buildSavePlanNodeOperations(updated), ...buildSaveScheduleOperations(schedule)];
}

export function timelineCreatePlanNodeDraft(
  parentItemId: string | null,
  themeId: string | null | undefined,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): Record<string, unknown> {
  return {
    node_type: "phase",
    node_state: "planned",
    project_id: themeId || null,
    _parent_plan_node_item_id: parentItemId,
    start_date: startDate || "",
    end_date: endDate || "",
  };
}

export function timelineResolveParentPlanNodeId(domain: WorkspaceDomain, parentItemId: string | null | undefined): string | null {
  return resolvePlanNodeId(domain, parentItemId);
}

export function timelineAddDependencyOperations(
  sourceItemId: string,
  targetItemId: string,
  domain: WorkspaceDomain,
): { ops: SaveOperation[]; planDepId: string } | null {
  const sourcePlanNode = findPlanNode(domain, sourceItemId);
  const targetPlanNode = findPlanNode(domain, targetItemId);
  if (!sourcePlanNode || !targetPlanNode) return null;
  const planDepId = crypto.randomUUID();
  const planDep: PlanDependency = {
    id: planDepId,
    plan_node_id: targetPlanNode.id,
    depends_on_plan_node_id: sourcePlanNode.id,
    dependency_type: "finish_to_start",
  };
  return {
    ops: [{ action: "save", type: "plan_dependency", entity: planDep as unknown as import("../../types").Entity }],
    planDepId,
  };
}

export function timelineFindDependencyV2Id(dep: BaseRecord, domain: WorkspaceDomain): string | null {
  const match = domain.plan_dependencies.find(
    (pd) => pd.id === dep.id,
  );
  return match?.id || null;
}
