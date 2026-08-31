import * as z from "zod/v4";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const contentProposalActorSchema = z
  .object({
    kind: z.literal("ai_agent"),
    id: boundedText(200).optional(),
  })
  .strict();

export const contentProposalRepositoryContextSchema = z
  .object({
    repository_context_id: boundedText(200).optional(),
    provider: z
      .enum(["github", "gitlab", "azure_devops", "local", "generic_git", "unknown"])
      .optional(),
    repository_slug: boundedText(500)
      .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/)
      .optional(),
    branch: boundedText(500)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value), "branchに制御文字は使えません。")
      .optional(),
  })
  .strict();

const requestBase = {
  idempotency_key: boundedText(200),
  caller: boundedText(200),
  actor: contentProposalActorSchema,
  source: z.literal("mcp"),
  source_session: boundedText(200).optional(),
  source_app: boundedText(120).optional(),
  repository_context: contentProposalRepositoryContextSchema.optional(),
};

export const proposeContentRequestSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...requestBase,
        kind: z.literal("note_create"),
        title: boundedText(200),
        body: z.string().min(1).max(200_000),
        theme: optionalText(500),
        note_type: z.enum(["memo", "report", "prompt"]).optional(),
        report_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        reason: optionalText(2_000),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        kind: z.literal("note_edit"),
        note_id: boundedText(200),
        base_version: z.number().int().positive(),
        title: boundedText(200),
        body: z.string().max(200_000),
        reason: boundedText(2_000),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        kind: z.literal("knowledge_create"),
        title: boundedText(200),
        body: optionalText(20_000),
        node_type: z.enum(["question", "claim", "evidence", "decision", "insight"]).optional(),
        theme: optionalText(500),
        confidence: z.enum(["low", "medium", "high"]).optional(),
        reason: optionalText(2_000),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        kind: z.literal("sketch_create"),
        title: boundedText(200),
        svg: z.string().min(1).max(500_000),
        theme: optionalText(500),
        reason: optionalText(2_000),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        kind: z.literal("artifact_create"),
        title: boundedText(200),
        file_name: boundedText(180),
        media_type: z.enum(["image/svg+xml", "text/markdown", "text/plain", "application/json"]),
        content: z.string().min(1).max(1_000_000),
        theme: optionalText(500),
        reason: optionalText(2_000),
      })
      .strict(),
  ])
  .superRefine((request, context) => {
    if (request.kind === "note_create" && request.report_date && request.note_type !== "report") {
      context.addIssue({
        code: "custom",
        path: ["report_date"],
        message: "report_date is only supported for report Notes",
      });
    }
  });

export const contentProposalPayloadTypeSchema = z.enum([
  "notes",
  "knowledge_nodes",
  "sketches",
  "artifacts",
]);

export const proposeContentResponseSchema = z
  .object({
    proposal_id: z.string().uuid(),
    status: z.enum(["queued", "duplicate"]),
    payload_type: contentProposalPayloadTypeSchema,
    message: boundedText(500),
  })
  .strict();

export type ProposeContentRequest = z.output<typeof proposeContentRequestSchema>;
export type ProposeContentResponse = z.output<typeof proposeContentResponseSchema>;
export type ContentProposalPayloadType = z.output<typeof contentProposalPayloadTypeSchema>;
