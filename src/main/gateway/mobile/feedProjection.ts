import type { MobileFeedPost } from "../../../shared/contracts/mobile/public.ts";
import {
  FEED_AUTHOR_IDENTITIES,
  authorIdForLabel,
  feedPostIdForProposal,
} from "../../../shared/feedAuthors.mjs";
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
}): MobileFeedPost[] {
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
    posts.push({
      postId: feedPostIdForProposal(String(entry.id)),
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
}): MobileFeedPost[] {
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
    posts.push({
      postId: String(entry.id),
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
  limit: number;
}): { posts: MobileFeedPost[]; truncated: boolean } {
  const all = [...projectOwnFeedPosts(input), ...projectProposalFeedPosts(input)].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.postId.localeCompare(right.postId),
  );
  return { posts: all.slice(0, input.limit), truncated: all.length > input.limit };
}
