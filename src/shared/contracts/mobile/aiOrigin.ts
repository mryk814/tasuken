import { z } from "zod/v4";
import { isoTimestampSchema } from "../../kernel/public.ts";

/** Optional, read-only projection requested by X-Tasken-Ai-Origin: 1. */
export const mobileAiOriginSchema = z
  .object({
    caller: z.string().trim().min(1).max(200),
    receivedAt: isoTimestampSchema,
    seenAt: isoTimestampSchema.nullable(),
  })
  .strict();

export function projectMobileAiOrigin(entity: { ai_creation?: unknown; ai_seen_at?: unknown }) {
  const origin = entity.ai_creation;
  if (
    !origin ||
    typeof origin !== "object" ||
    !("schema" in origin) ||
    origin.schema !== "tasken-ai-creation/v1"
  )
    return undefined;
  const record = origin as Record<string, unknown>;
  const projected = mobileAiOriginSchema.safeParse({
    caller: record.caller,
    receivedAt: record.received_at,
    seenAt: entity.ai_seen_at ?? null,
  });
  return projected.success ? projected.data : undefined;
}
