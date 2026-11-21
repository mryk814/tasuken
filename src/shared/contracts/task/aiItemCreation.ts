import * as z from "zod/v4";

import { entityIdSchema, isoTimestampSchema, localDateSchema } from "../../kernel/public.ts";
import { aiCreationOriginSchema } from "./aiCreationOrigin.ts";
import { aiTaskScheduleInputSchema } from "./aiSchedule.ts";
import { noteProposalImageSchema } from "./contentProposal.ts";
import { taskPlaceReminderSchema, taskPrioritySchema } from "./model.ts";

export { aiCreationOriginSchema };

/** Task・Noteのどちらにも使う入力。identity・作成者・経路はCoreが決める。 */
const commonCreationFields = {
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(""),
  idempotency_key: z.string().trim().min(1).max(200),
  caller: z.string().trim().min(1).max(200),
  source_app: z.string().trim().min(1).max(120).default("mcp-client"),
  source_session: z.string().trim().min(1).max(200).optional(),
  reason: z.string().max(2_000).default(""),
  theme_id: entityIdSchema
    .optional()
    .describe("Theme ID from search/get_theme_context; omitted = 個人業務."),
};

/** Taskだけが受ける欄。完了・委任・繰り返し・AIの出所は作成時に決めさせない。 */
export const aiTaskCreationFields = {
  ...commonCreationFields,
  priority: taskPrioritySchema.optional(),
  schedule: aiTaskScheduleInputSchema
    .optional()
    .describe("Due date = end_date only; one day = start_date; a period = both."),
  today_date: localDateSchema.optional().describe("Put on Today for this local date."),
  reminder_at: isoTimestampSchema
    .optional()
    .describe(
      "Notify at this moment (phone and desktop); offset required, e.g. 2026-11-16T09:00:00+09:00. A due date already notifies on its day.",
    ),
  checklist: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  place_reminder: taskPlaceReminderSchema
    .optional()
    .describe(
      "Notify on the phone when it stays at this place. Only coordinates the user gave or a reliable source states; never guess.",
    ),
};

/** Noteだけが受ける欄。 */
export const aiNoteCreationFields = {
  ...commonCreationFields,
  note_type: z.enum(["memo", "report", "prompt"]).optional(),
  report_date: localDateSchema.optional().describe("For note_type=report only."),
  task_id: entityIdSchema
    .optional()
    .describe(
      "Attach the Note to this Task (from search_items / get_task_context): the Note is created already linked, so it appears in the Task's context and detail without adoption. Theme defaults to the Task's Theme unless theme_id is given.",
    ),
  images: z
    .array(noteProposalImageSchema)
    .min(1)
    .max(8)
    .optional()
    .describe(
      "PNG/JPEG images for ![alt](tasken-upload://reference-id) in body; up to 8, 12MiB each, 24MiB total.",
    ),
};

const TASK_ONLY_FIELDS = [
  "priority",
  "schedule",
  "today_date",
  "reminder_at",
  "checklist",
  "place_reminder",
] as const;
const NOTE_ONLY_FIELDS = ["note_type", "report_date", "task_id", "images"] as const;

/** Creation only: identity, ownership, assignment and paths are owned by Core. */
export const aiItemCreationRequestSchema = z
  .object({
    kind: z.enum(["task", "note"]),
    ...aiTaskCreationFields,
    ...aiNoteCreationFields,
  })
  .strict()
  .superRefine((value, context) => {
    const foreign = value.kind === "task" ? NOTE_ONLY_FIELDS : TASK_ONLY_FIELDS;
    for (const field of foreign) {
      if (value[field] !== undefined)
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field}は${value.kind === "task" ? "Note" : "Task"}にだけ指定できます。`,
        });
    }
    if (value.report_date !== undefined && value.note_type !== "report")
      context.addIssue({
        code: "custom",
        path: ["report_date"],
        message: "report_dateはnote_type=reportにだけ指定できます。",
      });
  });

export const aiItemCreationResponseSchema = z
  .object({
    schema: z.literal("tasken-ai-item-creation/v1"),
    status: z.enum(["created", "duplicate"]),
    entity: z
      .object({
        type: z.enum(["task", "note"]),
        id: z.string(),
        version: z.number().int().positive(),
        title: z.string(),
        body: z.string(),
        theme_id: z.string().nullable(),
        /** Noteを紐づけたTask。紐づけが無いNoteと、Taskの作成ではnull。 */
        task_id: z.string().nullable(),
        deleted_at: z.string().nullable(),
        ai_creation: aiCreationOriginSchema,
        ai_seen_at: z.string().nullable(),
        canonical_sync_state: z.string().nullable(),
      })
      .strict(),
    workspace_id: z.string(),
    canonical_node: z.literal("this_node"),
  })
  .strict();

export type AiItemCreationRequest = z.input<typeof aiItemCreationRequestSchema>;
export type AiItemCreationResponse = z.output<typeof aiItemCreationResponseSchema>;
