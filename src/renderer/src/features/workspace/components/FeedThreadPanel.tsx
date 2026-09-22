import { useEffect, useRef } from "react";
import {
  IconArrowRight,
  IconClipboard,
  IconExternalLink,
  IconMessageCircle,
  IconMessageCircleQuestion,
  IconPencil,
  IconX,
} from "@tabler/icons-react";

import { Button } from "./common";
import {
  FEED_COPY_EXCERPT_MAX,
  FEED_MANUAL_COMMENT_MAX,
  FEED_MANUAL_QUESTION_MAX,
  FEED_MANUAL_REPLY_MAX,
  FEED_MANUAL_SOURCE_MAX,
  authorOf,
  manualPasteLabel,
  type FeedPost,
} from "../lib/feedPosts";
import { openSafeMarkdownLink, safeMarkdownLinkUrl } from "../lib/markdown";

export interface FeedThreadDraft {
  question: string;
  excerpt: string;
  url: string;
}

export interface FeedPasteDraft {
  answer: string;
  question: string;
  source: string;
  url: string;
  comment: string;
  saveId: string;
}

export interface FeedThreadPanelProps {
  post: FeedPost;
  replies: FeedPost[];
  draft: string;
  copyDraft: FeedThreadDraft | undefined;
  pasteDraft: FeedPasteDraft | undefined;
  pasteEditingId: string | null;
  externalOpen: "copy" | "paste" | undefined;
  busy: boolean;
  copyBusy: boolean;
  onClose(): void;
  onOpenArticle(post: FeedPost): void;
  onDraftChange(postId: string, value: string): void;
  onSubmitReply(post: FeedPost, options?: { askAi?: boolean }): void;
  onDeleteReply(reply: FeedPost): void;
  onToggleExternal(post: FeedPost, panel: "copy" | "paste"): void;
  onUpdateCopyDraft(post: FeedPost, patch: Partial<FeedThreadDraft>): void;
  onCopyForExternalAi(post: FeedPost): void;
  onUpdatePasteDraft(post: FeedPost, patch: Partial<Omit<FeedPasteDraft, "saveId">>): void;
  onSaveManualPaste(post: FeedPost): void;
  onDiscardExternalDraft(post: FeedPost): void;
  onStartPasteCorrection(post: FeedPost, reply: FeedPost): void;
  onSaveManualPasteAsNote(post: FeedPost, reply: FeedPost): void;
}

function formatRelative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`;
  const days = Math.floor(minutes / (60 * 24));
  if (days < 7) return `${days}日前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function ThreadAvatar({ post }: { post: FeedPost }) {
  const author = authorOf(post);
  return (
    <span
      className={`feed-avatar feed-avatar-${author.kind} feed-avatar-${author.id}`}
      aria-label={author.label}
    >
      {author.initial}
    </span>
  );
}

export function FeedThreadPanel({
  post,
  replies,
  draft,
  copyDraft,
  pasteDraft,
  pasteEditingId,
  externalOpen,
  busy,
  copyBusy,
  onClose,
  onOpenArticle,
  onDraftChange,
  onSubmitReply,
  onDeleteReply,
  onToggleExternal,
  onUpdateCopyDraft,
  onCopyForExternalAi,
  onUpdatePasteDraft,
  onSaveManualPaste,
  onDiscardExternalDraft,
  onStartPasteCorrection,
  onSaveManualPasteAsNote,
}: FeedThreadPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [post.id]);

  return (
    <aside className="feed-thread-panel" aria-label="会話">
      <header className="feed-thread-head">
        <h2 ref={headingRef} tabIndex={-1}>
          <IconMessageCircle size={18} stroke={1.8} aria-hidden="true" />
          会話
        </h2>
        <Button variant="ghost" compact onClick={onClose} aria-label="会話を閉じる">
          <IconX size={16} stroke={1.8} aria-hidden="true" />
          閉じる
        </Button>
      </header>

      <article className="feed-thread-origin">
        <div className="feed-thread-author">
          <ThreadAvatar post={post} />
          <span>
            <strong>{authorOf(post).label}</strong>
            <time dateTime={post.createdAt}>{formatRelative(post.createdAt)}</time>
          </span>
        </div>
        {post.paragraphs.map((paragraph, index) => (
          <p key={`${post.id}-thread-origin-${index}`} className="feed-post-text">
            {paragraph}
          </p>
        ))}
        {post.attachment?.articleBody?.length || post.attachment?.articleMarkdown ? (
          <Button variant="ghost" compact onClick={() => onOpenArticle(post)}>
            {post.draft ? "草稿を読む" : "記事を読む"}
            <IconArrowRight size={15} stroke={1.8} aria-hidden="true" />
          </Button>
        ) : null}
      </article>

      {replies.length > 0 ? (
        <ol className="feed-thread-posts" aria-label="返信">
          {replies.map((reply) => (
            <li key={reply.id} className="feed-post is-reply feed-thread-reply">
              <article className="feed-post-body">
                <ThreadAvatar post={reply} />
                <div className="feed-post-main">
                  <div className="feed-post-head">
                    <strong className="feed-author-name">{authorOf(reply).label}</strong>
                    <time className="feed-post-time" dateTime={reply.createdAt}>
                      {formatRelative(reply.createdAt)}
                    </time>
                  </div>
                  {reply.paragraphs.map((paragraph, index) => (
                    <p key={`${reply.id}-${index}`} className="feed-post-text">
                      {paragraph}
                    </p>
                  ))}
                  <div className="feed-reactions">
                    <span className="feed-thread-note">
                      {reply.manualOrigin === "manual_paste"
                        ? manualPasteLabel({ external_source: reply.manualSource })
                        : reply.author === "self"
                          ? "自分の返信"
                          : "AIの返答"}
                    </span>
                    {reply.aiState === "requested" ? (
                      <span className="feed-thread-state">AIに依頼済み</span>
                    ) : reply.aiState === "answered" ? (
                      <span className="feed-thread-state">回答あり</span>
                    ) : null}
                    {reply.manualOrigin === "manual_paste" ? (
                      <span className="feed-thread-note">
                        利用者提供であり事実確認済みを意味しません
                      </span>
                    ) : null}
                    {reply.replyId && reply.author === "self" ? (
                      <button
                        type="button"
                        className="feed-reaction"
                        onClick={() => onDeleteReply(reply)}
                      >
                        削除
                      </button>
                    ) : null}
                  </div>
                  {reply.manualOrigin === "manual_paste" ? (
                    <div className="feed-manual-detail">
                      {reply.manualQuestion ? (
                        <p className="feed-post-meta">質問: {reply.manualQuestion}</p>
                      ) : null}
                      {reply.manualComment ? (
                        <p className="feed-post-meta">自分の一言: {reply.manualComment}</p>
                      ) : null}
                      {reply.manualUrl && safeMarkdownLinkUrl(reply.manualUrl) ? (
                        <div className="feed-detail-actions">
                          <Button
                            variant="ghost"
                            compact
                            type="button"
                            onClick={() => openSafeMarkdownLink(reply.manualUrl ?? "")}
                          >
                            会話を開く（外部）
                          </Button>
                          <span className="feed-post-meta">{reply.manualUrl}</span>
                        </div>
                      ) : reply.manualUrl ? (
                        <p className="feed-post-meta">会話: {reply.manualUrl}</p>
                      ) : null}
                      <div className="feed-detail-actions">
                        <Button
                          variant="ghost"
                          compact
                          type="button"
                          onClick={() => onStartPasteCorrection(post, reply)}
                        >
                          <IconPencil size={15} stroke={1.8} aria-hidden="true" />
                          貼り付けを訂正
                        </Button>
                        <Button
                          variant="ghost"
                          compact
                          type="button"
                          onClick={() => onSaveManualPasteAsNote(post, reply)}
                        >
                          Noteに保存
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <p className="feed-thread-empty">まだ返信はありません。最初の一言を残せます。</p>
      )}

      <form
        className="feed-reply feed-thread-reply-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitReply(post);
        }}
      >
        <label htmlFor={`feed-thread-reply-${post.id}`}>返信</label>
        <textarea
          id={`feed-thread-reply-${post.id}`}
          value={draft}
          onChange={(event) => onDraftChange(post.id, event.target.value)}
          rows={3}
          placeholder="この投稿について一言返す"
        />
        <div className="feed-detail-actions">
          <Button variant="primary" type="submit" disabled={busy}>
            返信を残す
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            title="接続済みAIへの質問として残します。押した時点ではAIを起動しません。"
            onClick={() => onSubmitReply(post, { askAi: true })}
          >
            <IconMessageCircleQuestion size={16} stroke={1.8} aria-hidden="true" />
            AIに聞く
          </Button>
          <Button
            variant="ghost"
            type="button"
            aria-expanded={externalOpen === "copy"}
            onClick={() => onToggleExternal(post, "copy")}
          >
            <IconClipboard size={16} stroke={1.8} aria-hidden="true" />
            外部AIに聞く
          </Button>
          <Button
            variant="ghost"
            type="button"
            aria-expanded={externalOpen === "paste"}
            onClick={() => onToggleExternal(post, "paste")}
          >
            <IconExternalLink size={16} stroke={1.8} aria-hidden="true" />
            回答を貼り付け
          </Button>
        </div>
        <p className="feed-post-meta">
          「AIに聞く」は質問を保存するだけで、押した時点ではAIを起動しません。
        </p>
        {externalOpen === "copy" ? (
          <div className="feed-external-panel" aria-label="外部AIへの質問コピー">
            <p className="feed-post-meta">
              質問と選んだ文脈だけをコピーします。Taskenは送信・ブラウザ起動・AI実行をしません。
            </p>
            <label htmlFor={`feed-copy-q-${post.id}`}>質問</label>
            <textarea
              id={`feed-copy-q-${post.id}`}
              value={copyDraft?.question ?? ""}
              onChange={(event) => onUpdateCopyDraft(post, { question: event.target.value })}
              rows={2}
              placeholder="外部AIに聞きたいことを書く"
            />
            <label htmlFor={`feed-copy-excerpt-${post.id}`}>
              元投稿の抜粋（編集可、{FEED_COPY_EXCERPT_MAX}文字以内）
            </label>
            <textarea
              id={`feed-copy-excerpt-${post.id}`}
              value={copyDraft?.excerpt ?? ""}
              onChange={(event) => onUpdateCopyDraft(post, { excerpt: event.target.value })}
              rows={3}
            />
            <label htmlFor={`feed-copy-url-${post.id}`}>引用・資料URL（任意）</label>
            <input
              id={`feed-copy-url-${post.id}`}
              type="url"
              inputMode="url"
              value={copyDraft?.url ?? ""}
              onChange={(event) => onUpdateCopyDraft(post, { url: event.target.value })}
              placeholder="https://…"
            />
            <p className="feed-post-meta">
              添付Note全文・Task詳細・他のスレッド・ファイルパスは自動で付けません。
            </p>
            <div className="feed-detail-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={copyBusy}
                onClick={() => onCopyForExternalAi(post)}
              >
                {copyBusy ? "コピー中" : "コピーする"}
              </Button>
              <Button variant="ghost" type="button" onClick={() => onDiscardExternalDraft(post)}>
                下書きを破棄
              </Button>
            </div>
          </div>
        ) : null}
        {externalOpen === "paste" ? (
          <div className="feed-external-panel" aria-label="外部AI回答の貼り付け">
            <p className="feed-post-meta">
              回答本文を入力し、必要なら出所・会話URL・自分の一言を添えて、この投稿のスレッドへ保存します。
            </p>
            <label htmlFor={`feed-paste-a-${post.id}`}>
              回答本文（{FEED_MANUAL_REPLY_MAX}文字以内）
            </label>
            <textarea
              id={`feed-paste-a-${post.id}`}
              value={pasteDraft?.answer ?? ""}
              onChange={(event) => onUpdatePasteDraft(post, { answer: event.target.value })}
              rows={4}
              placeholder="外部AIの回答を貼り付け"
            />
            <p className="feed-post-meta">
              {(pasteDraft?.answer ?? "").length}/{FEED_MANUAL_REPLY_MAX}文字
            </p>
            <label htmlFor={`feed-paste-q-${post.id}`}>
              質問（{FEED_MANUAL_QUESTION_MAX}文字以内）
            </label>
            <textarea
              id={`feed-paste-q-${post.id}`}
              value={pasteDraft?.question ?? ""}
              onChange={(event) => onUpdatePasteDraft(post, { question: event.target.value })}
              rows={2}
            />
            <label htmlFor={`feed-paste-s-${post.id}`}>
              出所（任意、{FEED_MANUAL_SOURCE_MAX}文字以内。例: M365 Copilot）
            </label>
            <input
              id={`feed-paste-s-${post.id}`}
              value={pasteDraft?.source ?? ""}
              onChange={(event) => onUpdatePasteDraft(post, { source: event.target.value })}
              placeholder="未指定なら「外部AI」と表示"
            />
            <label htmlFor={`feed-paste-u-${post.id}`}>会話URL（任意）</label>
            <input
              id={`feed-paste-u-${post.id}`}
              type="url"
              inputMode="url"
              value={pasteDraft?.url ?? ""}
              onChange={(event) => onUpdatePasteDraft(post, { url: event.target.value })}
              placeholder="https://…"
            />
            <label htmlFor={`feed-paste-c-${post.id}`}>
              自分の一言（任意、{FEED_MANUAL_COMMENT_MAX}文字以内）
            </label>
            <textarea
              id={`feed-paste-c-${post.id}`}
              value={pasteDraft?.comment ?? ""}
              onChange={(event) => onUpdatePasteDraft(post, { comment: event.target.value })}
              rows={2}
              placeholder="自分の解釈・気づき"
            />
            <div className="feed-preview" aria-label="保存前プレビュー">
              <p className="feed-post-meta">保存前プレビュー</p>
              <p className="feed-post-meta">
                {manualPasteLabel({ external_source: pasteDraft?.source })}
              </p>
              {pasteDraft?.question ? (
                <p className="feed-post-meta">質問: {pasteDraft.question}</p>
              ) : null}
              {pasteDraft?.answer ? <p className="feed-post-text">{pasteDraft.answer}</p> : null}
              {pasteDraft?.comment ? (
                <p className="feed-post-meta">自分の一言: {pasteDraft.comment}</p>
              ) : null}
              <p className="feed-post-meta">
                回答内容・出所・会話URLは利用者提供であり、事実確認済みを意味しません。
              </p>
            </div>
            <div className="feed-detail-actions">
              <Button
                variant="primary"
                type="button"
                disabled={busy}
                onClick={() => onSaveManualPaste(post)}
              >
                {pasteEditingId ? "訂正を保存" : busy ? "保存中" : "返信として保存"}
              </Button>
              <Button variant="ghost" type="button" onClick={() => onDiscardExternalDraft(post)}>
                下書きを破棄
              </Button>
            </div>
          </div>
        ) : null}
      </form>
    </aside>
  );
}
