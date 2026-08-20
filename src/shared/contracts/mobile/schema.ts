import * as z from "zod/v4";

import { entityIdSchema, isoTimestampSchema, localDateSchema } from "../../kernel/public.ts";
import {
  taskIdSchema,
  taskIntendedExecutorSchema,
  taskPrioritySchema,
  taskRequesterSchema,
  taskStateSchema,
  taskWorkStateSchema,
} from "../task/public.ts";
import {
  TASKEN_MOBILE_API_VERSION,
  TASKEN_MOBILE_CAPABILITIES,
  TASKEN_MOBILE_MAX_ITEMS,
  TASKEN_MOBILE_SCHEMA_VERSION,
} from "./public.mjs";

const apiVersionSchema = z.literal(TASKEN_MOBILE_API_VERSION);
const schemaVersionSchema = z.literal(TASKEN_MOBILE_SCHEMA_VERSION);
const requestIdSchema = entityIdSchema;

export const mobileCapabilitySchema = z.enum([
  TASKEN_MOBILE_CAPABILITIES.health,
  TASKEN_MOBILE_CAPABILITIES.todayRead,
  TASKEN_MOBILE_CAPABILITIES.taskCreate,
]);

export const mobileScopeSchema = z.enum(["mobile:read", "mobile:task-write"]);

export const mobileResponseMetaSchema = z.object({
  apiVersion: apiVersionSchema,
  schemaVersion: schemaVersionSchema,
  serverId: z.string().trim().min(1).max(200),
  serverRevision: z.number().int().nonnegative(),
  generatedAt: isoTimestampSchema,
  truncated: z.boolean(),
}).strict();

export const mobileErrorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "validation_failed",
  "not_found",
  "method_not_allowed",
  "version_mismatch",
  "idempotency_conflict",
  "entity_conflict",
  "version_conflict",
  "capability_unavailable",
  "upstream_unavailable",
  "response_too_large",
  "internal_error",
]);

export const mobileErrorSchema = z.object({
  code: mobileErrorCodeSchema,
  message: z.string().trim().min(1).max(300),
  retryable: z.boolean(),
}).strict();

export const mobileHealthResponseSchema = z.object({
  ok: z.literal(true),
  meta: mobileResponseMetaSchema,
  data: z.object({
    status: z.literal("ready"),
    capabilities: z.array(mobileCapabilitySchema).max(10),
  }).strict(),
}).strict();

export const mobileTodayRequestSchema = z.object({
  apiVersion: apiVersionSchema,
  schemaVersion: schemaVersionSchema,
  requestId: requestIdSchema,
  date: localDateSchema,
  limit: z.number().int().positive().max(TASKEN_MOBILE_MAX_ITEMS).default(20),
}).strict();

export const mobileTaskSummarySchema = z.object({
  id: taskIdSchema,
  title: z.string().trim().min(1).max(500),
  themeId: entityIdSchema.nullable(),
  state: taskStateSchema,
  workState: taskWorkStateSchema.nullable(),
  updatedAt: isoTimestampSchema,
}).strict();

export const mobileTodayResponseSchema = z.object({
  ok: z.literal(true),
  meta: mobileResponseMetaSchema,
  data: z.object({
    date: localDateSchema,
    items: z.array(mobileTaskSummarySchema).max(TASKEN_MOBILE_MAX_ITEMS),
    nextCursor: z.string().max(1000).nullable(),
  }).strict(),
}).strict();

const mobileCreateTaskCandidateSchema = z.object({
  id: taskIdSchema,
  title: z.string().trim().min(1).max(500),
  projectId: entityIdSchema.nullable().optional(),
  state: taskStateSchema.default("todo"),
  priority: taskPrioritySchema.default("normal"),
  requester: taskRequesterSchema.default("self"),
  intendedExecutor: taskIntendedExecutorSchema.default("self"),
  todayDate: localDateSchema.nullable().optional(),
}).strict();

export const mobileCreateTaskRequestSchema = z.object({
  apiVersion: apiVersionSchema,
  schemaVersion: schemaVersionSchema,
  requestId: requestIdSchema,
  commandId: entityIdSchema,
  idempotencyKey: entityIdSchema,
  clientDeviceId: entityIdSchema,
  issuedAt: isoTimestampSchema,
  command: z.object({
    name: z.literal("CreateTask"),
    task: mobileCreateTaskCandidateSchema,
  }).strict(),
}).strict().refine((value) => value.commandId === value.idempotencyKey, {
  path: ["idempotencyKey"],
  message: "Phase 4AではcommandIdとidempotencyKeyを一致させてください。",
});

export const mobileCreateTaskResponseSchema = z.object({
  ok: z.literal(true),
  meta: mobileResponseMetaSchema,
  data: z.object({
    commandId: entityIdSchema,
    status: z.enum(["applied", "no_change"]),
    task: mobileTaskSummarySchema,
  }).strict(),
}).strict();

export const mobileErrorResponseSchema = z.object({
  ok: z.literal(false),
  meta: mobileResponseMetaSchema,
  error: mobileErrorSchema,
}).strict();

export type MobileCapability = z.output<typeof mobileCapabilitySchema>;
export type MobileScope = z.output<typeof mobileScopeSchema>;
export type MobileResponseMeta = z.output<typeof mobileResponseMetaSchema>;
export type MobileErrorCode = z.output<typeof mobileErrorCodeSchema>;
export type MobileHealthResponse = z.output<typeof mobileHealthResponseSchema>;
export type MobileTodayRequest = z.output<typeof mobileTodayRequestSchema>;
export type MobileTodayResponse = z.output<typeof mobileTodayResponseSchema>;
export type MobileCreateTaskRequest = z.output<typeof mobileCreateTaskRequestSchema>;
export type MobileCreateTaskResponse = z.output<typeof mobileCreateTaskResponseSchema>;
export type MobileErrorResponse = z.output<typeof mobileErrorResponseSchema>;
