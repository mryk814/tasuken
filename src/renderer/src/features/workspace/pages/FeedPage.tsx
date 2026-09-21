import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CommandEnvelope } from "../../../../../shared/applicationCommand";
import type { BaseRecord, PageProps } from "../types";
import { Button, PageHeader } from "../components/common";
import {
  FEED_PAGE_SIZE,
  buildFeedProjection,
  selectNeedsYou,
  type FeedItem,
} from "../lib/feedFixtures";
import { buildLiveFeed } from "../lib/feedProjection";
import { buildSaveTaskOperations } from "../domain-model/persistence";
import {
  FEED_POSTS,
  FEED_POST_KIND_LABELS,
  authorOf,
  buildPostsFromProposals,
  buildRepliesFromEntities,
  draftNoteEntity,
  draftNoteId,
  feedReactionId,
  feedReplyEntity,
  filterPosts,
  needsMore,
  postsForHome,
  postsForLearning,
  withReplies,
  type FeedAuthorId,
  type FeedPost,
  type FeedReactionKind,
} from "../lib/feedPosts";
import { uuid } from "../lib/format";

/**
 * Feed（SNS型の読む面。`docs/feed-learning-sns-plan-2026-09-21.md`）。
 *
 * AIから届いた投稿（`feed_posts` Proposal）をそのまま読み、投稿が1件も無いときだけ
 * 開発用fixture（架空データ）を使う。記事の草稿は「Noteに保存」で既存の採用経路へ渡し、
 * 読む操作とブックマークはTaskや未解決件数を変えない。
 * 「対応待ち」タブは既存の要対応projection（`buildAttentionQueue`）を正本にした実データで、
 * ここから回答・Task操作は既存Commandへ繋ぐ。
 *
 * 読む面の規則は `docs/feed-surface.md`。
 */

type FeedTab = "home" | "learn" | "needs";

const TABS: ReadonlyArray<{ id: FeedTab; label: string }> = [
  { id: "home", label: "ホーム" },
  { id: "learn", label: "学び" },
  { id: "needs", label: "対応待ち" },
];

/** 開発用: 閲覧中に届いたことにして、押すまで一覧へ割り込ませない。 */
const ARRIVING_POST_IDS = ["post-solvent-switch", "post-draft-note-uncertainty"];
/** 開発用: 前回の閲覧位置の区切り。fixtureでは3件目の直前を前回の終端とする。 */
const PREVIOUS_READING_EDGE_ID = "post-sample-size-reply";

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
  if (kind === "note_draft") return "記事の草稿";
  if (kind === "quote") return "引用";
  if (kind === "task") return "Task";
  return "外部資料";
}

export function FeedPage({
  data,
  domain,
  executeCommand,
  saveEntities,
  openDrawer,
  navigate,
  setToast,
  removeEntity,
}: PageProps) {
  // 実データでは保存済みの反応を、fixtureでは画面内の印を使う。
  const [tab, setTab] = useState<FeedTab>("home");
  const [limit, setLimit] = useState(FEED_PAGE_SIZE);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(() => new Set());
  const [interesting, setInteresting] = useState<ReadonlySet<string>>(() => new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [authorFilter, setAuthorFilter] = useState<FeedAuthorId | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [openNeedsId, setOpenNeedsId] = useState<string | null>(null);
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);
  const [arrivalsApplied, setArrivalsApplied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftAnswer, setDraftAnswer] = useState("");
  const rowRefs = useRef(new Map<string, HTMLElement>());
  // 相対時刻は描画中に現在時刻を読まず、初回に固定する。
  const [now] = useState(() => Date.now());

  const live = useMemo(
    () =>
      buildLiveFeed({
        tasks: domain.tasks as unknown[],
        proposals: domain.ai_proposals as unknown[],
        receipts: data.work_receipts as unknown[],
        themes: data.themes as unknown[],
        schedules: data.schedules as unknown[],
        today: new Date(now).toISOString().slice(0, 10),
      }),
    [domain.tasks, domain.ai_proposals, data.work_receipts, data.themes, data.schedules, now],
  );

  /**
   * 投稿の出所。AIから届いた読み物Proposal（`feed_posts`）を読み、
   * まだ1件も無いときだけ開発用fixtureを使う（第1段階の設計確認用）。
   */
  const livePosts = useMemo(
    () =>
      buildPostsFromProposals({
        proposals: domain.ai_proposals as unknown[],
        themes: data.themes as unknown[],
        tasks: domain.tasks as unknown[],
      }),
    [domain.ai_proposals, domain.tasks, data.themes],
  );
  /** 返信は投稿のIDに紐づくEntity、AIの返答はProposalとして届く。同じスレッドへ並べる。 */
  const replyPosts = useMemo(
    () =>
      buildRepliesFromEntities({
        replies: domain.feed_replies as unknown[],
        proposals: domain.ai_proposals as unknown[],
      }),
    [domain.feed_replies, domain.ai_proposals],
  );
  const usingFixtures = livePosts.length === 0 && replyPosts.length === 0;

  /**
   * 読者の状態はEntityとして保存する（投稿の正本ではない）。
   * 保存された印は `domain` 側の正規化を通して読む（未保存のworkspaceでは空になる）。
   */
  const reactions = useMemo(() => {
    const bookmark = new Set<string>();
    const interesting = new Set<string>();
    const hiddenPosts = new Set<string>();
    const rows = Array.isArray(domain.feed_reactions) ? domain.feed_reactions : [];
    for (const row of rows as unknown as Array<Record<string, unknown>>) {
      const postId = typeof row.post_id === "string" ? row.post_id : "";
      if (!postId) continue;
      if (row.kind === "bookmark") bookmark.add(postId);
      else if (row.kind === "interesting") interesting.add(postId);
      else if (row.kind === "hidden") hiddenPosts.add(postId);
    }
    return { bookmark, interesting, hidden: hiddenPosts };
  }, [domain.feed_reactions]);

  const sourcePosts = useMemo(() => {
    const all = usingFixtures ? FEED_POSTS : [...livePosts, ...replyPosts];
    const visible = all.filter((post) => !hidden.has(post.id) && !reactions.hidden.has(post.id));
    return {
      arriving: usingFixtures ? visible.filter((post) => ARRIVING_POST_IDS.includes(post.id)) : [],
      settled: usingFixtures
        ? visible.filter((post) => !ARRIVING_POST_IDS.includes(post.id))
        : visible,
    };
  }, [hidden, livePosts, reactions.hidden, replyPosts, usingFixtures]);

  const timeline = useMemo(() => {
    const posts = arrivalsApplied
      ? [...sourcePosts.arriving, ...sourcePosts.settled]
      : sourcePosts.settled;
    const base = tab === "learn" ? postsForLearning(posts) : postsForHome(posts);
    return withReplies(filterPosts(base, { author: authorFilter }));
  }, [arrivalsApplied, authorFilter, sourcePosts, tab]);

  const shownPosts = timeline.slice(0, limit);
  const hasMorePosts = timeline.length > shownPosts.length;
  const needsRows = useMemo(() => {
    if (tab !== "needs") return [] as FeedItem[];
    return selectNeedsYou(buildFeedProjection(live.items).items);
  }, [live.items, tab]);

  const openNeedsItem = needsRows.find((item) => item.id === openNeedsId) ?? null;
  const openArticle = useMemo(() => {
    // 読む面はfixtureと実データの両方を開ける。実データがあればそちらが正本。
    const pool = usingFixtures ? FEED_POSTS : livePosts;
    const post = pool.find((entry) => entry.id === openArticleId) ?? null;
    return post?.attachment?.articleBody ? post : null;
  }, [livePosts, openArticleId, usingFixtures]);

  const focusRow = useCallback((id: string) => {
    rowRefs.current.get(id)?.focus();
  }, []);

  /** 記事を閉じたら、開いた投稿へfocusを戻す。 */
  const closeArticle = useCallback(() => {
    const originId = openArticleId;
    setOpenArticleId(null);
    if (originId) window.requestAnimationFrame(() => focusRow(`post-${originId}`));
  }, [focusRow, openArticleId]);

  useEffect(() => {
    if (!openArticleId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeArticle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeArticle, openArticleId]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleIn = useCallback(
    (setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>, id: string) => {
      setter((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  /**
   * 読者の状態はEntityとして保存し、取り消しは削除で行う（既存の保存境界）。
   * 開発用fixtureの投稿は保存先を持たないので画面内だけに留める。
   */
  const toggleReaction = useCallback(
    async (post: FeedPost, kind: FeedReactionKind) => {
      const saved = reactions[kind].has(post.id);
      if (!usingFixtures) {
        const id = feedReactionId(post.id, kind);
        try {
          if (saved) await removeEntity("feed_reaction", { id });
          else
            await saveEntities(
              [
                {
                  action: "save",
                  type: "feed_reaction",
                  entity: {
                    id,
                    post_id: post.id,
                    kind,
                    created_at: new Date().toISOString(),
                  },
                },
              ],
              kind === "bookmark" ? "ブックマークしました。" : "記録しました。",
              "main_ui",
            );
        } catch (error) {
          setToast(
            `保存できませんでした。${error instanceof Error ? error.message : String(error)}`,
            "danger",
          );
          return;
        }
      } else if (kind === "bookmark") {
        toggleIn(setBookmarks, post.id);
      } else if (kind === "interesting") {
        toggleIn(setInteresting, post.id);
      } else {
        setHidden((current) => new Set(current).add(post.id));
      }
      setNotice(
        kind === "hidden"
          ? "この投稿を今回は見送りました。Taskは変わっていません。"
          : saved
            ? "印を外しました。未解決件数は変わっていません。"
            : "印を付けました。未解決件数は変わっていません。",
      );
    },
    [reactions, removeEntity, saveEntities, setToast, toggleIn, usingFixtures],
  );

  const toggleBookmark = useCallback(
    (post: FeedPost) => void toggleReaction(post, "bookmark"),
    [toggleReaction],
  );

  const toggleInteresting = useCallback(
    (post: FeedPost) => void toggleReaction(post, "interesting"),
    [toggleReaction],
  );

  const hidePost = useCallback(
    (post: FeedPost) => void toggleReaction(post, "hidden"),
    [toggleReaction],
  );

  /** 返信の下書きは投稿IDごとに持つ。閉じても消さない。 */
  const openReply = useCallback((post: FeedPost) => {
    setReplyTo((current) => (current === post.id ? null : post.id));
  }, []);

  const updateDraft = useCallback((postId: string, value: string) => {
    setDrafts((current) => ({ ...current, [postId]: value }));
  }, []);

  /**
   * 返信は投稿のIDに紐づけて保存する（第3段階）。
   * `askAi` を付けると、外部AIが `tasken.get_feed_context` で読む質問として残す。
   * 開発用fixtureの投稿は保存先を持たないので、下書きの保持までにする。
   */
  const submitReply = useCallback(
    async (post: FeedPost, options: { askAi?: boolean } = {}) => {
      const body = (drafts[post.id] ?? "").trim();
      if (!body) {
        setToast("返信の本文を入力してください。", "warning");
        return;
      }
      if (usingFixtures) {
        setNotice("この投稿は開発用です。返信は実データの投稿へ残せます。");
        return;
      }
      setBusy(true);
      try {
        await saveEntities(
          [
            {
              action: "save",
              type: "feed_reply",
              entity: feedReplyEntity({
                id: uuid(),
                postId: post.id,
                body,
                createdAt: new Date().toISOString(),
                askAi: options.askAi === true,
              }),
            },
          ],
          options.askAi ? "AIへの質問を残しました。" : "返信を残しました。",
          "main_ui",
        );
        setDrafts((current) => ({ ...current, [post.id]: "" }));
        setReplyTo(null);
        setNotice(
          options.askAi
            ? "質問を残しました。外部AIが取得すると「依頼済み」、返答が届くと「回答あり」になります。"
            : "返信を残しました。Taskと未解決件数は変わっていません。",
        );
      } catch (error) {
        // 失敗しても入力は消さない。
        setToast(
          `返信を保存できませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [drafts, saveEntities, setToast, usingFixtures],
  );

  /** 自分の返信はEntityの削除で取り消す（既存の「元に戻す」を使う）。 */
  const deleteReply = useCallback(
    (post: FeedPost) => {
      if (!post.replyId) return;
      void removeEntity("feed_reply", { id: post.replyId });
    },
    [removeEntity],
  );

  /** 記事の草稿が正式Noteになっていれば、そのNoteを返す（IDはProposalから決まる）。 */
  const savedNoteOf = useCallback(
    (post: FeedPost) => {
      const id = draftNoteId(post);
      if (!id) return null;
      return (
        (domain.notes as unknown as Array<{ id: string }>).find((note) => note.id === id) ?? null
      );
    },
    [domain.notes],
  );

  /**
   * 記事の草稿を正式なNoteとして保存する（既存のProposal採用経路）。
   * 読むだけでは正式データを増やさず、投稿のIDとブックマークも変えない。
   */
  const saveDraftAsNote = useCallback(
    async (post: FeedPost) => {
      const note = draftNoteEntity(post);
      const proposalId = post.proposalId;
      const proposal = proposalId
        ? (domain.ai_proposals as unknown as BaseRecord[]).find((entry) => entry.id === proposalId)
        : undefined;
      if (!note || !proposal) {
        setToast("記事の草稿が見つかりません。投稿を読み直してください。", "danger");
        return;
      }
      const version = Number(proposal.version || 0);
      setBusy(true);
      try {
        await executeCommand({
          commandId: `feed-post:${proposalId}:save-note:v${version}`,
          name: "ApplyAiProposal",
          payload: {
            proposal: { ...proposal, status: "accepted" },
            candidates: [{ type: "note", entity: note }],
          },
          actor: { kind: "user" },
          source: "main_ui",
          expectedVersions: [{ type: "ai_proposal", id: String(proposalId), version }],
          issuedAt: String(
            proposal.received_at || proposal.created_at || proposal.updated_at || "",
          ),
        } as CommandEnvelope);
        setNotice("記事をNoteに保存しました。投稿と読んだ印はそのまま残ります。");
        setToast("Noteに保存しました。", "success");
      } catch (error) {
        setToast(
          `Noteに保存できませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [domain.ai_proposals, executeCommand, setToast],
  );

  const openSavedNote = useCallback(
    (post: FeedPost) => {
      const note = savedNoteOf(post);
      if (note) openDrawer({ type: "note", entity: note as never });
    },
    [openDrawer, savedNoteOf],
  );

  const taskOf = useCallback(
    (item: FeedItem) => {
      if (!item.taskId) return null;
      return (
        (domain.tasks as unknown as Array<{ id: string }>).find(
          (task) => task.id === item.taskId,
        ) ?? null
      );
    },
    [domain.tasks],
  );

  const openTaskDrawer = useCallback(
    (item: FeedItem) => {
      const task = taskOf(item);
      if (task) {
        openDrawer({ type: "task", entity: task as never, commandSource: "main_ui" });
        return;
      }
      navigate("ai-io");
    },
    [navigate, openDrawer, taskOf],
  );

  const submitAnswer = useCallback(
    async (item: FeedItem) => {
      const body = draftAnswer.trim();
      if (!body) {
        setToast("回答を入力してください。", "warning");
        return;
      }
      const task = taskOf(item) as { id: string; version?: number } | null;
      if (!task || !item.requestId) {
        setToast("この質問のIDを確認できません。画面を再読み込みしてください。", "danger");
        return;
      }
      setBusy(true);
      try {
        await executeCommand({
          commandId: `${item.id}:reply:${Date.now()}`,
          name: "ReplyToAgentRequest",
          payload: { taskId: task.id, requestId: item.requestId, body },
          actor: { kind: "user" },
          source: "main_ui",
          expectedVersions: [{ type: "task", id: task.id, version: Number(task.version ?? 0) }],
          issuedAt: new Date().toISOString(),
        } as never);
        setNotice("回答を送りました。agentの再開を待ちます。");
        setDraftAnswer("");
        setToast("回答を送りました。agentの再開を待ちます。", "success");
      } catch (error) {
        setToast(
          `回答を送れませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [draftAnswer, executeCommand, setToast, taskOf],
  );

  const changeTodayDate = useCallback(
    async (item: FeedItem, target: string | null) => {
      const task = taskOf(item) as {
        id: string;
        today_date?: string | null;
        version?: number;
      } | null;
      if (!task) return;
      const message = target === null ? "今日の選択を外しました。" : "今日扱います。";
      setBusy(true);
      try {
        await saveEntities(
          buildSaveTaskOperations({ ...task, today_date: target } as never),
          message,
          "main_ui",
        );
        setToast(`${message} 締切は変わりません。`, "success");
      } catch (error) {
        setToast(
          `扱う日を変更できませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [saveEntities, setToast, taskOf],
  );

  return (
    <div className="page feed-page">
      <PageHeader route="feed" />

      <div className="feed-shell">
        <header className="feed-tabs" role="tablist" aria-label="Feedの切り替え">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? "is-active" : undefined}
              onClick={() => {
                setTab(entry.id);
                setOpenNeedsId(null);
                setOpenArticleId(null);
              }}
            >
              {entry.label}
              {entry.id === "needs" && live.unresolved > 0 ? (
                <span className="feed-tab-count">{live.unresolved}</span>
              ) : null}
            </button>
          ))}
          <div className="feed-tabs-spacer" />
          {tab !== "needs" && !arrivalsApplied && sourcePosts.arriving.length > 0 ? (
            <button
              type="button"
              className="feed-new-arrivals"
              onClick={() => {
                setArrivalsApplied(true);
                setNotice(null);
              }}
            >
              新しい投稿 {sourcePosts.arriving.length}件
            </button>
          ) : null}
        </header>

        {authorFilter ? (
          <p className="feed-filter-note">
            {authorOf({ author: authorFilter } as FeedPost).label} の投稿だけを表示しています。
            <Button variant="ghost" compact onClick={() => setAuthorFilter(null)}>
              絞り込みを解除
            </Button>
          </p>
        ) : null}

        {notice ? (
          <p className="feed-notice-line" role="status">
            {notice}
          </p>
        ) : null}

        {tab === "needs" ? (
          <section className="feed-timeline" aria-label="対応待ち">
            {needsRows.length === 0 ? (
              <p className="feed-empty">
                いま対応する更新はありません。読み物はホームと学びにあります。
              </p>
            ) : (
              <ul className="feed-needs-list">
                {needsRows.map((item) => (
                  <li key={item.id} className="feed-needs-row">
                    <div className="feed-needs-head">
                      <span className="feed-author-name">{item.actorLabel ?? "Tasken"}</span>
                      <span className={`feed-state feed-state-${item.state}`}>
                        {item.stateLabel}
                      </span>
                    </div>
                    <h3 className="feed-needs-title">
                      <button
                        type="button"
                        className="feed-row-open"
                        aria-expanded={item.id === openNeedsId}
                        onClick={() => {
                          setOpenNeedsId(item.id === openNeedsId ? null : item.id);
                          setDraftAnswer("");
                        }}
                        ref={(node) => {
                          if (node) rowRefs.current.set(`needs-${item.id}`, node);
                          else rowRefs.current.delete(`needs-${item.id}`);
                        }}
                      >
                        {item.headline}
                      </button>
                    </h3>
                    <p className="feed-post-text">{item.summary}</p>
                    <p className="feed-post-meta">{item.pathLabel}</p>
                    <div className="feed-reactions">
                      {item.actions.slice(0, 2).map((action) => (
                        <Button
                          key={action.id}
                          variant="ghost"
                          compact
                          onClick={() => {
                            if (action.id === "open_task" || action.id === "review_report") {
                              openTaskDrawer(item);
                              return;
                            }
                            setOpenNeedsId(item.id);
                            setDraftAnswer("");
                          }}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                    {openNeedsItem?.id === item.id ? (
                      <div className="feed-answer">
                        <p className="feed-post-meta">表示理由: {item.reasonShown}</p>
                        <dl className="feed-detail-rows">
                          {item.detail.rows.map((row) => (
                            <div key={row.label}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                        {item.requestId ? (
                          <form
                            className="feed-reply"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void submitAnswer(item);
                            }}
                          >
                            <label htmlFor="feed-answer-body">回答</label>
                            <textarea
                              id="feed-answer-body"
                              value={draftAnswer}
                              onChange={(event) => setDraftAnswer(event.target.value)}
                              rows={3}
                              disabled={busy}
                            />
                            <div className="feed-detail-actions">
                              <Button variant="primary" type="submit" disabled={busy}>
                                {busy ? "送信中" : "回答を送る"}
                              </Button>
                              <Button
                                variant="ghost"
                                type="button"
                                disabled={busy}
                                onClick={() => void changeTodayDate(item, null)}
                              >
                                今日の選択を外す
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <div className="feed-detail-actions">
                            <Button
                              variant="secondary"
                              compact
                              onClick={() => openTaskDrawer(item)}
                            >
                              Taskを開く
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section className="feed-timeline" aria-label={tab === "learn" ? "学び" : "ホーム"}>
            {shownPosts.length === 0 ? (
              <p className="feed-empty">まだ読める投稿がありません。</p>
            ) : (
              <ol className="feed-posts">
                {shownPosts.map((post) => {
                  const author = authorOf(post);
                  const isReply = post.replyTo !== null;
                  const isExpanded = expanded.has(post.id);
                  const collapsible = needsMore(post);
                  // 記事の草稿は採用前と採用後で状態を書き分ける。
                  const savedNote = savedNoteOf(post);
                  const body =
                    isExpanded || !collapsible ? post.paragraphs : post.paragraphs.slice(0, 1);
                  return (
                    <li
                      key={post.id}
                      className={`feed-post${isReply ? " is-reply" : ""}`}
                      ref={(node) => {
                        if (node) rowRefs.current.set(`post-${post.id}`, node);
                        else rowRefs.current.delete(`post-${post.id}`);
                      }}
                    >
                      {post.id === PREVIOUS_READING_EDGE_ID ? (
                        <p className="feed-reading-edge">前回の閲覧位置</p>
                      ) : null}
                      <article className="feed-post-body">
                        <span
                          className={`feed-avatar feed-avatar-${author.kind}`}
                          aria-hidden="true"
                        >
                          {author.initial}
                        </span>
                        <div className="feed-post-main">
                          <div className="feed-post-head">
                            <button
                              type="button"
                              className="feed-author-name"
                              onClick={() =>
                                setAuthorFilter(authorFilter === post.author ? null : post.author)
                              }
                            >
                              {author.label}
                            </button>
                            {author.kind === "ai" ? (
                              <span className="feed-ai-badge">AI</span>
                            ) : null}
                            <time className="feed-post-time" dateTime={post.createdAt}>
                              {formatRelative(post.createdAt, now)}
                            </time>
                            <span className="feed-post-kind">
                              {isReply ? null : FEED_POST_KIND_LABELS[post.kind]}
                            </span>
                            {isReply ? null : (
                              <button
                                type="button"
                                className="feed-post-more"
                                aria-label="この投稿を今回は見送る"
                                title="今回は見送る"
                                onClick={() => hidePost(post)}
                              >
                                …
                              </button>
                            )}
                          </div>
                          {body.map((paragraph, index) => (
                            <p key={`${post.id}-${index}`} className="feed-post-text">
                              {paragraph}
                            </p>
                          ))}
                          {collapsible && !isExpanded ? (
                            <button
                              type="button"
                              className="feed-more-text"
                              onClick={() => toggleExpanded(post.id)}
                            >
                              もっと読む
                            </button>
                          ) : null}
                          {post.attachment ? (
                            <div className={`feed-attachment is-${post.attachment.kind}`}>
                              <span className="feed-attachment-kind">
                                {savedNote ? "Note" : attachmentKindLabel(post.attachment.kind)}
                              </span>
                              <h4 className="feed-attachment-title">{post.attachment.title}</h4>
                              <p className="feed-attachment-intro">
                                {savedNote ? "保存済みのNote" : post.attachment.intro}
                              </p>
                              {post.attachment.figureLabel ? (
                                <div className="feed-figure">
                                  <span className="feed-figure-label">
                                    {post.attachment.figureLabel}
                                  </span>
                                </div>
                              ) : null}
                              <div className="feed-attachment-foot">
                                <span className="feed-attachment-ref">
                                  {post.attachment.refLabel}
                                </span>
                                {post.attachment.articleBody ? (
                                  <Button
                                    variant="ghost"
                                    compact
                                    onClick={() => setOpenArticleId(post.id)}
                                  >
                                    {post.attachment.kind === "note_draft"
                                      ? "草稿を読む"
                                      : "記事を読む"}
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    compact
                                    onClick={() =>
                                      openTaskDrawer({
                                        id: post.id,
                                        taskId: null,
                                        kind: "today_task",
                                        group: "today_change",
                                        actor: "self",
                                        receivedAt: post.createdAt,
                                        dueAt: null,
                                        headline: post.attachment!.title,
                                        summary: post.attachment!.intro,
                                        state: "info",
                                        stateLabel: "Task",
                                        generated: null,
                                        reasonShown: "",
                                        pathLabel: post.attachment!.refLabel,
                                        sourceLabel: null,
                                        actions: [],
                                        detail: { title: post.attachment!.title, rows: [] },
                                      })
                                    }
                                  >
                                    {post.attachment.kind === "external"
                                      ? "原典を開く"
                                      : "Taskを開く"}
                                  </Button>
                                )}
                                {/* 草稿は読むだけでは正式データにしない。保存は本人が選ぶ。 */}
                                {post.draft ? (
                                  savedNote ? (
                                    <Button
                                      variant="ghost"
                                      compact
                                      onClick={() => openSavedNote(post)}
                                    >
                                      Noteで読む
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="secondary"
                                      compact
                                      disabled={busy}
                                      onClick={() => void saveDraftAsNote(post)}
                                    >
                                      Noteに保存
                                    </Button>
                                  )
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          <div className="feed-reactions">
                            {isReply ? (
                              <>
                                <span className="feed-thread-note">
                                  {post.author === "self" ? "自分の返信" : "AIの返答"}
                                </span>
                                {post.aiState === "requested" ? (
                                  <span className="feed-thread-state">AIに依頼済み</span>
                                ) : post.aiState === "answered" ? (
                                  <span className="feed-thread-state">回答あり</span>
                                ) : null}
                                {post.replyId && post.author === "self" ? (
                                  <button
                                    type="button"
                                    className="feed-reaction"
                                    onClick={() => deleteReply(post)}
                                  >
                                    削除
                                  </button>
                                ) : null}
                              </>
                            ) : (
                              <button
                                type="button"
                                className="feed-reaction"
                                aria-pressed={replyTo === post.id}
                                onClick={() => openReply(post)}
                              >
                                返信
                              </button>
                            )}
                            {!isReply ? (
                              <>
                                <button
                                  type="button"
                                  className="feed-reaction"
                                  aria-pressed={
                                    interesting.has(post.id) || reactions.interesting.has(post.id)
                                  }
                                  onClick={() => toggleInteresting(post)}
                                >
                                  ♡ おもしろい
                                </button>
                                <button
                                  type="button"
                                  className="feed-reaction"
                                  aria-pressed={
                                    bookmarks.has(post.id) || reactions.bookmark.has(post.id)
                                  }
                                  onClick={() => toggleBookmark(post)}
                                >
                                  ブックマーク
                                </button>
                              </>
                            ) : null}
                          </div>
                          {replyTo === post.id ? (
                            <form
                              className="feed-reply"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void submitReply(post);
                              }}
                            >
                              <label htmlFor={`feed-reply-${post.id}`}>返信</label>
                              <textarea
                                id={`feed-reply-${post.id}`}
                                value={drafts[post.id] ?? ""}
                                onChange={(event) => updateDraft(post.id, event.target.value)}
                                rows={2}
                                placeholder="気づいたことを短く残す"
                              />
                              <div className="feed-detail-actions">
                                <Button variant="primary" type="submit" disabled={busy}>
                                  返信を残す
                                </Button>
                                {/* 投稿と根拠を添えて外部AIへ渡す質問。押した時点でAIは動かない。 */}
                                <Button
                                  variant="secondary"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void submitReply(post, { askAi: true })}
                                >
                                  AIに聞く
                                </Button>
                                <Button
                                  variant="ghost"
                                  type="button"
                                  onClick={() => setReplyTo(null)}
                                >
                                  閉じる（下書きは残る）
                                </Button>
                              </div>
                            </form>
                          ) : null}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ol>
            )}

            {hasMorePosts ? (
              <Button
                variant="secondary"
                className="feed-more"
                onClick={() => setLimit((value) => value + FEED_PAGE_SIZE)}
              >
                さらに読む（次の{FEED_PAGE_SIZE}件）
              </Button>
            ) : null}

            <p className="feed-end">ここまでの投稿を表示しました</p>
          </section>
        )}
      </div>

      {openArticle ? (
        <aside className="feed-reader" aria-label="記事">
          <div className="feed-reader-head">
            <span className="feed-attachment-kind">
              {attachmentKindLabel(openArticle.attachment!.kind)}
            </span>
            <Button variant="ghost" compact onClick={closeArticle}>
              戻る
            </Button>
          </div>
          <h2 className="feed-reader-title">{openArticle.attachment!.title}</h2>
          <p className="feed-reader-intro">{openArticle.attachment!.intro}</p>
          {(openArticle.attachment!.articleBody ?? []).map((paragraph, index) => (
            <p key={`article-${index}`} className="feed-reader-text">
              {paragraph}
            </p>
          ))}
          <p className="feed-reader-ref">{openArticle.attachment!.refLabel}</p>
        </aside>
      ) : null}
    </div>
  );
}
