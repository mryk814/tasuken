import * as z from "zod/v4";

const optionalText = z.string().trim().min(1).max(200).optional();

export const repositoryLookupRequestSchema = z.object({
  repository_context_id: optionalText,
  repository_id: optionalText,
  provider: optionalText,
  remote_url: optionalText,
  remote_urls: z.array(z.string().trim().max(2000)).max(20).optional(),
  repository_slug: optionalText,
  git_root: optionalText,
  cwd: optionalText,
  workspace_folder: optionalText,
  include_archived: z.boolean().optional(),
}).strict();

export const getTaskAssignmentRequestSchema = z.object({
  task_id: z.string().trim().min(1).max(200),
  limit: z.number().int().positive().max(100).optional(),
  include_archived: z.boolean().optional(),
}).strict();

export const getRepositoryContextRequestSchema = z.object({
  repository_context_id: z.string().trim().min(1).max(200),
  include_archived: z.boolean().optional(),
}).strict();

// Wave 2 preserves the established MCP compatibility shapes exactly. The
// boundary validates the stable envelope while legacy extension fields remain
// lossless until the public projections are versioned independently.
export const resolveRepositoryContextResponseSchema = z.looseObject({
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
  visible_context_count: z.number().int().nonnegative(),
});

export const findTasksForRepositoryResponseSchema = z.looseObject({
  tasks: z.array(z.looseObject({ id: z.string() })),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
  excluded_count: z.number().int().nonnegative(),
  excluded_reasons: z.array(z.looseObject({
    type: z.string(),
    reason: z.string(),
    count: z.number().int().positive(),
  })),
});

export const findThemesForRepositoryResponseSchema = z.looseObject({
  themes: z.array(z.looseObject({ id: z.string() })),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
});

export const getRepositoryContextResponseSchema = z.looseObject({
  repository_context: z.looseObject({ id: z.string() }).nullable(),
  repository_context_id: z.string(),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
});

export const getTaskAssignmentResponseSchema = z.looseObject({
  task: z.looseObject({ id: z.string() }).nullable(),
  receipts: z.array(z.looseObject({ id: z.string() })),
  task_id: z.string(),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
});

export type RepositoryLookupRequest = z.output<typeof repositoryLookupRequestSchema>;
export type ResolveRepositoryContextResponse = z.output<typeof resolveRepositoryContextResponseSchema>;
export type FindThemesForRepositoryResponse = z.output<typeof findThemesForRepositoryResponseSchema>;
export type FindTasksForRepositoryResponse = z.output<typeof findTasksForRepositoryResponseSchema>;
export type GetRepositoryContextRequest = z.output<typeof getRepositoryContextRequestSchema>;
export type GetRepositoryContextResponse = z.output<typeof getRepositoryContextResponseSchema>;
export type GetTaskAssignmentRequest = z.output<typeof getTaskAssignmentRequestSchema>;
export type GetTaskAssignmentResponse = z.output<typeof getTaskAssignmentResponseSchema>;
