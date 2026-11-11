import * as z from "zod/v4";

import { entityIdSchema, entityVersionSchema } from "../../kernel/public.ts";
import { taskReadModelSchema } from "./model.ts";

const callFields = {
  caller: z.string().trim().min(1).max(200),
  source_session: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("One stable value for this whole conversation."),
  source_app: z.string().trim().min(1).max(120).default("mcp-client"),
};

/**
 * 本人の言葉を根拠に、AIがProposalの採否を取り次ぐ（#703 段3）。本人の言葉（said）は必ず要る。
 * 作業報告（task_work）とNote（作成・編集の一件）を扱い、ほかの種類はDesktopの画面で決める。
 */
export const aiProposalDecisionRequestSchema = z
  .object({
    proposal_id: entityIdSchema,
    expected_version: entityVersionSchema,
    decision: z.enum(["accept", "reject"]),
    complete_task: z
      .boolean()
      .optional()
      .describe("Work reports only: also complete the Task. Only when the user said so."),
    said: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .describe("The user's own words that decided this, quoted as said."),
    ...callFields,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.complete_task && value.decision !== "accept")
      context.addIssue({
        code: "custom",
        path: ["complete_task"],
        message: "complete_taskは採用のときだけ指定できます。",
      });
  });

export const aiProposalDecisionResponseSchema = z
  .object({
    schema: z.literal("tasken-ai-proposal-decision/v1"),
    status: z.enum(["applied", "duplicate"]),
    proposal_id: z.string(),
    proposal_status: z.string(),
    change_id: z.string(),
    task: taskReadModelSchema.nullable(),
    note: z
      .object({ id: z.string(), version: z.number().int(), title: z.string() })
      .strict()
      .nullable(),
  })
  .strict();

/**
 * Noteの直接編集。本文は全部の置き換え。中身は「Note編集のProposalを作り、その場で採用する」で、
 * 採用の版の照合と保存（Canonical Markdown）はDesktopの採用と同じ経路を通る。
 */
export const aiNoteEditRequestSchema = z
  .object({
    note_id: entityIdSchema,
    base_version: entityVersionSchema,
    title: z.string().trim().min(1).max(200).optional(),
    base_signature: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "body_signature from get_note read without truncation (proves you read the full body).",
      ),
    body: z
      .string()
      .max(60_000)
      .refine((value) => new TextEncoder().encode(value).length <= 56_000, {
        message:
          "本文が大きすぎて直接編集できません（約56KB まで）。本人に画面で直してもらってください。",
      })
      .describe("Full replacement Markdown; keep existing attachment URLs."),
    said: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .optional()
      .describe("The user's own words that asked for this, quoted as said."),
    why: z.string().trim().min(1).max(2_000).optional(),
    idempotency_key: z.string().trim().min(1).max(200),
    ...callFields,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.said && !value.why)
      context.addIssue({ code: "custom", path: ["said"], message: "saidかwhyが必要です。" });
  });

export const aiNoteEditResponseSchema = z
  .object({
    schema: z.literal("tasken-ai-note-edit/v1"),
    status: z.enum(["applied", "duplicate"]),
    change_id: z.string(),
    proposal_id: z.string(),
    note: z.object({ id: z.string(), version: z.number().int(), title: z.string() }).strict(),
  })
  .strict();

export type AiProposalDecisionRequest = z.input<typeof aiProposalDecisionRequestSchema>;
export type AiProposalDecisionResponse = z.output<typeof aiProposalDecisionResponseSchema>;
export type AiNoteEditRequest = z.input<typeof aiNoteEditRequestSchema>;
export type AiNoteEditResponse = z.output<typeof aiNoteEditResponseSchema>;
