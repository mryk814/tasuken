import { useEffect, useRef } from "react";

import {
  IconArrowLeft,
  IconBookmark,
  IconDeviceFloppy,
  IconMessageCircle,
} from "@tabler/icons-react";

import { Button } from "./common";
import { MarkdownPreview } from "./MarkdownPreview";
import { authorOf, type FeedPost } from "../lib/feedPosts";
import { previewHtml } from "../lib/markdown";

export interface FeedArticleReaderProps {
  post: FeedPost;
  savedNote: unknown | null;
  busy: boolean;
  onClose(): void;
  onOpenThread(post: FeedPost): void;
  onSaveDraft(post: FeedPost): void;
  onOpenSavedNote(post: FeedPost): void;
}

function articleMarkdown(post: FeedPost): string {
  if (post.attachment?.articleMarkdown) return post.attachment.articleMarkdown;
  if (post.draft?.markdown) return post.draft.markdown;
  return post.attachment?.articleBody?.join("\n\n") ?? "";
}

export function FeedArticleReader({
  post,
  savedNote,
  busy,
  onClose,
  onOpenThread,
  onSaveDraft,
  onOpenSavedNote,
}: FeedArticleReaderProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [post.id]);

  const attachment = post.attachment;
  if (!attachment) return null;
  const author = authorOf(post);
  const isDraft = Boolean(post.draft);
  const markdown = articleMarkdown(post);
  const headingId = `feed-reader-title-${post.id}`;
  // 保存前は「AI記事」、保存後は利用者のNoteとして読む。同じ本文でも所有者が違う。
  const originLabel = savedNote ? "Note保存済み" : isDraft ? "AI記事" : "記事";

  return (
    <article className="feed-reader" aria-labelledby={headingId}>
      <header className="feed-reader-head">
        <div className="feed-reader-origin">
          <span
            className={`feed-avatar feed-avatar-${author.kind} feed-avatar-${author.id}`}
            aria-hidden="true"
          >
            {author.initial}
          </span>
          <span>
            <span className="feed-reader-origin-label">{originLabel}</span>
            <strong>{author.label}</strong>
          </span>
        </div>
        <Button variant="ghost" compact onClick={onClose} aria-label="記事を閉じる">
          <IconArrowLeft size={16} stroke={1.8} aria-hidden="true" />
          戻る
        </Button>
      </header>
      <h2 ref={headingRef} id={headingId} className="feed-reader-title" tabIndex={-1}>
        {post.draft?.title || attachment.title}
      </h2>
      <p className="feed-reader-intro">{attachment.intro}</p>
      {markdown ? (
        <MarkdownPreview
          className="feed-reader-markdown markdown-preview"
          html={previewHtml(markdown, "markdown")}
        />
      ) : (
        <p className="feed-reader-empty">この記事本文はまだありません。</p>
      )}
      <footer className="feed-reader-actions">
        <span className="feed-reader-ref">{attachment.refLabel}</span>
        <div className="feed-detail-actions">
          <Button variant="ghost" compact onClick={() => onOpenThread(post)}>
            <IconMessageCircle size={16} stroke={1.8} aria-hidden="true" />
            会話を開く
          </Button>
          {isDraft && savedNote ? (
            <Button variant="ghost" compact onClick={() => onOpenSavedNote(post)}>
              <IconBookmark size={16} stroke={1.8} aria-hidden="true" />
              Noteで読む
            </Button>
          ) : null}
          {isDraft && !savedNote ? (
            <Button variant="secondary" compact disabled={busy} onClick={() => onSaveDraft(post)}>
              <IconDeviceFloppy size={16} stroke={1.8} aria-hidden="true" />
              Noteに保存
            </Button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
