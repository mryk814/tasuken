import {
  TASK_CONTRACT_SCHEMA_VERSION,
  parseTaskCommand,
  parseTaskQuery,
  taskCommandOutcomeSchema,
  taskEventSchema,
  taskQueryResultSchema,
  taskReadModelSchema,
  taskScheduleReadModelSchema,
  type TaskCommand,
  type TaskCommandOutcome,
  type TaskCommandResponse,
  type TaskConflictReason,
  type TaskError,
  type TaskEvent,
  type TaskQuery,
  type TaskQueryResponse,
  type TaskReadModel,
  type TaskScheduleReadModel,
} from "../../../../shared/contracts/task/public.ts";
import {
  ApplicationCommandError,
  type ApplicationCommandSource,
  type CommandEnvelope,
  type CommandReceipt,
} from "../../../../shared/applicationCommand.ts";
import type { Entity } from "../../../../shared/types/workspace.ts";
import { SqliteTaskRepository } from "../infrastructure/sqliteTaskRepository.ts";
import type { WorkspaceTaskPersistence } from "../ports/taskRepository.ts";
import { TaskQueryHandler } from "./taskQueryHandler.ts";

export type ExecuteApplicationCommand = (command: CommandEnvelope) => CommandReceipt;

const sourceMap: Record<TaskCommand["source"], ApplicationCommandSource> = {
  desktop: "main_ui",
  mobile: "mobile",
  http: "inbox",
  mcp: "mcp",
  system: "inbox",
};

function applicationSource(command: TaskCommand): ApplicationCommandSource {
  return command.source === "desktop" && command.entrypoint ? command.entrypoint : sourceMap[command.source];
}

function taskError(
  code: TaskError["code"],
  message: string,
  details?: Record<string, unknown>,
  conflictReason?: TaskConflictReason,
): TaskError {
  return {
    code,
    message,
    issues: [],
    retryable: false,
    ...(conflictReason ? { conflict_reason: conflictReason } : {}),
    ...(details ? { details } : {}),
  };
}

function structuredConflictReason(error: ApplicationCommandError): TaskConflictReason | undefined {
  const reason = error.details?.conflictReason;
  if (
    reason === "command_fingerprint_mismatch"
    || reason === "entity_already_exists"
    || reason === "version_conflict"
    || reason === "other_conflict"
  ) return reason;
  if (error.code === "COMMAND_ID_REUSED") return "command_fingerprint_mismatch";
  if (error.code !== "CONFLICT") return undefined;
  return "other_conflict";
}

function projectSchedule(entity: Entity | null): TaskScheduleReadModel | null {
  if (!entity) return null;
  const projection = Object.fromEntries(
    Object.keys(taskScheduleReadModelSchema.shape)
      .filter((key) => Object.prototype.hasOwnProperty.call(entity, key))
      .map((key) => [key, entity[key]]),
  );
  return taskScheduleReadModelSchema.parse({
    ...projection,
    start_date: entity.start_date || null,
    end_date: entity.end_date || null,
    range_semantics: entity.range_semantics || null,
  });
}

function projectTask(entity: Entity, schedule: Entity | null): TaskReadModel {
  const projection = Object.fromEntries(
    Object.keys(taskReadModelSchema.shape)
      .filter((key) => key !== "schedule" && Object.prototype.hasOwnProperty.call(entity, key))
      .map((key) => [key, entity[key]]),
  );
  return taskReadModelSchema.parse({ ...projection, schedule: projectSchedule(schedule) });
}

function expectedVersions(
  command: Exclude<TaskCommand, { name: "CreateTask" }>,
  currentSchedule: Entity | null,
) {
  const versions: Array<{ type: "task" | "schedule"; id: string; version: number }> = [
    { type: "task", id: command.payload.task_id, version: command.payload.expected_version },
  ];
  if (command.name === "UpdateTask" && command.payload.schedule_change?.expected_version !== null
    && command.payload.schedule_change?.expected_version !== undefined) {
    versions.push({
      type: "schedule",
      id: String(currentSchedule?.id || command.command_id),
      version: command.payload.schedule_change.expected_version,
    });
  }
  return versions;
}

function materializedTask(
  command: Exclude<TaskCommand, { name: "CreateTask" | "DeleteTask" }>,
  current: Entity | null,
  changes: Record<string, unknown>,
): Entity {
  return {
    ...current,
    ...changes,
    id: command.payload.task_id,
    version: command.payload.expected_version,
    updated_at: command.issued_at,
  };
}

function materializedSchedule(
  command: Extract<TaskCommand, { name: "UpdateTask" }>,
  current: Entity | null,
): Entity | null {
  const change = command.payload.schedule_change;
  if (!change) return null;
  return {
    ...current,
    ...change.changes,
    id: current?.id || command.command_id,
    owner_type: "task",
    owner_id: command.payload.task_id,
    version: change.expected_version || 0,
    updated_at: command.issued_at,
  };
}

function applicationEnvelope(command: TaskCommand, current: Entity | null, currentSchedule: Entity | null): CommandEnvelope {
  const base = {
    commandId: command.command_id,
    name: command.name,
    actor: command.actor,
    source: applicationSource(command),
    issuedAt: command.issued_at,
  } as const;

  if (command.name === "CreateTask") return { ...base, payload: { task: command.payload.task } };
  if (command.name === "UpdateTask") {
    const schedule = materializedSchedule(command, currentSchedule);
    return {
      ...base,
      payload: {
        task: materializedTask(command, current, command.payload.changes || {}),
        ...(schedule ? { schedule } : {}),
      },
      expectedVersions: expectedVersions(command, currentSchedule),
    };
  }
  if (command.name === "CompleteTask") {
    return {
      ...base,
      payload: {
        taskId: command.payload.task_id,
        completionNote: command.payload.completion_note,
        ...(command.payload.changes ? { task: materializedTask(command, current, command.payload.changes) } : {}),
      },
      expectedVersions: expectedVersions(command, currentSchedule),
    };
  }
  if (command.name === "ReopenTask") {
    return {
      ...base,
      payload: {
        taskId: command.payload.task_id,
        ...(command.payload.changes ? { task: materializedTask(command, current, command.payload.changes) } : {}),
      },
      expectedVersions: expectedVersions(command, currentSchedule),
    };
  }
  return {
    ...base,
    payload: { taskId: command.payload.task_id },
    expectedVersions: expectedVersions(command, currentSchedule),
  };
}

function eventSnapshot(event: Entity | undefined, field: "before_json" | "after_json"): Entity | null | undefined {
  if (!event) return undefined;
  const serialized = event[field];
  if (serialized === null) return null;
  if (typeof serialized !== "string") return undefined;
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Entity : undefined;
  } catch {
    return undefined;
  }
}

function replayApplicationEnvelope(
  persistence: WorkspaceTaskPersistence,
  command: TaskCommand,
): CommandEnvelope | null {
  const events = persistence.list("change_event", true)
    .filter((event) => event.command_id === command.command_id);
  if (events.length === 0) return null;

  const taskEvent = events.find((event) => event.record_type === "task");
  const scheduleEvent = events.find((event) => event.record_type === "schedule");
  const taskBefore = eventSnapshot(taskEvent, "before_json");
  const scheduleBefore = eventSnapshot(scheduleEvent, "before_json");
  if (taskBefore === undefined || (scheduleEvent && scheduleBefore === undefined)) return null;

  if (command.name === "CreateTask") return applicationEnvelope(command, null, null);
  if (!taskBefore || !Number.isInteger(taskBefore.version)) return null;
  const replayCommand: TaskCommand = command.name === "UpdateTask"
    ? {
        ...command,
        payload: {
          ...command.payload,
          expected_version: Number(taskBefore.version),
          ...(command.payload.schedule_change
            ? {
                schedule_change: {
                  ...command.payload.schedule_change,
                  expected_version: scheduleBefore && Number.isInteger(scheduleBefore.version)
                    ? Number(scheduleBefore.version)
                    : null,
                },
              }
            : {}),
        },
      }
    : {
        ...command,
        payload: { ...command.payload, expected_version: Number(taskBefore.version) },
      };
  return applicationEnvelope(replayCommand, taskBefore, scheduleBefore || null);
}

function mergeNonOverlappingUpdate(command: TaskCommand, current: Entity | null): TaskCommand {
  if (command.name !== "UpdateTask" || !current) return command;
  if (Number(current.version) === command.payload.expected_version) return command;
  const changes = command.payload.changes;
  if (!changes) {
    return { ...command, payload: { ...command.payload, expected_version: Number(current.version) } };
  }
  if (!command.payload.base) return command;
  const canMerge = Object.keys(changes).every((key) => {
    const currentValue = current[key];
    const baseValue = command.payload.base?.[key as keyof typeof command.payload.base];
    const intendedValue = changes[key as keyof typeof changes];
    return JSON.stringify(currentValue) === JSON.stringify(baseValue)
      || JSON.stringify(currentValue) === JSON.stringify(intendedValue);
  });
  if (!canMerge) return command;
  return {
    ...command,
    payload: { ...command.payload, expected_version: Number(current.version) },
  };
}

function eventFor(command: TaskCommand, receipt: CommandReceipt, task: TaskReadModel): TaskEvent | null {
  if (receipt.status === "no_change") return null;
  const eventBase = {
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    event_id: receipt.events[0] || command.command_id,
    task_id: task.id,
    task_version: task.version,
    occurred_at: command.issued_at,
    actor: command.actor,
    task,
  } as const;
  if (command.name === "CreateTask") return taskEventSchema.parse({ ...eventBase, name: "TaskCreated" });
  if (command.name === "CompleteTask") return taskEventSchema.parse({ ...eventBase, name: "TaskCompleted" });
  if (command.name === "ReopenTask") return taskEventSchema.parse({ ...eventBase, name: "TaskReopened" });
  if (command.name === "DeleteTask") {
    return taskEventSchema.parse({ ...eventBase, name: "TaskDeleted", deleted_at: task.deleted_at || command.issued_at });
  }
  return taskEventSchema.parse({
    ...eventBase,
    name: "TaskUpdated",
    changed_fields: [
      ...Object.keys(command.payload.changes || {}),
      ...(command.payload.schedule_change ? ["schedule"] : []),
    ],
  });
}

function mappedApplicationError(error: unknown): TaskError {
  if (error instanceof ApplicationCommandError) {
    const code = error.code === "NOT_FOUND" || error.code === "CONFLICT" || error.code === "INVALID_TRANSITION"
      ? error.code
      : error.code === "COMMAND_ID_REUSED"
        ? "CONFLICT"
        : "INVALID_COMMAND";
    return taskError(code, error.message, error.details, structuredConflictReason(error));
  }
  return taskError("INTERNAL_ERROR", "Task処理を完了できませんでした。再読み込みして再試行してください。");
}

/** Transport-neutral Task use-case entrypoint shared by IPC, HTTP, and MCP adapters. */
export class TaskCapabilityService {
  private readonly queries: TaskQueryHandler;
  private readonly executeApplicationCommand: ExecuteApplicationCommand;
  private readonly persistence: WorkspaceTaskPersistence;

  constructor(persistence: WorkspaceTaskPersistence, executeApplicationCommand: ExecuteApplicationCommand) {
    this.persistence = persistence;
    this.queries = new TaskQueryHandler(new SqliteTaskRepository(persistence));
    this.executeApplicationCommand = executeApplicationCommand;
  }

  executeCommand(input: unknown): TaskCommandResponse {
    const parsed = parseTaskCommand(input);
    if (!parsed.ok) return parsed;
    let command = parsed.value;
    const taskId = command.name === "CreateTask" ? command.payload.task.id : command.payload.task_id;
    try {
      const replayEnvelope = replayApplicationEnvelope(this.persistence, command);
      if (replayEnvelope) {
        const receipt = this.executeApplicationCommand(replayEnvelope);
        const changed = receipt.changes.find((change) => change.type === "task")?.entity
          || this.queries.getTask(taskId, true);
        if (!changed) return { ok: false, error: taskError("NOT_FOUND", "Taskが見つかりません。") };
        const task = projectTask(changed, this.queries.getTaskSchedule(taskId));
        return {
          ok: true,
          value: taskCommandOutcomeSchema.parse({
            schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
            command_id: command.command_id,
            name: command.name,
            status: receipt.status,
            task,
            event: eventFor(command, receipt, task),
          }),
        };
      }
      const current = this.queries.getTask(taskId, true);
      if (command.name === "UpdateTask" && !current) return { ok: false, error: taskError("NOT_FOUND", "更新対象のTaskがありません。") };
      const currentSchedule = current ? this.queries.getTaskSchedule(taskId) : null;
      if (
        command.name === "UpdateTask"
        && command.payload.schedule_change
        && (command.payload.schedule_change.base !== null) !== (currentSchedule !== null)
      ) {
        return {
          ok: false,
          error: taskError(
            "CONFLICT",
            "Scheduleが更新されています。再読み込みしてください。",
            current ? { current_task: projectTask(current, currentSchedule) } : undefined,
            "version_conflict",
          ),
        };
      }
      command = mergeNonOverlappingUpdate(command, current);
      const receipt = this.executeApplicationCommand(applicationEnvelope(command, current, currentSchedule));
      if (receipt.status === "conflict") {
        const currentTask = this.queries.getTask(taskId, true);
        const latestSchedule = currentTask ? this.queries.getTaskSchedule(taskId) : null;
        return {
          ok: false,
          error: taskError(
            "CONFLICT",
            "Taskが更新されています。再読み込みしてください。",
            currentTask ? { current_task: projectTask(currentTask, latestSchedule) } : undefined,
            "version_conflict",
          ),
        };
      }
      const changed = receipt.changes.find((change) => change.type === "task")?.entity
        || this.queries.getTask(taskId, true);
      if (!changed) return { ok: false, error: taskError("NOT_FOUND", "Taskが見つかりません。") };
      const task = projectTask(changed, this.queries.getTaskSchedule(taskId));
      const outcome: TaskCommandOutcome = {
        schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
        command_id: command.command_id,
        name: command.name,
        status: receipt.status,
        task,
        event: eventFor(command, receipt, task),
      };
      return { ok: true, value: taskCommandOutcomeSchema.parse(outcome) };
    } catch (error) {
      const mapped = mappedApplicationError(error);
      if (mapped.code === "CONFLICT" && mapped.conflict_reason === "version_conflict") {
        const currentTask = this.queries.getTask(taskId, true);
        if (currentTask) {
          mapped.details = {
            ...mapped.details,
            current_task: projectTask(currentTask, this.queries.getTaskSchedule(taskId)),
          };
        }
      }
      return { ok: false, error: mapped };
    }
  }

  executeQuery(input: unknown): TaskQueryResponse {
    const parsed = parseTaskQuery(input);
    if (!parsed.ok) return parsed;
    try {
      const result = this.query(parsed.value);
      return { ok: true, value: taskQueryResultSchema.parse(result) };
    } catch {
      return { ok: false, error: taskError("INTERNAL_ERROR", "Taskを読み込めませんでした。再試行してください。") };
    }
  }

  private query(query: TaskQuery) {
    if (query.name === "GetTask") {
      const task = this.queries.getTask(query.parameters.task_id, query.parameters.include_deleted);
      return {
        schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
        query_id: query.query_id,
        name: "GetTask" as const,
        task: task ? projectTask(task, this.queries.getTaskSchedule(task.id)) : null,
      };
    }

    if (query.name === "ListTaskChanges") {
      const cursor = query.parameters.cursor || "";
      const filtered = this.queries.listTasks(true)
        .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)) || String(left.id).localeCompare(String(right.id)))
        .filter((task) => `${String(task.updated_at)}|${String(task.id)}` > cursor);
      const page = filtered.slice(0, query.parameters.limit);
      const nextCursor = page.length > 0
        ? `${String(page.at(-1)?.updated_at)}|${String(page.at(-1)?.id)}`
        : query.parameters.cursor || null;
      return {
        schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
        query_id: query.query_id,
        name: "ListTaskChanges" as const,
        items: page.map((task) => projectTask(task, this.queries.getTaskSchedule(task.id))),
        next_cursor: nextCursor,
        has_more: filtered.length > page.length,
      };
    }

    const filtered = this.queries.listTasks(query.name === "ListTasks" ? query.parameters.include_deleted : false)
      .filter((task) => query.parameters.project_id === undefined || task.project_id === query.parameters.project_id)
      .filter((task) => !query.parameters.states?.length || query.parameters.states.includes(task.state as never))
      .filter((task) => query.name !== "ListTodayTasks" || task.today_date === query.parameters.date)
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)) || String(left.id).localeCompare(String(right.id)));
    const cursorIndex = query.parameters.cursor
      ? filtered.findIndex((task) => task.id === query.parameters.cursor)
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = filtered.slice(start, start + query.parameters.limit);
    return {
      schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
      query_id: query.query_id,
      name: query.name,
      ...(query.name === "ListTodayTasks" ? { date: query.parameters.date } : {}),
      items: page.map((task) => projectTask(task, this.queries.getTaskSchedule(task.id))),
      next_cursor: start + page.length < filtered.length ? String(page.at(-1)?.id || "") : null,
    };
  }
}
