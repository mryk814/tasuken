import * as z from "zod/v4";

import { isoTimestampSchema } from "../../kernel/public.ts";
import { taskIdSchema } from "./model.ts";

/** Start only. Core owns the actor, source, workspace and command name. */
export const aiTaskStartRequestSchema = z
  .object({
    task_id: taskIdSchema,
    expected_version: z.number().int().positive(),
    idempotency_key: z.string().trim().min(1).max(200),
    caller: z.string().trim().min(1).max(200),
    started_at: isoTimestampSchema,
    work_attempt_id: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    source_session: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type AiTaskStartRequest = z.output<typeof aiTaskStartRequestSchema>;
