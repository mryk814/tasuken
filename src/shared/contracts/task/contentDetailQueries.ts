import * as z from "zod/v4";

import { nextToolSchema } from "./itemQueries.ts";

const boundedTextLength = z.number().int().positive().max(100_000).optional();

const contentDetailReadError = <Key extends "note_id" | "conversation_id" | "artifact_id">(key: Key) => z.object({
  error: z.object({
    code: z.literal("not_found"),
    message: z.string().trim().min(1),
    [key]: z.string(),
  }).strict(),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
  next_tools: z.array(nextToolSchema).max(4),
}).strict();

const noteNotFoundSchema = contentDetailReadError("note_id");
const conversationNotFoundSchema = contentDetailReadError("conversation_id");
const artifactNotFoundSchema = contentDetailReadError("artifact_id");

export const contentDetailReadErrorSchema = z.union([
  noteNotFoundSchema,
  conversationNotFoundSchema,
  artifactNotFoundSchema,
]);

const entityRefSchema = z.object({
  type: z.string(),
  id: z.string(),
}).strict();

const sourceRefSchema = z.object({
  kind: z.enum(["url", "file", "canonical_document", "conversation", "meeting", "repository", "external_system"]),
  locator: z.string(),
  title: z.string().optional(),
  captured_at: z.string().optional(),
  last_checked_at: z.string().optional(),
  storage_root_id: z.string().optional(),
  relative_path: z.string().optional(),
}).strict();

export const aiHeaderSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  summary: z.string(),
  summary_authority: z.enum(["user_confirmed", "rule_generated", "ai_generated", "excerpt"]).nullable(),
  summary_origin: z.enum(["explicit", "derived", "missing"]),
  freshness: z.enum(["current", "stale", "superseded", "unknown"]),
  freshness_origin: z.enum(["explicit", "derived", "unset"]),
  freshness_reason: z.string(),
  authority: z.enum(["user_confirmed", "imported", "ai_generated", "inferred", "external_source"]).nullable(),
  authority_origin: z.enum(["explicit", "derived", "unset"]),
  authority_reason: z.string(),
  ai_visibility: z.array(z.enum(["m365", "coding_agent", "external_ai"])),
  ai_visibility_source: z.enum(["entity", "theme", "workspace_default"]),
  ai_visibility_reason: z.string(),
  theme_id: z.string().nullable(),
  updated_at: z.string().nullable(),
  last_verified_at: z.string().nullable(),
  superseded_by: entityRefSchema.nullable(),
  source_refs: z.array(sourceRefSchema),
}).strict();

const commonDetailFields = {
  id: z.string(),
  version: z.number().int(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  ai: aiHeaderSchema.optional(),
};

export const noteDetailSchema = z.object({
  ...commonDetailFields,
  title: z.string(),
  note_type: z.string(),
  project_id: z.string().nullable(),
  body_markdown: z.string(),
}).strict();

export const conversationDetailSchema = z.object({
  ...commonDetailFields,
  title: z.string(),
  description: z.string(),
  source_url: z.string().url().nullable(),
  body_markdown: z.string(),
  // Legacy behavior intentionally maps numeric 0 to null, but preserves a
  // non-numeric value if old data contains one.
  message_count: z.union([z.number(), z.string(), z.null()]),
  source_format: z.string().nullable(),
}).strict();

export const artifactMetadataSchema = z.object({
  ...commonDetailFields,
  title: z.string(),
  filename: z.string(),
  file_type: z.string().nullable(),
  mime_type: z.string().nullable(),
  file_size: z.number().nullable(),
  storage_mode: z.string(),
  source_type: z.string().nullable(),
  source_id: z.string().nullable(),
  origin_note_id: z.string().nullable(),
  generated_by: z.string().nullable(),
  description: z.string(),
}).strict();

const noteDetailResponseSchema = z.object({
  note: noteDetailSchema,
  truncated: z.boolean(),
  limits: z.object({ max_text_length: z.number().int().positive().max(100_000) }).strict(),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
  next_tools: z.array(nextToolSchema).max(4),
}).strict();

const conversationDetailResponseSchema = z.object({
  conversation: conversationDetailSchema,
  truncated: z.boolean(),
  limits: z.object({ max_text_length: z.number().int().positive().max(100_000) }).strict(),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
  next_tools: z.array(nextToolSchema).max(4),
}).strict();

const artifactDetailResponseSchema = z.object({
  artifact: artifactMetadataSchema,
  external_file_content_included: z.literal(false),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
  next_tools: z.array(nextToolSchema).max(4),
}).strict();

export const getNoteRequestSchema = z.object({
  note_id: z.string().trim().min(1).max(200),
  max_text_length: boundedTextLength,
  include_archived: z.boolean().optional(),
}).strict();

export const getConversationRequestSchema = z.object({
  conversation_id: z.string().trim().min(1).max(200),
  max_text_length: boundedTextLength,
  include_archived: z.boolean().optional(),
}).strict();

export const getArtifactMetadataRequestSchema = z.object({
  artifact_id: z.string().trim().min(1).max(200),
  include_archived: z.boolean().optional(),
}).strict();

export const getNoteResponseSchema = z.union([noteDetailResponseSchema, noteNotFoundSchema]);
export const getConversationResponseSchema = z.union([conversationDetailResponseSchema, conversationNotFoundSchema]);
export const getArtifactMetadataResponseSchema = z.union([artifactDetailResponseSchema, artifactNotFoundSchema]);

export type GetNoteRequest = z.output<typeof getNoteRequestSchema>;
export type GetConversationRequest = z.output<typeof getConversationRequestSchema>;
export type GetArtifactMetadataRequest = z.output<typeof getArtifactMetadataRequestSchema>;
export type GetNoteResponse = z.output<typeof getNoteResponseSchema>;
export type GetConversationResponse = z.output<typeof getConversationResponseSchema>;
export type GetArtifactMetadataResponse = z.output<typeof getArtifactMetadataResponseSchema>;
