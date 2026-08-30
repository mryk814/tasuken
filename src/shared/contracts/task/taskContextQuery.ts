import { z } from "zod";

import { taskIdSchema } from "./model.ts";

const optionalText = z.string().trim().max(2_000).optional();

export const taskContextWorkspaceSchema = z
  .object({
    repository_id: optionalText,
    provider: optionalText,
    cwd: optionalText,
    git_root: optionalText,
    remote_url: optionalText,
    remote_urls: z.array(z.string().trim().max(2_000)).max(20).optional(),
    remotes: z.array(z.string().trim().max(2_000)).max(20).optional(),
    repository_slug: optionalText,
    branch: optionalText,
    workspace_folder: optionalText,
  })
  .strict();

export const taskContextIncludeSchema = z.enum([
  "theme",
  "repository",
  "notes",
  "conversations",
  "artifacts",
  "resources",
  "activity",
  "work_receipts",
]);

export const getTaskContextRequestSchema = z
  .object({
    task_id: taskIdSchema,
    include: z.array(taskContextIncludeSchema).max(8).optional(),
    max_items_per_type: z.number().int().positive().max(25).optional(),
    max_text_length: z.number().int().positive().max(100_000).optional(),
    detail: z.literal("summary").optional(),
    workspace: taskContextWorkspaceSchema.optional(),
    include_archived: z.boolean().optional(),
  })
  .strict();

export const getTaskContextResponseSchema = z
  .object({
    read_only: z.literal(true),
    ai_audience: z.string(),
  })
  .passthrough();

export type GetTaskContextRequest = z.infer<typeof getTaskContextRequestSchema>;
export type GetTaskContextResponse = z.infer<typeof getTaskContextResponseSchema>;
