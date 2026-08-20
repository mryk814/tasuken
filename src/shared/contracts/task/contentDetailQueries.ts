import * as z from "zod/v4";

const boundedTextLength = z.number().int().positive().max(100_000).optional();

export const contentDetailReadErrorSchema = z.object({
  error: z.object({
    code: z.literal("not_found"),
    message: z.string().trim().min(1),
    note_id: z.string().optional(),
    conversation_id: z.string().optional(),
    artifact_id: z.string().optional(),
  }).strict(),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
}).strict();

const aiHeaderSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  summary: z.string(),
});

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
}).strict();

const conversationDetailResponseSchema = z.object({
  conversation: conversationDetailSchema,
  truncated: z.boolean(),
  limits: z.object({ max_text_length: z.number().int().positive().max(100_000) }).strict(),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
}).strict();

const artifactDetailResponseSchema = z.object({
  artifact: artifactMetadataSchema,
  external_file_content_included: z.literal(false),
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
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

export const getNoteResponseSchema = z.union([noteDetailResponseSchema, contentDetailReadErrorSchema]);
export const getConversationResponseSchema = z.union([conversationDetailResponseSchema, contentDetailReadErrorSchema]);
export const getArtifactMetadataResponseSchema = z.union([artifactDetailResponseSchema, contentDetailReadErrorSchema]);

export type GetNoteRequest = z.output<typeof getNoteRequestSchema>;
export type GetConversationRequest = z.output<typeof getConversationRequestSchema>;
export type GetArtifactMetadataRequest = z.output<typeof getArtifactMetadataRequestSchema>;
export type GetNoteResponse = z.output<typeof getNoteResponseSchema>;
export type GetConversationResponse = z.output<typeof getConversationResponseSchema>;
export type GetArtifactMetadataResponse = z.output<typeof getArtifactMetadataResponseSchema>;
