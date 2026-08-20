import * as z from "zod/v4";

import {
  completeTaskCommandSchema,
  createTaskCommandSchema,
  deleteTaskCommandSchema,
  getTaskQuerySchema,
  listTodayTasksQuerySchema,
  reopenTaskCommandSchema,
  updateTaskCommandSchema,
  type TaskCommandResponse,
  type TaskQueryResponse,
} from "../../../../../shared/contracts/task/public.ts";
import type { TaskCapabilityService } from "../../application/taskCapabilityService.ts";

export interface TaskMcpPolicy {
  allowDirectWrites: boolean;
}

const operationSchemas = {
  "task.create": createTaskCommandSchema,
  "task.update": updateTaskCommandSchema,
  "task.delete": deleteTaskCommandSchema,
  "task.complete": completeTaskCommandSchema,
  "task.reopen": reopenTaskCommandSchema,
  "task.get": getTaskQuerySchema,
  "task.list_today": listTodayTasksQuerySchema,
} as const;

export type TaskMcpOperation = keyof typeof operationSchemas;

const writeOperations = new Set<TaskMcpOperation>([
  "task.create",
  "task.update",
  "task.delete",
  "task.complete",
  "task.reopen",
]);

/** Stable discovery metadata for MCP tool registration and AI-agent planning. */
export const TASK_MCP_OPERATIONS = Object.freeze(
  (Object.entries(operationSchemas) as Array<[TaskMcpOperation, z.ZodType]>).map(([name, schema]) => ({
    name,
    access: writeOperations.has(name) ? "proposal_only_by_default" as const : "read" as const,
    idempotency: writeOperations.has(name) ? "command_id must remain stable across retries" : "not_applicable",
    concurrency: ["task.update", "task.delete", "task.complete", "task.reopen"].includes(name)
      ? "expected_version is required; CONFLICT requires query and deliberate retry"
      : "not_applicable",
    inputSchema: z.toJSONSchema(schema, { target: "draft-7" }),
  })),
);

function forbidden(): TaskCommandResponse {
  return {
    ok: false,
    error: {
      code: "FORBIDDEN",
      message: "MCPからのTask書き込みはProposal経由で確認してください。",
      issues: [],
      retryable: false,
    },
  };
}

/** MCP exposes named operations; direct writes remain proposal-only unless explicitly enabled. */
export function createTaskMcpAdapter(service: TaskCapabilityService, policy: TaskMcpPolicy = { allowDirectWrites: false }) {
  return {
    operations: TASK_MCP_OPERATIONS,
    invoke(operation: TaskMcpOperation, input: unknown): TaskCommandResponse | TaskQueryResponse {
      if (!Object.prototype.hasOwnProperty.call(operationSchemas, operation)) {
        return {
          ok: false,
          error: { code: "INVALID_COMMAND", message: `未対応のTask operationです: ${String(operation)}`, issues: [], retryable: false },
        };
      }
      const parsed = operationSchemas[operation].safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: writeOperations.has(operation) ? "INVALID_COMMAND" : "INVALID_QUERY",
            message: `${operation}の入力がschemaに適合しません。`,
            issues: parsed.error.issues.map((issue) => ({
              code: issue.code,
              path: issue.path.map((segment) => typeof segment === "number" ? segment : String(segment)),
              message: issue.message,
            })),
            retryable: false,
          },
        };
      }
      if (writeOperations.has(operation)) {
        if (!policy.allowDirectWrites) return forbidden();
        return service.executeCommand(parsed.data);
      }
      return service.executeQuery(parsed.data);
    },
  };
}
