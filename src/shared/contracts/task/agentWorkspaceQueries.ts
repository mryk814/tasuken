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

export const getRepositoryContextRequestSchema = z
  .object({
    repository_context_id: z.string().trim().min(1).max(200),
    include_archived: z.boolean().optional(),
  })
  .strict();

export const getAgentSessionContextRequestSchema = repositoryLookupRequestSchema
  .extend({
    client_kind: z
      .enum([
        "codex",
        "claude_code",
        "cursor",
        "github_copilot",
        "opencode",
        "deepseek_harness",
        "other",
      ])
      .optional(),
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
    context_count: z.number().int().nonnegative(),
  })
  .strict();

export const findTasksForRepositoryResponseSchema = z.looseObject({
  tasks: z.array(z.looseObject({ id: z.string() })),
  read_only: z.literal(true),
});

export const findThemesForRepositoryResponseSchema = z
  .object({
    ...repositoryMatchShape,
    themes: z.array(publicThemeSchema),
    matched_context_ids: z.array(z.string()),
    repository_contexts: z.array(publicRepositoryContextSchema),
    read_only: z.literal(true),
  })
  .strict();

const getRepositoryContextSuccessSchema = z
  .object({
    repository_context: publicRepositoryContextSchema,
    repository_context_id: z.string(),
    themes: z.array(publicThemeSchema),
    tasks: z.array(publicTaskSchema),
    read_only: z.literal(true),
  })
  .strict();

const getRepositoryContextMissingSchema = z
  .object({
    repository_context: z.null(),
    repository_context_id: z.string(),
    read_only: z.literal(true),
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

/**
 * AI の作業を読む時の 1 つの形（`shared/agentWorkCard.ts` の AgentWorkCard）。新しい記録も、
 * 古い会話の読み替えも、MCP の読む道具にはこの形で返す。
 */
export const agentWorkCardSchema = z
  .object({
    id: z.string(),
    origin: z.enum(["record", "session"]),
    started_at: z.string().nullable(),
    ended_at: z.string(),
    client_kind: z.string(),
    client_label: z.string().nullable(),
    model_label: z.string().nullable(),
    source_session_id: z.string().nullable(),
    theme_ids: z.array(z.string()),
    task_ids: z.array(z.string()),
    repository_context_ids: z.array(z.string()),
    intent: z.string().nullable(),
    summary: z.string().nullable(),
    changed: z.array(z.string()),
    changed_more: z.number().int().nonnegative(),
    verified: z.array(z.string()),
    remaining: z.array(z.string()),
    status: z.enum(["done", "partial", "blocked"]),
    notice: z.string().nullable(),
    basis: z.enum(["ai_report", "log_pickup", "folded"]),
    written_by: z.string().nullable(),
    running: z.boolean(),
    end_recorded: z.boolean(),
  })
  .strict();

const agentSessionContextTaskWorkSchema = z
  .array(
    z.object({
      id: z.string(),
      task_id: z.string(),
      title: z.string(),
      started_at: z.string(),
      ended_at: z.string().nullable(),
      status: z.enum(["active", "completed", "blocked"]),
      review_status: z.enum(["pending", "accepted", "recorded"]),
      summary: z.string(),
      executor_label: z.string(),
      source_session: z.string().nullable(),
      verification: z.array(z.string()),
      remaining_work: z.array(z.string()),
      proposal_id: z.string().nullable(),
    }),
  )
  .default([]);

/**
 * 呼ぶ側（MCP の橋・hook の script）が応答を読む時の形。Core と呼ぶ側の版がずれても読める
 * ように寛容にしてある。hook の script は main の checkout から動き、Desktop の Core は
 * installer で上がるので、新しい script が古い Core の応答（`sessions` を持ち、`agent_work` が
 * 無く、`previous_handoff` が古い会話の形）を読む組が必ず起きる。厳しく読むと応答ごと失敗し、
 * hook はリポジトリとテーマの結び付けを黙って落とす。
 *
 * - 知らない欄（古い `sessions` など）は通す。
 * - `agent_work` が無い・読めない時は空、`previous_handoff` が読めない時は null。
 * - リポジトリ・テーマ・Task・作業場所は、古い版と同じ形なので厳しく読む。
 */
export const getAgentSessionContextClientResponseSchema = z.looseObject({
  ...repositoryMatchShape,
  repository_context: publicRepositoryContextSchema.nullable(),
  themes: z.array(publicThemeSchema),
  tasks: z.array(publicTaskSchema),
  working_copies: z.array(publicWorkingCopySchema),
  agent_work: z.array(agentWorkCardSchema).catch([]),
  task_work: agentSessionContextTaskWorkSchema,
  previous_handoff: agentWorkCardSchema.nullable().catch(null),
  read_only: z.literal(true),
});

/** Core が応答を作る時の形（厳しい。知らない欄を出さない）。 */
export const getAgentSessionContextResponseSchema = z
  .object({
    ...repositoryMatchShape,
    repository_context: publicRepositoryContextSchema.nullable(),
    themes: z.array(publicThemeSchema),
    tasks: z.array(publicTaskSchema),
    working_copies: z.array(publicWorkingCopySchema),
    /** そのリポジトリ（date だけの時は、その日）の AI の作業。終わりの新しい順。 */
    agent_work: z.array(agentWorkCardSchema),
    task_work: agentSessionContextTaskWorkSchema,
    /** 引き継ぎ: 自分の会話ではない、残りのある（か止まった）直前の 1 件。 */
    previous_handoff: agentWorkCardSchema.nullable(),
    read_only: z.literal(true),
  })
  .strict();

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
