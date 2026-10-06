import { Fragment, type ReactNode } from "react";

import { Button, EmptyState } from "./common";
import { FeedPostCard } from "./FeedPostCard";
import { FEED_PAGE_SIZE } from "../lib/feedFixtures";
import {
  draftNoteId,
  noteReferenceOf,
  type FeedAuthorId,
  type FeedPost,
  type FeedReactionKind,
} from "../lib/feedPosts";

/**
 * 投稿列。ホームAの連続面を組み立て、投稿一件の表示は `FeedPostCard` へ渡す。
 *
 * 投稿ごとの派生（保存済みNote、参照先Note、返信の最新一件）はここで解いて
 * カードへ渡す。正本は持たず、`FeedPage` の表示状態だけを受け取る
 * （`docs/feed-sns-implementation-plan-2026-09-22.md` フェーズ1）。
 */
export interface FeedStreamProps {
  posts: FeedPost[];
  replyPosts: FeedPost[];
  notes: unknown[];
  now: number;
  authorFilter: FeedAuthorId | null;
  expanded: ReadonlySet<string>;
  openThreadId: string | null;
  busy: boolean;
  bookmarks: ReadonlySet<string>;
  interesting: ReadonlySet<string>;
  known: ReadonlySet<string>;
  hasMore: boolean;
  /** 投稿が無いときの見出しと、次にできること（design-guide §5）。 */
  emptyTitle: string;
  emptyAction?: { label: string; onClick(): void };
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
  editingOwnPostId: string | null;
  editingOwnPostBody: string;
  onStartOwnPostEdit(post: FeedPost): void;
  onChangeOwnPostEdit(body: string): void;
  onCancelOwnPostEdit(): void;
  onSaveOwnPostEdit(post: FeedPost): void;
  onDeleteOwnPost(post: FeedPost): void;
  onMore(): void;
  registerRow(postId: string, node: HTMLLIElement | null): void;
  /**
   * 投稿の間に時刻順で差し込む行（AIからの質問・成果の確認・変更案）。
   * `at` はISO時刻。投稿より新しいものから順に、その投稿の前へ置く。
   */
  interleaved?: ReadonlyArray<{ id: string; at: string; node: ReactNode }>;
}

export function FeedStream({
  posts,
  replyPosts,
  notes,
  now,
  authorFilter,
  expanded,
  openThreadId,
  busy,
  bookmarks,
  interesting,
  known,
  hasMore,
  emptyTitle,
  emptyAction,
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
  editingOwnPostId,
  editingOwnPostBody,
  onStartOwnPostEdit,
  onChangeOwnPostEdit,
  onCancelOwnPostEdit,
  onSaveOwnPostEdit,
  onDeleteOwnPost,
  onMore,
  registerRow,
  interleaved = [],
}: FeedStreamProps) {
  const noteRows = notes as unknown as Array<{ id: string } & Record<string, unknown>>;
  const extras = [...interleaved].sort(
    (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
  );
  /** 各投稿の前に置く差し込み行と、最後の投稿より古い残り。描画前に一度だけ分ける。 */
  const extrasByPost = new Map<string, typeof extras>();
  let cursor = 0;
  for (const post of posts) {
    const taken: typeof extras = [];
    while (cursor < extras.length && extras[cursor].at >= post.createdAt) {
      taken.push(extras[cursor]);
      cursor += 1;
    }
    extrasByPost.set(post.id, taken);
  }
  const trailingExtras = extras.slice(cursor);
  const renderExtras = (rows: typeof extras) =>
    rows.map((extra) => <Fragment key={`extra-${extra.id}`}>{extra.node}</Fragment>);
  return (
    <>
      {posts.length === 0 && extras.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          action={emptyAction?.label}
          onAction={emptyAction?.onClick}
        />
      ) : (
        <ol className="feed-posts">
          {posts.map((post) => {
            const savedNote = (() => {
              const id = draftNoteId(post);
              if (!id) return null;
              return noteRows.find((note) => note.id === id) ?? null;
            })();
            const referencedNote = post.referencedNoteId
              ? (noteRows.find((note) => note.id === post.referencedNoteId) ?? null)
              : null;
            const noteReference =
              post.attachment?.kind === "note"
                ? referencedNote
                  ? "saved"
                  : "missing"
                : noteReferenceOf(post, savedNote);
            // 予告に出すのは最新の返信一件だけ。全件は右のスレッドで読む。
            const replies = replyPosts
              .filter((reply) => reply.replyTo === post.id)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
            return (
              <Fragment key={post.id}>
                {renderExtras(extrasByPost.get(post.id) ?? [])}
                <FeedPostCard
                  post={post}
                  now={now}
                  authorFilter={authorFilter}
                  expanded={expanded.has(post.id)}
                  savedNote={savedNote}
                  referencedNote={referencedNote}
                  noteReference={noteReference}
                  replyCount={replies.length}
                  latestReply={replies[0] ?? null}
                  threadOpen={openThreadId === post.id}
                  busy={busy}
                  bookmarkActive={bookmarks.has(post.id)}
                  interestingActive={interesting.has(post.id)}
                  knownActive={known.has(post.id)}
                  onToggleExpanded={onToggleExpanded}
                  onAuthorFilter={onAuthorFilter}
                  onOpenThread={onOpenThread}
                  onOpenArticle={onOpenArticle}
                  onToggleReaction={onToggleReaction}
                  onHide={onHide}
                  onOpenNote={onOpenNote}
                  onOpenTask={onOpenTask}
                  onSaveDraft={onSaveDraft}
                  onOpenSavedNote={onOpenSavedNote}
                  editingOwnPost={editingOwnPostId === post.id}
                  editingOwnPostBody={editingOwnPostBody}
                  onStartOwnPostEdit={onStartOwnPostEdit}
                  onChangeOwnPostEdit={onChangeOwnPostEdit}
                  onCancelOwnPostEdit={onCancelOwnPostEdit}
                  onSaveOwnPostEdit={onSaveOwnPostEdit}
                  onDeleteOwnPost={onDeleteOwnPost}
                  rowRef={(node) => registerRow(post.id, node)}
                />
              </Fragment>
            );
          })}
          {renderExtras(trailingExtras)}
        </ol>
      )}

      {hasMore ? (
        <Button variant="secondary" className="feed-more" onClick={onMore}>
          さらに読む（次の{FEED_PAGE_SIZE}件）
        </Button>
      ) : null}

      <p className="feed-end">ここまでの投稿を表示しました</p>
    </>
  );
}
