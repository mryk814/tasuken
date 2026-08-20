import * as z from "zod/v4";

import { publicRepositoryContextSchema, publicThemeSchema } from "./agentWorkspaceQueries.ts";
import { aiHeaderSchema } from "./contentDetailQueries.ts";

export const getThemeContextRequestSchema = z.object({
  theme_id: z.string().trim().min(1).max(200),
  limit: z.number().int().positive().max(100).optional(),
  max_chars: z.number().int().positive().max(8_000).optional(),
  include_raw_body: z.boolean().optional(),
  max_hops: z.number().int().positive().max(2).optional(),
  max_nodes: z.number().int().positive().max(100).optional(),
  max_edges: z.number().int().nonnegative().max(200).optional(),
  token_budget: z.number().int().positive().max(12_000).optional(),
  include_archived: z.boolean().optional(),
}).strict();

const entityRefSchema = z.object({ type: z.string(), id: z.string() }).strict();
const evidenceRefSchema = z.union([entityRefSchema, z.string()]);
const relationPathEntrySchema = z.object({
  edge_id: z.string().nullable(),
  assertion_id: z.string().nullable(),
  from: entityRefSchema,
  predicate: z.string().nullable(),
  to: entityRefSchema,
  layer: z.string().nullable(),
  status: z.string().nullable(),
  origin: z.string().nullable(),
  evidence_refs: z.array(evidenceRefSchema),
  reason: z.string().nullable(),
}).strict();
const relationPathSchema = z.array(relationPathEntrySchema);

const themeEntitySchema = publicThemeSchema.extend({
  included_because: z.string(),
  relation_path: relationPathSchema,
}).strict();

const repositoryEntitySchema = publicRepositoryContextSchema.extend({
  ai: aiHeaderSchema.optional(),
  included_because: z.string(),
  relation_path: relationPathSchema,
}).strict();

const openItemSchema = z.object({
  id: z.string(),
  entity_type: z.enum(["task", "waiting", "plan_node", "item"]),
  title: z.string(),
  kind: z.string(),
  state: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  theme_id: z.string().nullable(),
  description: z.string(),
  waiting_for: z.string().optional(),
  next_action: z.string().optional(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  included_because: z.string(),
  relation_path: relationPathSchema,
  ai: aiHeaderSchema.optional(),
}).strict();

const locatorSchema = z.object({
  tool: z.string(),
  arguments: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
}).strict();

const noteSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  title: z.string(),
  note_type: z.string(),
  excerpt: z.string().optional(),
  body_markdown: z.string().optional(),
  project_id: z.string().nullable().optional(),
  included_because: z.string(),
  relation_path: relationPathSchema,
  locator: locatorSchema.optional(),
  ai: aiHeaderSchema.optional(),
}).strict();

const knowledgeNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  node_type: z.string().nullable(),
  theme_id: z.string().nullable(),
  body: z.string(),
  source_type: z.string().nullable(),
  source_id: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  included_because: z.string(),
  relation_path: relationPathSchema,
  ai: aiHeaderSchema.optional(),
}).strict();

const graphNodeSchema = z.object({
  type: z.string(),
  id: z.string(),
  title: z.string().optional(),
  updated_at: z.string().optional(),
  created_at: z.string().optional(),
  theme_id: z.string().optional(),
  source_record_id: z.string().optional(),
  source_refs: z.array(z.string()).optional(),
  ai_authority: z.string().optional(),
  ai_visibility: z.string().optional(),
  ai_freshness: z.string().optional(),
}).strict();

const graphEdgeSchema = z.object({
  id: z.string(),
  assertion_id: z.string(),
  source: entityRefSchema,
  target: entityRefSchema,
  predicate: z.string(),
  layer: z.string(),
  status: z.string(),
  status_raw: z.string().optional(),
  origin: z.string(),
  evidence_refs: z.array(evidenceRefSchema),
  legacy_evidence_refs: z.array(z.string()).optional(),
  confidence: z.number().optional(),
  reason: z.string(),
  path: z.array(z.string()),
}).strict();

const graphPathSchema = z.object({
  from: entityRefSchema,
  to: entityRefSchema,
  hops: z.number().int().nonnegative(),
  edge_ids: z.array(z.string()),
}).strict();
const exclusionSchema = z.object({ ref: entityRefSchema, reason: z.string(), count: z.number().int().positive() }).strict();
const graphLimitsSchema = z.object({
  maxHops: z.number().int(),
  maxNodes: z.number().int(),
  maxEdges: z.number().int(),
  maxDiagnostics: z.number().int(),
  tokenBudget: z.number().int(),
}).strict();
const graphPolicySchema = z.object({
  asserted_first: z.boolean(),
  suggested_included: z.boolean(),
  suggested_is_fact: z.boolean(),
}).strict();
const diagnosticSchema = z.object({
  kind: z.string(),
  assertion_id: z.string().optional(),
  missing_refs: z.array(entityRefSchema).optional(),
  message: z.string().optional(),
}).strict();
const contextGraphSchema = z.object({
  seed: entityRefSchema,
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  paths: z.array(graphPathSchema),
  diagnostics: z.array(diagnosticSchema),
  excluded_nodes: z.array(exclusionSchema),
  limits: graphLimitsSchema,
  estimated_tokens: z.number().int().nonnegative(),
  truncated: z.boolean(),
  exclusions: z.array(z.string()),
  policy: graphPolicySchema,
}).strict();

const selectionEntrySchema = z.object({
  ref: entityRefSchema,
  reason: z.string().nullable(),
  count: z.literal(1),
  title: z.string().nullable(),
  ai: aiHeaderSchema.nullable(),
  relation_path: relationPathSchema,
  locator: locatorSchema.nullable(),
}).strict();
const selectionSchema = z.object({
  schema: z.literal("tasken-context-selection/v1"),
  seed: entityRefSchema,
  included: z.array(selectionEntrySchema),
  excluded: z.array(exclusionSchema),
  relations: z.array(graphEdgeSchema),
  limits: z.object({ max_text_length: z.number().int().positive(), graph: graphLimitsSchema }).strict(),
  truncated: z.boolean(),
  truncation: z.object({
    graph: z.object({ reason: z.literal("bounded_relation_query"), limits: graphLimitsSchema }).strict().optional(),
    text: z.object({ reason: z.literal("max_text_length"), limit: z.number().int().positive(), used: z.number().int().nonnegative() }).strict().optional(),
  }).strict(),
  estimated_characters: z.number().int().nonnegative(),
  estimated_tokens: z.number().int().nonnegative(),
  policy: graphPolicySchema.nullable(),
}).strict();

const exclusionSummaryShape = {
  excluded_count: z.number().int().nonnegative(),
  excluded_reasons: z.array(z.object({ type: z.string(), reason: z.string(), count: z.number().int().positive() }).strict()),
};
const truncationSchema = z.object({
  graph: z.object({ reason: z.literal("bounded_relation_query"), limits: graphLimitsSchema }).strict().optional(),
  text: z.object({ reason: z.literal("max_text_length"), limit: z.number().int().positive(), used: z.number().int().nonnegative() }).strict().optional(),
}).strict();

const successSchema = z.object({
  themes: z.array(themeEntitySchema),
  repository_contexts: z.array(repositoryEntitySchema),
  theme_repository_contexts: z.array(z.object({
    theme_id: z.string(),
    context_ids: z.array(z.string()),
    missing_context_ids: z.array(z.string()),
    missing_context_reasons: z.array(z.string()),
    contexts: z.array(repositoryEntitySchema),
  }).strict()),
  open_items: z.array(openItemSchema),
  recent_notes: z.array(noteSchema),
  knowledge: z.object({ knowledge_nodes: z.array(knowledgeNodeSchema), knowledge_edges: z.array(graphEdgeSchema) }).strict(),
  health: z.object({
    plan: z.object({ open_count: z.number().int().nonnegative() }).strict(),
    knowledge: z.object({ represented_node_count: z.number().int().nonnegative() }).strict(),
  }).strict(),
  context_graph: contextGraphSchema,
  context_selection: selectionSchema,
  limits: z.object({ max_text_length: z.number().int().positive(), graph: graphLimitsSchema }).strict(),
  truncation: truncationSchema,
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  truncated: z.boolean(),
  ai_audience: z.literal("coding_agent"),
  read_only: z.literal(true),
  ...exclusionSummaryShape,
}).strict();

const notFoundSchema = z.object({
  error: z.object({ code: z.literal("not_found"), message: z.string(), theme_id: z.string() }).strict(),
  context_selection: z.object({
    schema: z.literal("tasken-context-selection/v1"), seed: entityRefSchema, included: z.array(z.never()), excluded: z.array(exclusionSchema),
    relations: z.array(z.never()), limits: z.object({}).strict(), truncated: z.literal(false), truncation: z.object({}).strict(),
    estimated_characters: z.literal(0), estimated_tokens: z.literal(0), policy: z.null(),
  }).strict(),
  ai_audience: z.literal("coding_agent"),
  read_only: z.literal(true),
  ...exclusionSummaryShape,
}).strict();

export const getThemeContextResponseSchema = z.union([successSchema, notFoundSchema]);

export type GetThemeContextRequest = z.output<typeof getThemeContextRequestSchema>;
export type GetThemeContextResponse = z.output<typeof getThemeContextResponseSchema>;
