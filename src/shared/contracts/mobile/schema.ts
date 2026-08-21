import * as z from "zod/v4";

import { entityIdSchema, entityVersionSchema, isoTimestampSchema, localDateSchema } from "../../kernel/public.ts";
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
  TASKEN_MOBILE_CAPABILITIES.taskWrite,
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
  "pairing_code_invalid",
  "rate_limited",
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
  version: entityVersionSchema,
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

const mobileTaskCommandSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("CreateTask"),
    task: mobileCreateTaskCandidateSchema,
  }).strict(),
  z.object({
    name: z.literal("CompleteTask"),
    taskId: taskIdSchema,
    expectedVersion: entityVersionSchema,
  }).strict(),
  z.object({
    name: z.literal("ReopenTask"),
    taskId: taskIdSchema,
    expectedVersion: entityVersionSchema,
  }).strict(),
]);

export const mobileTaskCommandRequestSchema = z.object({
  apiVersion: apiVersionSchema,
  schemaVersion: schemaVersionSchema,
  requestId: requestIdSchema,
  commandId: entityIdSchema,
  idempotencyKey: entityIdSchema,
  clientDeviceId: entityIdSchema,
  issuedAt: isoTimestampSchema,
  command: mobileTaskCommandSchema,
}).strict().refine((value) => value.commandId === value.idempotencyKey, {
  path: ["idempotencyKey"],
  message: "commandIdとidempotencyKeyを一致させてください。",
});

export const mobileTaskCommandResponseSchema = z.object({
  ok: z.literal(true),
  meta: mobileResponseMetaSchema,
  data: z.object({
    commandId: entityIdSchema,
    status: z.enum(["applied", "no_change"]),
    task: mobileTaskSummarySchema,
  }).strict(),
}).strict();

export const mobilePairRequestSchema = z.object({
  apiVersion: apiVersionSchema,
  schemaVersion: schemaVersionSchema,
  requestId: requestIdSchema,
  pairingCode: z.string().regex(/^\d{8}$/),
  clientDeviceId: entityIdSchema,
  deviceLabel: z.string().trim().min(1).max(80),
}).strict();

export const mobilePairResponseSchema = z.object({
  ok: z.literal(true),
  meta: mobileResponseMetaSchema,
  data: z.object({
    deviceId: entityIdSchema,
    deviceLabel: z.string().trim().min(1).max(80),
    accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    scopes: z.array(mobileScopeSchema).min(1).max(10),
    pairedAt: isoTimestampSchema,
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
export type MobileTaskCommandRequest = z.output<typeof mobileTaskCommandRequestSchema>;
export type MobileTaskCommandResponse = z.output<typeof mobileTaskCommandResponseSchema>;
export type MobilePairRequest = z.output<typeof mobilePairRequestSchema>;
export type MobilePairResponse = z.output<typeof mobilePairResponseSchema>;
export type MobileErrorResponse = z.output<typeof mobileErrorResponseSchema>;
