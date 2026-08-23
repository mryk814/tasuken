import { entityDefinition } from "../../../../shared/entityRegistry.mjs";
import { taskCreationProvenanceSchema } from "../../../../shared/contracts/task/public.ts";
import type { Entity, EntityType, SaveOperation } from "../../../../shared/types/workspace.ts";
import { ApplicationCommandError, type ApplicationCommandName, type CommandEnvelope, type CommandReceipt } from "../../../../shared/applicationCommand.ts";
import type { TaskRepository } from "../ports/taskRepository.ts";
import {
  assertHumanAcceptBeforeTaskCompletion,
  assertTaskThemeExists,
  currentTaskWorkState,
  normalizeTaskForSave,
  taskChangeType,
  taskFromPayload,
  taskIdFromPayload,
  taskReferenceOperations,
  validateTaskScheduleWrite,
} from "./taskPolicy.ts";

const taskDefinition = entityDefinition("task");

function attachCreationProvenance(command: CommandEnvelope, event: Entity, isCreate: boolean): Entity {
  const raw = (command.payload as { provenance?: unknown }).provenance;
  if (raw === undefined) return event;
  if (!isCreate) throw new ApplicationCommandError("INVALID_PAYLOAD", "provenanceはCreateTaskだけに指定できます。");
  const parsed = taskCreationProvenanceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task作成元のprovenanceが不正です。", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    ? event.metadata as Record<string, unknown>
    : {};
  return { ...event, metadata: { ...metadata, provenance: parsed.data } };
}

export const taskApplicationCommandNames = ["CreateTask", "UpdateTask", "DeleteTask", "CompleteTask", "ReopenTask"] as const;
const taskCommandNames = new Set<ApplicationCommandName>(taskApplicationCommandNames);

export interface TaskCommandRuntime {
  hasExpectedVersion(command: CommandEnvelope, type: EntityType, id: string): boolean;
  assertExpectedVersion(command: CommandEnvelope, type: EntityType, id: string, current: Entity | null): void;
  createEvent(command: CommandEnvelope, entityType: EntityType, entityId: string, kind: "created" | "updated" | "completed" | "rescheduled", before: Entity | null, after: Entity): Entity;
  annotateEvent(command: CommandEnvelope, event: Entity): Entity;
  persist(command: CommandEnvelope, operations: SaveOperation[], eventIds: string[], changeTypes: EntityType[]): CommandReceipt;
  persistNoChange(command: CommandEnvelope, taskId: string, current: Entity): CommandReceipt;
  now(): string;
}

export class TaskCommandHandler {
  private readonly repository: TaskRepository;
  private readonly runtime: TaskCommandRuntime;

  constructor(repository: TaskRepository, runtime: TaskCommandRuntime) {
    this.repository = repository;
    this.runtime = runtime;
  }

  handles(name: ApplicationCommandName): boolean {
    return taskCommandNames.has(name);
  }

  execute(command: CommandEnvelope): CommandReceipt {
    if (!this.handles(command.name)) throw new ApplicationCommandError("INVALID_ENVELOPE", `Task moduleが所有しないCommandです: ${command.name}`);
    if (command.name === "DeleteTask") return this.deleteTask(command);
    if (command.name === "CreateTask" || command.name === "UpdateTask") return this.saveTask(command, command.name === "CreateTask");
    return this.transitionTask(command, command.name === "CompleteTask");
  }

  private saveTask(command: CommandEnvelope, isCreate: boolean): CommandReceipt {
    const inputTask = taskFromPayload(command.payload);
    const taskId = inputTask.id;
    const current = this.repository.get("task", taskId, true);
    if (isCreate && current) {
      throw new ApplicationCommandError("CONFLICT", "同じTask IDが既に存在します。", {
        type: "task",
        id: taskId,
        conflictReason: "entity_already_exists",
      });
    }
    if (!isCreate && !current) throw new ApplicationCommandError("NOT_FOUND", "更新対象のTaskがありません。", { id: taskId });
    this.runtime.assertExpectedVersion(command, "task", taskId, current);

    const task = normalizeTaskForSave(inputTask, current || undefined);
    if (task.state === "done") assertHumanAcceptBeforeTaskCompletion(task);
    if (!isCreate && !this.runtime.hasExpectedVersion(command, "task", taskId)) {
      throw new ApplicationCommandError("CONFLICT", "UpdateTaskにはexpected versionが必要です。", {
        type: "task",
        id: taskId,
        conflictReason: "version_conflict",
      });
    }
    taskDefinition.parseUpdate(task);
    assertTaskThemeExists(this.repository, task);
    if (!isCreate && current && current.state !== task.state && (current.state === "done" || task.state === "done")) {
      throw new ApplicationCommandError("INVALID_TRANSITION", "完了状態の変更はCompleteTask/ReopenTaskを使用してください。");
    }
    if (!isCreate && current && Object.prototype.hasOwnProperty.call(inputTask, "work_state") && currentTaskWorkState(current) !== currentTaskWorkState(task)) {
      const setupTransition = (currentTaskWorkState(current) === "not_delegated" && currentTaskWorkState(task) === "ready_for_agent")
        || (currentTaskWorkState(current) === "ready_for_agent" && currentTaskWorkState(task) === "not_delegated");
      if (!setupTransition) throw new ApplicationCommandError("INVALID_TRANSITION", "Work stateの変更はStart/Report/Accept/Return Commandを使用してください。", { id: taskId });
    }

    const schedule = validateTaskScheduleWrite(
      this.repository,
      command,
      (command.payload as { schedule?: Entity | null }).schedule,
      taskId,
      isCreate,
      (type, id) => this.runtime.hasExpectedVersion(command, type, id),
      (type, id, entity) => this.runtime.assertExpectedVersion(command, type, id, entity),
    );
    const operations: SaveOperation[] = [{ action: "save", type: "task", entity: task }];
    if (schedule) operations.push({ action: "save", type: "schedule", entity: schedule });
    const event = this.runtime.annotateEvent(
      command,
      attachCreationProvenance(
        command,
        this.runtime.createEvent(command, "task", taskId, taskChangeType(current, task, command.name), current, task),
        isCreate,
      ),
    );
    operations.push({ action: "save", type: "change_event", entity: event });
    const previousSchedule = schedule ? this.repository.get("schedule", schedule.id, true) : null;
    const scheduleEvent = schedule
      ? this.runtime.annotateEvent(command, this.runtime.createEvent(command, "schedule", taskId, "rescheduled", previousSchedule, schedule))
      : null;
    if (scheduleEvent) operations.push({ action: "save", type: "change_event", entity: scheduleEvent });
    operations.push(...taskReferenceOperations(this.repository, command, taskId));
    return this.runtime.persist(
      command,
      operations,
      [event.id, ...(scheduleEvent ? [scheduleEvent.id] : [])],
      operations.map((operation) => operation.type).filter((type) => type !== "change_event"),
    );
  }

  private transitionTask(command: CommandEnvelope, completing: boolean): CommandReceipt {
    const taskId = taskIdFromPayload(command.payload);
    const current = this.repository.get("task", taskId);
    if (!current) throw new ApplicationCommandError("NOT_FOUND", "対象Taskがありません。", { id: taskId });
    if (!this.runtime.hasExpectedVersion(command, "task", taskId)) {
      throw new ApplicationCommandError("CONFLICT", `${command.name}にはexpected versionが必要です。`, {
        type: "task",
        id: taskId,
        conflictReason: "version_conflict",
      });
    }
    this.runtime.assertExpectedVersion(command, "task", taskId, current);
    if (current.state === "cancelled") throw new ApplicationCommandError("INVALID_TRANSITION", "キャンセル済みTaskはこのCommandで変更できません。", { id: taskId });
    if (completing) assertHumanAcceptBeforeTaskCompletion(current);
    const requestedTask = (command.payload as { task?: Entity }).task;
    if (requestedTask) {
      taskFromPayload({ task: requestedTask });
      taskDefinition.parseUpdate(requestedTask);
    }
    const alreadyInTarget = completing ? current.state === "done" : current.state !== "done";
    if (alreadyInTarget) {
      if (requestedTask || (command.payload as { references?: Entity[] }).references?.length) return this.saveTask(command, false);
      return this.runtime.persistNoChange(command, taskId, current);
    }
    const next: Entity = completing
      ? { ...current, ...(requestedTask || {}), id: taskId, state: "done", completed_at: this.runtime.now(), completion_note: (command.payload as { completionNote?: string | null }).completionNote ?? current.completion_note ?? null }
      : { ...current, ...(requestedTask || {}), id: taskId, state: "todo", completed_at: null };
    const normalizedTask = normalizeTaskForSave(next, current);
    taskDefinition.parseUpdate(normalizedTask);
    assertTaskThemeExists(this.repository, normalizedTask);
    const event = this.runtime.annotateEvent(command, this.runtime.createEvent(command, "task", taskId, completing ? "completed" : "updated", current, normalizedTask));
    const normalizedSchedule = validateTaskScheduleWrite(
      this.repository,
      command,
      (command.payload as { schedule?: Entity | null }).schedule,
      taskId,
      false,
      (type, id) => this.runtime.hasExpectedVersion(command, type, id),
      (type, id, entity) => this.runtime.assertExpectedVersion(command, type, id, entity),
    );
    const scheduleEvent = normalizedSchedule
      ? this.runtime.annotateEvent(command, this.runtime.createEvent(command, "schedule", taskId, "rescheduled", this.repository.get("schedule", normalizedSchedule.id, true), normalizedSchedule))
      : null;
    const operations: SaveOperation[] = [
      { action: "save", type: "task", entity: normalizedTask },
      ...(normalizedSchedule ? [{ action: "save" as const, type: "schedule" as const, entity: normalizedSchedule }] : []),
      { action: "save", type: "change_event", entity: event },
      ...(scheduleEvent ? [{ action: "save" as const, type: "change_event" as const, entity: scheduleEvent }] : []),
      ...taskReferenceOperations(this.repository, command, taskId),
    ];
    return this.runtime.persist(command, operations, [event.id, ...(scheduleEvent ? [scheduleEvent.id] : [])], operations.map((operation) => operation.type).filter((type) => type !== "change_event"));
  }

  private deleteTask(command: CommandEnvelope): CommandReceipt {
    const taskId = taskIdFromPayload(command.payload);
    const current = this.repository.get("task", taskId);
    if (!current) throw new ApplicationCommandError("NOT_FOUND", "削除対象のTaskがありません。", { id: taskId });
    if (!this.runtime.hasExpectedVersion(command, "task", taskId)) {
      throw new ApplicationCommandError("CONFLICT", "DeleteTaskにはexpected versionが必要です。", {
        type: "task",
        id: taskId,
        conflictReason: "version_conflict",
      });
    }
    this.runtime.assertExpectedVersion(command, "task", taskId, current);
    const deleted = this.repository.removeTask(taskId);
    if (!deleted) throw new ApplicationCommandError("NOT_FOUND", "削除対象のTaskがありません。", { id: taskId });
    return {
      commandId: command.commandId,
      name: command.name,
      status: "applied",
      saved: [],
      deleted: [{ type: "task", id: taskId }],
      events: [],
      warnings: [],
      revisions: [],
      changes: [{ type: "task", entity: deleted }],
    };
  }
}
