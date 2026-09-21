import {
  getFeedContextRequestSchema,
  getFeedContextResponseSchema,
  type FeedPostSummary,
  type GetFeedContextRequest,
  type GetFeedContextResponse,
} from "../../../shared/contracts/task/public.ts";
import type { FeedContextReadPort, FeedContextRecord } from "../ports/feedContextReadPort.ts";

const AUDIENCE = "coding_agent";
const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_CHARS = 400;
/** 投稿IDの接頭辞。Feedの表示と読み出しで同じ規則を使う。 */
const POST_PREFIX = "feed-post:";

const FEED_NEXT_TOOLS = [
  {
    tool: "tasken.answer_feed_question",
    description: "利用者の質問へ答えるとき、元の投稿のスレッドへ返答を返す。",
  },
  {
    tool: "tasken.get_task_context",
    description: "投稿が参照するTaskの詳細を、AI公開範囲の判定つきで確認する。",
  },
  {
    tool: "tasken.propose_feed_post",
    description: "同じ題材の重複を避けて次の投稿を送る。",
  },
];

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function paragraphs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
}

function excerpt(value: string, maxChars: number): string {
  const body = value.replace(/\s+/gu, " ").trim();
  return body.length > maxChars ? `${body.slice(0, maxChars)}…` : body;
}

/** 読み物Proposal（`feed_posts`）から、表示に必要な最小の要約を作る。 */
function postSummary(
  proposal: FeedContextRecord,
  maxChars: number,
): { summary: FeedPostSummary; body: string } | null {
  if (text(proposal.deleted_at)) return null;
  if (text(proposal.payload_type) !== "feed_posts") return null;
  const payload = (proposal.payload || {}) as Record<string, unknown>;
  const published = Array.isArray(payload.feed_posts) ? payload.feed_posts[0] : null;
  if (!published || typeof published !== "object") return null;
  const post = published as Record<string, unknown>;
  const body = paragraphs(post.body).join("\n");
  if (!body) return null;
  const request = (proposal.request || {}) as Record<string, unknown>;
  return {
    body,
    summary: {
      id: `${POST_PREFIX}${text(proposal.id)}`,
      topic: text(post.topic) || "own_note",
      created_at: text(proposal.received_at) || text(proposal.created_at),
      author: text(proposal.source_app) || text(request.caller) || "unknown",
      excerpt: excerpt(body, maxChars),
      task_id: nullableText(post.task_id),
      theme_id: nullableText(post.theme),
      note_id: nullableText(post.note_id),
    },
  };
}

/**
 * Feedの読み出し（SNS型Feed 第3段階）。
 *
 * - 利用者が明示的にAIへ向けた質問（`ai_requested_at` 付きの返信）と、その元の投稿。
 * - 直近の投稿（題材の重複を避けるため。本文は抜粋だけ）。
 * - 利用者の明示的な反応（ブックマーク・おもしろい）。
 *
 * 正式データは変更せず、Proposalの採用状態にも触れない。
 */
export class FeedContextQueryService {
  constructor(private readonly readPort: FeedContextReadPort) {}

  execute(input: GetFeedContextRequest): GetFeedContextResponse {
    const request = getFeedContextRequestSchema.parse(input);
    const limit = request.limit ?? DEFAULT_LIMIT;
    const maxChars = request.max_chars ?? DEFAULT_MAX_CHARS;
    const snapshot = this.readPort.readFeedContextSnapshot(false);
    const workspace = snapshot.workspace;

    const posts = new Map<string, FeedPostSummary>();
    const ordered: FeedPostSummary[] = [];
    for (const proposal of workspace.ai_proposals || []) {
      const built = postSummary(proposal, maxChars);
      if (!built) continue;
      posts.set(built.summary.id, built.summary);
      ordered.push(built.summary);
    }
    ordered.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));

    // 回答済みの質問は、AIの返答（`author_kind: "ai"` の返信）から判定する。
    const answeredQuestions = new Set<string>();
    for (const reply of workspace.feed_replies || []) {
      if (text(reply.deleted_at)) continue;
      if (text(reply.author_kind) !== "ai") continue;
      const answered = nullableText(reply.reply_to);
      if (answered) answeredQuestions.add(answered);
    }

    const questions: GetFeedContextResponse["questions"] = [];
    for (const reply of workspace.feed_replies || []) {
      if (text(reply.deleted_at)) continue;
      if (text(reply.author_kind) === "ai") continue;
      const requestedAt = nullableText(reply.ai_requested_at);
      if (!requestedAt) continue;
      const postId = text(reply.post_id);
      const replyId = text(reply.id);
      const answered = answeredQuestions.has(replyId);
      if (answered && !request.include_answered) continue;
      questions.push({
        id: replyId,
        post_id: postId,
        body: text(reply.body),
        created_at: text(reply.created_at),
        requested_at: requestedAt,
        answered,
        post: posts.get(postId) ?? null,
      });
    }
    questions.sort(
      (a, b) => a.requested_at.localeCompare(b.requested_at) || a.id.localeCompare(b.id),
    );

    const bookmarked: string[] = [];
    const interesting: string[] = [];
    for (const reaction of workspace.feed_reactions || []) {
      if (text(reaction.deleted_at)) continue;
      const postId = text(reaction.post_id);
      if (!postId) continue;
      if (text(reaction.kind) === "bookmark" && !bookmarked.includes(postId))
        bookmarked.push(postId);
      else if (text(reaction.kind) === "interesting" && !interesting.includes(postId))
        interesting.push(postId);
    }

    const recentPosts = ordered.slice(0, limit);
    const returnedQuestions = questions.slice(0, limit);
    const truncated =
      ordered.length > recentPosts.length || questions.length > returnedQuestions.length;

    return getFeedContextResponseSchema.parse({
      questions: returnedQuestions,
      recent_posts: recentPosts,
      reactions: {
        bookmarked_post_ids: bookmarked.slice(0, limit),
        interesting_post_ids: interesting.slice(0, limit),
      },
      limit,
      max_chars: maxChars,
      truncated,
      result_meta: {
        contract_version: 1,
        returned_count: returnedQuestions.length + recentPosts.length,
        truncated,
      },
      ai_audience: AUDIENCE,
      read_only: true,
      next_tools: FEED_NEXT_TOOLS,
    });
  }
}
