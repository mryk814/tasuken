import { z } from "zod";
import { entityIdSchema, entityVersionSchema, isoTimestampSchema } from "./kernel/public.ts";
import type { Entity } from "./types/workspace.ts";
import type { CommandEnvelope } from "./applicationCommand.ts";

const date = z.iso.date().nullable();
const time = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  .nullable();
const duration = z.number().int().min(1).max(10080).nullable();
const range = z.enum(["once_within_window", "ongoing"]).nullable();
export const taskScheduleSnapshotSchema = z.strictObject({
  taskId: entityIdSchema,
  taskVersion: entityVersionSchema,
  scheduleId: entityIdSchema.nullable(),
  scheduleVersion: entityVersionSchema.nullable(),
  startDate: date,
  endDate: date,
  rangeSemantics: range,
  todayDate: date,
  plannedStartTime: time,
  plannedDurationMinutes: duration,
});
export const taskScheduleProposalRequestSchema = z.strictObject({
  current: taskScheduleSnapshotSchema,
  instruction: z.string().trim().min(1).max(12000),
  inputAt: isoTimestampSchema,
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }),
});
// Omitted properties preserve current values; null explicitly clears a field.
export const taskSchedulePatchSchema = z.strictObject({
  startDate: date.optional(),
  endDate: date.optional(),
  rangeSemantics: range.optional(),
  todayDate: date.optional(),
  plannedStartTime: time.optional(),
  plannedDurationMinutes: duration.optional(),
});
export const taskScheduleProposalSchema = z.strictObject({
  patch: taskSchedulePatchSchema,
  warnings: z.array(z.string().min(1).max(500)).max(10),
});
export type TaskScheduleSnapshot = z.infer<typeof taskScheduleSnapshotSchema>;
export type TaskScheduleProposalRequest = z.infer<typeof taskScheduleProposalRequestSchema>;
export type TaskScheduleProposal = z.infer<typeof taskScheduleProposalSchema>;

export function taskScheduleSnapshot(task: Entity, schedule?: Entity | null): TaskScheduleSnapshot {
  return taskScheduleSnapshotSchema.parse({
    taskId: task.id,
    taskVersion: task.version,
    scheduleId: schedule?.id ?? null,
    scheduleVersion: schedule?.version ?? null,
    startDate: schedule?.start_date ?? null,
    endDate: schedule?.end_date ?? null,
    rangeSemantics: schedule?.range_semantics ?? null,
    todayDate: task.today_date ?? null,
    plannedStartTime: task.planned_start_time ?? null,
    plannedDurationMinutes: task.planned_duration_minutes ?? null,
  });
}

export function buildTaskScheduleProposalCommand(
  task: Entity,
  schedule: Entity | null,
  proposal: TaskScheduleProposal,
  current: TaskScheduleSnapshot,
  commandId: string,
  issuedAt: string,
): CommandEnvelope {
  if (JSON.stringify(taskScheduleSnapshot(task, schedule)) !== JSON.stringify(current))
    throw new Error("Taskまたは日程が更新されています。現在の予定で提案を作り直してください。");
  const validated = validateTaskScheduleProposal(proposal, current);
  if (!Object.keys(validated.patch).length) throw new Error("適用できる変更はありません。");
  const nextTask = { ...task };
  const nextSchedule = schedule
    ? { ...schedule }
    : ({
        id: `schedule-${commandId}`,
        owner_type: "task",
        owner_id: task.id,
        start_date: null,
        end_date: null,
        range_semantics: null,
        date_kind: "unknown",
        confidence: "fixed",
        granularity: "day",
      } as Entity);
  const taskFields = {
    todayDate: "today_date",
    plannedStartTime: "planned_start_time",
    plannedDurationMinutes: "planned_duration_minutes",
  } as const;
  const scheduleFields = {
    startDate: "start_date",
    endDate: "end_date",
    rangeSemantics: "range_semantics",
  } as const;
  for (const [key, field] of Object.entries(taskFields))
    if (Object.hasOwn(validated.patch, key))
      nextTask[field] = validated.patch[key as keyof typeof taskFields];
  let scheduleChanged = false;
  for (const [key, field] of Object.entries(scheduleFields))
    if (Object.hasOwn(validated.patch, key)) {
      nextSchedule[field] = validated.patch[key as keyof typeof scheduleFields];
      scheduleChanged = true;
    }
  if (scheduleChanged)
    nextSchedule.date_kind =
      nextSchedule.start_date &&
      nextSchedule.end_date &&
      nextSchedule.start_date !== nextSchedule.end_date
        ? "range"
        : nextSchedule.end_date
          ? "deadline"
          : nextSchedule.start_date
            ? "point"
            : "unknown";
  return {
    commandId,
    name: "UpdateTask",
    actor: { kind: "user" },
    source: "main_ui",
    issuedAt,
    expectedVersions: [
      { type: "task", id: task.id, version: current.taskVersion },
      ...(schedule
        ? [{ type: "schedule" as const, id: schedule.id, version: current.scheduleVersion! }]
        : []),
    ],
    payload: {
      task: nextTask,
      ...(scheduleChanged ? { schedule: nextSchedule } : {}),
      expectedSchedule: schedule ? { id: schedule.id, version: current.scheduleVersion! } : null,
    },
  };
}

export function validateTaskScheduleProposal(
  value: unknown,
  current: TaskScheduleSnapshot,
): TaskScheduleProposal {
  const proposal = taskScheduleProposalSchema.parse(value);
  const next = { ...current, ...proposal.patch };
  if (next.startDate && next.endDate && next.startDate > next.endDate)
    return {
      patch: {},
      warnings: [...proposal.warnings, "開始日が期限より後になるため適用しません。"],
    };
  if (next.rangeSemantics && (!next.startDate || !next.endDate || next.startDate === next.endDate))
    return {
      patch: {},
      warnings: [...proposal.warnings, "期間の意味と日付が一致しないため適用しません。"],
    };
  return {
    ...proposal,
    patch: Object.fromEntries(
      Object.entries(proposal.patch).filter(
        ([key, value]) => current[key as keyof TaskScheduleSnapshot] !== value,
      ),
    ),
  };
}

export const taskScheduleFieldLabels = {
  startDate: "開始日",
  endDate: "期限",
  rangeSemantics: "期間の意味",
  todayDate: "今日割当",
  plannedStartTime: "予定時刻",
  plannedDurationMinutes: "所要時間（分）",
} as const;

export function taskScheduleProposalProviderSchema() {
  const fields = {
    startDate: { type: ["string", "null"] },
    endDate: { type: ["string", "null"] },
    rangeSemantics: { type: ["string", "null"], enum: ["once_within_window", "ongoing", null] },
    todayDate: { type: ["string", "null"] },
    plannedStartTime: { type: ["string", "null"] },
    plannedDurationMinutes: { type: ["integer", "null"] },
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [
            key,
            {
              type: "object",
              additionalProperties: false,
              properties: { change: { type: "boolean" }, value },
              required: ["change", "value"],
            },
          ]),
        ),
        required: Object.keys(fields),
      },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["changes", "warnings"],
  };
}

export function parseTaskScheduleProviderResult(value: unknown, current: TaskScheduleSnapshot) {
  const operation = <T extends z.ZodType>(schema: T) =>
    z.strictObject({ change: z.boolean(), value: schema });
  const parsed = z
    .strictObject({
      changes: z.strictObject({
        startDate: operation(date),
        endDate: operation(date),
        rangeSemantics: operation(range),
        todayDate: operation(date),
        plannedStartTime: operation(time),
        plannedDurationMinutes: operation(duration),
      }),
      warnings: z.array(z.string().min(1).max(500)).max(10),
    })
    .parse(value);
  return validateTaskScheduleProposal(
    {
      patch: Object.fromEntries(
        Object.entries(parsed.changes)
          .filter(([, entry]) => entry.change)
          .map(([key, entry]) => [key, entry.value]),
      ),
      warnings: parsed.warnings,
    },
    current,
  );
}
