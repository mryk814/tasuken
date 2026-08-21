import * as z from "zod/v4";

import { publicActivityEntrySchema } from "./activityEntries.ts";

export const aiContextAudienceSchema = z.enum(["m365", "coding_agent", "external_ai"]);
export const agentContextEntityTypeSchema = z.enum([
  "theme", "item", "note", "link", "view", "status_update", "source_record",
  "entity_source", "field_definition", "field_value", "log_entry", "import_batch",
  "knowledge_node", "ai_proposal", "resource", "project", "repository_context",
  "capture_entry", "task", "work_receipt", "waiting", "plan_node", "schedule",
  "reference", "task_dependency", "plan_dependency", "knowledge_edge", "change_event",
  "artifact", "sketch",
]);

const exclusionReasonSchema = z.object({ type: z.string(), reason: z.string(), count: z.number().int().nonnegative() }).strict();
export const publicContextValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(publicContextValueSchema).max(200),
  z.record(z.string(), publicContextValueSchema),
]));

const activityPayloadSchema = z.object({
  schema_version: z.number().int().positive(), timezone: z.string(), date: z.string().nullable(),
  events: z.array(publicActivityEntrySchema).max(100),
  excluded_count: z.number().int().nonnegative(), excluded_reasons: z.array(exclusionReasonSchema).max(100),
  truncated: z.boolean(),
}).strict();

export const getActivityRequestSchema = z.object({
  date: z.string().trim().max(40).optional(), from: z.string().trim().max(80).optional(),
  to: z.string().trim().max(80).optional(), theme_id: z.string().trim().max(200).optional(),
  entity_type: z.string().trim().max(100).optional(),
  event_kinds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  timezone: z.string().trim().max(100).optional(), limit: z.number().int().min(1).max(100).optional(),
  format: z.enum(["json", "markdown"]).optional(), audience: aiContextAudienceSchema.optional(),
  include_archived: z.boolean().optional(),
}).strict();

export const getActivityResponseSchema = activityPayloadSchema.extend({
  activity: z.union([activityPayloadSchema, z.string()]), format: z.enum(["json", "markdown"]),
  result_meta: z.object({ contract_version: z.literal(1), returned_count: z.number().int().nonnegative(), matched_visible_count: z.number().int().nonnegative(), truncated: z.boolean() }).strict(),
  ai_audience: aiContextAudienceSchema, read_only: z.literal(true),
}).strict();

export const getContextSubgraphRequestSchema = z.object({
  entity_type: agentContextEntityTypeSchema, entity_id: z.string().trim().min(1).max(200),
  max_hops: z.number().int().min(1).max(2).optional(), max_nodes: z.number().int().min(1).max(100).optional(),
  max_edges: z.number().int().min(1).max(200).optional(), token_budget: z.number().int().min(1).max(12_000).optional(),
  include_suggested: z.boolean().optional(), include_archived: z.boolean().optional(),
}).strict();

const graphRefSchema = z.object({ type: z.string(), id: z.string() }).strict();
const graphNodeSchema = z.record(z.string(), publicContextValueSchema).and(z.object({ type: z.string(), id: z.string() }));
const graphEdgeSchema = z.record(z.string(), publicContextValueSchema).and(z.object({ id: z.string(), source: graphRefSchema, target: graphRefSchema, predicate: z.string(), layer: z.string(), status: z.string() }));

export const getContextSubgraphResponseSchema = z.object({
  seed: graphRefSchema, nodes: z.array(graphNodeSchema).max(100), edges: z.array(graphEdgeSchema).max(200),
  paths: z.array(publicContextValueSchema).max(200), diagnostics: z.array(publicContextValueSchema).max(100),
  excluded_nodes: z.array(publicContextValueSchema).max(100),
  limits: z.object({ maxHops: z.number().int().min(1).max(2), maxNodes: z.number().int().min(1).max(100), maxEdges: z.number().int().min(1).max(200), maxDiagnostics: z.number().int().positive(), tokenBudget: z.number().int().min(1).max(12_000) }).strict(),
  estimated_tokens: z.number().int().nonnegative(), truncated: z.boolean(), exclusions: z.array(z.string()).max(100),
  policy: z.object({ asserted_first: z.literal(true), suggested_included: z.boolean(), suggested_is_fact: z.literal(false) }).strict(),
  context_selection: publicContextValueSchema,
  result_meta: z.object({ contract_version: z.literal(1), returned_node_count: z.number().int().nonnegative(), returned_edge_count: z.number().int().nonnegative(), excluded_node_count: z.number().int().nonnegative(), truncated: z.boolean() }).strict(),
  ai_audience: z.literal("coding_agent"), read_only: z.literal(true),
}).strict();

export const exportAiContextRequestSchema = z.object({
  scope: z.enum(["active_theme", "selected_theme", "recent", "open_items", "knowledge"]).optional(),
  theme_id: z.string().trim().max(200).optional(), max_items: z.number().int().min(1).max(100).optional(),
  max_notes: z.number().int().min(1).max(100).optional(), max_knowledge_nodes: z.number().int().min(1).max(100).optional(),
  max_chars: z.number().int().min(1).max(8_000).optional(), format: z.enum(["markdown", "json"]).optional(),
  include_raw_body: z.boolean().optional(), audience: aiContextAudienceSchema.optional(),
}).strict();

const exportResultMetaSchema = z.object({ contract_version: z.literal(1), returned_theme_count: z.number().int().nonnegative(), returned_item_count: z.number().int().nonnegative(), returned_note_count: z.number().int().nonnegative(), returned_resource_count: z.number().int().nonnegative(), returned_knowledge_node_count: z.number().int().nonnegative(), returned_activity_count: z.number().int().nonnegative(), truncated: z.boolean() }).strict();
export const exportAiContextPackSchema = z.object({
  generated_at: z.string(), scope: z.enum(["active_theme", "selected_theme", "recent", "open_items", "knowledge"]),
  ai_audience: aiContextAudienceSchema, themes: z.array(publicContextValueSchema).max(100),
  repository_contexts: z.array(publicContextValueSchema).max(100), theme_repository_contexts: z.array(publicContextValueSchema).max(100),
  items: z.array(publicContextValueSchema).max(100), notes: z.array(publicContextValueSchema).max(100),
  resources: z.array(publicContextValueSchema).max(100), knowledge_nodes: z.array(publicContextValueSchema).max(100),
  knowledge_edges: z.array(publicContextValueSchema).max(200), activity: z.array(publicActivityEntrySchema).max(100),
  activity_meta: z.object({ schema_version: z.number().int().positive(), timezone: z.string(), excluded_count: z.number().int().nonnegative(), excluded_reasons: z.array(exclusionReasonSchema).max(100) }).strict(),
  health: publicContextValueSchema, excluded_count: z.number().int().nonnegative(), excluded_reasons: z.array(exclusionReasonSchema).max(100),
  result_meta: exportResultMetaSchema, read_only: z.literal(true),
}).strict();
export const exportAiContextResponseSchema = z.union([
  exportAiContextPackSchema,
  z.string(),
]);

export type GetActivityRequest = z.output<typeof getActivityRequestSchema>;
export type GetActivityResponse = z.output<typeof getActivityResponseSchema>;
export type GetContextSubgraphRequest = z.output<typeof getContextSubgraphRequestSchema>;
export type GetContextSubgraphResponse = z.output<typeof getContextSubgraphResponseSchema>;
export type ExportAiContextRequest = z.output<typeof exportAiContextRequestSchema>;
export type ExportAiContextResponse = z.output<typeof exportAiContextResponseSchema>;
