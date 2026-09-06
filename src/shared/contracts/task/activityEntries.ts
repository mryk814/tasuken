import * as z from "zod/v4";

import { nextToolSchema } from "./itemQueries.ts";

const recordSchema = z.record(z.string(), z.unknown());

export const activityPageSchema = z
  .object({
    status: z.enum(["ok", "invalid_cursor", "resync_required"]),
    period: z
      .object({
        date: z.string().nullable(),
        from: z.string().nullable(),
        to: z.string().nullable(),
        timezone: z.string(),
        boundaries: z.literal("inclusive"),
      })
      .strict(),
    limit: z.number().int().min(1).max(500),
    returned_count: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative().nullable(),
    matched_visible_count: z.number().int().nonnegative().nullable(),
    next_cursor: z.string().max(200).nullable(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    generated_at: z.iso.datetime(),
  })
  .strict();

const activityExclusionSchema = z
  .object({
    type: z.string(),
    reason: z.string(),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const getActivityEntriesRequestSchema = z
  .object({
    task_id: z.string().trim().min(1).max(200).optional(),
    profile: z.enum(["default", "recall"]).optional(),
    event_kinds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    cursor: z.string().max(200).optional(),
    timezone: z.string().trim().max(100).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
    include_archived: z.boolean().optional(),
  })
  .strict()
  .refine(({ task_id, date }) => Boolean(task_id) !== Boolean(date), {
    message: "task_id or date must be specified, but not both",
  });

const entityRefSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    revision: z.number().optional(),
  })
  .strict();

const typedRefSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    revision: z.number().optional(),
    relation: z.string().optional(),
    role: z.string().optional(),
  })
  .strict();

const canonicalRefSchema = z
  .object({
    kind: z.string(),
    storage_root_id: z.string().optional(),
    relative_path: z.string().optional(),
    web_url: z.string().optional(),
    entity_id: z.string().optional(),
    status: z.string(),
    local_status: z.string().optional(),
  })
  .strict();

const sourceCanonicalRefSchema = canonicalRefSchema.extend({
  status: z.string().optional(),
});

export const publicActivityEntrySchema = z
  .object({
    id: z.string(),
    occurred_at: z.string(),
    event_kind: z.string(),
    entity_ref: entityRefSchema,
    entity_title: z.string(),
    theme_ref: z.object({ kind: z.enum(["theme", "none"]), id: z.string().nullable() }).strict(),
    actor: recordSchema,
    origin: recordSchema,
    summary: z.string(),
    changed_fields: z.array(z.string()),
    canonical_refs: z.array(canonicalRefSchema),
    source_refs: z.array(z.union([typedRefSchema, sourceCanonicalRefSchema])),
    relation_refs: z.array(typedRefSchema),
    work_receipt_ref: typedRefSchema.nullable(),
    metadata: recordSchema,
    local_date: z.string(),
    local_time: z.string(),
    recall: z
      .object({
        stage: z.enum([
          "input",
          "planned",
          "work_recorded",
          "ai_reported",
          "human_accepted",
          "organized",
          "changed",
        ]),
        authority: z.string().nullable(),
        authority_origin: z.enum(["explicit", "derived", "unset"]),
        source_ref: entityRefSchema,
        history: z
          .object({
            entity_title_source: z.enum([
              "after_snapshot",
              "before_snapshot",
              "current_fallback",
              "unknown",
            ]),
            theme_ref_source: z.enum(["event", "after_snapshot", "before_snapshot", "unknown"]),
            theme_title: z.string().nullable(),
            theme_title_source: z.enum([
              "theme_event_after",
              "theme_event_before",
              "current_fallback",
              "unknown",
            ]),
            current_entity_title: z.string().nullable(),
            current_theme_ref: z
              .object({ kind: z.enum(["theme", "none"]), id: z.string().nullable() })
              .strict(),
            current_theme_title: z.string().nullable(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const activityEntriesResultMetaSchema = z
  .object({
    contract_version: z.literal(1),
    returned_count: z.number().int().nonnegative(),
    matched_visible_count: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
  })
  .strict();

const successSchema = z
  .object({
    task_id: z.string(),
    events: z.array(publicActivityEntrySchema).max(100),
    limit: z.number().int().min(1).max(100),
    truncated: z.boolean(),
    result_meta: activityEntriesResultMetaSchema,
    page: activityPageSchema.optional(),
    excluded_count: z.number().int().nonnegative().optional(),
    excluded_reasons: z.array(activityExclusionSchema).optional(),
    read_only: z.literal(true),
    ai_audience: z.literal("coding_agent"),
    next_tools: z.array(nextToolSchema).max(4),
  })
  .strict();

const dailySuccessSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    events: z.array(publicActivityEntrySchema).max(100),
    limit: z.number().int().min(1).max(100),
    truncated: z.boolean(),
    result_meta: activityEntriesResultMetaSchema,
    page: activityPageSchema.optional(),
    excluded_count: z.number().int().nonnegative().optional(),
    excluded_reasons: z.array(activityExclusionSchema).optional(),
    read_only: z.literal(true),
    ai_audience: z.literal("coding_agent"),
    next_tools: z.array(nextToolSchema).max(4),
  })
  .strict();

const notFoundSchema = z
  .object({
    error: z
      .object({
        code: z.literal("not_found"),
        message: z.string(),
        task_id: z.string(),
      })
      .strict(),
    read_only: z.literal(true),
    ai_audience: z.literal("coding_agent"),
    next_tools: z.array(nextToolSchema).max(4),
  })
  .strict();

export const getActivityEntriesResponseSchema = z.union([
  successSchema,
  dailySuccessSchema,
  notFoundSchema,
]);

export type GetActivityEntriesRequest = z.output<typeof getActivityEntriesRequestSchema>;
export type GetActivityEntriesResponse = z.output<typeof getActivityEntriesResponseSchema>;
export type PublicActivityEntry = z.output<typeof publicActivityEntrySchema>;
