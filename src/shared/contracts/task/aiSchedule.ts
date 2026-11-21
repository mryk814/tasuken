import * as z from "zod/v4";

import { localDateSchema } from "../../kernel/public.ts";
import {
  taskScheduleConfidenceSchema,
  taskScheduleEditSchema,
  taskScheduleEndTimeSchema,
  taskScheduleGranularitySchema,
  taskScheduleNotifyBeforeSchema,
  type TaskScheduleEdit,
} from "./model.ts";

/** 時刻を新しく付けて知らせの欄を省いたときの既定（画面が最初に選ぶ「30分前」と同じ。#785）。 */
export const DEFAULT_SCHEDULE_NOTIFY_BEFORE_MINUTES = 30;

/**
 * AIが渡すTaskの日程。期限だけなら`end_date`、一日なら`start_date`、期間なら両方。
 * `date_kind`と`range_semantics`はCoreが日付から導く（AIに整合を取らせない）。
 * 時刻（`end_time`）と知らせ（`notify_before_minutes`）は既定を持たない。省けば保存済みの値のまま
 * （既定を null にすると、日付だけ動かす変更が本人の時刻を消す）。
 */
export const aiTaskScheduleInputSchema = z
  .object({
    start_date: localDateSchema.nullable().default(null),
    end_date: localDateSchema.nullable().default(null),
    confidence: taskScheduleConfidenceSchema.default("fixed"),
    granularity: taskScheduleGranularitySchema.default("day"),
    end_time: taskScheduleEndTimeSchema
      .nullable()
      .optional()
      .describe(
        "Local HH:mm on the due day (end_date, else start_date), e.g. 23:59. Omit = keep the saved time; null removes it.",
      ),
    notify_before_minutes: taskScheduleNotifyBeforeSchema
      .nullable()
      .optional()
      .describe(
        "Notify this many minutes before end_time (0 = at it). Omit = keep; with a new end_time the default is 30. null = no notice.",
      ),
  })
  .strict()
  .refine((value) => value.start_date !== null || value.end_date !== null, {
    message: "start_dateかend_dateのどちらかを指定してください。",
  })
  .refine((value) => !value.start_date || !value.end_date || value.end_date >= value.start_date, {
    message: "end_dateはstart_date以降にしてください。",
    path: ["end_date"],
  })
  .refine((value) => !value.end_time || value.granularity === "day", {
    message: "end_timeは granularity: day の日程にだけ指定できます。",
    path: ["end_time"],
  })
  .refine(
    (value) =>
      value.notify_before_minutes === null ||
      value.notify_before_minutes === undefined ||
      value.end_time !== null,
    {
      message: "notify_before_minutesはend_timeと一緒に指定してください。",
      path: ["notify_before_minutes"],
    },
  );

export type AiTaskScheduleInput = z.output<typeof aiTaskScheduleInputSchema>;

/**
 * AIの日程入力を、Taskの日程の正本の形（date_kind・range_semanticsを含む）にする。
 * `current` は保存済みの日程（無ければ新規）。時刻を新しく付けて知らせを省いたときだけ既定の 30 分前にする
 * （既にある時刻を変えるだけなら、本人が選んだ知らせを残す）。
 */
export function taskScheduleEditFromAiInput(
  input: AiTaskScheduleInput,
  current?: { end_time?: string | null } | null,
): TaskScheduleEdit {
  const { start_date: start, end_date: end } = input;
  const isRange = Boolean(start && end && end > start);
  const newlyTimed = Boolean(input.end_time) && !current?.end_time;
  return taskScheduleEditSchema.parse({
    start_date: start,
    end_date: end,
    date_kind: !start ? "deadline" : !end || start === end ? "point" : "range",
    range_semantics: isRange ? "once_within_window" : null,
    confidence: input.confidence,
    granularity: input.granularity,
    ...(input.end_time !== undefined ? { end_time: input.end_time } : {}),
    ...(input.notify_before_minutes !== undefined
      ? { notify_before_minutes: input.notify_before_minutes }
      : newlyTimed
        ? { notify_before_minutes: DEFAULT_SCHEDULE_NOTIFY_BEFORE_MINUTES }
        : {}),
  });
}
