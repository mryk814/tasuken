import * as z from "zod/v4";

import { nextToolSchema } from "./itemQueries.ts";

const publicJsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type PublicJson = z.output<typeof publicJsonPrimitiveSchema> | PublicJson[] | { [key: string]: PublicJson };
const publicJsonValueSchema: z.ZodType<PublicJson> = z.lazy(() => z.union([
  publicJsonPrimitiveSchema,
  z.array(publicJsonValueSchema).max(100),
  z.record(z.string().max(200), publicJsonValueSchema),
]));
const publicMetadataSchema = z.record(z.string().max(200), publicJsonValueSchema);

const aiSourceRefSchema = z.object({
  kind: z.string(),
  locator: z.string(),
  title: z.string().optional(),
  captured_at: z.string().optional(),
  last_checked_at: z.string().optional(),
  storage_root_id: z.string().optional(),
  relative_path: z.string().optional(),
}).strict();

const publicAiHeaderSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  summary: z.string(),
  summary_authority: z.string().nullable(),
  summary_origin: z.string(),
  freshness: z.string(),
  freshness_origin: z.string(),
  freshness_reason: z.string(),
  authority: z.string().nullable(),
  authority_origin: z.string(),
  authority_reason: z.string(),
  ai_visibility: z.array(z.string()).max(3),
  ai_visibility_source: z.string().nullable(),
  ai_visibility_reason: z.string(),
  theme_id: z.string().nullable(),
  updated_at: z.string().nullable(),
  last_verified_at: z.string().nullable(),
  superseded_by: z.object({ type: z.string(), id: z.string() }).strict().nullable(),
  source_refs: z.array(aiSourceRefSchema).max(100),
}).strict();

const publicNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  note_type: z.string().optional(),
  project_id: z.string().nullable().optional(),
  theme_id: z.string().nullable().optional(),
  body_markdown: z.string().optional(),
  body_excerpt: z.string().optional(),
  version: z.number().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).max(100).optional(),
  metadata: publicMetadataSchema.optional(),
  ai: publicAiHeaderSchema,
}).strict();

const publicKnowledgeNodeSchema = z.object({
  id: z.string(),
  node_type: z.string(),
  title: z.string(),
  body: z.string(),
  theme_id: z.string().nullable().optional(),
  status: z.string().optional(),
  confidence: z.string().optional(),
  source_type: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  source_note_id: z.string().nullable().optional(),
  source_link_id: z.string().nullable().optional(),
  source_item_id: z.string().nullable().optional(),
  version: z.number().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).max(100).optional(),
  metadata: publicMetadataSchema.optional(),
  ai: publicAiHeaderSchema,
}).strict();

const publicKnowledgeEdgeSchema = z.object({
  id: z.string(),
  source_node_id: z.string(),
  target_node_id: z.string(),
  relation_type: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  confidence: z.string().optional(),
  version: z.number().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  source: z.string().optional(),
  metadata: publicMetadataSchema.optional(),
}).strict();

const publicResourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  source_url: z.string().nullable().optional(),
  resource_scope: z.string().optional(),
  project_id: z.string().nullable().optional(),
  theme_id: z.string().nullable().optional(),
  version: z.number().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).max(100).optional(),
  metadata: publicMetadataSchema.optional(),
  ai: publicAiHeaderSchema,
}).strict();

const publicItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  status: z.string(),
  priority: z.string().optional(),
  theme_id: z.string().nullable().optional(),
  description: z.string().optional(),
  waiting_for: z.string().optional(),
  next_action: z.string().optional(),
  planned_start: z.string().nullable().optional(),
  planned_end: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  source_record_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  source: z.string().optional(),
  metadata: publicMetadataSchema.optional(),
  ai: publicAiHeaderSchema,
}).strict();

const healthItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string().optional(),
  waiting_for: z.string().optional(),
  date: z.string().optional(),
  theme_id: z.string().nullable().optional(),
}).strict();

const knowledgeHealthIssueSchema = z.object({
  id: z.string(),
  kind: z.string(),
  node: publicKnowledgeNodeSchema,
  message: z.string(),
  action: z.string(),
}).strict();
const exclusionReasonSchema = z.object({
  type: z.string(),
  reason: z.string(),
  count: z.number().int().nonnegative(),
}).strict();

const readMetadataShape = {
  ai_audience: z.literal("coding_agent"),
  read_only: z.literal(true),
  next_tools: z.array(nextToolSchema).max(4),
};

const exclusionShape = {
  excluded_count: z.number().int().nonnegative(),
  excluded_reasons: z.array(exclusionReasonSchema),
};

const listResultMetaSchema = z.object({
  contract_version: z.literal(1),
  returned_count: z.number().int().nonnegative(),
  matched_visible_count: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict();

export const getRecentNotesRequestSchema = z.object({
  theme_id: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  max_chars: z.number().int().min(1).max(8_000).optional(),
  include_raw_body: z.boolean().optional(),
  include_archived: z.boolean().optional(),
}).strict();

export const getRecentNotesResponseSchema = z.object({
  notes: z.array(publicNoteSchema).max(100),
  limit: z.number().int().min(1).max(100),
  include_raw_body: z.boolean(),
  truncated: z.boolean(),
  result_meta: listResultMetaSchema,
  ...exclusionShape,
  ...readMetadataShape,
}).strict();

export const searchKnowledgeRequestSchema = z.object({
  query: z.string().trim().min(1).max(1_000).optional(),
  theme_id: z.string().trim().min(1).max(200).optional(),
  node_types: z.array(z.string().trim().min(1).max(100)).max(8).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  max_chars: z.number().int().min(1).max(8_000).optional(),
  include_archived: z.boolean().optional(),
}).strict();

export const searchKnowledgeResponseSchema = z.object({
  knowledge_nodes: z.array(publicKnowledgeNodeSchema).max(100),
  limit: z.number().int().min(1).max(100),
  truncated: z.boolean(),
  result_meta: listResultMetaSchema,
  ...exclusionShape,
  ...readMetadataShape,
}).strict();

export const getKnowledgeContextRequestSchema = z.object({
  theme_id: z.string().trim().min(1).max(200).optional(),
  include_relations: z.boolean().optional(),
  include_sources: z.boolean().optional(),
  include_raw_body: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  max_chars: z.number().int().min(1).max(8_000).optional(),
  include_archived: z.boolean().optional(),
}).strict();

export const getKnowledgeContextResponseSchema = z.object({
  knowledge_nodes: z.array(publicKnowledgeNodeSchema).max(100),
  knowledge_edges: z.array(publicKnowledgeEdgeSchema).max(200),
  sources: z.object({
    notes: z.array(publicNoteSchema).max(100),
    resources: z.array(publicResourceSchema).max(100),
    items: z.array(publicItemSchema).max(100),
  }).strict().optional(),
  limit: z.number().int().min(1).max(100),
  truncated: z.boolean(),
  result_meta: z.object({
    contract_version: z.literal(1),
    returned_node_count: z.number().int().nonnegative(),
    matched_visible_node_count: z.number().int().nonnegative(),
    returned_edge_count: z.number().int().nonnegative(),
    matched_public_edge_count: z.number().int().nonnegative(),
    returned_source_count: z.number().int().nonnegative(),
    matched_public_source_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).strict(),
  ...exclusionShape,
  ...readMetadataShape,
}).strict();

export const getPlanHealthRequestSchema = z.object({
  theme_id: z.string().trim().min(1).max(200).optional(),
}).strict();

export const getPlanHealthResponseSchema = z.object({
  open_tasks: z.number().int().nonnegative(),
  open_waitings: z.number().int().nonnegative(),
  open_plan_nodes: z.number().int().nonnegative(),
  open_count: z.number().int().nonnegative(),
  overdue_items: z.array(healthItemSchema).max(100),
  waiting_items: z.array(healthItemSchema).max(100),
  unscheduled_items: z.array(healthItemSchema).max(100),
  truncated: z.boolean(),
  result_meta: z.object({
    contract_version: z.literal(1),
    returned_item_count: z.number().int().nonnegative(),
    matched_visible_item_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).strict(),
  ...readMetadataShape,
}).strict();

export const getKnowledgeHealthRequestSchema = getPlanHealthRequestSchema;

export const getKnowledgeHealthResponseSchema = z.object({
  issues: z.array(knowledgeHealthIssueSchema).max(100),
  unresolved_questions: z.array(publicKnowledgeNodeSchema).max(100),
  claims_without_evidence: z.array(publicKnowledgeNodeSchema).max(100),
  contradicted_claims: z.array(publicKnowledgeNodeSchema).max(100),
  evidence_without_source: z.array(publicKnowledgeNodeSchema).max(100),
  isolated_nodes: z.array(publicKnowledgeNodeSchema).max(100),
  stale_decisions: z.array(publicKnowledgeNodeSchema).max(100),
  truncated: z.boolean(),
  result_meta: z.object({
    contract_version: z.literal(1),
    returned_issue_count: z.number().int().nonnegative(),
    matched_issue_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).strict(),
  ...readMetadataShape,
}).strict();

export type GetRecentNotesRequest = z.output<typeof getRecentNotesRequestSchema>;
export type GetRecentNotesResponse = z.output<typeof getRecentNotesResponseSchema>;
export type SearchKnowledgeRequest = z.output<typeof searchKnowledgeRequestSchema>;
export type SearchKnowledgeResponse = z.output<typeof searchKnowledgeResponseSchema>;
export type GetKnowledgeContextRequest = z.output<typeof getKnowledgeContextRequestSchema>;
export type GetKnowledgeContextResponse = z.output<typeof getKnowledgeContextResponseSchema>;
export type GetPlanHealthRequest = z.output<typeof getPlanHealthRequestSchema>;
export type GetPlanHealthResponse = z.output<typeof getPlanHealthResponseSchema>;
export type GetKnowledgeHealthRequest = z.output<typeof getKnowledgeHealthRequestSchema>;
export type GetKnowledgeHealthResponse = z.output<typeof getKnowledgeHealthResponseSchema>;
