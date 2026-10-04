import type { MobileFeedPost } from "../../../shared/contracts/mobile/public.ts";
import { FEED_AUTHOR_IDENTITIES, authorIdForLabel } from "../../../shared/feedAuthors.mjs";
import { feedPostIdForProposal } from "../../../shared/feedIds.mjs";
import { noteProjectId } from "../../../shared/themeRef.mjs";

type Row = Record<string, unknown>;

const TOPICS = ["work_report", "insight", "learning", "reference", "question", "own_note"] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function paragraphs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
}

function topicOf(value: unknown): MobileFeedPost["topic"] {
  const topic = text(value);
  return (TOPICS as readonly string[]).includes(topic)
    ? (topic as MobileFeedPost["topic"])
    : "own_note";
}

function isRow(value: unknown): value is Row {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function names(entries: readonly unknown[], key: string): Map<string, string> {
  return new Map(
    entries.filter(isRow).map((entry) => [String(entry.id), text(entry[key])] as const),
  );
}

const REACTION_KINDS = ["bookmark", "interesting"] as const;

/** 投稿ごとに自分の反応を集める。削除された反応は数えない。 */
function reactionsByPost(reactions: readonly unknown[]): Map<string, MobileFeedPost["reactions"]> {
  const byPost = new Map<string, MobileFeedPost["reactions"]>();
  for (const entry of reactions) {
    if (!isRow(entry) || entry.deleted_at) continue;
    const postId = text(entry.post_id);
    const kind = text(entry.kind);
    if (!postId || !(REACTION_KINDS as readonly string[]).includes(kind)) continue;
    const current = byPost.get(postId) ?? [];
    if (!current.includes(kind as (typeof REACTION_KINDS)[number])) {
      current.push(kind as (typeof REACTION_KINDS)[number]);
    }
    byPost.set(postId, current);
  }
  return byPost;
}

/**
 * 投稿ごとの返信を古い順に集める。自分の返信（`feed_reply`）とAIの返答
 * （`feed_reply` のAI作成分と `feed_replies` Proposal）を、Desktopの `buildRepliesFromEntities` と同じ範囲で読む。
 */
function repliesByPost(
  replies: readonly unknown[],
  proposals: readonly unknown[],
): Map<string, MobileFeedPost["replies"]> {
  const collected: Array<{ postId: string; reply: MobileFeedPost["replies"][number] }> = [];
  for (const entry of replies) {
    if (!isRow(entry) || entry.deleted_at) continue;
    const postId = text(entry.post_id);
    const body = text(entry.body);
    const createdAt = text(entry.created_at);
    if (!postId || !body || !createdAt) continue;
    const isAi = text(entry.author_kind) === "ai";
    const label = isAi
      ? FEED_AUTHOR_IDENTITIES[authorIdForLabel(text(entry.author_label))].label
      : FEED_AUTHOR_IDENTITIES.self.label;
    collected.push({
      postId,
      reply: {
        replyId: String(entry.id),
        authorKind: isAi ? "ai" : "human",
        authorLabel: label,
        createdAt,
        body: body.slice(0, 4000),
      },
    });
  }
  for (const proposal of proposals) {
    if (!isRow(proposal) || proposal.deleted_at) continue;
    if (text(proposal.payload_type) !== "feed_replies") continue;
    const payload = isRow(proposal.payload) ? proposal.payload : {};
    const answer = Array.isArray(payload.feed_replies) ? payload.feed_replies[0] : null;
    if (!isRow(answer)) continue;
    const postId = text(answer.post_id);
    const body = text(answer.body);
    const createdAt = text(proposal.received_at) || text(proposal.created_at);
    if (!postId || !body || !createdAt) continue;
    const request = isRow(proposal.request) ? proposal.request : {};
    const authorId = authorIdForLabel(
      text(answer.author_label) || text(proposal.source_app) || text(request.caller),
    );
    collected.push({
      postId,
      reply: {
        replyId: `feed-answer:${String(proposal.id)}`,
        authorKind: "ai",
        authorLabel: FEED_AUTHOR_IDENTITIES[authorId as keyof typeof FEED_AUTHOR_IDENTITIES].label,
        createdAt,
        body: body.slice(0, 4000),
      },
    });
  }
  collected.sort(
    (left, right) =>
      left.reply.createdAt.localeCompare(right.reply.createdAt) ||
      left.reply.replyId.localeCompare(right.reply.replyId),
  );
  const byPost = new Map<string, MobileFeedPost["replies"]>();
  for (const { postId, reply } of collected) {
    const current = byPost.get(postId) ?? [];
    if (current.length < 50) current.push(reply);
    byPost.set(postId, current);
  }
  return byPost;
}

/** 本文の長さ・段落数は契約の上限へ収める。超える分は切り、投稿全体は落とさない。 */
function boundedParagraphs(values: readonly string[]): string[] {
  return values.slice(0, 50).map((value) => value.slice(0, 10000));
}

function externalLink(media: unknown): MobileFeedPost["link"] {
  if (!isRow(media) || media.kind !== "external_link") return null;
  const url = text(media.url);
  if (!url || url.length > 2000) return null;
  return {
    url,
    label: text(media.label).slice(0, 200) || null,
    comment: text(media.comment).slice(0, 2000) || null,
  };
}

/**
 * AIが送ったFeed投稿（`feed_posts` Proposal）を、Androidへ渡すread modelへ射影する。
 *
 * Desktopの `buildPostsFromProposals` と同じ範囲を読む（削除されていないProposal。
 * 採用済みも読める）。画像・図・返信・反応は含めない。
 */
export function projectProposalFeedPosts(input: {
  proposals: readonly unknown[];
  tasks: readonly unknown[];
  themes: readonly unknown[];
  reactions?: readonly unknown[];
  replies?: readonly unknown[];
}): MobileFeedPost[] {
  const myReactions = reactionsByPost(input.reactions ?? []);
  const threads = repliesByPost(input.replies ?? [], input.proposals);
  const themeNames = names(input.themes, "name");
  const taskTitles = names(input.tasks, "title");
  const posts: MobileFeedPost[] = [];
  for (const entry of input.proposals) {
    if (!isRow(entry) || entry.deleted_at) continue;
    if (text(entry.payload_type) !== "feed_posts") continue;
    const payload = isRow(entry.payload) ? entry.payload : {};
    const published = Array.isArray(payload.feed_posts) ? payload.feed_posts[0] : null;
    if (!isRow(published)) continue;
    const body = paragraphs(published.body);
    if (body.length === 0) continue;
    const createdAt = text(entry.received_at) || text(entry.created_at);
    if (!createdAt) continue;

    const request = isRow(entry.request) ? entry.request : {};
    const authorId = authorIdForLabel(text(entry.source_app) || text(request.caller));
    const identity = FEED_AUTHOR_IDENTITIES[authorId as keyof typeof FEED_AUTHOR_IDENTITIES];
    const taskId = text(published.task_id) || null;
    const themeId = text(published.theme) || null;
    const article = isRow(published.article) ? published.article : null;
    const noteId = text(published.note_id);
    const postId = feedPostIdForProposal(String(entry.id));
    posts.push({
      postId,
      authorKind: identity.kind === "human" ? "human" : "ai",
      authorLabel: identity.label,
      topic: topicOf(published.topic),
      createdAt,
      body: boundedParagraphs(body),
      taskId,
      taskTitle: taskId ? taskTitles.get(taskId) || null : null,
      themeId,
      themeName: themeId ? themeNames.get(themeId) || themeId : null,
      attachment: article
        ? { kind: "note_draft", title: text(article.title).slice(0, 500) }
        : noteId
          ? { kind: "note", title: (text(published.attachment_label) || "Note").slice(0, 500) }
          : null,
      reactions: myReactions.get(postId) ?? [],
      replies: threads.get(postId) ?? [],
      link: externalLink(published.media),
    } as unknown as MobileFeedPost);
  }
  return posts;
}

/** 自分のFeed投稿（`feed_post`）を射影する。つぶやきなので添付は持たない。 */
export function projectOwnFeedPosts(input: {
  feedPosts: readonly unknown[];
  tasks: readonly unknown[];
  themes: readonly unknown[];
  proposals?: readonly unknown[];
  reactions?: readonly unknown[];
  replies?: readonly unknown[];
}): MobileFeedPost[] {
  const myReactions = reactionsByPost(input.reactions ?? []);
  const threads = repliesByPost(input.replies ?? [], input.proposals ?? []);
  const themeNames = names(input.themes, "name");
  const taskTitles = names(input.tasks, "title");
  const posts: MobileFeedPost[] = [];
  for (const entry of input.feedPosts) {
    if (!isRow(entry) || entry.deleted_at) continue;
    const publishedAt = text(entry.published_at);
    if (!publishedAt) continue;
    const body = text(entry.body_markdown ?? entry.body);
    if (!body) continue;
    const taskId = text(entry.task_id) || null;
    const themeId = noteProjectId(entry);
    const postId = String(entry.id);
    posts.push({
      postId,
      authorKind: "human",
      authorLabel: FEED_AUTHOR_IDENTITIES.self.label,
      topic: "own_note",
      createdAt: publishedAt,
      body: boundedParagraphs(
        body
          .split(/\n{2,}/u)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean),
      ),
      taskId,
      taskTitle: taskId ? taskTitles.get(taskId) || null : null,
      themeId,
      themeName: themeId ? themeNames.get(themeId) || themeId : null,
      attachment: null,
      reactions: myReactions.get(postId) ?? [],
      replies: threads.get(postId) ?? [],
      link: null,
    } as unknown as MobileFeedPost);
  }
  return posts;
}

/**
 * AIの投稿と自分の投稿を新しい順に1本へ並べる。上限を超える分は切り、`truncated` で知らせる。
 * Androidは並べ替えない（Desktopの並びをそのまま使う）。
 */
export function projectFeedPosts(input: {
  proposals: readonly unknown[];
  feedPosts: readonly unknown[];
  tasks: readonly unknown[];
  themes: readonly unknown[];
  reactions?: readonly unknown[];
  replies?: readonly unknown[];
  limit: number;
}): { posts: MobileFeedPost[]; truncated: boolean } {
  const all = [...projectOwnFeedPosts(input), ...projectProposalFeedPosts(input)].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.postId.localeCompare(right.postId),
  );
  return { posts: all.slice(0, input.limit), truncated: all.length > input.limit };
}
