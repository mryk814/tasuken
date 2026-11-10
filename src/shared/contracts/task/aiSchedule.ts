import * as z from "zod/v4";

import { localDateSchema } from "../../kernel/public.ts";
import {
  taskScheduleConfidenceSchema,
  taskScheduleEditSchema,
  taskScheduleGranularitySchema,
  type TaskScheduleEdit,
} from "./model.ts";

/**
 * AIが渡すTaskの日程。期限だけなら`end_date`、一日なら`start_date`、期間なら両方。
 * `date_kind`と`range_semantics`はCoreが日付から導く（AIに整合を取らせない）。
 */
export const aiTaskScheduleInputSchema = z
  .object({
    start_date: localDateSchema.nullable().default(null),
    end_date: localDateSchema.nullable().default(null),
    confidence: taskScheduleConfidenceSchema.default("fixed"),
    granularity: taskScheduleGranularitySchema.default("day"),
  })
  .strict()
  .refine((value) => value.start_date !== null || value.end_date !== null, {
    message: "start_dateかend_dateのどちらかを指定してください。",
  })
  .refine((value) => !value.start_date || !value.end_date || value.end_date >= value.start_date, {
    message: "end_dateはstart_date以降にしてください。",
    path: ["end_date"],
  });

export type AiTaskScheduleInput = z.output<typeof aiTaskScheduleInputSchema>;

/** AIの日程入力を、Taskの日程の正本の形（date_kind・range_semanticsを含む）にする。 */
export function taskScheduleEditFromAiInput(input: AiTaskScheduleInput): TaskScheduleEdit {
  const { start_date: start, end_date: end } = input;
  const isRange = Boolean(start && end && end > start);
  return taskScheduleEditSchema.parse({
    start_date: start,
    end_date: end,
    date_kind: !start ? "deadline" : !end || start === end ? "point" : "range",
    range_semantics: isRange ? "once_within_window" : null,
    confidence: input.confidence,
    granularity: input.granularity,
  });
}
