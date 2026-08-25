import * as z from "zod/v4";

const text = (max: number) => z.string().trim().min(1).max(max);
const timestamp = text(100).refine((value) => !Number.isNaN(Date.parse(value)), "ISO 8601 timestamp が必要です。");
const stringList = z.array(text(1000)).max(100).optional();
const identity = {
  idempotency_key: text(200),
  caller: text(200),
  source: z.literal("mcp"),
  source_app: text(120),
  source_session: text(500),
  actor: z.object({ kind: z.literal("ai_agent"), id: text(200).optional() }).strict(),
};

const relationTargets = {
  theme_ids: z.array(text(200)).max(50).optional(),
  task_ids: z.array(text(200)).max(100).optional(),
  repository_context_ids: z.array(text(200)).max(50).optional(),
  working_copy_ids: z.array(text(200)).max(50).optional(),
};

export const proposeAgentSessionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    ...identity,
    ...relationTargets,
    action: z.literal("start"),
    started_at: timestamp,
    client_kind: z.enum(["codex", "claude_code", "cursor", "github_copilot", "other"]),
    client_label: z.string().trim().max(200).optional(),
    agent_label: z.string().trim().max(200).optional(),
    provider_label: z.string().trim().max(200).optional(),
    model_label: z.string().trim().max(200).optional(),
    intent: z.object({
      summary: text(4000),
      requested_outcome: z.string().trim().max(4000).optional(),
      boundary: z.string().trim().max(4000).optional(),
    }).strict(),
  }).strict(),
  z.object({
    ...identity,
    action: z.literal("finish"),
    agent_session_id: z.string().uuid(),
    expected_version: z.number().int().positive(),
    ended_at: timestamp,
    status: z.enum(["completed", "blocked", "abandoned"]),
    outcome: z.object({
      summary: text(8000),
      decisions: stringList,
      changed_items: stringList,
      verification: stringList,
      remaining_work: stringList,
      next_suggested_action: z.string().trim().max(4000).optional(),
    }).strict(),
  }).strict(),
]);

export const proposeAgentSessionResponseSchema = z.object({
  proposal_id: z.string().uuid(),
  agent_session_id: z.string().uuid(),
  status: z.enum(["queued", "duplicate"]),
  payload_type: z.literal("agent_sessions"),
  message: text(500),
}).strict();

export type ProposeAgentSessionRequest = z.output<typeof proposeAgentSessionRequestSchema>;
export type ProposeAgentSessionResponse = z.output<typeof proposeAgentSessionResponseSchema>;
