import * as z from "zod/v4";

import type { Result } from "../../kernel/public.ts";
import {
  type CompleteTaskCommand,
  type CreateTaskCommand,
  type DeleteTaskCommand,
  type ReopenTaskCommand,
  type UpdateTaskCommand,
} from "./commands.ts";
import { taskErrorSchema, type TaskError } from "./errors.ts";
import { taskEventSchema } from "./events.ts";
import { taskReadModelSchema } from "./model.ts";
import {
  type GetTaskQuery,
  type GetTaskQueryResult,
  type ListTodayTasksQuery,
  type ListTodayTasksQueryResult,
  taskQueryResultSchema,
  type TaskQueryResult,
} from "./queries.ts";
import { taskContractSchemaVersionSchema } from "./version.ts";

export const taskCommandOutcomeSchema = z
  .object({
    schemaVersion: taskContractSchemaVersionSchema,
    command_id: z.string().trim().min(1),
    name: z.enum([
      "CreateTask",
      "UpdateTask",
      "DeleteTask",
      "CompleteTask",
      "ReopenTask",
      "StartTaskWork",
      "AcceptTaskWork",
      "ReturnTaskWork",
    ]),
    status: z.enum(["applied", "no_change"]),
    task: taskReadModelSchema.nullable(),
    event: taskEventSchema.nullable(),
  })
  .strict();

export const taskCommandResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: taskCommandOutcomeSchema }).strict(),
  z.object({ ok: z.literal(false), error: taskErrorSchema }).strict(),
]);
export const taskQueryResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: taskQueryResultSchema }).strict(),
  z.object({ ok: z.literal(false), error: taskErrorSchema }).strict(),
]);

export type TaskCommandOutcome = z.output<typeof taskCommandOutcomeSchema>;
export type TaskCommandResponse = Result<TaskCommandOutcome, TaskError>;
export type TaskQueryResponse = Result<TaskQueryResult, TaskError>;
export type TaskGetResponse = Result<GetTaskQueryResult, TaskError>;
export type TaskListTodayResponse = Result<ListTodayTasksQueryResult, TaskError>;

/** Feature-scoped client surface. Transport details stay behind this interface. */
export interface TaskCapability {
  create(command: CreateTaskCommand): Promise<TaskCommandResponse>;
  update(command: UpdateTaskCommand): Promise<TaskCommandResponse>;
  delete(command: DeleteTaskCommand): Promise<TaskCommandResponse>;
  complete(command: CompleteTaskCommand): Promise<TaskCommandResponse>;
  reopen(command: ReopenTaskCommand): Promise<TaskCommandResponse>;
  get(query: GetTaskQuery): Promise<TaskGetResponse>;
  listToday(query: ListTodayTasksQuery): Promise<TaskListTodayResponse>;
  subscribe(callback: (event: z.output<typeof taskEventSchema>) => void): () => void;
}
