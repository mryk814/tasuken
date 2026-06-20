import type { Item } from "../../types";
import type { PlanNode, Schedule, Task, Waiting, WorkspaceDomain } from "../types";

function scheduleMap(domain: WorkspaceDomain): Map<string, Schedule> {
  return new Map(domain.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
}

function taskToItem(task: Task, schedule?: Schedule): Item {
  return {
    id: task.id,
    title: task.title,
    kind: "task",
    theme_id: task.project_id,
    status: task.state,
    priority: task.priority,
    description: task.description ?? undefined,
    planned_start: schedule?.start_date ?? null,
    planned_end: schedule?.end_date ?? null,
    completed_at: task.completed_at,
    source_record_id: task.source_record_id,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

function waitingToItem(waiting: Waiting, schedule?: Schedule): Item {
  return {
    id: waiting.id,
    title: waiting.title,
    kind: "waiting",
    theme_id: waiting.project_id,
    status: waiting.state === "received" ? "done" : waiting.state === "cancelled" ? "cancelled" : "waiting",
    waiting_for: waiting.waiting_for,
    next_action: waiting.next_action ?? undefined,
    description: waiting.description ?? undefined,
    planned_start: schedule?.start_date ?? null,
    planned_end: schedule?.end_date ?? null,
    source_record_id: waiting.source_record_id,
    created_at: waiting.created_at,
    updated_at: waiting.updated_at,
  };
}

function planNodeToItem(planNode: PlanNode, schedule?: Schedule): Item {
  return {
    id: planNode.id,
    title: planNode.title,
    kind: planNode.type === "milestone" ? "milestone" : "period",
    theme_id: planNode.project_id,
    status: planNode.state === "done" ? "done" : planNode.state === "cancelled" ? "cancelled" : "todo",
    description: planNode.description ?? undefined,
    planned_start: schedule?.start_date ?? null,
    planned_end: schedule?.end_date ?? null,
    source_record_id: planNode.source_record_id,
    created_at: planNode.created_at,
    updated_at: planNode.updated_at,
  };
}

export function domainToItems(domain: WorkspaceDomain): Item[] {
  const schedMap = scheduleMap(domain);
  const items: Item[] = [];
  for (const task of domain.tasks) items.push(taskToItem(task, schedMap.get(`task:${task.id}`)));
  for (const waiting of domain.waitings) items.push(waitingToItem(waiting, schedMap.get(`waiting:${waiting.id}`)));
  for (const planNode of domain.plan_nodes) items.push(planNodeToItem(planNode, schedMap.get(`plan_node:${planNode.id}`)));
  return items;
}

/** @deprecated Use domainToItems instead */
export const v2ToItems = domainToItems;
