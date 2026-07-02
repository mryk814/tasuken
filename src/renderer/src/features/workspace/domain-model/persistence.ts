import type { Entity, SaveOperation, SaveOptions } from "../types";
import type { CaptureEntry, ChangeEvent, EntityRefType, Note, PlanNode, Resource, Schedule, Task, Waiting } from "./types";

type SaveSource = ChangeEvent["source"];

export interface SaveContext {
  now?: string;
  source?: SaveSource;
  reason?: string | null;
}

/** @deprecated Use SaveContext instead */
export type V2SaveContext = SaveContext;

function nowIso(context: SaveContext = {}): string {
  return context.now || new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

function saveOperation(type: SaveOperation["type"], entity: Entity, options?: SaveOptions): SaveOperation {
  return { action: "save", type, entity, options };
}

export interface TriageTarget {
  type: EntityRefType;
  id: string;
}

export function buildChangeEventOperation(
  entityType: EntityRefType,
  entityId: string,
  changeType: ChangeEvent["change_type"],
  context: SaveContext = {},
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

export function buildSaveTaskOperations(task: Task, context: SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("task", task as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("task", task.id, task.completed_at ? "completed" : "updated", context, undefined, task),
  ];
}

export function buildSaveWaitingOperations(waiting: Waiting, context: SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("waiting", waiting as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("waiting", waiting.id, waiting.state === "received" ? "completed" : "updated", context, undefined, waiting),
  ];
}

export function buildSavePlanNodeOperations(planNode: PlanNode, context: SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("plan_node", planNode as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("plan_node", planNode.id, planNode.state === "done" ? "completed" : "updated", context, undefined, planNode),
  ];
}

export function buildSaveScheduleOperations(schedule: Schedule, context: SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("schedule", schedule as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation(schedule.owner_type, schedule.owner_id, "rescheduled", context, undefined, schedule),
  ];
}

export function buildSaveCaptureEntryOperations(entry: CaptureEntry, context: SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("capture_entry", entry as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("capture_entry", entry.id, "updated", context, undefined, entry),
  ];
}

export function buildSaveResourceOperations(resource: Resource, context: SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("resource", resource as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("resource", resource.id, "updated", context, undefined, resource),
  ];
}

export function buildSaveNoteOperations(note: Note, context: SaveContext = {}): SaveOperation[] {
  return [
    saveOperation("note", note as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("note", note.id, "updated", context, undefined, note),
  ];
}

export function buildTriageCaptureEntryOperations(
  entry: CaptureEntry,
  target: TriageTarget,
  context: SaveContext = {},
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

export function buildSendMicroMemoToInboxOperations(
  entry: CaptureEntry,
  context: SaveContext = {},
): SaveOperation[] {
  const next: CaptureEntry = {
    ...entry,
    kind: null,
    state: "untriaged",
    triaged_to_type: null,
    triaged_to_id: null,
  };
  return [
    saveOperation("capture_entry", next as unknown as Entity, { source: context.source || "manual", reason: context.reason || undefined }),
    buildChangeEventOperation("capture_entry", entry.id, "updated", context, entry, next),
  ];
}

export async function saveTask(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, task: Task, context?: SaveContext): Promise<Entity[]> {
  return saveEntities(buildSaveTaskOperations(task, context), "Taskを保存しました。");
}

export async function saveWaiting(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, waiting: Waiting, context?: SaveContext): Promise<Entity[]> {
  return saveEntities(buildSaveWaitingOperations(waiting, context), "Waitingを保存しました。");
}

export async function savePlanNode(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, planNode: PlanNode, context?: SaveContext): Promise<Entity[]> {
  return saveEntities(buildSavePlanNodeOperations(planNode, context), "PlanNodeを保存しました。");
}

export async function saveSchedule(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, schedule: Schedule, context?: SaveContext): Promise<Entity[]> {
  return saveEntities(buildSaveScheduleOperations(schedule, context), "Scheduleを保存しました。");
}

export async function saveCaptureEntry(saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>, entry: CaptureEntry, context?: SaveContext): Promise<Entity[]> {
  return saveEntities(buildSaveCaptureEntryOperations(entry, context), "CaptureEntryを保存しました。");
}

export async function triageCaptureEntry(
  saveEntities: (operations: SaveOperation[], message?: string) => Promise<Entity[]>,
  entry: CaptureEntry,
  target: TriageTarget,
  context?: SaveContext,
): Promise<Entity[]> {
  return saveEntities(buildTriageCaptureEntryOperations(entry, target, context), "CaptureEntryを整理しました。");
}
