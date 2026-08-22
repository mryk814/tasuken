import * as z from "zod/v4";

import { parseVersionedWithSchema, type Result } from "../../kernel/public.ts";
import { taskErrorCodeSchema, taskErrorSchema, type TaskError, type TaskErrorCode } from "./errors.ts";

export const TASK_CONTRACT_SCHEMA_VERSION = 2 as const;
export const taskContractSchemaVersionSchema = z.literal(TASK_CONTRACT_SCHEMA_VERSION);

/**
 * v2 adds the independently versioned canonical Schedule projection.
 * There is no legacy transport migration: all in-repository clients update in lockstep.
 * Persisted Workspace/SQLite migration remains outside this boundary.
 */
export function parseTaskContract<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  invalidCode: Extract<TaskErrorCode, "INVALID_COMMAND" | "INVALID_QUERY" | "INVALID_EVENT" | "INVALID_READ_MODEL">,
): Result<z.output<TSchema>, TaskError> {
  const result = parseVersionedWithSchema(schema, value, TASK_CONTRACT_SCHEMA_VERSION, invalidCode);
  if (result.ok) return result;
  const parsedCode = taskErrorCodeSchema.safeParse(result.error.code);
  return {
    ok: false,
    error: taskErrorSchema.parse({
      ...result.error,
      code: parsedCode.success ? parsedCode.data : invalidCode,
    }),
  };
}
