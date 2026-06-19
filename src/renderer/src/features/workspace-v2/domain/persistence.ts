import type { Entity, SaveOperation, SaveOptions } from "../../workspace/types";
import type { CaptureEntry, ChangeEvent, EntityRefType, PlanNode, Schedule, Task, Waiting } from "./types";

type SaveSource = ChangeEvent["source"];

export interface V2SaveContext {
  now?: string;
  source?: SaveSource;
  reason?: string | null;
}

export interface TriageTarget {
  type: EntityRefType;
  id: string;
}

function nowIso(context: V2SaveContext = {}): string {
  return context.now || new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

function saveOperation(type: SaveOperation["type"], entity: Entity, options?: SaveOptions): SaveOperation {
  return { action: "save", type, entity, options };
}

export function buildChangeEventOperation(
  entityType: EntityRefType,
  entityId: string,
  changeType: ChangeEvent["change_type"],
  context: V2SaveContext = {},
  beforeJson?: unknown,
  afterJson?: unknown,
): SaveOperation {
  return saveOperation("change_event", {
    id: uuid(),
    entity_type: entityType,
    entity_id: entityId,
    changed_at: nowIso(context),
    change_type: changeType,
    reason: context.reason || null,
    before_json: beforeJson,
    after_json: afterJson,
    source: context.source || "manual",
  });
}

export function buildSaveTaskOperations(task: Task, context: V2SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("task", task as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("task", task.id, task.completed_at ? "completed" : "updated", context, undefined, task),
  ];
}

export function buildSaveWaitingOperations(waiting: Waiting, context: V2SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("waiting", waiting as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("waiting", waiting.id, waiting.state === "received" ? "completed" : "updated", context, undefined, waiting),
  ];
}

export function buildSavePlanNodeOperations(planNode: PlanNode, context: V2SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("plan_node", planNode as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("plan_node", planNode.id, planNode.state === "done" ? "completed" : "updated", context, undefined, planNode),
  ];
}

export function buildSaveScheduleOperations(schedule: Schedule, context: V2SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("schedule", schedule as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation(schedule.owner_type, schedule.owner_id, "rescheduled", context, undefined, schedule),
  ];
}

export function buildSaveCaptureEntryOperations(entry: CaptureEntry, context: V2SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("capture_entry", entry as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("capture_entry", entry.id, "updated", context, undefined, entry),
  ];
}

export function buildTriageCaptureEntryOperations(
  entry: CaptureEntry,
  target: TriageTarget,
  context: V2SaveContext = {},
): SaveOperation[] {
  const next: CaptureEntry = {
    ...entry,
    state: "triaged",
    triaged_to_type: target.type,
    triaged_to_id: target.id,
  };
  return [
    saveOperation("capture_entry", next as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("capture_entry", entry.id, "triaged", context, entry, next),
  ];
}

export async function saveTask(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, task: Task, context?: V2SaveContext): Promise<Entity[]> {
  return saveEntities(buildSaveTaskOperations(task, context), "Taskを保存しました。");
}

export async function saveWaiting(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, waiting: Waiting, context?: V2SaveContext): Promise<Entity[]> {
  return saveEntities(buildSaveWaitingOperations(waiting, context), "Waitingを保存しました。");
}

export async function savePlanNode(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, planNode: PlanNode, context?: V2SaveContext): Promise<Entity[]> {
  return saveEntities(buildSavePlanNodeOperations(planNode, context), "PlanNodeを保存しました。");
}

export async function saveSchedule(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, schedule: Schedule, context?: V2SaveContext): Promise<Entity[]> {
  return saveEntities(buildSaveScheduleOperations(schedule, context), "Scheduleを保存しました。");
}

export async function saveCaptureEntry(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, entry: CaptureEntry, context?: V2SaveContext): Promise<Entity[]> {
  return saveEntities(buildSaveCaptureEntryOperations(entry, context), "CaptureEntryを保存しました。");
}

export async function triageCaptureEntry(
  saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>,
  entry: CaptureEntry,
  target: TriageTarget,
  context?: V2SaveContext,
): Promise<Entity[]> {
  return saveEntities(buildTriageCaptureEntryOperations(entry, target, context), "CaptureEntryを整理しました。");
}
