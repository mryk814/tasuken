import {
  IconBook2,
  IconBookmark,
  IconBulb,
  IconChartDots3,
  IconHeart,
  IconLink,
  IconMessageCircle,
  IconMessageCircleQuestion,
  IconNotes,
  IconDots,
} from "@tabler/icons-react";

import { Button } from "./common";
import {
  FEED_POST_KIND_LABELS,
  authorOf,
  type FeedAuthorId,
  type FeedPost,
  type FeedPostKind,
  type FeedReactionKind,
  type FeedNoteReference,
  needsMore,
} from "../lib/feedPosts";

function formatRelative(value: string, now: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((now - date.getTime()) / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`;
  const days = Math.floor(minutes / (60 * 24));
  if (days < 7) return `${days}日前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function attachmentKindLabel(kind: string): string {
  if (kind === "note") return "Note";
  if (kind === "note_draft") return "AI記事";
  if (kind === "quote") return "引用";
  if (kind === "task") return "Task";
  return "外部資料";
}

/**
 * 添付の見出し。保存前を「AI記事」、保存後を「Note保存済み」として区別する。
 * 参照先が消えている場合は、Noteがあるかのように見せない。
 */
function attachmentLabel(input: { kind: string; saved: boolean; missing: boolean }): string {
  if (input.saved) return "Note保存済み";
  if (input.missing) return "Note";
  return attachmentKindLabel(input.kind);
}

function PostKindIcon({ kind }: { kind: FeedPostKind }) {
  switch (kind) {
    case "insight":
      return <IconBulb size={15} stroke={1.8} aria-hidden="true" />;
    case "learning":
      return <IconBook2 size={15} stroke={1.8} aria-hidden="true" />;
    case "reference":
      return <IconLink size={15} stroke={1.8} aria-hidden="true" />;
    case "question":
      return <IconMessageCircleQuestion size={15} stroke={1.8} aria-hidden="true" />;
    case "work_report":
      return <IconChartDots3 size={15} stroke={1.8} aria-hidden="true" />;
    case "own_note":
      return <IconNotes size={15} stroke={1.8} aria-hidden="true" />;
  }
}

export interface FeedPostCardProps {
  post: FeedPost;
  now: number;
  authorFilter: FeedAuthorId | null;
  expanded: boolean;
  savedNote: unknown | null;
  referencedNote: Record<string, unknown> | null;
  noteReference: FeedNoteReference;
  replyCount: number;
  latestReply: FeedPost | null;
  threadOpen: boolean;
  busy: boolean;
  bookmarkActive: boolean;
  interestingActive: boolean;
  knownActive: boolean;
  onToggleExpanded(postId: string): void;
  onAuthorFilter(author: FeedAuthorId | null): void;
  onOpenThread(post: FeedPost): void;
  onOpenArticle(post: FeedPost): void;
  onToggleReaction(post: FeedPost, kind: FeedReactionKind): void;
  onHide(post: FeedPost): void;
  onOpenNote(note: Record<string, unknown>): void;
  onOpenTask(post: FeedPost): void;
  onSaveDraft(post: FeedPost): void;
  onOpenSavedNote(post: FeedPost): void;
  onOpenOwnNote(post: FeedPost): void;
  onUnpublish(post: FeedPost): void;
  rowRef?: (node: HTMLLIElement | null) => void;
}

export function FeedPostCard({
  post,
  now,
  authorFilter,
  expanded,
  savedNote,
  referencedNote,
  noteReference,
  replyCount,
  latestReply,
  threadOpen,
  busy,
  bookmarkActive,
  interestingActive,
  knownActive,
  onToggleExpanded,
  onAuthorFilter,
  onOpenThread,
  onOpenArticle,
  onToggleReaction,
  onHide,
  onOpenNote,
  onOpenTask,
  onSaveDraft,
  onOpenSavedNote,
  onOpenOwnNote,
  onUnpublish,
  rowRef,
}: FeedPostCardProps) {
  const author = authorOf(post);
  const collapsible = needsMore(post);
  const noteMissing = noteReference === "missing";
  const body = expanded || !collapsible ? post.paragraphs : post.paragraphs.slice(0, 1);
  const article = post.attachment;

  return (
    <li ref={rowRef} className="feed-post" tabIndex={-1}>
      <article className="feed-post-body">
        <span
          className={`feed-avatar feed-avatar-${author.kind} feed-avatar-${author.id}`}
          aria-hidden="true"
        >
          {author.initial}
        </span>
        <div className="feed-post-main">
          <div className="feed-post-head">
            <button
              type="button"
              className="feed-author-name"
              onClick={() => onAuthorFilter(authorFilter === post.author ? null : post.author)}
            >
              {author.label}
            </button>
            {author.kind === "ai" ? <span className="feed-ai-badge">AI</span> : null}
            <time className="feed-post-time" dateTime={post.createdAt}>
              {formatRelative(post.createdAt, now)}
            </time>
            <span
              className={`feed-post-kind is-${post.kind}`}
              title={FEED_POST_KIND_LABELS[post.kind]}
            >
              <PostKindIcon kind={post.kind} />
              <span className="feed-post-kind-label">{FEED_POST_KIND_LABELS[post.kind]}</span>
            </span>
            <details className="feed-post-more-menu">
              <summary aria-label="この投稿の補助操作" title="補助操作">
                <IconDots size={18} stroke={1.8} aria-hidden="true" />
              </summary>
              <div className="feed-post-menu-body">
                <button
                  type="button"
                  className="feed-reaction"
                  aria-pressed={knownActive}
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    onToggleReaction(post, "known");
                  }}
                >
                  既知だった
                </button>
                <button
                  type="button"
                  className="feed-reaction"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    onHide(post);
                  }}
                >
                  今回は見送る
                </button>
              </div>
            </details>
          </div>
          {body.map((paragraph, index) => (
            <p key={`${post.id}-${index}`} className="feed-post-text">
              {paragraph}
            </p>
          ))}
          {collapsible && !expanded ? (
            <button
              type="button"
              className="feed-more-text"
              onClick={() => onToggleExpanded(post.id)}
            >
              もっと読む
            </button>
          ) : null}
          {article ? (
            <div
              className={`feed-attachment is-${article.kind}${noteMissing ? " is-missing" : ""}`}
            >
              <span className="feed-attachment-kind">
                {attachmentLabel({
                  kind: article.kind,
                  saved: Boolean(savedNote),
                  // 元Noteが消えている場合は、参照先があるように見せない。
                  missing: noteMissing && !savedNote,
                })}
              </span>
              <h4 className="feed-attachment-title">
                {String(referencedNote?.title || "") || article.title}
              </h4>
              <p className="feed-attachment-intro">
                {savedNote
                  ? "自分のNotesに保存済み。この投稿と会話はそのまま残ります。"
                  : referencedNote
                    ? "参照しているNote"
                    : noteMissing
                      ? "参照先が削除されています"
                      : article.intro}
              </p>
              {noteMissing ? (
                <p className="feed-attachment-missing">
                  {post.draft
                    ? "元のNoteを「元に戻す」と、この参照からまた読めます。草稿の本文は残っています。"
                    : "元のNoteを「元に戻す」と、この参照からまた読めます。"}
                </p>
              ) : null}
              {article.figureLabel ? (
                <div className="feed-figure">
                  <span className="feed-figure-label">{article.figureLabel}</span>
                </div>
              ) : null}
              <div className="feed-attachment-foot">
                <span className="feed-attachment-ref">{article.refLabel}</span>
                {article.articleBody?.length || article.articleMarkdown ? (
                  <Button variant="ghost" compact onClick={() => onOpenArticle(post)}>
                    記事を読む
                  </Button>
                ) : article.kind === "note" ? (
                  referencedNote ? (
                    <Button variant="ghost" compact onClick={() => onOpenNote(referencedNote)}>
                      Noteで読む
                    </Button>
                  ) : null
                ) : (
                  <Button variant="ghost" compact onClick={() => onOpenTask(post)}>
                    {article.kind === "external" ? "原典を開く" : "Taskを開く"}
                  </Button>
                )}
                {post.draft ? (
                  savedNote ? (
                    <Button variant="ghost" compact onClick={() => onOpenSavedNote(post)}>
                      Noteで読む
                    </Button>
                  ) : noteMissing ? null : (
                    <Button
                      variant="secondary"
                      compact
                      disabled={busy}
                      onClick={() => onSaveDraft(post)}
                    >
                      Noteに保存
                    </Button>
                  )
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="feed-reactions">
            <button
              type="button"
              className={`feed-reaction feed-icon-action${threadOpen ? " is-active" : ""}`}
              aria-label={`返信${replyCount > 0 ? ` ${replyCount}件` : ""}`}
              aria-pressed={threadOpen}
              title={`返信${replyCount > 0 ? ` ${replyCount}件` : ""}`}
              onClick={() => onOpenThread(post)}
            >
              <IconMessageCircle size={16} stroke={1.8} aria-hidden="true" />
              {replyCount > 0 ? <span className="feed-reaction-count">{replyCount}</span> : null}
            </button>
            <button
              type="button"
              className="feed-reaction feed-icon-action"
              aria-label="おもしろい"
              aria-pressed={interestingActive}
              title="おもしろい"
              onClick={() => onToggleReaction(post, "interesting")}
            >
              <IconHeart size={16} stroke={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="feed-reaction feed-icon-action"
              aria-label="ブックマーク"
              aria-pressed={bookmarkActive}
              title="ブックマーク"
              onClick={() => onToggleReaction(post, "bookmark")}
            >
              <IconBookmark size={16} stroke={1.8} aria-hidden="true" />
            </button>
            {post.noteId ? (
              <>
                <button type="button" className="feed-reaction" onClick={() => onOpenOwnNote(post)}>
                  Noteで読む
                </button>
                <button type="button" className="feed-reaction" onClick={() => onUnpublish(post)}>
                  Feedから外す
                </button>
              </>
            ) : null}
          </div>
          {latestReply ? (
            <button
              type="button"
              className="feed-thread-preview"
              onClick={() => onOpenThread(post)}
              aria-label={`会話を開く。最新の返信: ${latestReply.paragraphs[0]}`}
            >
              <IconMessageCircle size={15} stroke={1.8} aria-hidden="true" />
              <span>{latestReply.paragraphs[0]}</span>
              {replyCount > 1 ? <strong>{replyCount}件</strong> : null}
            </button>
          ) : null}
        </div>
      </article>
    </li>
  );
}
