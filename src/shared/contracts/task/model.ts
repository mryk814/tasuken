import * as z from "zod/v4";

import {
  entityIdSchema,
  entityVersionSchema,
  isoTimestampSchema,
  localDateSchema,
} from "../../kernel/public.ts";

export const taskIdSchema = entityIdSchema.brand<"TaskId">();
export const taskStateSchema = z.enum(["todo", "doing", "waiting", "review", "done", "cancelled"]);
export const taskPrioritySchema = z.enum(["normal", "high"]);
export const taskRequesterSchema = z.enum(["self", "human", "ai_agent", "external", "unknown"]);
export const taskIntendedExecutorSchema = z.enum(["self", "human", "ai_agent", "unassigned"]);
export const taskWorkStateSchema = z.enum([
  "not_delegated",
  "ready_for_agent",
  "in_progress",
  "reported_done",
  "needs_human_review",
  "accepted",
  "blocked",
  "failed",
]);
export const taskShelfSchema = z.enum(["maybe_today", "this_evening", "this_week", "someday", "backlog"]);
export const taskScheduleDateKindSchema = z.enum(["point", "deadline", "range", "unknown"]);
export const taskScheduleRangeSemanticsSchema = z.enum(["once_within_window", "ongoing"]);
export const taskScheduleConfidenceSchema = z.enum(["rough", "tentative", "fixed"]);
export const taskScheduleGranularitySchema = z.enum(["day", "week", "month"]);

const optionalText = (maximum: number) => z.string().max(maximum).nullable().optional();
const optionalEntityId = entityIdSchema.nullable().optional();
const optionalTaskId = taskIdSchema.nullable().optional();
const optionalTimestamp = isoTimestampSchema.nullable().optional();

function expectedScheduleDateKind(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "unknown" as const;
  if (!startDate && endDate) return "deadline" as const;
  if (startDate && (!endDate || startDate === endDate)) return "point" as const;
  return "range" as const;
}

const taskScheduleFields = {
  id: entityIdSchema,
  owner_type: z.literal("task"),
  owner_id: taskIdSchema,
  start_date: localDateSchema.nullable(),
  end_date: localDateSchema.nullable(),
  date_kind: taskScheduleDateKindSchema,
  range_semantics: taskScheduleRangeSemanticsSchema.nullable(),
  confidence: taskScheduleConfidenceSchema,
  granularity: taskScheduleGranularitySchema,
};

function validateTaskScheduleDates(
  value: z.output<z.ZodObject<typeof taskScheduleFields>>,
  context: z.core.$RefinementCtx,
) {
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    context.addIssue({
      code: "custom",
      path: ["end_date"],
      message: "end_dateはstart_date以降にしてください。",
    });
  }
  const isRange = Boolean(value.start_date && value.end_date && value.end_date > value.start_date);
  if (value.range_semantics !== null && !isRange) {
    context.addIssue({
      code: "custom",
      path: ["range_semantics"],
      message: "range_semanticsは開始日と終了日が異なる期間にだけ指定できます。",
    });
  }
}

function validateTaskSchedule(
  value: z.output<z.ZodObject<typeof taskScheduleFields>>,
  context: z.core.$RefinementCtx,
) {
  validateTaskScheduleDates(value, context);
  if (value.date_kind !== expectedScheduleDateKind(value.start_date, value.end_date)) {
    context.addIssue({
      code: "custom",
      path: ["date_kind"],
      message: "date_kindはstart_date/end_dateから導出した値と一致する必要があります。",
    });
  }
}

/** Canonical Schedule write carried beside the Task aggregate. */
export const taskScheduleWriteSchema = z.object(taskScheduleFields).strict().superRefine(validateTaskSchedule);

const taskScheduleEditFields = {
  start_date: localDateSchema.nullable(),
  end_date: localDateSchema.nullable(),
  date_kind: taskScheduleDateKindSchema,
  range_semantics: taskScheduleRangeSemanticsSchema.nullable(),
  confidence: taskScheduleConfidenceSchema,
  granularity: taskScheduleGranularitySchema,
};

export const taskScheduleEditSchema = z.object(taskScheduleEditFields).strict().superRefine((value, context) => {
  validateTaskSchedule({
    id: "schedule-contract-validation",
    owner_type: "task",
    owner_id: "task-contract-validation",
    ...value,
  }, context);
});

/** Public nested projection. Schedule remains an independently versioned entity. */
export const taskScheduleReadModelSchema = z.object({
  ...taskScheduleFields,
  version: entityVersionSchema,
  source: z.string().trim().min(1).max(100),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  deleted_at: optionalTimestamp,
}).strict().superRefine(validateTaskScheduleDates);

export const taskRepeatRuleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  month_day: z.number().int().min(1).max(31).nullable().optional(),
  next_from: z.enum(["scheduled", "completed"]),
  until: localDateSchema.nullable().optional(),
}).strict();

export const taskChecklistItemSchema = z.object({
  id: entityIdSchema,
  title: z.string().trim().min(1).max(200),
  done: z.boolean(),
  sort_order: z.number().finite(),
  completed_at: optionalTimestamp,
}).strict();

const aiSourceRefSchema = z.object({
  kind: z.enum(["url", "file", "canonical_document", "conversation", "meeting", "repository", "external_system"]),
  locator: z.string().trim().min(1).max(4000),
  title: z.string().max(500).optional(),
  captured_at: isoTimestampSchema.optional(),
  last_checked_at: isoTimestampSchema.optional(),
  storage_root_id: entityIdSchema.optional(),
  relative_path: z.string().max(4000).optional(),
}).strict();

const aiEntityRefSchema = z.object({
  type: z.string().trim().min(1).max(100),
  id: entityIdSchema,
}).strict();

const taskFields = {
  id: taskIdSchema,
  project_id: optionalEntityId,
  plan_node_id: optionalEntityId,
  parent_task_id: optionalTaskId,
  section_id: optionalEntityId,
  title: z.string().trim().min(1).max(500),
  description: optionalText(50000),
  state: taskStateSchema,
  requester: taskRequesterSchema.optional(),
  intended_executor: taskIntendedExecutorSchema.optional(),
  executor_identity: optionalText(200),
  work_state: taskWorkStateSchema.optional(),
  work_started_at: optionalTimestamp,
  work_reported_at: optionalTimestamp,
  work_review_note: optionalText(2000),
  priority: taskPrioritySchema,
  today_date: localDateSchema.nullable().optional(),
  planning_shelf: taskShelfSchema.nullable().optional(),
  planned_start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  planned_duration_minutes: z.number().int().positive().max(10080).nullable().optional(),
  reminder_at: optionalTimestamp,
  completed_at: optionalTimestamp,
  completion_note: optionalText(10000),
  repeat_rule: taskRepeatRuleSchema.nullable().optional(),
  repeat_series_id: optionalEntityId,
  repeat_parent_task_id: optionalTaskId,
  checklist_items: z.array(taskChecklistItemSchema).max(100).optional(),
  source_record_id: optionalEntityId,
  legacy_item_id: optionalEntityId,
  repository_context_mode: z.enum(["inherit", "extend", "override"]).optional(),
  repository_context_ids: z.array(entityIdSchema).max(100).optional(),
  primary_repository_context_id: optionalEntityId,
  repository_subdirectory: optionalText(4000),
  repository_branch_hint: optionalText(500),
  repository_context_detachments: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
  ai_summary: optionalText(20000),
  ai_summary_authority: z.enum(["user_confirmed", "rule_generated", "ai_generated", "excerpt"]).nullable().optional(),
  ai_freshness: z.enum(["current", "stale", "superseded", "unknown"]).nullable().optional(),
  ai_authority: z.enum(["user_confirmed", "imported", "ai_generated", "inferred", "external_source"]).nullable().optional(),
  ai_visibility: z.array(z.enum(["m365", "coding_agent", "external_ai"])).max(3).nullable().optional(),
  ai_last_verified_at: optionalTimestamp,
  ai_superseded_by: aiEntityRefSchema.nullable().optional(),
  ai_source_refs: z.array(aiSourceRefSchema).max(100).optional(),
};

/** Public transport DTO. This is not a SQLite row or Renderer form state. */
export const taskReadModelSchema = z.object({
  ...taskFields,
  schedule: taskScheduleReadModelSchema.nullable(),
  version: entityVersionSchema,
  source: z.string().trim().min(1).max(100),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  deleted_at: optionalTimestamp,
}).strict();

/** Create input. IDs remain caller-generated so Desktop/Mobile can enqueue offline. */
export const taskDraftSchema = z.object(taskFields).strict();

export const taskPatchSchema = taskDraftSchema
  .omit({ id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "変更fieldを1件以上指定してください。" });

export type TaskId = z.output<typeof taskIdSchema>;
export type TaskState = z.output<typeof taskStateSchema>;
export type TaskPriority = z.output<typeof taskPrioritySchema>;
export type TaskRequester = z.output<typeof taskRequesterSchema>;
export type TaskIntendedExecutor = z.output<typeof taskIntendedExecutorSchema>;
export type TaskWorkState = z.output<typeof taskWorkStateSchema>;
export type TaskShelf = z.output<typeof taskShelfSchema>;
export type TaskScheduleDateKind = z.output<typeof taskScheduleDateKindSchema>;
export type TaskScheduleRangeSemantics = z.output<typeof taskScheduleRangeSemanticsSchema>;
export type TaskScheduleConfidence = z.output<typeof taskScheduleConfidenceSchema>;
export type TaskScheduleGranularity = z.output<typeof taskScheduleGranularitySchema>;
export type TaskScheduleWrite = z.output<typeof taskScheduleWriteSchema>;
export type TaskScheduleEdit = z.output<typeof taskScheduleEditSchema>;
export type TaskScheduleReadModel = z.output<typeof taskScheduleReadModelSchema>;
export type TaskRepeatRule = z.output<typeof taskRepeatRuleSchema>;
export type TaskChecklistItem = z.output<typeof taskChecklistItemSchema>;
export type TaskReadModel = z.output<typeof taskReadModelSchema>;
export type TaskDraft = z.output<typeof taskDraftSchema>;
export type TaskPatch = z.output<typeof taskPatchSchema>;
