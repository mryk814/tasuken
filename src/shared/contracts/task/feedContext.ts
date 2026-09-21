import * as z from "zod/v4";

import { nextToolSchema } from "./itemQueries.ts";

/**
 * Feedの読み出し（SNS型Feed 第3段階）。
 *
 * 外部AIが次に書く題材と、利用者が明示的に残した質問を読むためのbounded context。
 * 正式データを変更せず、投稿の本文を丸ごと渡さない（短い抜粋と参照IDだけ）。
 * Task・Themeの詳細は既存の読み出しtool（`tasken.get_task_context` など）で取得し、
 * そこでのAI公開範囲の判定に従う。
 */

/** 投稿の要約。本文は抜粋だけを返す。 */
export const feedPostSummarySchema = z
  .object({
    id: z.string(),
    topic: z.string(),
    created_at: z.string(),
    author: z.string(),
    excerpt: z.string(),
    task_id: z.string().nullable(),
    theme_id: z.string().nullable(),
    note_id: z.string().nullable(),
  })
  .strict();

/** 利用者の質問（`ai_requested_at` 付きの返信）と、その元になった投稿。 */
export const feedQuestionSchema = z
  .object({
    id: z.string(),
    post_id: z.string(),
    body: z.string(),
    created_at: z.string(),
    requested_at: z.string(),
    answered: z.boolean(),
    post: feedPostSummarySchema.nullable(),
  })
  .strict();

export const getFeedContextRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
    max_chars: z.number().int().min(1).max(4_000).optional(),
    /** 回答済みの質問も含めるか。既定は未回答だけ。 */
    include_answered: z.boolean().optional(),
  })
  .strict();

export const getFeedContextResponseSchema = z
  .object({
    questions: z.array(feedQuestionSchema).max(50),
    recent_posts: z.array(feedPostSummarySchema).max(50),
    reactions: z
      .object({
        bookmarked_post_ids: z.array(z.string()).max(50),
        interesting_post_ids: z.array(z.string()).max(50),
        /** 「既に知っていた」と本人が伝えた投稿。次の題材選びで避ける材料にする。 */
        known_post_ids: z.array(z.string()).max(50),
      })
      .strict(),
    limit: z.number().int().min(1).max(50),
    max_chars: z.number().int().min(1).max(4_000),
    truncated: z.boolean(),
    result_meta: z
      .object({
        contract_version: z.literal(1),
        returned_count: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
    ai_audience: z.enum(["m365", "coding_agent", "external_ai"]),
    read_only: z.literal(true),
    next_tools: z.array(nextToolSchema).max(4),
  })
  .strict();

export type FeedPostSummary = z.output<typeof feedPostSummarySchema>;
export type FeedQuestion = z.output<typeof feedQuestionSchema>;
export type GetFeedContextRequest = z.output<typeof getFeedContextRequestSchema>;
export type GetFeedContextResponse = z.output<typeof getFeedContextResponseSchema>;
