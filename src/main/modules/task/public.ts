import type { Entity } from "../../../shared/types/workspace.ts";
import type { WorkspaceTaskPersistence } from "./ports/taskRepository.ts";
import { SqliteTaskRepository } from "./infrastructure/sqliteTaskRepository.ts";
import { TaskCommandHandler, type TaskCommandRuntime } from "./application/taskCommandHandler.ts";
import { TaskQueryHandler } from "./application/taskQueryHandler.ts";

export {
  TaskCapabilityService,
  projectTaskReadModel,
  type ExecuteApplicationCommand,
} from "./application/taskCapabilityService.ts";
export {
  createTaskHttpAdapter,
  type TaskHttpRequest,
  type TaskHttpResponse,
} from "./transport/http/taskHttpAdapter.ts";
export {
  createTaskMcpAdapter,
  TASK_MCP_OPERATIONS,
  type TaskMcpOperation,
  type TaskMcpPolicy,
} from "./transport/mcp/taskMcpAdapter.ts";
export { registerTaskIpc, type TaskIpcHost } from "./transport/ipc/registerTaskIpc.ts";

export { normalizeTaskAssignment } from "./domain/taskAssignment.ts";

export type { TaskCommandRuntime } from "./application/taskCommandHandler.ts";
export type {
  TaskEntityAccess,
  TaskRepository,
  WorkspaceTaskPersistence,
} from "./ports/taskRepository.ts";

export {
  assertHumanAcceptBeforeTaskCompletion,
  assertTaskThemeExists,
  currentTaskWorkState,
  normalizeCanonicalTask,
  normalizeTaskForSave,
  taskChangeType,
  taskFromPayload,
  taskIdFromPayload,
  taskReferenceOperations,
  validateTaskScheduleWrite,
} from "./application/taskPolicy.ts";

export function createTaskModule(
  persistence: WorkspaceTaskPersistence,
  runtime: TaskCommandRuntime,
) {
  const repository = new SqliteTaskRepository(persistence);
  return {
    commands: new TaskCommandHandler(repository, runtime),
    queries: new TaskQueryHandler(repository),
  };
}

export function saveTaskAssignmentForWorkStart(
  persistence: WorkspaceTaskPersistence,
  task: Entity,
) {
  return new SqliteTaskRepository(persistence).saveTaskAssignmentForWorkStart(task);
}
