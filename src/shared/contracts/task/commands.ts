import * as z from "zod/v4";

import { entityIdSchema, entityVersionSchema, isoTimestampSchema, type Result } from "../../kernel/public.ts";
import { taskDraftSchema, taskIdSchema, taskPatchSchema } from "./model.ts";
import { parseTaskContract, taskContractSchemaVersionSchema } from "./version.ts";
import type { TaskError } from "./errors.ts";

export const taskCommandActorSchema = z.object({
  kind: z.enum(["user", "system", "ai_agent"]),
  id: entityIdSchema.optional(),
}).strict();

export const taskCommandSourceSchema = z.enum(["desktop", "mobile", "http", "mcp", "system"]);
export const taskCommandEntrypointSchema = z.enum(["main_ui", "today_window", "quick_capture", "inbox", "command_palette", "tasken_root", "mcp"]);

const commandBase = {
  schemaVersion: taskContractSchemaVersionSchema,
  command_id: entityIdSchema,
  actor: taskCommandActorSchema,
  source: taskCommandSourceSchema,
  entrypoint: taskCommandEntrypointSchema.optional(),
  issued_at: isoTimestampSchema,
};

export const createTaskCommandSchema = z.object({
  ...commandBase,
  name: z.literal("CreateTask"),
  payload: z.object({ task: taskDraftSchema }).strict(),
}).strict();

export const updateTaskCommandSchema = z.object({
  ...commandBase,
  name: z.literal("UpdateTask"),
  payload: z.object({
    task_id: taskIdSchema,
    expected_version: entityVersionSchema,
    changes: taskPatchSchema,
  }).strict(),
}).strict();

export const deleteTaskCommandSchema = z.object({
  ...commandBase,
  name: z.literal("DeleteTask"),
  payload: z.object({
    task_id: taskIdSchema,
    expected_version: entityVersionSchema,
  }).strict(),
}).strict();

export const completeTaskCommandSchema = z.object({
  ...commandBase,
  name: z.literal("CompleteTask"),
  payload: z.object({
    task_id: taskIdSchema,
    expected_version: entityVersionSchema,
    completion_note: z.string().max(10000).nullable().optional(),
    changes: taskPatchSchema.optional(),
  }).strict(),
}).strict();

export const reopenTaskCommandSchema = z.object({
  ...commandBase,
  name: z.literal("ReopenTask"),
  payload: z.object({
    task_id: taskIdSchema,
    expected_version: entityVersionSchema,
    changes: taskPatchSchema.optional(),
  }).strict(),
}).strict();

export const taskCommandSchema = z.discriminatedUnion("name", [
  createTaskCommandSchema,
  updateTaskCommandSchema,
  deleteTaskCommandSchema,
  completeTaskCommandSchema,
  reopenTaskCommandSchema,
]);

export type TaskCommandActor = z.output<typeof taskCommandActorSchema>;
export type TaskCommandSource = z.output<typeof taskCommandSourceSchema>;
export type TaskCommandEntrypoint = z.output<typeof taskCommandEntrypointSchema>;
export type CreateTaskCommand = z.output<typeof createTaskCommandSchema>;
export type UpdateTaskCommand = z.output<typeof updateTaskCommandSchema>;
export type DeleteTaskCommand = z.output<typeof deleteTaskCommandSchema>;
export type CompleteTaskCommand = z.output<typeof completeTaskCommandSchema>;
export type ReopenTaskCommand = z.output<typeof reopenTaskCommandSchema>;
export type TaskCommand = z.output<typeof taskCommandSchema>;

export function parseTaskCommand(value: unknown): Result<TaskCommand, TaskError> {
  return parseTaskContract(taskCommandSchema, value, "INVALID_COMMAND");
}
