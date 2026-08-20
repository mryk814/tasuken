import * as z from "zod/v4";

import { taskIdSchema } from "./model.ts";

const aiEntityHeaderSchema = z.looseObject({
  id: z.string(),
  type: z.literal("task"),
  title: z.string(),
  summary: z.string(),
  ai_visibility: z.array(z.enum(["m365", "coding_agent", "external_ai"])),
  ai_visibility_source: z.enum(["entity", "theme", "workspace_default"]),
  theme_id: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export const listAgentReadyTasksRequestSchema = z.object({
  theme_id: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().positive().max(100).optional(),
  include_archived: z.boolean().optional(),
}).strict();

/**
 * The Task body remains a compatibility projection during migration.
 * Known boundary fields are validated while legacy extension fields pass through unchanged.
 */
export const agentReadyTaskSchema = z.looseObject({
  id: taskIdSchema,
  intended_executor: z.literal("ai_agent"),
  state: z.string(),
  project_id: z.string().nullable().optional(),
  work_state: z.string().optional(),
  updated_at: z.string().optional(),
  deleted_at: z.string().nullable().optional(),
  ai: aiEntityHeaderSchema,
});

export const listAgentReadyTasksResponseSchema = z.object({
  tasks: z.array(agentReadyTaskSchema),
  limit: z.number().int().min(1).max(100),
  ai_audience: z.literal("coding_agent"),
  read_only: z.literal(true),
  excluded_count: z.number().int().nonnegative(),
  excluded_reasons: z.array(z.object({
    type: z.string(),
    reason: z.string(),
    count: z.number().int().positive(),
  }).strict()),
}).strict();

export type ListAgentReadyTasksRequest = z.output<typeof listAgentReadyTasksRequestSchema>;
export type AgentReadyTask = z.output<typeof agentReadyTaskSchema>;
export type ListAgentReadyTasksResponse = z.output<typeof listAgentReadyTasksResponseSchema>;
