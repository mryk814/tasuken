import * as z from "zod/v4";

const recordSchema = z.record(z.string(), z.unknown());

export const getActivityEntriesRequestSchema = z.object({
  task_id: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(100).optional(),
  include_archived: z.boolean().optional(),
}).strict();

const entityRefSchema = z.object({
  type: z.string(),
  id: z.string(),
  revision: z.number().optional(),
}).strict();

const typedRefSchema = z.object({
  type: z.string(),
  id: z.string(),
  revision: z.number().optional(),
  relation: z.string().optional(),
  role: z.string().optional(),
}).strict();

const canonicalRefSchema = z.object({
  kind: z.string(),
  storage_root_id: z.string().optional(),
  relative_path: z.string().optional(),
  web_url: z.string().optional(),
  entity_id: z.string().optional(),
  status: z.string(),
  local_status: z.string().optional(),
}).strict();

const sourceCanonicalRefSchema = canonicalRefSchema.extend({
  status: z.string().optional(),
});

export const publicActivityEntrySchema = z.object({
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
}).strict();

export const activityEntriesResultMetaSchema = z.object({
  contract_version: z.literal(1),
  returned: z.number().int().nonnegative(),
  matched_visible: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict();

const successSchema = z.object({
  task_id: z.string(),
  events: z.array(publicActivityEntrySchema).max(100),
  limit: z.number().int().min(1).max(100),
  truncated: z.boolean(),
  result_meta: activityEntriesResultMetaSchema,
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
}).strict();

const notFoundSchema = z.object({
  error: z.object({
    code: z.literal("not_found"),
    message: z.string(),
    task_id: z.string(),
  }).strict(),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
}).strict();

export const getActivityEntriesResponseSchema = z.union([successSchema, notFoundSchema]);

export type GetActivityEntriesRequest = z.output<typeof getActivityEntriesRequestSchema>;
export type GetActivityEntriesResponse = z.output<typeof getActivityEntriesResponseSchema>;
export type PublicActivityEntry = z.output<typeof publicActivityEntrySchema>;
