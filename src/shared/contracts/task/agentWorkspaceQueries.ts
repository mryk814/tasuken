import * as z from "zod/v4";

import { aiHeaderSchema } from "./contentDetailQueries.ts";

const optionalText = z.string().trim().min(1).max(200).optional();

export const repositoryLookupRequestSchema = z
  .object({
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
  })
  .strict();

export const getTaskAssignmentRequestSchema = z
  .object({
    task_id: z.string().trim().min(1).max(200),
    limit: z.number().int().positive().max(100).optional(),
    include_archived: z.boolean().optional(),
  })
  .strict();

export const getRepositoryContextRequestSchema = z
  .object({
    repository_context_id: z.string().trim().min(1).max(200),
    include_archived: z.boolean().optional(),
  })
  .strict();

export const getAgentSessionContextRequestSchema = repositoryLookupRequestSchema
  .extend({
    client_kind: z.enum(["codex", "claude_code", "cursor", "github_copilot", "other"]).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    source_session: z.string().trim().min(1).max(500),
    agent_label: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().positive().max(50).optional(),
  })
  .strict()
  .refine(({ client_kind, date }) => Boolean(client_kind) || Boolean(date), {
    message: "client_kind is required unless date is specified",
  });

export const publicRepositoryContextSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    provider: z.string(),
    canonical_url: z.string().url().nullable(),
    canonical_identity: z.string().nullable(),
    web_url: z.string().url().nullable(),
    repository_slug: z.string().nullable(),
    owner: z.string().nullable(),
    name: z.string().nullable(),
    remote_aliases: z.array(z.string().url()),
    default_branch: z.string().nullable(),
    subdirectory: z.string().nullable(),
    active: z.boolean(),
    metadata: z.object({}).strict(),
  })
  .strict();

const repositoryCandidateSchema = z
  .object({
    context: publicRepositoryContextSchema,
    score: z.number(),
    reasons: z.array(z.string()),
  })
  .strict();

const repositoryMatchShape = {
  status: z.enum(["matched", "ambiguous", "unknown"]),
  reason_code: z.string(),
  reason: z.string(),
  selected: publicRepositoryContextSchema.nullable(),
  candidates: z.array(repositoryCandidateSchema),
};

const themeCharterSchema = z
  .object({
    schema: z.literal("tasken-theme-charter/v1"),
    purpose: z.string(),
    desired_outcome: z.string(),
    principles: z.array(z.string()),
    scope: z.string(),
    non_goals: z.array(z.string()),
    long_term_questions: z.array(z.string()),
    learning_interests: z.array(z.string()),
  })
  .strict();

const themeStateSchema = z
  .object({
    schema: z.literal("tasken-theme-state/v1"),
    current_direction: z.string(),
    active_questions: z.array(z.string()),
    current_bets: z.array(z.string()),
    blockers: z.array(z.string()),
    unresolved_decisions: z.array(z.string()),
    next_frontier: z.string(),
    updated_at: z.string().nullable(),
  })
  .strict();

export const publicThemeSchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    name: z.string(),
    code: z.string().nullable(),
    description: z.string(),
    state: z.string().nullable(),
    charter: themeCharterSchema.nullable(),
    current_state: themeStateSchema.nullable(),
    ai: aiHeaderSchema.optional(),
  })
  .strict();

const checklistItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    done: z.boolean(),
    sort_order: z.number(),
  })
  .strict();

export const publicTaskSchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    title: z.string(),
    description: z.string(),
    state: z.string(),
    priority: z.string(),
    project_id: z.string().nullable(),
    plan_node_id: z.string().nullable(),
    parent_task_id: z.string().nullable(),
    checklist_items: z.array(checklistItemSchema),
    ai: aiHeaderSchema.optional(),
  })
  .strict();

export const resolveRepositoryContextResponseSchema = z
  .object({
    ...repositoryMatchShape,
    read_only: z.literal(true),
    ai_audience: z.literal("coding_agent"),
    visible_context_count: z.number().int().nonnegative(),
  })
  .strict();

export const findTasksForRepositoryResponseSchema = z.looseObject({
  tasks: z.array(z.looseObject({ id: z.string() })),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
  excluded_count: z.number().int().nonnegative(),
  excluded_reasons: z.array(
    z.looseObject({
      type: z.string(),
      reason: z.string(),
      count: z.number().int().positive(),
    }),
  ),
});

export const findThemesForRepositoryResponseSchema = z
  .object({
    ...repositoryMatchShape,
    themes: z.array(publicThemeSchema),
    matched_context_ids: z.array(z.string()),
    repository_contexts: z.array(publicRepositoryContextSchema),
    read_only: z.literal(true),
    ai_audience: z.literal("coding_agent"),
  })
  .strict();

const getRepositoryContextSuccessSchema = z
  .object({
    repository_context: publicRepositoryContextSchema,
    repository_context_id: z.string(),
    themes: z.array(publicThemeSchema),
    tasks: z.array(publicTaskSchema),
    read_only: z.literal(true),
    ai_audience: z.literal("coding_agent"),
  })
  .strict();

const getRepositoryContextMissingSchema = z
  .object({
    repository_context: z.null(),
    repository_context_id: z.string(),
    excluded_reasons: z.array(z.literal("repository_context_not_visible")),
    read_only: z.literal(true),
    ai_audience: z.literal("coding_agent"),
  })
  .strict();

export const getRepositoryContextResponseSchema = z.union([
  getRepositoryContextSuccessSchema,
  getRepositoryContextMissingSchema,
]);

const publicWorkingCopySchema = z
  .object({
    id: z.string(),
    repository_context_id: z.string(),
    device_id: z.string(),
    storage_root_id: z.string(),
    worktree_identity: z.string().nullable(),
    branch_hint: z.string().nullable(),
    active: z.boolean(),
    last_seen_at: z.string().nullable(),
  })
  .strict();

const publicAgentSessionSchema = z.looseObject({
  id: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  status: z.enum(["active", "completed", "blocked", "abandoned"]),
  client_kind: z.string(),
  source_session_id: z.string().nullable(),
  intent: z.looseObject({ summary: z.string() }),
  outcome: z.looseObject({ summary: z.string() }).nullable(),
});

export const getAgentSessionContextResponseSchema = z
  .object({
    ...repositoryMatchShape,
    repository_context: publicRepositoryContextSchema.nullable(),
    themes: z.array(publicThemeSchema),
    tasks: z.array(publicTaskSchema),
    working_copies: z.array(publicWorkingCopySchema),
    sessions: z.array(publicAgentSessionSchema),
    previous_handoff: publicAgentSessionSchema.nullable(),
    read_only: z.literal(true),
    ai_audience: z.literal("coding_agent"),
  })
  .strict();

export const getTaskAssignmentResponseSchema = z.looseObject({
  task: z.looseObject({ id: z.string() }).nullable(),
  receipts: z.array(z.looseObject({ id: z.string() })),
  task_id: z.string(),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
});

export type RepositoryLookupRequest = z.output<typeof repositoryLookupRequestSchema>;
export type ResolveRepositoryContextResponse = z.output<
  typeof resolveRepositoryContextResponseSchema
>;
export type FindThemesForRepositoryResponse = z.output<
  typeof findThemesForRepositoryResponseSchema
>;
export type FindTasksForRepositoryResponse = z.output<typeof findTasksForRepositoryResponseSchema>;
export type GetRepositoryContextRequest = z.output<typeof getRepositoryContextRequestSchema>;
export type GetRepositoryContextResponse = z.output<typeof getRepositoryContextResponseSchema>;
export type GetAgentSessionContextRequest = z.output<typeof getAgentSessionContextRequestSchema>;
export type GetAgentSessionContextResponse = z.output<typeof getAgentSessionContextResponseSchema>;
export type GetTaskAssignmentRequest = z.output<typeof getTaskAssignmentRequestSchema>;
export type GetTaskAssignmentResponse = z.output<typeof getTaskAssignmentResponseSchema>;
