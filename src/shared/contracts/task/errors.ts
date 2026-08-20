import * as z from "zod/v4";

import { contractIssueSchema } from "../../kernel/public.ts";

export const taskErrorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "INVALID_QUERY",
  "INVALID_EVENT",
  "INVALID_READ_MODEL",
  "UNSUPPORTED_SCHEMA_VERSION",
  "UNSUPPORTED_FUTURE_SCHEMA_VERSION",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_TRANSITION",
  "FORBIDDEN",
  "UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const taskConflictReasonSchema = z.enum([
  "command_fingerprint_mismatch",
  "entity_already_exists",
  "version_conflict",
  "other_conflict",
]);

export const taskErrorSchema = z.object({
  code: taskErrorCodeSchema,
  message: z.string().trim().min(1),
  issues: z.array(contractIssueSchema).default([]),
  retryable: z.boolean().default(false),
  conflict_reason: taskConflictReasonSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type TaskErrorCode = z.output<typeof taskErrorCodeSchema>;
export type TaskConflictReason = z.output<typeof taskConflictReasonSchema>;
export type TaskError = z.output<typeof taskErrorSchema>;
