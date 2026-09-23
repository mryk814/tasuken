import { Button } from "./common";
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
  emptyLabel: string;
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
  emptyLabel,
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
}: FeedStreamProps) {
  const noteRows = notes as unknown as Array<{ id: string } & Record<string, unknown>>;

  return (
    <>
      {posts.length === 0 ? (
        <p className="feed-empty">{emptyLabel}</p>
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
              <FeedPostCard
                key={post.id}
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
            );
          })}
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
