import * as z from "zod/v4";

import { entityIdSchema, type Result } from "../../kernel/public.ts";
import { taskIdSchema, taskReadModelSchema, taskStateSchema } from "./model.ts";
import { parseTaskContract, taskContractSchemaVersionSchema } from "./version.ts";
import type { TaskError } from "./errors.ts";

const queryBase = {
  schemaVersion: taskContractSchemaVersionSchema,
  query_id: entityIdSchema,
};

export const getTaskQuerySchema = z.object({
  ...queryBase,
  name: z.literal("GetTask"),
  parameters: z.object({
    task_id: taskIdSchema,
    include_deleted: z.boolean().optional(),
  }).strict(),
}).strict();

export const listTasksQuerySchema = z.object({
  ...queryBase,
  name: z.literal("ListTasks"),
  parameters: z.object({
    project_id: entityIdSchema.nullable().optional(),
    states: z.array(taskStateSchema).max(6).optional(),
    include_deleted: z.boolean().optional(),
    cursor: z.string().max(1000).nullable().optional(),
    limit: z.number().int().positive().max(200).default(50),
  }).strict(),
}).strict();

export const taskQuerySchema = z.discriminatedUnion("name", [getTaskQuerySchema, listTasksQuerySchema]);

export const getTaskQueryResultSchema = z.object({
  schemaVersion: taskContractSchemaVersionSchema,
  query_id: entityIdSchema,
  name: z.literal("GetTask"),
  task: taskReadModelSchema.nullable(),
}).strict();

export const listTasksQueryResultSchema = z.object({
  schemaVersion: taskContractSchemaVersionSchema,
  query_id: entityIdSchema,
  name: z.literal("ListTasks"),
  items: z.array(taskReadModelSchema).max(200),
  next_cursor: z.string().max(1000).nullable(),
}).strict();

export const taskQueryResultSchema = z.discriminatedUnion("name", [
  getTaskQueryResultSchema,
  listTasksQueryResultSchema,
]);

export type GetTaskQuery = z.output<typeof getTaskQuerySchema>;
export type ListTasksQuery = z.output<typeof listTasksQuerySchema>;
export type TaskQuery = z.output<typeof taskQuerySchema>;
export type GetTaskQueryResult = z.output<typeof getTaskQueryResultSchema>;
export type ListTasksQueryResult = z.output<typeof listTasksQueryResultSchema>;
export type TaskQueryResult = z.output<typeof taskQueryResultSchema>;

export function parseTaskQuery(value: unknown): Result<TaskQuery, TaskError> {
  return parseTaskContract(taskQuerySchema, value, "INVALID_QUERY");
}

export function parseTaskQueryResult(value: unknown): Result<TaskQueryResult, TaskError> {
  return parseTaskContract(taskQueryResultSchema, value, "INVALID_READ_MODEL");
}
