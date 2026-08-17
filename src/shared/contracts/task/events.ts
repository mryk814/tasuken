import * as z from "zod/v4";

import { entityIdSchema, entityVersionSchema, isoTimestampSchema, type Result } from "../../kernel/public.ts";
import { taskCommandActorSchema } from "./commands.ts";
import type { TaskError } from "./errors.ts";
import { taskIdSchema, taskReadModelSchema } from "./model.ts";
import { parseTaskContract, taskContractSchemaVersionSchema } from "./version.ts";

const eventBase = {
  schemaVersion: taskContractSchemaVersionSchema,
  event_id: entityIdSchema,
  task_id: taskIdSchema,
  task_version: entityVersionSchema,
  occurred_at: isoTimestampSchema,
  actor: taskCommandActorSchema,
};

export const taskCreatedEventSchema = z.object({
  ...eventBase,
  name: z.literal("TaskCreated"),
  task: taskReadModelSchema,
}).strict();

export const taskUpdatedEventSchema = z.object({
  ...eventBase,
  name: z.literal("TaskUpdated"),
  changed_fields: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  task: taskReadModelSchema,
}).strict();

export const taskCompletedEventSchema = z.object({
  ...eventBase,
  name: z.literal("TaskCompleted"),
  task: taskReadModelSchema,
}).strict();

export const taskReopenedEventSchema = z.object({
  ...eventBase,
  name: z.literal("TaskReopened"),
  task: taskReadModelSchema,
}).strict();

export const taskDeletedEventSchema = z.object({
  ...eventBase,
  name: z.literal("TaskDeleted"),
  deleted_at: isoTimestampSchema,
  task: taskReadModelSchema,
}).strict();

export const taskEventSchema = z.discriminatedUnion("name", [
  taskCreatedEventSchema,
  taskUpdatedEventSchema,
  taskCompletedEventSchema,
  taskReopenedEventSchema,
  taskDeletedEventSchema,
]);

export type TaskCreatedEvent = z.output<typeof taskCreatedEventSchema>;
export type TaskUpdatedEvent = z.output<typeof taskUpdatedEventSchema>;
export type TaskCompletedEvent = z.output<typeof taskCompletedEventSchema>;
export type TaskReopenedEvent = z.output<typeof taskReopenedEventSchema>;
export type TaskDeletedEvent = z.output<typeof taskDeletedEventSchema>;
export type TaskEvent = z.output<typeof taskEventSchema>;

export function parseTaskEvent(value: unknown): Result<TaskEvent, TaskError> {
  return parseTaskContract(taskEventSchema, value, "INVALID_EVENT");
}
