import * as z from "zod/v4";

const boundedText = (max: number) => z.string().trim().min(1).max(max);

/**
 * 受領したProposalの現在地を、このnodeの正本から読む。
 *
 * 採否は人が行うため、AIは同じ内容を再送する代わりにここで状態を確認する。
 * この応答は**このnodeの正本**であり、別端末への配送や採否は保証しない。
 */
export const proposalStatusRequestSchema = z
  .object({
    proposal_id: boundedText(200),
  })
  .strict();

export const proposalStatusValueSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "partially_accepted",
  "quarantined",
]);

const createdEntitySchema = z
  .object({
    type: z.string(),
    id: z.string(),
    title: z.string().nullable(),
  })
  .strict();

export const proposalStatusResponseSchema = z
  .object({
    schema: z.literal("tasken-proposal-status/v1"),
    proposal_id: z.string(),
    found: z.boolean(),
    status: proposalStatusValueSchema.nullable(),
    /** 人がまだ判断していない状態。trueでも再送せず、利用者へ確認する。 */
    awaiting_review: z.boolean(),
    payload_type: z.string().nullable(),
    source_app: z.string().nullable(),
    received_at: z.string().nullable(),
    /**
     * 採用によって生まれたEntity。未採用・却下では空。
     * どのEntityか記録が無い場合は空のままとし、推測で埋めない。
     */
    created_entities: z.array(createdEntitySchema).max(50),
    /** Entityをどう特定したか。`none`は特定できなかったことを意味する。 */
    resolved_by: z.enum(["proposal_target", "created_backlink", "none"]),
    view: z
      .object({
        canonical_node: z.literal("this_node"),
        workspace_id: z.string(),
        device_id: z.string(),
        delivery_confirmed: z.literal(false),
        note: z.string(),
      })
      .strict(),
  })
  .strict();

export type ProposalStatusRequest = z.output<typeof proposalStatusRequestSchema>;
export type ProposalStatusResponse = z.output<typeof proposalStatusResponseSchema>;
