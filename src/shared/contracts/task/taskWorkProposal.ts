import * as z from "zod/v4";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalTimestampSchema = z.string().trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "ISO 8601 timestampが必要です。")
  .optional();

export const taskWorkProposalActorSchema = z.object({
  kind: z.literal("ai_agent"),
  id: boundedText(200).optional(),
}).strict();

export const taskWorkRepositoryContextSchema = z.object({
  repository_context_id: boundedText(200).optional(),
  provider: z.enum(["github", "gitlab", "azure_devops", "local", "generic_git", "unknown"]).optional(),
  repository_slug: boundedText(500).regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/).optional(),
  branch: boundedText(500).refine((value) => !/[\x00-\x1f\x7f]/.test(value), "branchに制御文字は使えません。")
    .optional(),
}).strict();

export const taskWorkExternalReferenceSchema = z.object({
  kind: z.enum(["issue", "pull_request", "merge_request", "commit", "branch", "file", "pipeline", "other"]),
  provider: z.string().trim().max(120).optional(),
  display_label: boundedText(200),
  url: z.string().trim().url().refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, "HTTPS URL without credentialsが必要です。"),
  external_id: z.string().trim().max(200).optional(),
}).strict();

const workItemListSchema = z.array(boundedText(1000)).max(100).optional();
const requestBase = {
  task_id: boundedText(200),
  expected_version: z.number().int().nonnegative(),
  idempotency_key: boundedText(200),
  caller: boundedText(200),
  actor: taskWorkProposalActorSchema,
  source: z.literal("mcp"),
  source_session: boundedText(200).optional(),
  source_app: boundedText(120).optional(),
  repository_context: taskWorkRepositoryContextSchema.optional(),
};

const receiptFields = {
  executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]),
  executor_label: boundedText(200),
  summary: boundedText(10_000),
  completed_items: workItemListSchema,
  changed_or_created_items: workItemListSchema,
  verification: workItemListSchema,
  remaining_work: workItemListSchema,
  external_references: z.array(taskWorkExternalReferenceSchema).max(100).optional(),
  reported_at: optionalTimestampSchema,
  provider: z.string().trim().max(120).optional(),
  model: z.string().trim().max(200).optional(),
};

export const proposeTaskWorkRequestSchema = z.discriminatedUnion("action", [
  z.object({
    ...requestBase,
    action: z.literal("start"),
    executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]).optional(),
    executor_identity: z.string().trim().max(200).optional(),
    started_at: optionalTimestampSchema,
  }).strict(),
  z.object({ ...requestBase, ...receiptFields, action: z.literal("append_receipt") }).strict(),
  z.object({ ...requestBase, ...receiptFields, action: z.literal("report_done") }).strict(),
  z.object({
    ...requestBase,
    action: z.literal("report_blocked"),
    executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]).optional(),
    executor_label: boundedText(200),
    blocker: boundedText(10_000),
    attempted_work: workItemListSchema,
    needed_input: workItemListSchema,
    retained_artifacts: workItemListSchema,
    external_references: z.array(taskWorkExternalReferenceSchema).max(100).optional(),
    reported_at: optionalTimestampSchema,
    provider: z.string().trim().max(120).optional(),
    model: z.string().trim().max(200).optional(),
  }).strict(),
]);

export const proposeTaskWorkResponseSchema = z.object({
  proposal_id: z.string().uuid(),
  status: z.enum(["queued", "duplicate"]),
  payload_type: z.literal("task_work"),
  message: boundedText(500),
}).strict();

export type ProposeTaskWorkRequest = z.output<typeof proposeTaskWorkRequestSchema>;
export type ProposeTaskWorkResponse = z.output<typeof proposeTaskWorkResponseSchema>;
