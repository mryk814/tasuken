import * as z from "zod/v4";

import {
  entityIdSchema,
  entityVersionSchema,
  isoTimestampSchema,
  type Result,
} from "../../kernel/public.ts";
import { taskDraftSchema, taskIdSchema, taskPatchSchema, taskScheduleEditSchema } from "./model.ts";
import { parseTaskContract, taskContractSchemaVersionSchema } from "./version.ts";
import type { TaskError } from "./errors.ts";

export const taskCommandActorSchema = z
  .object({
    kind: z.enum(["user", "system", "ai_agent"]),
    id: entityIdSchema.optional(),
  })
  .strict();

export const taskCommandSourceSchema = z.enum(["desktop", "mobile", "http", "mcp", "system"]);
export const taskCommandEntrypointSchema = z.enum([
  "main_ui",
  "today_window",
  "quick_capture",
  "inbox",
  "command_palette",
  "tasken_root",
  "mcp",
]);

export const taskCreationReportedViaSchema = z.enum([
  "android_app",
  "widget",
  "app_shortcut",
  "share_target",
  "android_speech",
]);
export const taskSpeechRecognitionModeSchema = z.enum(["on_device", "system_service", "unknown"]);

export const taskCreationProvenanceSchema = z
  .object({
    reported_via: taskCreationReportedViaSchema,
    captured_at: isoTimestampSchema,
    capture_method: z.literal("android_speech").nullable(),
    recognition_mode: taskSpeechRecognitionModeSchema.nullable(),
    language: z.string().trim().min(1).max(64).nullable(),
    confidence: z.number().finite().min(0).max(1).nullable(),
    source_audio_available: z.literal(false).nullable(),
    shared_mime_type: z.literal("text/plain").nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasSpeech = value.capture_method === "android_speech";
    if (hasSpeech) {
      if (value.reported_via !== "android_speech") {
        context.addIssue({
          code: "custom",
          path: ["reported_via"],
          message: "音声認識結果はandroid_speech入力だけに指定できます。",
        });
      }
      if (
        value.recognition_mode === null ||
        value.language === null ||
        value.source_audio_available !== false
      ) {
        context.addIssue({
          code: "custom",
          path: ["capture_method"],
          message: "音声認識のmode・language・source_audio_availableが必要です。",
        });
      }
    } else if (
      value.recognition_mode !== null ||
      value.language !== null ||
      value.confidence !== null ||
      value.source_audio_available !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["capture_method"],
        message: "音声認識metadataにはcapture_methodが必要です。",
      });
    }
    if ((value.reported_via === "share_target") !== (value.shared_mime_type !== null)) {
      context.addIssue({
        code: "custom",
        path: ["shared_mime_type"],
        message: "Share Target入力にはtext/plain MIMEを指定してください。",
      });
    }
  });

const commandBase = {
  schemaVersion: taskContractSchemaVersionSchema,
  command_id: entityIdSchema,
  actor: taskCommandActorSchema,
  source: taskCommandSourceSchema,
  entrypoint: taskCommandEntrypointSchema.optional(),
  issued_at: isoTimestampSchema,
};

export const createTaskCommandSchema = z
  .object({
    ...commandBase,
    name: z.literal("CreateTask"),
    payload: z
      .object({
        task: taskDraftSchema,
        provenance: taskCreationProvenanceSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const taskScheduleChangeSchema = z
  .object({
    changes: taskScheduleEditSchema,
    base: taskScheduleEditSchema.nullable(),
    expected_version: entityVersionSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.base) {
      if (value.expected_version === null) {
        context.addIssue({
          code: "custom",
          path: ["expected_version"],
          message: "既存Scheduleの更新にはexpected_versionが必要です。",
        });
      }
    } else {
      if (value.expected_version !== null) {
        context.addIssue({
          code: "custom",
          path: ["expected_version"],
          message: "新規Scheduleのexpected_versionはnullにしてください。",
        });
      }
      if (value.changes.start_date === null && value.changes.end_date === null) {
        context.addIssue({
          code: "custom",
          path: ["changes"],
          message: "新規Scheduleには開始日または終了日が必要です。",
        });
      }
    }
  });

export const updateTaskCommandSchema = z
  .object({
    ...commandBase,
    name: z.literal("UpdateTask"),
    payload: z
      .object({
        task_id: taskIdSchema,
        expected_version: entityVersionSchema,
        changes: taskPatchSchema.optional(),
        base: taskPatchSchema.optional(),
        schedule_change: taskScheduleChangeSchema.optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (!value.changes && !value.schedule_change) {
          context.addIssue({
            code: "custom",
            path: ["changes"],
            message: "TaskまたはScheduleの変更を指定してください。",
          });
        }
        if (!value.changes && value.base) {
          context.addIssue({
            code: "custom",
            path: ["base"],
            message: "changesなしでbaseを指定できません。",
          });
        }
        if (value.changes && value.base) {
          const changedKeys = Object.keys(value.changes).sort();
          const baseKeys = Object.keys(value.base).sort();
          if (
            changedKeys.length !== baseKeys.length ||
            changedKeys.some((key, index) => key !== baseKeys[index])
          ) {
            context.addIssue({
              code: "custom",
              path: ["base"],
              message: "baseはchangesと同じfieldを持つ必要があります。",
            });
          }
        }
      }),
  })
  .strict();

export const deleteTaskCommandSchema = z
  .object({
    ...commandBase,
    name: z.literal("DeleteTask"),
    payload: z
      .object({
        task_id: taskIdSchema,
        expected_version: entityVersionSchema,
      })
      .strict(),
  })
  .strict();

export const completeTaskCommandSchema = z
  .object({
    ...commandBase,
    name: z.literal("CompleteTask"),
    payload: z
      .object({
        task_id: taskIdSchema,
        expected_version: entityVersionSchema,
        completion_note: z.string().max(10000).nullable().optional(),
        changes: taskPatchSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const reopenTaskCommandSchema = z
  .object({
    ...commandBase,
    name: z.literal("ReopenTask"),
    payload: z
      .object({
        task_id: taskIdSchema,
        expected_version: entityVersionSchema,
        changes: taskPatchSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const taskCommandSchema = z.discriminatedUnion("name", [
  createTaskCommandSchema,
  updateTaskCommandSchema,
  deleteTaskCommandSchema,
  completeTaskCommandSchema,
  reopenTaskCommandSchema,
]);

export type TaskCommandActor = z.output<typeof taskCommandActorSchema>;
export type TaskCommandSource = z.output<typeof taskCommandSourceSchema>;
export type TaskCommandEntrypoint = z.output<typeof taskCommandEntrypointSchema>;
export type TaskCreationReportedVia = z.output<typeof taskCreationReportedViaSchema>;
export type TaskSpeechRecognitionMode = z.output<typeof taskSpeechRecognitionModeSchema>;
export type TaskCreationProvenance = z.output<typeof taskCreationProvenanceSchema>;
export type CreateTaskCommand = z.output<typeof createTaskCommandSchema>;
export type UpdateTaskCommand = z.output<typeof updateTaskCommandSchema>;
export type TaskScheduleChange = z.output<typeof taskScheduleChangeSchema>;
export type DeleteTaskCommand = z.output<typeof deleteTaskCommandSchema>;
export type CompleteTaskCommand = z.output<typeof completeTaskCommandSchema>;
export type ReopenTaskCommand = z.output<typeof reopenTaskCommandSchema>;
export type TaskCommand = z.output<typeof taskCommandSchema>;

export function parseTaskCommand(value: unknown): Result<TaskCommand, TaskError> {
  return parseTaskContract(taskCommandSchema, value, "INVALID_COMMAND");
}
