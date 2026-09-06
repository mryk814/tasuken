import { z } from "zod/v4";
import { TASKEN_MOBILE_API_VERSION, TASKEN_MOBILE_SCHEMA_VERSION } from "./protocol.mjs";

const identity = z.string().trim().min(1).max(200);
export const mobileRelatedDocumentsRequestSchema = z
  .object({
    apiVersion: z.literal(TASKEN_MOBILE_API_VERSION),
    schemaVersion: z.literal(TASKEN_MOBILE_SCHEMA_VERSION),
    taskId: identity,
    limit: z.number().int().min(1).max(50).default(50),
    cursor: z.string().max(2000).optional(),
  })
  .strict();
export const mobileRelatedDocumentRequestSchema = z
  .object({
    apiVersion: z.literal(TASKEN_MOBILE_API_VERSION),
    schemaVersion: z.literal(TASKEN_MOBILE_SCHEMA_VERSION),
    taskId: identity,
    type: z.enum(["note", "capture_entry"]),
    id: identity,
  })
  .strict();
export const mobileRelatedDocumentSummarySchema = z
  .object({
    type: z.enum(["note", "capture_entry"]),
    id: identity,
    title: z.string().max(500),
    version: z.number().int().positive().nullable(),
    status: z.enum(["available", "not_found"]),
    reasons: z
      .array(
        z
          .object({ predicate: z.string().max(200), direction: z.enum(["from_task", "to_task"]) })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
export const mobileRelatedDocumentsDataSchema = z
  .object({
    taskId: identity,
    status: z.enum(["available", "not_found", "cursor_stale"]),
    documents: z.array(mobileRelatedDocumentSummarySchema).max(50),
    nextCursor: z.string().max(2000).nullable(),
  })
  .strict();
export const mobileRelatedDocumentDataSchema = z
  .object({
    taskId: identity,
    type: z.enum(["note", "capture_entry"]),
    id: identity,
    status: z.enum(["available", "not_found", "not_related"]),
    document: z
      .object({
        title: z.string().max(500),
        version: z.number().int().positive(),
        body: z.string().max(50000),
        totalCharacters: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type MobileRelatedDocumentsRequest = z.output<typeof mobileRelatedDocumentsRequestSchema>;
export type MobileRelatedDocumentRequest = z.output<typeof mobileRelatedDocumentRequestSchema>;
export type MobileRelatedDocumentsData = z.output<typeof mobileRelatedDocumentsDataSchema>;
export type MobileRelatedDocumentData = z.output<typeof mobileRelatedDocumentDataSchema>;
