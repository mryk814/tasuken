import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PageProps } from "../types";
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
  filterPosts,
  needsMore,
  postsForHome,
  postsForLearning,
  withReplies,
  type FeedAuthorId,
  type FeedPost,
} from "../lib/feedPosts";

/**
 * Feed（SNS型の読む面。`docs/feed-learning-sns-plan-2026-09-21.md` 第1段階）。
 *
 * **投稿は開発用fixture**（架空データ）。実データ接続は第2段階で行う。
 * 「対応待ち」タブだけは既存の要対応projection（`buildAttentionQueue`）を正本にした実データで、
 * ここから回答・Task操作は既存Commandへ繋ぐ。
 *
 * 読む面の規則は `docs/feed-surface.md`。第1段階では投稿の作成と反応の保存を行わない。
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
}: PageProps) {
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

  const sourcePosts = useMemo(() => {
    const visible = FEED_POSTS.filter((post) => !hidden.has(post.id));
    return {
      arriving: visible.filter((post) => ARRIVING_POST_IDS.includes(post.id)),
      settled: visible.filter((post) => !ARRIVING_POST_IDS.includes(post.id)),
    };
  }, [hidden]);

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
    const post = FEED_POSTS.find((entry) => entry.id === openArticleId) ?? null;
    return post?.attachment?.articleBody ? post : null;
  }, [openArticleId]);

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

  /** 読んだり保存したりしても、Taskの状態と未解決件数は変えない。 */
  const toggleBookmark = useCallback(
    (post: FeedPost) => {
      const saved = bookmarks.has(post.id);
      toggleIn(setBookmarks, post.id);
      setNotice(
        saved
          ? "ブックマークを外しました。未解決件数は変わっていません。"
          : "ブックマークしました。未解決件数は変わっていません。",
      );
    },
    [bookmarks, toggleIn],
  );

  const hidePost = useCallback((post: FeedPost) => {
    setHidden((current) => new Set(current).add(post.id));
    setNotice("この投稿を今回は見送りました。Taskは変わっていません。");
  }, []);

  /** 返信の下書きは投稿IDごとに持つ。閉じても消さない。 */
  const openReply = useCallback((post: FeedPost) => {
    setReplyTo((current) => (current === post.id ? null : post.id));
  }, []);

  const updateDraft = useCallback((postId: string, value: string) => {
    setDrafts((current) => ({ ...current, [postId]: value }));
  }, []);

  const submitReply = useCallback((post: FeedPost) => {
    // 第1段階では保存しない。返信の保存契約は第3段階で追加する。
    setNotice(
      `${authorOf(post).label}への返信は次の段階で保存します。下書きはこの画面に残ります。`,
    );
  }, []);

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
                              {FEED_POST_KIND_LABELS[post.kind]}
                            </span>
                            <button
                              type="button"
                              className="feed-post-more"
                              aria-label="この投稿を今回は見送る"
                              title="今回は見送る"
                              onClick={() => hidePost(post)}
                            >
                              …
                            </button>
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
                                {attachmentKindLabel(post.attachment.kind)}
                              </span>
                              <h4 className="feed-attachment-title">{post.attachment.title}</h4>
                              <p className="feed-attachment-intro">{post.attachment.intro}</p>
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
                              </div>
                            </div>
                          ) : null}
                          <div className="feed-reactions">
                            {isReply ? (
                              <span className="feed-thread-note">返信</span>
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
                                  aria-pressed={interesting.has(post.id)}
                                  onClick={() => toggleIn(setInteresting, post.id)}
                                >
                                  ♡ おもしろい
                                </button>
                                <button
                                  type="button"
                                  className="feed-reaction"
                                  aria-pressed={bookmarks.has(post.id)}
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
                                submitReply(post);
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
                                <Button variant="primary" type="submit">
                                  返信を残す
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
