import * as z from "zod/v4";

/** Creation only: identity, ownership, assignment and paths are owned by Core. */
export const aiItemCreationRequestSchema = z
  .object({
    kind: z.enum(["task", "note"]),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(20_000).default(""),
    idempotency_key: z.string().trim().min(1).max(200),
    caller: z.string().trim().min(1).max(200),
    source_app: z.string().trim().min(1).max(120).default("mcp-client"),
    source_session: z.string().trim().min(1).max(200).optional(),
    reason: z.string().max(2_000).default(""),
  })
  .strict();

export const aiCreationOriginSchema = z
  .object({
    schema: z.literal("tasken-ai-creation/v1"),
    command_id: z.string(),
    caller: z.string(),
    source_app: z.string(),
    source_session: z.string().nullable(),
    received_at: z.string(),
    reason: z.string(),
  })
  .strict();

export const aiItemCreationResponseSchema = z
  .object({
    schema: z.literal("tasken-ai-item-creation/v1"),
    status: z.enum(["created", "duplicate"]),
    entity: z
      .object({
        type: z.enum(["task", "note"]),
        id: z.string(),
        version: z.number().int().positive(),
        title: z.string(),
        body: z.string(),
        deleted_at: z.string().nullable(),
        ai_creation: aiCreationOriginSchema,
        ai_seen_at: z.string().nullable(),
        canonical_sync_state: z.string().nullable(),
      })
      .strict(),
    workspace_id: z.string(),
    canonical_node: z.literal("this_node"),
  })
  .strict();

export type AiItemCreationRequest = z.input<typeof aiItemCreationRequestSchema>;
export type AiItemCreationResponse = z.output<typeof aiItemCreationResponseSchema>;
