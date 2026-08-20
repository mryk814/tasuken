import * as z from "zod/v4";

import { nextToolSchema } from "./itemQueries.ts";

const publicRecordSchema = z.record(z.string(), z.unknown());
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

export const getRecentNotesRequestSchema = z.object({
  theme_id: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  max_chars: z.number().int().min(1).max(8_000).optional(),
  include_raw_body: z.boolean().optional(),
  include_archived: z.boolean().optional(),
}).strict();

export const getRecentNotesResponseSchema = z.object({
  notes: z.array(publicRecordSchema).max(100),
  limit: z.number().int().min(1).max(100),
  include_raw_body: z.boolean(),
  ...exclusionShape,
  ...readMetadataShape,
}).strict();

export const searchKnowledgeRequestSchema = z.object({
  query: z.string().trim().max(1_000).optional(),
  theme_id: z.string().trim().min(1).max(200).optional(),
  node_types: z.array(z.string().trim().min(1).max(100)).max(8).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  max_chars: z.number().int().min(1).max(8_000).optional(),
  include_archived: z.boolean().optional(),
}).strict();

export const searchKnowledgeResponseSchema = z.object({
  knowledge_nodes: z.array(publicRecordSchema).max(100),
  limit: z.number().int().min(1).max(100),
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
  knowledge_nodes: z.array(publicRecordSchema).max(100),
  knowledge_edges: z.array(publicRecordSchema),
  sources: z.object({
    notes: z.array(publicRecordSchema),
    resources: z.array(publicRecordSchema),
    items: z.array(publicRecordSchema),
  }).strict().optional(),
  limit: z.number().int().min(1).max(100),
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
  overdue_items: z.array(publicRecordSchema),
  waiting_items: z.array(publicRecordSchema),
  unscheduled_items: z.array(publicRecordSchema),
  ...readMetadataShape,
}).strict();

export const getKnowledgeHealthRequestSchema = getPlanHealthRequestSchema;

export const getKnowledgeHealthResponseSchema = z.object({
  issues: z.array(publicRecordSchema),
  unresolved_questions: z.array(publicRecordSchema),
  claims_without_evidence: z.array(publicRecordSchema),
  contradicted_claims: z.array(publicRecordSchema),
  evidence_without_source: z.array(publicRecordSchema),
  isolated_nodes: z.array(publicRecordSchema),
  stale_decisions: z.array(publicRecordSchema),
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
