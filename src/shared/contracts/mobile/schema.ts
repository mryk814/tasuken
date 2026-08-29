import * as z from "zod/v4";

import {
  entityIdSchema,
  entityVersionSchema,
  isoTimestampSchema,
  localDateSchema,
} from "../../kernel/public.ts";
import {
  taskIdSchema,
  taskCreationReportedViaSchema,
  taskIntendedExecutorSchema,
  taskPrioritySchema,
  taskRequesterSchema,
  taskScheduleConfidenceSchema,
  taskScheduleDateKindSchema,
  taskScheduleGranularitySchema,
  taskScheduleRangeSemanticsSchema,
  taskStateSchema,
  taskSpeechRecognitionModeSchema,
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

export const TASKEN_MOBILE_THEME_CURSOR_MAX_LENGTH = 200;
const TASKEN_MOBILE_THEME_CURSOR_VERSION = 1;
const TASKEN_MOBILE_THEME_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export function encodeTaskenMobileThemeCursor(fingerprint: string, position: number): string {
  if (
    !TASKEN_MOBILE_THEME_FINGERPRINT_PATTERN.test(fingerprint) ||
    !Number.isSafeInteger(position) ||
    position <= 0
  ) {
    throw new TypeError("Invalid Mobile Theme cursor payload");
  }
  return globalThis
    .btoa(
      JSON.stringify({
        v: TASKEN_MOBILE_THEME_CURSOR_VERSION,
        fingerprint,
        position,
      }),
    )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function decodeTaskenMobileThemeCursor(
  cursor: unknown,
): { fingerprint: string; position: number } | null {
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > TASKEN_MOBILE_THEME_CURSOR_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(cursor)
  )
    return null;
  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded: unknown = JSON.parse(
      globalThis.atob(`${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`),
    );
    if (
      !decoded ||
      typeof decoded !== "object" ||
      Array.isArray(decoded) ||
      Object.keys(decoded).sort().join(",") !== "fingerprint,position,v"
    )
      return null;
    const payload = decoded as { v?: unknown; fingerprint?: unknown; position?: unknown };
    if (
      payload.v !== TASKEN_MOBILE_THEME_CURSOR_VERSION ||
      typeof payload.fingerprint !== "string" ||
      !TASKEN_MOBILE_THEME_FINGERPRINT_PATTERN.test(payload.fingerprint) ||
      typeof payload.position !== "number" ||
      !Number.isSafeInteger(payload.position) ||
      payload.position <= 0
    )
      return null;
    const position = payload.position;
    if (encodeTaskenMobileThemeCursor(payload.fingerprint, position) !== cursor) return null;
    return { fingerprint: payload.fingerprint, position };
  } catch {
    return null;
  }
}

export const mobileCapabilitySchema = z.enum([
  TASKEN_MOBILE_CAPABILITIES.health,
  TASKEN_MOBILE_CAPABILITIES.todayRead,
  TASKEN_MOBILE_CAPABILITIES.syncRead,
  TASKEN_MOBILE_CAPABILITIES.workReceiptRead,
  TASKEN_MOBILE_CAPABILITIES.proposalRead,
  TASKEN_MOBILE_CAPABILITIES.proposalReview,
  TASKEN_MOBILE_CAPABILITIES.humanReview,
  TASKEN_MOBILE_CAPABILITIES.taskWrite,
  TASKEN_MOBILE_CAPABILITIES.captureWrite,
]);

export const mobileScopeSchema = z.enum([
  "mobile:read",
  "mobile:task-write",
  "mobile:capture-write",
  "mobile:proposal-review",
  "mobile:human-review",
]);

export const mobileResponseMetaSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    serverId: z.string().trim().min(1).max(200),
    serverRevision: z.number().int().nonnegative(),
    generatedAt: isoTimestampSchema,
    truncated: z.boolean(),
  })
  .strict();

export const mobileErrorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "validation_failed",
  "pairing_code_invalid",
  "rate_limited",
  "not_found",
  "theme_not_found",
  "method_not_allowed",
  "version_mismatch",
  "idempotency_conflict",
  "entity_conflict",
  "version_conflict",
  "proposal_conflict",
  "work_review_conflict",
  "capability_unavailable",
  "upstream_unavailable",
  "response_too_large",
  "internal_error",
]);

export const mobileHealthResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        status: z.literal("ready"),
        capabilities: z.array(mobileCapabilitySchema).max(10),
      })
      .strict(),
  })
  .strict();

export const mobileTodayRequestSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    requestId: requestIdSchema,
    date: localDateSchema,
    limit: z.number().int().positive().max(TASKEN_MOBILE_MAX_ITEMS).default(20),
  })
  .strict();

export const mobileTaskScheduleSchema = z
  .object({
    id: entityIdSchema,
    version: entityVersionSchema,
    startDate: localDateSchema.nullable(),
    endDate: localDateSchema.nullable(),
    dateKind: taskScheduleDateKindSchema,
    rangeSemantics: taskScheduleRangeSemanticsSchema.nullable(),
    confidence: taskScheduleConfidenceSchema,
    granularity: taskScheduleGranularitySchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateMobileScheduleDates(value, context);
    const expectedDateKind =
      !value.startDate && !value.endDate
        ? "unknown"
        : !value.startDate
          ? "deadline"
          : !value.endDate || value.startDate === value.endDate
            ? "point"
            : "range";
    if (value.dateKind !== expectedDateKind) {
      context.addIssue({
        code: "custom",
        path: ["dateKind"],
        message: "dateKindはstartDate/endDateから導出した値と一致する必要があります。",
      });
    }
  });

const mobilePlannedStartTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();
const mobilePlannedDurationMinutesSchema = z.number().int().positive().max(10080).nullable();

export const mobileWorkReceiptSummarySchema = z
  .object({
    id: entityIdSchema,
    reportedAt: isoTimestampSchema,
    executorLabel: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(2000),
  })
  .strict();

export const TASKEN_MOBILE_WORK_RECEIPT_MAX_LIST_ITEMS = 20;
export const TASKEN_MOBILE_WORK_RECEIPT_MAX_ITEM_LENGTH = 400;
export const TASKEN_MOBILE_WORK_RECEIPT_MAX_EXTERNAL_REFERENCES = 10;
export const TASKEN_MOBILE_WORK_RECEIPT_MAX_EXTERNAL_URL_LENGTH = 2000;

const mobileWorkReceiptItemSchema = z
  .string()
  .trim()
  .min(1)
  .max(TASKEN_MOBILE_WORK_RECEIPT_MAX_ITEM_LENGTH);

const mobileWorkReceiptItemListSchema = z
  .array(mobileWorkReceiptItemSchema)
  .max(TASKEN_MOBILE_WORK_RECEIPT_MAX_LIST_ITEMS);

export const mobileWorkReceiptExternalReferenceSchema = z
  .object({
    kind: z.enum([
      "issue",
      "pull_request",
      "merge_request",
      "commit",
      "branch",
      "file",
      "pipeline",
      "other",
    ]),
    provider: z.string().trim().max(120).nullable(),
    displayLabel: z.string().trim().min(1).max(200),
    url: z
      .string()
      .trim()
      .url()
      .max(TASKEN_MOBILE_WORK_RECEIPT_MAX_EXTERNAL_URL_LENGTH)
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "https:" && !parsed.username && !parsed.password;
        } catch {
          return false;
        }
      }, "Work Receipt external referenceはcredentialを含まないHTTPS URLが必要です。"),
    externalId: z.string().trim().max(200).nullable(),
  })
  .strict();

export const mobileWorkReceiptRequestSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    requestId: requestIdSchema,
    taskId: taskIdSchema,
    receiptId: entityIdSchema,
  })
  .strict();

export const mobileWorkReceiptDetailSchema = z
  .object({
    id: entityIdSchema,
    taskId: taskIdSchema,
    executorKind: z.enum(["self", "human", "ai_agent", "external", "unknown"]),
    executorLabel: z.string().trim().min(1).max(200),
    startedAt: isoTimestampSchema.nullable(),
    reportedAt: isoTimestampSchema,
    reportKind: z.enum(["report", "blocked"]),
    summary: z.string().trim().min(1).max(10000),
    completedItems: mobileWorkReceiptItemListSchema,
    changedOrCreatedItems: mobileWorkReceiptItemListSchema,
    verification: mobileWorkReceiptItemListSchema,
    remainingWork: mobileWorkReceiptItemListSchema,
    externalReferences: z
      .array(mobileWorkReceiptExternalReferenceSchema)
      .max(TASKEN_MOBILE_WORK_RECEIPT_MAX_EXTERNAL_REFERENCES),
  })
  .strict();

export const mobileWorkReceiptResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        receipt: mobileWorkReceiptDetailSchema,
      })
      .strict(),
  })
  .strict();

export const TASKEN_MOBILE_PROPOSAL_MAX_ITEMS = 50;
export const mobileTaskWorkProposalActionSchema = z.enum([
  "start",
  "append_receipt",
  "report_done",
  "report_blocked",
]);

export const mobileTaskWorkProposalSchema = z
  .object({
    id: entityIdSchema,
    version: entityVersionSchema,
    status: z.literal("pending"),
    task: z
      .object({
        id: taskIdSchema,
        version: entityVersionSchema,
        title: z.string().trim().min(1).max(500),
        themeId: entityIdSchema.nullable(),
        workState: taskWorkStateSchema.nullable(),
      })
      .strict(),
    action: mobileTaskWorkProposalActionSchema,
    caller: z.string().trim().min(1).max(200),
    sourceApp: z.string().trim().min(1).max(120),
    receivedAt: isoTimestampSchema,
    expectedTaskVersion: entityVersionSchema,
    stale: z.boolean(),
    executorLabel: z.string().trim().min(1).max(200).nullable(),
    startedAt: isoTimestampSchema.nullable(),
    reportedAt: isoTimestampSchema.nullable(),
    summary: z.string().trim().min(1).max(10000).nullable(),
    completedItems: mobileWorkReceiptItemListSchema,
    changedOrCreatedItems: mobileWorkReceiptItemListSchema,
    verification: mobileWorkReceiptItemListSchema,
    remainingWork: mobileWorkReceiptItemListSchema,
    externalReferences: z
      .array(mobileWorkReceiptExternalReferenceSchema)
      .max(TASKEN_MOBILE_WORK_RECEIPT_MAX_EXTERNAL_REFERENCES),
  })
  .strict();

export const mobileTaskWorkProposalsRequestSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    requestId: requestIdSchema,
    limit: z
      .number()
      .int()
      .positive()
      .max(TASKEN_MOBILE_PROPOSAL_MAX_ITEMS)
      .default(TASKEN_MOBILE_PROPOSAL_MAX_ITEMS),
  })
  .strict();

export const mobileTaskWorkProposalsResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        proposals: z.array(mobileTaskWorkProposalSchema).max(TASKEN_MOBILE_PROPOSAL_MAX_ITEMS),
      })
      .strict(),
  })
  .strict();

export const mobileTaskWorkProposalDecisionRequestSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    requestId: requestIdSchema,
    commandId: entityIdSchema,
    idempotencyKey: entityIdSchema,
    clientDeviceId: entityIdSchema,
    issuedAt: isoTimestampSchema,
    proposalId: entityIdSchema,
    taskId: taskIdSchema,
    expectedProposalVersion: entityVersionSchema,
    expectedTaskVersion: entityVersionSchema,
    decision: z.enum(["accept", "reject"]),
  })
  .strict()
  .refine((value) => value.commandId === value.idempotencyKey, {
    path: ["idempotencyKey"],
    message: "commandIdとidempotencyKeyを一致させてください。",
  });

export const mobileTaskWorkProposalDecisionResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        commandId: entityIdSchema,
        commandStatus: z.enum(["applied", "no_change"]),
        proposalId: entityIdSchema,
        proposalStatus: z.enum(["accepted", "rejected"]),
        decision: z.enum(["accept", "reject"]),
        taskId: taskIdSchema,
        taskVersion: entityVersionSchema,
      })
      .strict(),
  })
  .strict();

export const mobileTaskWorkReviewRequestSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    requestId: requestIdSchema,
    commandId: entityIdSchema,
    idempotencyKey: entityIdSchema,
    clientDeviceId: entityIdSchema,
    issuedAt: isoTimestampSchema,
    taskId: taskIdSchema,
    expectedTaskVersion: entityVersionSchema,
    receiptId: entityIdSchema,
    action: z.enum(["accept", "return"]),
    reviewNote: z.string().trim().max(2000).nullable(),
  })
  .strict()
  .refine((value) => value.commandId === value.idempotencyKey, {
    path: ["idempotencyKey"],
    message: "commandIdとidempotencyKeyを一致させてください。",
  })
  .refine(
    (value) => (value.action === "return" ? Boolean(value.reviewNote) : value.reviewNote === null),
    {
      path: ["reviewNote"],
      message: "差戻しまたはblocked返信にはreviewNoteが必要です。承認時はnullにしてください。",
    },
  );

export const mobileChecklistItemSchema = z
  .object({
    id: entityIdSchema,
    title: z.string().trim().min(1).max(200),
    done: z.boolean(),
    sortOrder: z.number().finite(),
    completedAt: isoTimestampSchema.nullable(),
  })
  .strict();

const mobileChecklistSchema = z
  .array(mobileChecklistItemSchema)
  .max(100)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Checklist item IDは重複できません。",
        });
      }
      seen.add(item.id);
    });
  });

export const mobileTaskSummarySchema = z
  .object({
    id: taskIdSchema,
    version: entityVersionSchema,
    title: z.string().trim().min(1).max(500),
    themeId: entityIdSchema.nullable(),
    state: taskStateSchema,
    workState: taskWorkStateSchema.nullable(),
    todayDate: localDateSchema.nullable().optional(),
    plannedStartTime: mobilePlannedStartTimeSchema.optional(),
    plannedDurationMinutes: mobilePlannedDurationMinutesSchema.optional(),
    latestWorkReceipt: mobileWorkReceiptSummarySchema.nullable().optional(),
    checklistItems: mobileChecklistSchema.default([]),
    schedule: mobileTaskScheduleSchema.nullable(),
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const mobileTaskWorkReviewResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        commandId: entityIdSchema,
        commandStatus: z.enum(["applied", "no_change"]),
        action: z.enum(["accept", "return"]),
        receiptId: entityIdSchema,
        task: mobileTaskSummarySchema,
      })
      .strict(),
  })
  .strict();

export const mobileVersionConflictSchema = z
  .object({
    currentTask: mobileTaskSummarySchema,
    intendedAction: z.enum(["UpdateTask", "CompleteTask", "ReopenTask", "DeleteTask"]),
    expectedVersion: entityVersionSchema,
    conflictField: z.enum(["task", "schedule"]),
    expectedScheduleVersion: entityVersionSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.conflictField === "task") {
      if (value.expectedScheduleVersion !== null) {
        context.addIssue({
          code: "custom",
          path: ["expectedScheduleVersion"],
          message: "Task競合はSchedule versionを持てません。",
        });
      }
      if (value.currentTask.version <= value.expectedVersion) {
        context.addIssue({
          code: "custom",
          path: ["currentTask", "version"],
          message: "Task競合のcurrentTaskはexpectedVersionより新しい必要があります。",
        });
      }
      return;
    }
    if (value.intendedAction !== "UpdateTask") {
      context.addIssue({
        code: "custom",
        path: ["intendedAction"],
        message: "Schedule競合はUpdateTaskでだけ返せます。",
      });
    }
    if (
      value.expectedScheduleVersion !== null &&
      value.currentTask.schedule !== null &&
      value.currentTask.schedule.version === value.expectedScheduleVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentTask", "schedule", "version"],
        message: "Schedule競合のcurrent ScheduleはexpectedScheduleVersionと異なる必要があります。",
      });
    }
  });

export const mobileErrorSchema = z
  .object({
    code: mobileErrorCodeSchema,
    message: z.string().trim().min(1).max(300),
    retryable: z.boolean(),
    conflict: mobileVersionConflictSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.code === "version_conflict") !== (value.conflict !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["conflict"],
        message: "version_conflictだけが競合詳細を持てます。",
      });
    }
  });

export const mobileTodayResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        date: localDateSchema,
        items: z.array(mobileTaskSummarySchema).max(TASKEN_MOBILE_MAX_ITEMS),
        nextCursor: z.string().max(1000).nullable(),
      })
      .strict(),
  })
  .strict();

export const mobileThemeCatalogItemSchema = z
  .object({
    id: entityIdSchema,
    title: z.string().trim().min(1).max(500),
  })
  .strict();

export const mobileThemeCursorSchema = z
  .string()
  .max(TASKEN_MOBILE_THEME_CURSOR_MAX_LENGTH)
  .refine((value) => decodeTaskenMobileThemeCursor(value) !== null, "Theme cursorが不正です。");

export const mobileThemesRequestSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    requestId: requestIdSchema,
    cursor: mobileThemeCursorSchema.optional(),
    limit: z
      .number()
      .int()
      .positive()
      .max(TASKEN_MOBILE_MAX_ITEMS)
      .default(TASKEN_MOBILE_MAX_ITEMS),
  })
  .strict();

export const mobileThemesResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        themes: z.array(mobileThemeCatalogItemSchema).max(TASKEN_MOBILE_MAX_ITEMS),
        nextCursor: mobileThemeCursorSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 1; index < value.data.themes.length; index += 1) {
      if (value.data.themes[index - 1].id >= value.data.themes[index].id) {
        context.addIssue({
          code: "custom",
          path: ["data", "themes", index, "id"],
          message: "Theme IDは重複せず昇順である必要があります。",
        });
      }
    }
    if (value.meta.truncated !== (value.data.nextCursor !== null)) {
      context.addIssue({
        code: "custom",
        path: ["data", "nextCursor"],
        message: "nextCursorはtruncatedと一致する必要があります。",
      });
    }
    if (value.data.nextCursor !== null && value.data.themes.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["data", "nextCursor"],
        message: "空のTheme pageはnextCursorを持てません。",
      });
    }
  });

const mobileSyncRequestBase = {
  apiVersion: apiVersionSchema,
  schemaVersion: schemaVersionSchema,
  requestId: requestIdSchema,
  limit: z.number().int().positive().max(TASKEN_MOBILE_MAX_ITEMS).default(TASKEN_MOBILE_MAX_ITEMS),
};

export const mobileBootstrapRequestSchema = z
  .object({
    ...mobileSyncRequestBase,
  })
  .strict();

export const mobileBootstrapResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        tasks: z.array(mobileTaskSummarySchema).max(TASKEN_MOBILE_MAX_ITEMS),
        nextCursor: z.string().max(1000).nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const mobileSyncRequestSchema = z
  .object({
    ...mobileSyncRequestBase,
    cursor: z.string().max(1000),
  })
  .strict();

export const mobileSyncChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("upsert"),
      task: mobileTaskSummarySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tombstone"),
      entityType: z.literal("task"),
      id: taskIdSchema,
      version: entityVersionSchema,
      updatedAt: isoTimestampSchema,
    })
    .strict(),
]);

export const mobileSyncResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        changes: z.array(mobileSyncChangeSchema).max(TASKEN_MOBILE_MAX_ITEMS),
        nextCursor: z.string().max(1000),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

const mobileCreateTaskCandidateSchema = z
  .object({
    id: taskIdSchema,
    title: z.string().trim().min(1).max(500),
    projectId: entityIdSchema.nullable().optional(),
    state: taskStateSchema.default("todo"),
    priority: taskPrioritySchema.default("normal"),
    requester: taskRequesterSchema.default("self"),
    intendedExecutor: taskIntendedExecutorSchema.default("self"),
    todayDate: localDateSchema.nullable().optional(),
  })
  .strict();

export const mobileTaskCreationProvenanceSchema = z
  .object({
    reportedVia: taskCreationReportedViaSchema,
    capturedAt: isoTimestampSchema,
    captureMethod: z.literal("android_speech").nullable(),
    recognitionMode: taskSpeechRecognitionModeSchema.nullable(),
    language: z.string().trim().min(1).max(64).nullable(),
    confidence: z.number().finite().min(0).max(1).nullable(),
    sourceAudioAvailable: z.literal(false).nullable(),
    sharedMimeType: z.literal("text/plain").nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasSpeech = value.captureMethod === "android_speech";
    if (hasSpeech) {
      if (value.reportedVia !== "android_speech") {
        context.addIssue({
          code: "custom",
          path: ["reportedVia"],
          message: "音声認識結果はandroid_speech入力だけに指定できます。",
        });
      }
      if (
        value.recognitionMode === null ||
        value.language === null ||
        value.sourceAudioAvailable !== false
      ) {
        context.addIssue({
          code: "custom",
          path: ["captureMethod"],
          message: "音声認識のmode・language・sourceAudioAvailableが必要です。",
        });
      }
    } else if (
      value.recognitionMode !== null ||
      value.language !== null ||
      value.confidence !== null ||
      value.sourceAudioAvailable !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["captureMethod"],
        message: "音声認識metadataにはcaptureMethodが必要です。",
      });
    }
    if ((value.reportedVia === "share_target") !== (value.sharedMimeType !== null)) {
      context.addIssue({
        code: "custom",
        path: ["sharedMimeType"],
        message: "Share Target入力にはtext/plain MIMEを指定してください。",
      });
    }
  });

export const mobileCaptureCreationProvenanceSchema = mobileTaskCreationProvenanceSchema;

const mobileScheduleEditFields = {
  startDate: localDateSchema.nullable(),
  endDate: localDateSchema.nullable(),
  rangeSemantics: taskScheduleRangeSemanticsSchema.nullable(),
};

function validateMobileScheduleDates(
  value: {
    startDate: string | null;
    endDate: string | null;
    rangeSemantics: "once_within_window" | "ongoing" | null;
  },
  context: z.RefinementCtx,
) {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "endDateはstartDate以降にしてください。",
    });
  }
  const isRange = Boolean(value.startDate && value.endDate && value.endDate > value.startDate);
  if (value.rangeSemantics !== null && !isRange) {
    context.addIssue({
      code: "custom",
      path: ["rangeSemantics"],
      message: "rangeSemanticsは開始日と終了日が異なる期間にだけ指定できます。",
    });
  }
}

const mobileScheduleEditSchema = z
  .object(mobileScheduleEditFields)
  .strict()
  .superRefine(validateMobileScheduleDates);
const mobileScheduleBaseSchema = z
  .object(mobileScheduleEditFields)
  .strict()
  .superRefine(validateMobileScheduleDates);

const mobileTaskUpdatePatchSchema = z.union([
  z.object({ title: z.string().trim().min(1).max(500) }).strict(),
  z.object({ todayDate: localDateSchema.nullable() }).strict(),
  z.object({ themeId: entityIdSchema.nullable() }).strict(),
  z.object({ schedule: mobileScheduleEditSchema }).strict(),
  z.object({ checklistItems: mobileChecklistSchema }).strict(),
]);

const mobileTaskUpdateBaseSchema = z.union([
  z.object({ title: z.string().trim().min(1).max(500) }).strict(),
  z.object({ todayDate: localDateSchema.nullable() }).strict(),
  z.object({ themeId: entityIdSchema.nullable() }).strict(),
  z.object({ schedule: mobileScheduleBaseSchema.nullable() }).strict(),
  z.object({ checklistItems: mobileChecklistSchema }).strict(),
]);

const mobileTaskCommandSchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("CreateTask"),
      task: mobileCreateTaskCandidateSchema,
      provenance: mobileTaskCreationProvenanceSchema.optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("UpdateTask"),
      taskId: taskIdSchema,
      expectedVersion: entityVersionSchema,
      expectedScheduleVersion: entityVersionSchema.nullable(),
      changes: mobileTaskUpdatePatchSchema,
      base: mobileTaskUpdateBaseSchema,
    })
    .strict()
    .superRefine((value, context) => {
      const changedKey = Object.keys(value.changes)[0];
      const baseKey = Object.keys(value.base)[0];
      if (changedKey !== baseKey) {
        context.addIssue({
          code: "custom",
          path: ["base"],
          message: "baseはchangesと同じfieldを持つ必要があります。",
        });
      }
      if (changedKey !== "schedule") {
        if (value.expectedScheduleVersion !== null) {
          context.addIssue({
            code: "custom",
            path: ["expectedScheduleVersion"],
            message: "Schedule以外の更新ではexpectedScheduleVersionをnullにしてください。",
          });
        }
        return;
      }
      const changes = mobileTaskUpdatePatchSchema.options[3].parse(value.changes).schedule;
      const base = mobileTaskUpdateBaseSchema.options[3].parse(value.base).schedule;
      if (base === null) {
        if (value.expectedScheduleVersion !== null) {
          context.addIssue({
            code: "custom",
            path: ["expectedScheduleVersion"],
            message: "新規ScheduleのexpectedScheduleVersionはnullにしてください。",
          });
        }
        if (changes.startDate === null && changes.endDate === null) {
          context.addIssue({
            code: "custom",
            path: ["changes", "schedule"],
            message: "新規Scheduleには開始日または終了日が必要です。",
          });
        }
        return;
      }
      if (value.expectedScheduleVersion === null) {
        context.addIssue({
          code: "custom",
          path: ["expectedScheduleVersion"],
          message: "既存Scheduleの更新にはexpectedScheduleVersionが必要です。",
        });
      }
    }),
  z
    .object({
      name: z.literal("CompleteTask"),
      taskId: taskIdSchema,
      expectedVersion: entityVersionSchema,
    })
    .strict(),
  z
    .object({
      name: z.literal("ReopenTask"),
      taskId: taskIdSchema,
      expectedVersion: entityVersionSchema,
    })
    .strict(),
  z
    .object({
      name: z.literal("DeleteTask"),
      taskId: taskIdSchema,
      expectedVersion: entityVersionSchema,
    })
    .strict(),
]);

export const mobileTaskCommandRequestSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    requestId: requestIdSchema,
    commandId: entityIdSchema,
    idempotencyKey: entityIdSchema,
    clientDeviceId: entityIdSchema,
    issuedAt: isoTimestampSchema,
    command: mobileTaskCommandSchema,
  })
  .strict()
  .refine((value) => value.commandId === value.idempotencyKey, {
    path: ["idempotencyKey"],
    message: "commandIdとidempotencyKeyを一致させてください。",
  });

export const mobileTaskCommandResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        commandId: entityIdSchema,
        status: z.enum(["applied", "no_change"]),
        task: mobileTaskSummarySchema,
      })
      .strict(),
  })
  .strict();

const mobileCreateCaptureCandidateSchema = z
  .object({
    id: entityIdSchema,
    text: z.string().trim().min(1).max(500),
    projectId: entityIdSchema.nullable().optional(),
    capturedAt: isoTimestampSchema,
  })
  .strict();

const mobileCaptureCommandSchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("CreateCapture"),
      capture: mobileCreateCaptureCandidateSchema,
      provenance: mobileCaptureCreationProvenanceSchema.optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("DeleteCapture"),
      captureId: entityIdSchema,
      expectedVersion: entityVersionSchema,
    })
    .strict(),
]);

export const mobileCaptureCommandRequestSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    requestId: requestIdSchema,
    commandId: entityIdSchema,
    idempotencyKey: entityIdSchema,
    clientDeviceId: entityIdSchema,
    issuedAt: isoTimestampSchema,
    command: mobileCaptureCommandSchema,
  })
  .strict()
  .refine((value) => value.commandId === value.idempotencyKey, {
    path: ["idempotencyKey"],
    message: "commandIdとidempotencyKeyを一致させてください。",
  })
  .refine(
    (value) =>
      value.command.name !== "CreateCapture" || value.command.capture.capturedAt === value.issuedAt,
    {
      path: ["command", "capture", "capturedAt"],
      message: "capturedAtとissuedAtを一致させてください。",
    },
  )
  .refine(
    (value) =>
      value.command.name !== "CreateCapture" ||
      value.command.provenance === undefined ||
      value.command.provenance.capturedAt === value.command.capture.capturedAt,
    {
      path: ["command", "provenance", "capturedAt"],
      message: "provenanceのcapturedAtを一致させてください。",
    },
  );

export const mobileCommandRequestSchema = z.union([
  mobileTaskCommandRequestSchema,
  mobileCaptureCommandRequestSchema,
]);

export const mobileCaptureCommandResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        commandId: entityIdSchema,
        status: z.enum(["applied", "no_change"]),
        capture: z
          .object({
            id: entityIdSchema,
            version: entityVersionSchema,
            capturedAt: isoTimestampSchema,
            deleted: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const mobilePairRequestSchema = z
  .object({
    apiVersion: apiVersionSchema,
    schemaVersion: schemaVersionSchema,
    requestId: requestIdSchema,
    pairingCode: z.string().regex(/^\d{8}$/),
    clientDeviceId: entityIdSchema,
    deviceLabel: z.string().trim().min(1).max(80),
  })
  .strict();

export const mobilePairResponseSchema = z
  .object({
    ok: z.literal(true),
    meta: mobileResponseMetaSchema,
    data: z
      .object({
        deviceId: entityIdSchema,
        deviceLabel: z.string().trim().min(1).max(80),
        accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        scopes: z.array(mobileScopeSchema).min(1).max(10),
        pairedAt: isoTimestampSchema,
      })
      .strict(),
  })
  .strict();

export const mobileErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    meta: mobileResponseMetaSchema,
    error: mobileErrorSchema,
  })
  .strict();

export type MobileCapability = z.output<typeof mobileCapabilitySchema>;
export type MobileScope = z.output<typeof mobileScopeSchema>;
export type MobileResponseMeta = z.output<typeof mobileResponseMetaSchema>;
export type MobileErrorCode = z.output<typeof mobileErrorCodeSchema>;
export type MobileHealthResponse = z.output<typeof mobileHealthResponseSchema>;
export type MobileTodayRequest = z.output<typeof mobileTodayRequestSchema>;
export type MobileTodayResponse = z.output<typeof mobileTodayResponseSchema>;
export type MobileTaskSchedule = z.output<typeof mobileTaskScheduleSchema>;
export type MobileWorkReceiptSummary = z.output<typeof mobileWorkReceiptSummarySchema>;
export type MobileWorkReceiptRequest = z.output<typeof mobileWorkReceiptRequestSchema>;
export type MobileWorkReceiptDetail = z.output<typeof mobileWorkReceiptDetailSchema>;
export type MobileWorkReceiptExternalReference = z.output<
  typeof mobileWorkReceiptExternalReferenceSchema
>;
export type MobileWorkReceiptResponse = z.output<typeof mobileWorkReceiptResponseSchema>;
export type MobileTaskWorkProposalAction = z.output<typeof mobileTaskWorkProposalActionSchema>;
export type MobileTaskWorkProposal = z.output<typeof mobileTaskWorkProposalSchema>;
export type MobileTaskWorkProposalsRequest = z.output<typeof mobileTaskWorkProposalsRequestSchema>;
export type MobileTaskWorkProposalsResponse = z.output<
  typeof mobileTaskWorkProposalsResponseSchema
>;
export type MobileTaskWorkProposalDecisionRequest = z.output<
  typeof mobileTaskWorkProposalDecisionRequestSchema
>;
export type MobileTaskWorkProposalDecisionResponse = z.output<
  typeof mobileTaskWorkProposalDecisionResponseSchema
>;
export type MobileTaskSummary = z.output<typeof mobileTaskSummarySchema>;
export type MobileThemeCatalogItem = z.output<typeof mobileThemeCatalogItemSchema>;
export type MobileThemesRequest = z.output<typeof mobileThemesRequestSchema>;
export type MobileThemesResponse = z.output<typeof mobileThemesResponseSchema>;
export type MobileBootstrapRequest = z.output<typeof mobileBootstrapRequestSchema>;
export type MobileBootstrapResponse = z.output<typeof mobileBootstrapResponseSchema>;
export type MobileSyncRequest = z.output<typeof mobileSyncRequestSchema>;
export type MobileSyncChange = z.output<typeof mobileSyncChangeSchema>;
export type MobileSyncResponse = z.output<typeof mobileSyncResponseSchema>;
export type MobileTaskCommandRequest = z.output<typeof mobileTaskCommandRequestSchema>;
export type MobileTaskCommandResponse = z.output<typeof mobileTaskCommandResponseSchema>;
export type MobileCaptureCommandRequest = z.output<typeof mobileCaptureCommandRequestSchema>;
export type MobileCaptureCommandResponse = z.output<typeof mobileCaptureCommandResponseSchema>;
export type MobileCommandRequest = z.output<typeof mobileCommandRequestSchema>;
export type MobilePairRequest = z.output<typeof mobilePairRequestSchema>;
export type MobilePairResponse = z.output<typeof mobilePairResponseSchema>;
export type MobileErrorResponse = z.output<typeof mobileErrorResponseSchema>;
