import * as z from "zod/v4";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

const identity = {
  idempotency_key: boundedText(200),
  caller: boundedText(200),
  actor: z.object({ kind: z.literal("ai_agent"), id: boundedText(200).optional() }).strict(),
  source: z.literal("mcp"),
  source_session: boundedText(200).optional(),
  source_app: boundedText(120).optional(),
};

export const proposeRepositoryTaskRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    ...identity,
    kind: z.literal("repository_context"),
    label: boundedText(200),
    provider: z.enum(["github", "gitlab", "azure_devops", "local", "generic_git", "unknown"]).optional(),
    remote_url: optionalText(2_000),
    local_path: optionalText(2_000),
    web_url: optionalText(2_000),
    repository_slug: optionalText(500),
    subdirectory: optionalText(2_000),
    default_branch: optionalText(500),
    reason: optionalText(2_000),
  }).strict(),
  z.object({
    ...identity,
    kind: z.literal("task"),
    title: boundedText(200),
    description: z.string().max(20_000).optional(),
    theme: optionalText(200),
    priority: z.enum(["normal", "high"]).optional(),
    planned_start: optionalText(200),
    planned_end: optionalText(200),
    reason: optionalText(2_000),
  }).strict(),
]);

export const proposeRepositoryTaskResponseSchema = z.object({
  proposal_id: z.string().uuid(),
  status: z.enum(["queued", "duplicate"]),
  payload_type: z.enum(["repository_contexts", "items"]),
  message: boundedText(500),
}).strict();

export type ProposeRepositoryTaskRequest = z.output<typeof proposeRepositoryTaskRequestSchema>;
export type ProposeRepositoryTaskResponse = z.output<typeof proposeRepositoryTaskResponseSchema>;
