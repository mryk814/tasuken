import * as z from "zod/v4";

/**
 * NASのreplicaから読むAIへ返す、同期の状態と鮮度。
 *
 * `as_of`は「その時刻までのDesktopの変更は取り込み済み」を意味し、nullは不明。
 * 端末ID・パス・エラー文は含めない。
 */
export const sourceStatusStateSchema = z.enum([
  "off",
  "starting",
  "ok",
  "conflict",
  "waiting_packet",
  "waiting_image",
  "blocked",
  "io_error",
]);

export const sourceStatusSchema = z
  .object({
    node: z.string(),
    state: sourceStatusStateSchema,
    as_of: z.string().nullable(),
    desktop_seen_at: z.string().nullable(),
  })
  .strict();

export const getSourceStatusRequestSchema = z.object({}).strict();

export const getSourceStatusResponseSchema = z.object({ source: sourceStatusSchema }).strict();

export type SourceStatus = z.output<typeof sourceStatusSchema>;
export type GetSourceStatusRequest = z.output<typeof getSourceStatusRequestSchema>;
export type GetSourceStatusResponse = z.output<typeof getSourceStatusResponseSchema>;
