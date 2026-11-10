import * as z from "zod/v4";

/** AIが新規作成したTask・Noteに残す出所。Task modelからも読むため、作成の入力契約とは分けて置く。 */
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
