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
    /**
     * このnodeが観測できる同期の状態。相手端末の受信や採否は含まない。
     * 「差分が無い」ことは最新を意味しないため、断定できる表現だけを返す。
     */
    sync: z
      .object({
        enabled: z.boolean(),
        /** 最後に同期処理が成功した時刻。未同期・未有効はnull。 */
        last_synced_at: z.string().nullable(),
        /** 直近の同期が失敗しているか。error本文はパス等を含みうるため返さない。 */
        last_sync_failed: z.boolean(),
        /** このnodeがまだ公開していない差分の数。同期が無効なnodeは0。 */
        pending_local_changes: z.number().int().min(0),
        note: z.string(),
      })
      .strict(),
  })
  .strict();

export type ProposalStatusRequest = z.output<typeof proposalStatusRequestSchema>;
export type ProposalStatusResponse = z.output<typeof proposalStatusResponseSchema>;
