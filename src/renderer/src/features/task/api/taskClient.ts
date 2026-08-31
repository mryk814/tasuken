import {
  TASK_CONTRACT_SCHEMA_VERSION,
  completeTaskCommandSchema,
  createTaskCommandSchema,
  deleteTaskCommandSchema,
  getTaskQuerySchema,
  listTodayTasksQuerySchema,
  reopenTaskCommandSchema,
  taskDraftSchema,
  taskPatchSchema,
  updateTaskCommandSchema,
  type TaskCapability,
  type TaskCommandOutcome,
  type TaskCommandResponse,
  type TaskCommandActor,
  type TaskCommandEntrypoint,
  type TaskDraft,
  type TaskError,
  type TaskEvent,
  type TaskPatch,
  type TaskReadModel,
  type TaskState,
} from "../../../../../shared/contracts/task/public";

export interface TaskMutationContext {
  /** Stable across retries. Reusing it with different input returns CONFLICT. */
  commandId: string;
  issuedAt: string;
  actor?: TaskCommandActor;
  entrypoint?: TaskCommandEntrypoint;
}

export interface ListTodayTaskOptions {
  date: string;
  queryId: string;
  projectId?: string | null;
  states?: TaskState[];
  cursor?: string | null;
  limit?: number;
}

export interface TaskChange {
  event: TaskEvent;
  task: TaskReadModel;
  /** True when a task_version gap caused a canonical GetTask query before delivery. */
  resynced: boolean;
}

export type TaskEditPlan =
  | { name: "CreateTask"; expectedVersion: null }
  | { name: "UpdateTask" | "CompleteTask" | "ReopenTask"; expectedVersion: number };

/**
 * Chooses the Task lifecycle command from the persisted and proposed states.
 * Composite Application Commands reuse this plan while retaining their Schedule/Reference payloads.
 */
export function planTaskEdit(
  task: { state: unknown },
  previous: Pick<TaskReadModel, "state" | "version"> | null,
): TaskEditPlan {
  if (!previous) return { name: "CreateTask", expectedVersion: null };
  if (previous.state !== "done" && task.state === "done") {
    return { name: "CompleteTask", expectedVersion: previous.version };
  }
  if (previous.state === "done" && task.state !== "done") {
    return { name: "ReopenTask", expectedVersion: previous.version };
  }
  return { name: "UpdateTask", expectedVersion: previous.version };
}

export class TaskClientError extends Error {
  readonly code: TaskError["code"];
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(error: TaskError) {
    super(error.message);
    this.name = "TaskClientError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

function mutationBase(context: TaskMutationContext) {
  return {
    schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
    command_id: context.commandId,
    actor: context.actor || { kind: "user" as const },
    source: "desktop" as const,
    entrypoint: context.entrypoint,
    issued_at: context.issuedAt,
  };
}

function outcome<T>(response: { ok: true; value: T } | { ok: false; error: TaskError }): T {
  if (!response.ok) throw new TaskClientError(response.error);
  return response.value;
}

/** Renderer-owned typed Task client. Feature code never handles IPC names or unknown payloads. */
export function createTaskClient(capability: TaskCapability) {
  const versions = new Map<string, number>();
  const remember = (task: TaskReadModel | null) => {
    if (task) versions.set(task.id, task.version);
    return task;
  };
  const run = async (request: Promise<TaskCommandResponse>): Promise<TaskCommandOutcome> => {
    const value = outcome(await request);
    remember(value.task);
    return value;
  };

  const get = async (taskId: string, queryId: string, includeDeleted = false) => {
    const value = outcome(await capability.get(getTaskQuerySchema.parse({
      schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
      query_id: queryId,
      name: "GetTask",
      parameters: { task_id: taskId, include_deleted: includeDeleted },
    })));
    return remember(value.task);
  };

  const client = {
    applyEdit(
      task: TaskDraft,
      previous: Pick<TaskReadModel, "state" | "version"> | null,
      context: TaskMutationContext,
    ): Promise<TaskCommandOutcome> {
      const { id, ...changes } = task;
      const plan = planTaskEdit(task, previous);
      if (plan.name === "CreateTask") return client.create(task, context);
      if (plan.name === "CompleteTask") {
        return client.complete(id, plan.expectedVersion, task.completion_note, changes, context);
      }
      if (plan.name === "ReopenTask") {
        return client.reopen(id, plan.expectedVersion, changes, context);
      }
      return client.update(id, plan.expectedVersion, changes, context);
    },
    create(task: TaskDraft, context: TaskMutationContext) {
      return run(capability.create(createTaskCommandSchema.parse({
        ...mutationBase(context),
        name: "CreateTask",
        payload: { task: taskDraftSchema.parse(task) },
      })));
    },
    update(taskId: string, expectedVersion: number, changes: TaskPatch, context: TaskMutationContext) {
      return run(capability.update(updateTaskCommandSchema.parse({
        ...mutationBase(context),
        name: "UpdateTask",
        payload: { task_id: taskId, expected_version: expectedVersion, changes: taskPatchSchema.parse(changes) },
      })));
    },
    delete(taskId: string, expectedVersion: number, context: TaskMutationContext) {
      return run(capability.delete(deleteTaskCommandSchema.parse({
        ...mutationBase(context),
        name: "DeleteTask",
        payload: { task_id: taskId, expected_version: expectedVersion },
      })));
    },
    complete(taskId: string, expectedVersion: number, completionNote: TaskDraft["completion_note"], changes: TaskPatch, context: TaskMutationContext) {
      return run(capability.complete(completeTaskCommandSchema.parse({
        ...mutationBase(context),
        name: "CompleteTask",
        payload: { task_id: taskId, expected_version: expectedVersion, completion_note: completionNote, changes: taskPatchSchema.parse(changes) },
      })));
    },
    reopen(taskId: string, expectedVersion: number, changes: TaskPatch, context: TaskMutationContext) {
      return run(capability.reopen(reopenTaskCommandSchema.parse({
        ...mutationBase(context),
        name: "ReopenTask",
        payload: { task_id: taskId, expected_version: expectedVersion, changes: taskPatchSchema.parse(changes) },
      })));
    },
    get,
    async listToday(options: ListTodayTaskOptions) {
      const value = outcome(await capability.listToday(listTodayTasksQuerySchema.parse({
        schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
        query_id: options.queryId,
        name: "ListTodayTasks",
        parameters: {
          date: options.date,
          project_id: options.projectId,
          states: options.states,
          cursor: options.cursor,
          limit: options.limit || 50,
        },
      })));
      for (const task of value.items) remember(task);
      return value;
    },
    subscribe(callback: (change: TaskChange) => void, onError: (error: Error) => void = (error) => {
      console.error("Task eventの再同期に失敗しました。", error);
    }) {
      let queue = Promise.resolve();
      return capability.subscribe((event) => {
        queue = queue.then(async () => {
          const knownVersion = versions.get(event.task_id);
          const hasGap = knownVersion !== undefined && event.task_version > knownVersion + 1;
          const canonical = hasGap
            ? await get(event.task_id, `resync:${event.event_id}`, true)
            : remember(event.task);
          callback({ event, task: canonical || event.task, resynced: hasGap });
        }).catch((error: unknown) => {
          onError(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
  };
  return client;
}

export function projectTaskDraft(value: Record<string, unknown>): TaskDraft {
  const projection = Object.fromEntries(
    Object.keys(taskDraftSchema.shape)
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, value[key]]),
  );
  return taskDraftSchema.parse(projection);
}
