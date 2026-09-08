import { z } from "zod/v4";
import { entityIdSchema, isoTimestampSchema } from "../../kernel/public.ts";
import { TASKEN_MOBILE_API_VERSION, TASKEN_MOBILE_SCHEMA_VERSION } from "./protocol.mjs";
import { mobileResponseMetaSchema } from "./schema.ts";

const text = z.string().max(8000);
const items = z.array(z.string().max(1000)).max(20);
export const mobileThemeContextRequestSchema = z
  .object({
    apiVersion: z.literal(TASKEN_MOBILE_API_VERSION),
    schemaVersion: z.literal(TASKEN_MOBILE_SCHEMA_VERSION),
    themeId: entityIdSchema,
  })
  .strict();

export const mobileThemeContextSchema = z
  .object({
    id: entityIdSchema,
    title: z.string().min(1).max(500),
    version: z.number().int().positive(),
    updatedAt: isoTimestampSchema.nullable(),
    charter: z
      .object({
        schema: z.literal("tasken-theme-charter/v1"),
        purpose: text,
        desired_outcome: text,
        principles: items,
        scope: text,
        non_goals: items,
        long_term_questions: items,
        learning_interests: items,
      })
      .strict()
      .nullable(),
    currentState: z
      .object({
        schema: z.literal("tasken-theme-state/v1"),
        current_direction: text,
        active_questions: items,
        current_bets: items,
        blockers: items,
        unresolved_decisions: items,
        next_frontier: text,
        updated_at: isoTimestampSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const mobileThemeContextDataSchema = z.discriminatedUnion("status", [
  z
    .object({
      themeId: entityIdSchema,
      status: z.literal("available"),
      theme: mobileThemeContextSchema,
    })
    .strict(),
  z.object({ themeId: entityIdSchema, status: z.literal("not_found"), theme: z.null() }).strict(),
]);
export const mobileThemeContextResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: mobileThemeContextDataSchema,
  })
  .strict();
export type MobileThemeContextRequest = z.output<typeof mobileThemeContextRequestSchema>;
export type MobileThemeContextData = z.output<typeof mobileThemeContextDataSchema>;
