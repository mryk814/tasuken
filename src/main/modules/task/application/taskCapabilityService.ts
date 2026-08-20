import {
  TASK_CONTRACT_SCHEMA_VERSION,
  parseTaskCommand,
  parseTaskQuery,
  taskCommandOutcomeSchema,
  taskEventSchema,
  taskQueryResultSchema,
  taskReadModelSchema,
  type TaskCommand,
  type TaskCommandOutcome,
  type TaskCommandResponse,
  type TaskConflictReason,
  type TaskError,
  type TaskEvent,
  type TaskQuery,
  type TaskQueryResponse,
  type TaskReadModel,
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
  if (error.code === "COMMAND_ID_REUSED") return "command_fingerprint_mismatch";
  if (error.code !== "CONFLICT") return undefined;
  const reason = error.details?.conflictReason;
  if (
    reason === "command_fingerprint_mismatch"
    || reason === "entity_already_exists"
    || reason === "version_conflict"
    || reason === "other_conflict"
  ) return reason;
  return "other_conflict";
}

function projectTask(entity: Entity): TaskReadModel {
  const projection = Object.fromEntries(
    Object.keys(taskReadModelSchema.shape)
      .filter((key) => Object.prototype.hasOwnProperty.call(entity, key))
      .map((key) => [key, entity[key]]),
  );
  return taskReadModelSchema.parse(projection);
}

function expectedVersion(command: Exclude<TaskCommand, { name: "CreateTask" }>) {
  return [{ type: "task" as const, id: command.payload.task_id, version: command.payload.expected_version }];
}

function applicationEnvelope(command: TaskCommand, current: Entity | null): CommandEnvelope {
  const base = {
    commandId: command.command_id,
    name: command.name,
    actor: command.actor,
    source: applicationSource(command),
    issuedAt: command.issued_at,
  } as const;

  if (command.name === "CreateTask") return { ...base, payload: { task: command.payload.task } };
  if (command.name === "UpdateTask") {
    return {
      ...base,
      payload: { task: { ...current, ...command.payload.changes, id: command.payload.task_id } },
      expectedVersions: expectedVersion(command),
    };
  }
  if (command.name === "CompleteTask") {
    return {
      ...base,
      payload: {
        taskId: command.payload.task_id,
        completionNote: command.payload.completion_note,
        ...(command.payload.changes ? { task: { ...current, ...command.payload.changes, id: command.payload.task_id } } : {}),
      },
      expectedVersions: expectedVersion(command),
    };
  }
  if (command.name === "ReopenTask") {
    return {
      ...base,
      payload: {
        taskId: command.payload.task_id,
        ...(command.payload.changes ? { task: { ...current, ...command.payload.changes, id: command.payload.task_id } } : {}),
      },
      expectedVersions: expectedVersion(command),
    };
  }
  return {
    ...base,
    payload: { taskId: command.payload.task_id },
    expectedVersions: expectedVersion(command),
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
  return taskEventSchema.parse({ ...eventBase, name: "TaskUpdated", changed_fields: Object.keys(command.payload.changes) });
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

  constructor(persistence: WorkspaceTaskPersistence, executeApplicationCommand: ExecuteApplicationCommand) {
    this.queries = new TaskQueryHandler(new SqliteTaskRepository(persistence));
    this.executeApplicationCommand = executeApplicationCommand;
  }

  executeCommand(input: unknown): TaskCommandResponse {
    const parsed = parseTaskCommand(input);
    if (!parsed.ok) return parsed;
    const command = parsed.value;
    try {
      const taskId = command.name === "CreateTask" ? command.payload.task.id : command.payload.task_id;
      const current = this.queries.getTask(taskId, true);
      if (command.name === "UpdateTask" && !current) return { ok: false, error: taskError("NOT_FOUND", "更新対象のTaskがありません。") };
      const receipt = this.executeApplicationCommand(applicationEnvelope(command, current));
      if (receipt.status === "conflict") {
        return { ok: false, error: taskError("CONFLICT", "Taskが更新されています。再読み込みしてください。", undefined, "version_conflict") };
      }
      const changed = receipt.changes.find((change) => change.type === "task")?.entity
        || this.queries.getTask(taskId, true);
      if (!changed) return { ok: false, error: taskError("NOT_FOUND", "Taskが見つかりません。") };
      const task = projectTask(changed);
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
      return { ok: false, error: mappedApplicationError(error) };
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
        task: task ? projectTask(task) : null,
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
      items: page.map(projectTask),
      next_cursor: start + page.length < filtered.length ? String(page.at(-1)?.id || "") : null,
    };
  }
}
