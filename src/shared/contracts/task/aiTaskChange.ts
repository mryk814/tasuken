import * as z from "zod/v4";

import {
  entityIdSchema,
  entityVersionSchema,
  isoTimestampSchema,
  localDateSchema,
} from "../../kernel/public.ts";
import { aiTaskScheduleInputSchema } from "./aiSchedule.ts";
import { taskIdSchema, taskPrioritySchema, taskReadModelSchema, taskShelfSchema } from "./model.ts";

/**
 * 変更の根拠。本人の言葉（`said`）か、AIの理由（`why`）。何に本人の言葉が要るかはCoreが決め、
 * 要るのに`why`だけなら保存せずに`ASK_USER`を返す。
 */
const basisFields = {
  said: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .optional()
    .describe("The user's own words that asked for this, quoted as said."),
  why: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .optional()
    .describe("Your reason when the user did not say it; Core may answer ASK_USER."),
};

/** 呼び出しの同一性。`source_session`は会話ごとに一つの値（まとめての変更の歯止めと取り消しの単位）。 */
const callFields = {
  idempotency_key: z.string().trim().min(1).max(200),
  caller: z.string().trim().min(1).max(200),
  source_session: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("One stable value for this whole conversation."),
  source_app: z.string().trim().min(1).max(120).default("mcp-client"),
};

export const aiChecklistItemInputSchema = z
  .object({
    id: entityIdSchema.optional().describe("Keep for existing items; omit for new ones."),
    title: z.string().trim().min(1).max(200),
    done: z
      .boolean()
      .optional()
      .describe("Omit to keep an existing item's state; new items default to not done."),
  })
  .strict();

/**
 * AIが直接変えてよいTaskの欄（許可リスト）。完了・再開・削除は`action`で、委任は`intended_executor`で行う。
 * 状態・AIの出所・作業の記録・繰り返し・画像・リポジトリの紐付けは受けない。
 */
export const aiTaskEditSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(50_000).optional(),
    theme_id: entityIdSchema.optional(),
    priority: taskPrioritySchema.optional(),
    today_date: localDateSchema.nullable().optional(),
    planning_shelf: taskShelfSchema.nullable().optional(),
    planned_start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    planned_duration_minutes: z.number().int().positive().max(10_080).nullable().optional(),
    reminder_at: isoTimestampSchema.nullable().optional(),
    checklist: z
      .array(aiChecklistItemInputSchema)
      .max(100)
      .optional()
      .describe("Full replacement list in display order."),
    schedule: aiTaskScheduleInputSchema
      .nullable()
      .optional()
      .describe("Due date = end_date only; null clears the dates."),
    intended_executor: z
      .enum(["self", "ai_agent"])
      .optional()
      .describe("ai_agent = AI Ready (delegate); self = take it back."),
    handoff_expected_result: z.string().max(2_000).nullable().optional(),
    handoff_instruction: z.string().max(4_000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "変える欄を1つ以上指定してください。",
  });

export const aiTaskChangeRequestSchema = z
  .object({
    action: z.enum(["update", "complete", "reopen", "delete"]),
    task_id: taskIdSchema,
    expected_version: entityVersionSchema,
    changes: aiTaskEditSchema.optional(),
    completion_note: z.string().max(10_000).optional(),
    confirm_bulk: z
      .boolean()
      .optional()
      .describe("Only after the user approved more changes in this session; needs said."),
    ...basisFields,
    ...callFields,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.said && !value.why)
      context.addIssue({ code: "custom", path: ["said"], message: "saidかwhyが必要です。" });
    if ((value.action === "update") !== (value.changes !== undefined))
      context.addIssue({
        code: "custom",
        path: ["changes"],
        message: "changesはaction=updateにだけ、必ず指定します。",
      });
    if (value.completion_note !== undefined && value.action !== "complete")
      context.addIssue({
        code: "custom",
        path: ["completion_note"],
        message: "completion_noteはaction=completeにだけ指定できます。",
      });
    if (value.confirm_bulk && !value.said)
      context.addIssue({
        code: "custom",
        path: ["confirm_bulk"],
        message: "confirm_bulkには本人の言葉（said）が必要です。",
      });
  });

export const aiTaskChangeResponseSchema = z
  .object({
    schema: z.literal("tasken-ai-task-change/v1"),
    status: z.enum(["applied", "no_change", "duplicate"]),
    change_id: z.string(),
    task: taskReadModelSchema,
  })
  .strict();

/** 取り消し。`change_id`で一つ、`undo_session`でその会話の変更を新しい順に。 */
export const aiChangeUndoRequestSchema = z
  .object({
    change_id: z.string().trim().min(1).max(200).optional(),
    undo_session: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Undo every direct Task change of that source_session, newest first."),
    ...basisFields,
    ...callFields,
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.change_id) === Boolean(value.undo_session))
      context.addIssue({
        code: "custom",
        path: ["change_id"],
        message: "change_idかundo_sessionのどちらか一方を指定してください。",
      });
    if (!value.said && !value.why)
      context.addIssue({ code: "custom", path: ["said"], message: "saidかwhyが必要です。" });
  });

export const aiChangeUndoResponseSchema = z
  .object({
    schema: z.literal("tasken-ai-change-undo/v1"),
    undone: z.array(
      z.object({ change_id: z.string(), undo_change_id: z.string(), task_id: z.string() }).strict(),
    ),
    /** 途中で止まった変更（後から別の変更が入った、など）。それより古い変更は戻していない。 */
    stopped: z
      .object({
        change_id: z.string(),
        code: z.string(),
        message: z.string(),
        current_task: taskReadModelSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type AiTaskChangeRequest = z.input<typeof aiTaskChangeRequestSchema>;
export type AiTaskChangeResponse = z.output<typeof aiTaskChangeResponseSchema>;
export type AiChangeUndoRequest = z.input<typeof aiChangeUndoRequestSchema>;
export type AiChangeUndoResponse = z.output<typeof aiChangeUndoResponseSchema>;
