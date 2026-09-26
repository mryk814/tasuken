import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CommandEnvelope } from "../../../../../shared/applicationCommand";
import type { BaseRecord, PageProps } from "../types";
import { Button, EmptyState, PageHeader } from "../components/common";
import {
  AiProposalPanel,
  ProposalDetail,
  ProposalRisk,
  proposalHeadline,
} from "../components/AiProposalPanel";
import { FeedArticleReader } from "../components/FeedArticleReader";
import { FeedContextRail } from "../components/FeedContextRail";
import { FeedStream } from "../components/FeedStream";
import {
  FeedThreadPanel,
  type FeedPasteDraft,
  type FeedThreadDraft,
} from "../components/FeedThreadPanel";
import {
  FEED_PAGE_SIZE,
  buildFeedProjection,
  selectNeedsYou,
  type FeedItem,
} from "../lib/feedFixtures";
import { buildLiveFeed } from "../lib/feedProjection";
import { taskWorkEntry } from "../../../../../shared/contracts/task/public";
import { buildSaveTaskOperations } from "../domain-model/persistence";
import {
  FEED_AUTHORS,
  FEED_POSTS,
  authorOf,
  buildOwnPosts,
  buildPostsFromProposals,
  buildPostsFromWorkReceipts,
  buildRepliesFromEntities,
  draftNoteEntity,
  draftNoteId,
  clearFeedPostFocus,
  feedPostEntity,
  updateFeedOwnPost,
  feedReactionId,
  feedReplyEntity,
  filterPosts,
  markFeedLastSeen,
  peekFeedPostFocus,
  postsBookmarked,
  postsForHome,
  postsForLearning,
  type FeedAuthorId,
  type FeedPost,
  type FeedReactionKind,
} from "../lib/feedPosts";
import { workspaceApi } from "../../../services/workspaceApi";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import { uuid } from "../lib/format";
import {
  FEED_COPY_EXCERPT_MAX,
  buildExternalAiCopyText,
  feedManualPasteEntity,
  hasLiveFeedData,
  manualPasteNoteCandidate,
} from "../lib/feedPosts";

/**
 * Feed（SNS型の読む面。`docs/feed-learning-sns-plan-2026-09-21.md`）。
 *
 * AIから届いた投稿（`feed_posts` Proposal）をそのまま読み、投稿が1件も無いときだけ
 * 開発用fixture（架空データ）を使う。記事の草稿は「Noteに保存」で既存の採用経路へ渡し、
 * 読む操作とブックマークはTaskや未解決件数を変えない。
 * 「対応待ち」タブは既存の要対応projection（`buildAttentionQueue`）を正本にした実データで、
 * ここから回答・Task操作は既存Commandへ繋ぐ。変更案の確認・採否は同じタブ内の
 * 「提案の確認」（`AiProposalPanel`）で行い、`ai-io` へ移動せずに完結させる。
 *
 * 読む面の規則は `docs/feed-surface.md`。
 */

type FeedTab = "home" | "learn" | "bookmarks" | "needs";
type FeedBookmarkFilter = "bookmark" | "interesting" | "known";

const TABS: ReadonlyArray<{ id: FeedTab; label: string }> = [
  { id: "home", label: "ホーム" },
  { id: "learn", label: "学び" },
  { id: "bookmarks", label: "ブックマーク" },
  { id: "needs", label: "対応待ち" },
];

const FEED_VIEW_STATE_KEY = "tasken:feed:view:v1";

interface FeedViewState {
  tab: FeedTab;
  bookmarkFilter: FeedBookmarkFilter;
  limit: number;
  expanded: string[];
  authorFilter: FeedAuthorId | null;
  drafts: Record<string, string>;
  compose: string;
  threadPostId: string | null;
  articlePostId: string | null;
  anchorPostId: string | null;
  anchorOffset: number;
  scrollTop: number;
}

function isFeedTab(value: unknown): value is FeedTab {
  return value === "home" || value === "learn" || value === "bookmarks" || value === "needs";
}

function isBookmarkFilter(value: unknown): value is FeedBookmarkFilter {
  return value === "bookmark" || value === "interesting" || value === "known";
}

function isFeedAuthorId(value: unknown): value is FeedAuthorId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FEED_AUTHORS, value);
}

function normalizeFeedDrafts(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([postId, draft]) => postId.length > 0 && typeof draft === "string",
    ),
  );
}

function optionalFeedId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** 配列フィールドを表示用の1行へまとめる。無ければ空文字（呼び出し側で「—」を出す）。 */
function listJoined(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
}

function normalizeFeedLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < FEED_PAGE_SIZE) {
    return FEED_PAGE_SIZE;
  }
  return Math.min(500, Math.ceil(value / FEED_PAGE_SIZE) * FEED_PAGE_SIZE);
}

function readFeedViewState(): Partial<FeedViewState> {
  try {
    const raw = localStorage.getItem(FEED_VIEW_STATE_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw) as Partial<FeedViewState>;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeFeedViewState(state: FeedViewState): void {
  try {
    localStorage.setItem(FEED_VIEW_STATE_KEY, JSON.stringify(state));
  } catch {
    // 表示状態を保存できなくても、現在の操作は画面内で継続する。
  }
}

/** 開発用: 閲覧中に届いたことにして、押すまで一覧へ割り込ませない。 */
const ARRIVING_POST_IDS = ["post-solvent-switch", "post-draft-note-uncertainty"];

/**
 * 受信時刻の表示。一覧の行では秒まで要らない。
 * 値が壊れているときに現在時刻を出さない（空にする）。
 */
function feedTimeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
}

/** 詳細ペインの見出し。種類ごとに、そこで何をするかを書く。 */
function needsDetailHeading(item: FeedItem): string {
  if (item.requestId) return item.stateLabel === "判断待ち" ? "判断する" : "回答する";
  if (item.kind === "review_ready") return "成果を確認";
  return "対応する";
}

/**
 * 詳細を提案の面（`ProposalDetail`）で描く行か。
 *
 * 成果確認は #599 の読み順を持つ独自の面で出すので、ここには含めない。
 * 判断（回答待ち・成果確認）は判断の面、変更案と確認待ちは提案の面で扱う。
 */
function usesProposalDetail(item: FeedItem): boolean {
  return (
    item.kind === "proposal_pending" ||
    item.kind === "progress_report" ||
    item.kind === "answered_report"
  );
}

export function FeedPage(props: PageProps) {
  const {
    data,
    domain,
    activeTheme,
    executeCommand,
    saveEntities,
    openDrawer,
    navigate,
    setToast,
    removeEntity,
  } = props;
  const [storedView] = useState<Partial<FeedViewState>>(() => readFeedViewState());
  // 実データでは保存済みの反応を、fixtureでは画面内の印を使う。
  const [tab, setTab] = useState<FeedTab>(() =>
    isFeedTab(storedView.tab) ? storedView.tab : "home",
  );
  const [bookmarkFilter, setBookmarkFilter] = useState<FeedBookmarkFilter>(() =>
    isBookmarkFilter(storedView.bookmarkFilter) ? storedView.bookmarkFilter : "bookmark",
  );
  const [limit, setLimit] = useState(() => normalizeFeedLimit(storedView.limit));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        Array.isArray(storedView.expanded)
          ? storedView.expanded.filter((value): value is string => typeof value === "string")
          : [],
      ),
  );
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(() => new Set());
  const [interesting, setInteresting] = useState<ReadonlySet<string>>(() => new Set());
  const [known, setKnown] = useState<ReadonlySet<string>>(() => new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [authorFilter, setAuthorFilter] = useState<FeedAuthorId | null>(() =>
    isFeedAuthorId(storedView.authorFilter) ? storedView.authorFilter : null,
  );
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>(() =>
    normalizeFeedDrafts(storedView.drafts),
  );
  const [openThreadId, setOpenThreadId] = useState<string | null>(() =>
    optionalFeedId(storedView.threadPostId),
  );
  /** 対応待ちの選択。判断・変更案・確認待ちを同じ1つの選択で扱う。 */
  const [selectedNeedsId, setSelectedNeedsId] = useState<string | null>(null);
  const [refreshingNeeds, setRefreshingNeeds] = useState(false);
  const refreshWorkspace = useWorkspaceStore((state) => state.refresh);
  const [openArticleId, setOpenArticleId] = useState<string | null>(() =>
    optionalFeedId(storedView.articlePostId),
  );
  const [arrivalsApplied, setArrivalsApplied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [draftAnswer, setDraftAnswer] = useState("");
  /** 報告の差し戻しメモ。失敗しても入力を消さない（design-guide §5）。 */
  const [draftReviewNote, setDraftReviewNote] = useState("");
  /** Task完了は選ばれていない明示オプション（#599）。既定の主操作は「報告を採用」。 */
  const [completeTask, setCompleteTask] = useState(false);
  /** 自分の投稿欄の下書き。投稿しても消さず、成功時だけ空にする。 */
  const [compose, setCompose] = useState(() =>
    typeof storedView.compose === "string" ? storedView.compose : "",
  );
  /** 自分の投稿の編集中の投稿IDと下書き。保存に失敗しても入力は残す。 */
  const [editingOwnPostId, setEditingOwnPostId] = useState<string | null>(null);
  const [editingOwnPostBody, setEditingOwnPostBody] = useState("");
  /**
   * 外部AI往復の下書きは投稿別に保持する。正式返信やMCP待ちへ混ぜず、
   * localStorageで再起動後も復帰できるようにする（`docs/feed-external-ai-handoff-plan.md` §C）。
   */
  const [externalOpen, setExternalOpen] = useState<
    Readonly<Record<string, "copy" | "paste" | undefined>>
  >({});
  const [copyDrafts, setCopyDrafts] = useState<
    Readonly<Record<string, { question: string; excerpt: string; url: string }>>
  >({});
  const [pasteDrafts, setPasteDrafts] = useState<
    Readonly<
      Record<
        string,
        {
          answer: string;
          question: string;
          source: string;
          url: string;
          comment: string;
          saveId: string;
        }
      >
    >
  >({});
  const [pasteEditingId, setPasteEditingId] = useState<Readonly<Record<string, string | null>>>({});
  const pageRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const scrollTopRef = useRef(
    typeof storedView.scrollTop === "number" && Number.isFinite(storedView.scrollTop)
      ? Math.max(0, storedView.scrollTop)
      : 0,
  );
  const anchorPostIdRef = useRef(optionalFeedId(storedView.anchorPostId));
  const anchorOffsetRef = useRef(
    typeof storedView.anchorOffset === "number" && Number.isFinite(storedView.anchorOffset)
      ? storedView.anchorOffset
      : 0,
  );
  const restoredScrollRef = useRef(false);
  const viewStateRef = useRef<FeedViewState>({
    tab: isFeedTab(storedView.tab) ? storedView.tab : "home",
    bookmarkFilter: isBookmarkFilter(storedView.bookmarkFilter)
      ? storedView.bookmarkFilter
      : "bookmark",
    limit: normalizeFeedLimit(storedView.limit),
    expanded: Array.isArray(storedView.expanded)
      ? storedView.expanded.filter((value): value is string => typeof value === "string")
      : [],
    authorFilter: isFeedAuthorId(storedView.authorFilter) ? storedView.authorFilter : null,
    drafts: normalizeFeedDrafts(storedView.drafts),
    compose: typeof storedView.compose === "string" ? storedView.compose : "",
    threadPostId: optionalFeedId(storedView.threadPostId),
    articlePostId: optionalFeedId(storedView.articlePostId),
    anchorPostId: optionalFeedId(storedView.anchorPostId),
    anchorOffset:
      typeof storedView.anchorOffset === "number" && Number.isFinite(storedView.anchorOffset)
        ? storedView.anchorOffset
        : 0,
    scrollTop:
      typeof storedView.scrollTop === "number" && Number.isFinite(storedView.scrollTop)
        ? Math.max(0, storedView.scrollTop)
        : 0,
  });
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
    () => [
      ...buildPostsFromProposals({
        proposals: domain.ai_proposals as unknown[],
        themes: data.themes as unknown[],
        tasks: domain.tasks as unknown[],
      }),
      // AIの作業報告も投稿として流す（Agent Desk集約。`docs/feed-surface.md`）。
      ...buildPostsFromWorkReceipts({
        receipts: data.work_receipts as unknown[],
        themes: data.themes as unknown[],
        tasks: domain.tasks as unknown[],
      }),
    ],
    [domain.ai_proposals, domain.tasks, data.themes, data.work_receipts],
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
  /**
   * 自分の投稿はFeed専用の正本（`feed_post`）から作る。Notesには残さない。
   * 未整理のメモ全件を流さないため、Feed専用に保存したものだけを読む。
   */
  const ownPosts = useMemo(
    () => buildOwnPosts({ feedPosts: domain.feed_posts as unknown[] }),
    [domain.feed_posts],
  );
  /**
   * 投稿の出所。実データの投稿・返信・自分の投稿のいずれかがあればfixtureを出さない。
   * 自分の投稿だけではfixtureから切り替わらない条件を是正する（handoff §2）。
   */
  const usingFixtures = !hasLiveFeedData({ livePosts, replyPosts, ownPosts });

  /**
   * 読者の状態はEntityとして保存する（投稿の正本ではない）。
   * 保存された印は `domain` 側の正規化を通して読む（未保存のworkspaceでは空になる）。
   */
  const reactions = useMemo(() => {
    const bookmark = new Set<string>();
    const interesting = new Set<string>();
    const hiddenPosts = new Set<string>();
    const knownPosts = new Set<string>();
    const rows = Array.isArray(domain.feed_reactions) ? domain.feed_reactions : [];
    for (const row of rows as unknown as Array<Record<string, unknown>>) {
      const postId = typeof row.post_id === "string" ? row.post_id : "";
      if (!postId) continue;
      if (row.kind === "bookmark") bookmark.add(postId);
      else if (row.kind === "interesting") interesting.add(postId);
      else if (row.kind === "hidden") hiddenPosts.add(postId);
      else if (row.kind === "known") knownPosts.add(postId);
    }
    return { bookmark, interesting, hidden: hiddenPosts, known: knownPosts };
  }, [domain.feed_reactions]);

  /**
   * 表示に使う印は、保存済みの反応と開発用fixtureの画面内の印を合わせたもの。
   * 実データでは保存済みだけが残り、fixtureでは画面内だけに留まる。
   */
  const shownBookmarks = useMemo(
    () => new Set([...bookmarks, ...reactions.bookmark]),
    [bookmarks, reactions.bookmark],
  );
  const shownInteresting = useMemo(
    () => new Set([...interesting, ...reactions.interesting]),
    [interesting, reactions.interesting],
  );
  const shownKnown = useMemo(
    () => new Set([...known, ...reactions.known]),
    [known, reactions.known],
  );

  const sourcePosts = useMemo(() => {
    const all = usingFixtures ? FEED_POSTS : [...ownPosts, ...livePosts, ...replyPosts];
    const visible = all.filter((post) => !hidden.has(post.id) && !reactions.hidden.has(post.id));
    return {
      arriving: usingFixtures ? visible.filter((post) => ARRIVING_POST_IDS.includes(post.id)) : [],
      settled: usingFixtures
        ? visible.filter((post) => !ARRIVING_POST_IDS.includes(post.id))
        : visible,
    };
  }, [hidden, livePosts, ownPosts, reactions.hidden, replyPosts, usingFixtures]);

  const timeline = useMemo(() => {
    const posts = arrivalsApplied
      ? [...sourcePosts.arriving, ...sourcePosts.settled]
      : sourcePosts.settled;
    const base = tab === "learn" ? postsForLearning(posts) : postsForHome(posts);
    // 返信はホームの投稿列へ差し込まず、選んだ投稿のスレッドで読む。
    const filtered = filterPosts(base, { author: authorFilter }).filter((post) => !post.replyTo);
    if (tab !== "bookmarks") return filtered;
    const selected =
      bookmarkFilter === "bookmark"
        ? shownBookmarks
        : bookmarkFilter === "interesting"
          ? shownInteresting
          : shownKnown;
    return postsBookmarked(filtered, selected);
  }, [
    arrivalsApplied,
    authorFilter,
    bookmarkFilter,
    shownBookmarks,
    shownInteresting,
    shownKnown,
    sourcePosts,
    tab,
  ]);

  const shownPosts = timeline.slice(0, limit);
  const shownPostsRef = useRef<FeedPost[]>([]);
  shownPostsRef.current = shownPosts;
  const hasMorePosts = timeline.length > shownPosts.length;

  /**
   * 「最後にFeedを見た時刻」を残す。
   *
   * Todayの「AIから届いたこと」は、これより後に届いた記事や学びだけを出す。
   * 正本ではなく表示上の印なので、読めなくても閲覧は続けられる。
   */
  useEffect(() => {
    markFeedLastSeen(Date.now());
    return () => markFeedLastSeen(Date.now());
  }, []);

  useEffect(() => {
    const next: FeedViewState = {
      tab,
      bookmarkFilter,
      limit,
      expanded: [...expanded],
      authorFilter,
      drafts: { ...drafts },
      compose,
      threadPostId: openThreadId,
      articlePostId: openArticleId,
      anchorPostId: anchorPostIdRef.current,
      anchorOffset: anchorOffsetRef.current,
      scrollTop: scrollTopRef.current,
    };
    viewStateRef.current = next;
    writeFeedViewState(next);
  }, [
    authorFilter,
    bookmarkFilter,
    compose,
    drafts,
    expanded,
    limit,
    openArticleId,
    openThreadId,
    tab,
  ]);

  const captureScrollAnchor = useCallback(() => {
    const root = pageRef.current;
    const container = root?.closest<HTMLElement>(".main-area");
    if (!container) return;
    scrollTopRef.current = container.scrollTop;
    const containerTop = container.getBoundingClientRect().top;
    const anchor = shownPostsRef.current
      .map((post) => ({ post, node: rowRefs.current.get(`post-${post.id}`) }))
      .find(({ node }) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        return rect.bottom >= containerTop + 8;
      });
    if (anchor?.node) {
      anchorPostIdRef.current = anchor.post.id;
      anchorOffsetRef.current = anchor.node.getBoundingClientRect().top - containerTop;
    }
    const next = {
      ...viewStateRef.current,
      anchorPostId: anchorPostIdRef.current,
      anchorOffset: anchorOffsetRef.current,
      scrollTop: scrollTopRef.current,
    };
    viewStateRef.current = next;
    writeFeedViewState(next);
  }, []);

  useLayoutEffect(() => {
    const root = pageRef.current;
    const container = root?.closest<HTMLElement>(".main-area");
    if (!container) return;
    const onScroll = () => {
      scrollTopRef.current = container.scrollTop;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    let restoreFrame = 0;
    let restoreAttempts = 0;
    const restore = () => {
      if (restoredScrollRef.current) return;
      const anchorId = anchorPostIdRef.current;
      const anchorNode = anchorId ? rowRefs.current.get(`post-${anchorId}`) : null;
      if (
        anchorId &&
        !anchorNode &&
        container.scrollHeight <= container.clientHeight &&
        restoreAttempts < 8
      ) {
        restoreAttempts += 1;
        restoreFrame = window.requestAnimationFrame(restore);
        return;
      }
      const desired = anchorNode
        ? (() => {
            const containerTop = container.getBoundingClientRect().top;
            const currentTop = anchorNode.getBoundingClientRect().top - containerTop;
            return container.scrollTop + currentTop - anchorOffsetRef.current;
          })()
        : scrollTopRef.current;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = Math.min(maxScrollTop, Math.max(0, desired));
      scrollTopRef.current = container.scrollTop;
      restoredScrollRef.current = true;
    };
    restoreFrame = window.requestAnimationFrame(restore);
    window.addEventListener("beforeunload", captureScrollAnchor);
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.removeEventListener("beforeunload", captureScrollAnchor);
      container.removeEventListener("scroll", onScroll);
      captureScrollAnchor();
    };
  }, [captureScrollAnchor]);

  const needsRows = useMemo(() => {
    if (tab !== "needs") return [] as FeedItem[];
    // 判断・変更案・確認待ちを1本の一覧にする。同じ報告を2つの面に出さない。
    return selectNeedsYou(buildFeedProjection(live.items).items);
  }, [live.items, tab]);

  /**
   * 右レールの対応キュー。タブを問わず未処理の判断だけを並べる。
   * 変更案も含む（レールは入口の目印で、採否そのものは対応待ちの詳細で行う）。
   */
  const railAttention = useMemo(
    () => selectNeedsYou(buildFeedProjection(live.items).items).slice(0, 8),
    [live.items],
  );

  const openAttentionFromRail = useCallback((item: FeedItem) => {
    setTab("needs");
    setDraftAnswer("");
    // 種別を問わず同じ一覧の行を選ぶ。詳細の読み順は行の種類が決める。
    setSelectedNeedsId(item.id);
  }, []);

  /**
   * 対応待ちの再読込。一覧を持つ面が更新の入口を持つ（旧「提案の確認」から移した）。
   * Focus復帰では通知を連発せず、明示操作のときだけ結果を知らせる。
   */
  const refreshNeeds = useCallback(
    async (showFeedback: boolean) => {
      setRefreshingNeeds(true);
      try {
        await refreshWorkspace();
        if (showFeedback) setToast("対応待ちを更新しました。", "success");
      } catch (error) {
        if (showFeedback) {
          setToast(
            `Proposalを更新できませんでした。${error instanceof Error ? error.message : String(error)}`,
            "danger",
          );
        }
      } finally {
        setRefreshingNeeds(false);
      }
    },
    [refreshWorkspace, setToast],
  );

  useEffect(() => {
    const resyncOnFocus = () => void refreshNeeds(false);
    window.addEventListener("focus", resyncOnFocus);
    return () => window.removeEventListener("focus", resyncOnFocus);
  }, [refreshNeeds]);

  const selectedNeedsItem = needsRows.find((item) => item.id === selectedNeedsId) ?? null;
  /** 読める投稿が無いときの「記録する」。投稿欄は同じ面にあるので、そこへfocusを移す。 */
  const focusCompose = useCallback(() => {
    const node = document.getElementById("feed-compose-body");
    if (node instanceof HTMLTextAreaElement) node.focus();
  }, []);
  const availablePosts = useMemo(
    () => [...sourcePosts.arriving, ...sourcePosts.settled],
    [sourcePosts],
  );
  const rootPosts = useMemo(() => availablePosts.filter((post) => !post.replyTo), [availablePosts]);
  const openThreadPost = rootPosts.find((post) => post.id === openThreadId) ?? null;
  const threadReplies = useMemo(
    () =>
      openThreadId
        ? replyPosts
            .filter((reply) => reply.replyTo === openThreadId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        : [],
    [openThreadId, replyPosts],
  );
  const openArticlePost = useMemo(() => {
    const post = availablePosts.find((entry) => entry.id === openArticleId) ?? null;
    return post?.attachment?.articleBody?.length || post?.attachment?.articleMarkdown ? post : null;
  }, [availablePosts, openArticleId]);

  useEffect(() => {
    if (availablePosts.length === 0) return;
    if (openThreadId && !rootPosts.some((post) => post.id === openThreadId)) {
      setOpenThreadId(null);
    }
    if (openArticleId && !openArticlePost) {
      setOpenArticleId(null);
    }
  }, [availablePosts.length, openArticleId, openArticlePost, openThreadId, rootPosts]);

  const focusRow = useCallback((id: string) => {
    rowRefs.current.get(id)?.focus();
  }, []);

  /**
   * Noteから「元のFeed投稿を開く」で来たときは、その投稿のスレッドを開いて会話へ戻す。
   * 投稿がまだ読めないうちは預けたままにし、読めた時点で一度だけ開く。
   * 返信に着地した場合も、会話の起点になる親投稿を開く。
   */
  useEffect(() => {
    const targetId = peekFeedPostFocus();
    if (!targetId) return;
    const target = availablePosts.find((post) => post.id === targetId);
    if (!target) return;
    const root = target.replyTo
      ? availablePosts.find((post) => post.id === target.replyTo)
      : target;
    if (!root) return;
    clearFeedPostFocus();
    setTab("home");
    setOpenArticleId(null);
    setOpenThreadId(root.id);
    window.requestAnimationFrame(() => {
      rowRefs.current.get(`post-${root.id}`)?.scrollIntoView({ block: "center" });
    });
  }, [availablePosts]);

  /** Agent Desk集約後の `ai-io` リダイレクト。表示中に届いてもタブを切り替える。 */
  useEffect(() => {
    const onOpenTab = (event: Event) => {
      const tab = (event as CustomEvent<string>).detail;
      if (isFeedTab(tab)) {
        setTab(tab);
        setSelectedNeedsId(null);
        setOpenArticleId(null);
        setOpenThreadId(null);
      }
    };
    window.addEventListener("tasken:feed:open-tab", onOpenTab);
    return () => window.removeEventListener("tasken:feed:open-tab", onOpenTab);
  }, []);

  const openThread = useCallback((post: FeedPost) => {
    setOpenArticleId(null);
    setOpenThreadId((current) => (current === post.id ? null : post.id));
  }, []);

  const closeThread = useCallback(() => {
    const originId = openThreadId;
    setOpenThreadId(null);
    if (originId) window.requestAnimationFrame(() => focusRow(`post-${originId}`));
  }, [focusRow, openThreadId]);

  const closeFeedContext = useCallback(() => {
    setOpenArticleId(null);
    setOpenThreadId(null);
  }, []);

  const openArticle = useCallback((post: FeedPost) => {
    // 右の補助領域は1スロット（design-guide §21）。記事とスレッドは重ねない。
    setOpenThreadId(null);
    setOpenArticleId(post.id);
  }, []);

  /** 記事を閉じたら、開いた投稿へfocusを戻す。 */
  const closeArticle = useCallback(() => {
    const originId = openArticleId;
    setOpenArticleId(null);
    if (originId) window.requestAnimationFrame(() => focusRow(`post-${originId}`));
  }, [focusRow, openArticleId]);

  useEffect(() => {
    if (!openArticleId && !openThreadId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (openArticleId) closeArticle();
      else closeThread();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeArticle, closeThread, openArticleId, openThreadId]);

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
      } else if (kind === "known") {
        toggleIn(setKnown, post.id);
      } else {
        setHidden((current) => new Set(current).add(post.id));
      }
      setNotice(
        kind === "hidden"
          ? "この投稿を今回は見送りました。Taskは変わっていません。"
          : kind === "known"
            ? "「既知だった」を記録しました。次の題材選びの材料になります。"
            : saved
              ? "印を外しました。未解決件数は変わっていません。"
              : "印を付けました。未解決件数は変わっていません。",
      );
    },
    [reactions, removeEntity, saveEntities, setToast, toggleIn, usingFixtures],
  );

  const hidePost = useCallback(
    (post: FeedPost) => void toggleReaction(post, "hidden"),
    [toggleReaction],
  );

  /** 返信の下書きは投稿IDごとに持つ。閉じても消さない。 */
  const updateDraft = useCallback((postId: string, value: string) => {
    setDrafts((current) => ({ ...current, [postId]: value }));
  }, []);

  function externalCopyKey(postId: string): string {
    return `tasken:feed:external-copy:${postId}`;
  }

  function externalPasteKey(postId: string): string {
    return `tasken:feed:external-paste:${postId}`;
  }

  function defaultExcerpt(post: FeedPost): string {
    const joined = post.paragraphs.join("\n\n");
    if (joined.length <= FEED_COPY_EXCERPT_MAX) return joined;
    return `${joined.slice(0, FEED_COPY_EXCERPT_MAX)}（以下省略）`;
  }

  // 下書きの復帰。正式返信やMCP待ちへは混ぜない。localStorageが使えなければ画面内stateに留める。
  useEffect(() => {
    try {
      const nextCopy: Record<string, { question: string; excerpt: string; url: string }> = {};
      const nextPaste: Record<
        string,
        {
          answer: string;
          question: string;
          source: string;
          url: string;
          comment: string;
          saveId: string;
        }
      > = {};
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        if (key.startsWith("tasken:feed:external-copy:")) {
          const postId = key.slice("tasken:feed:external-copy:".length);
          const raw = localStorage.getItem(key);
          if (raw) nextCopy[postId] = JSON.parse(raw) as (typeof nextCopy)[string];
        } else if (key.startsWith("tasken:feed:external-paste:")) {
          const postId = key.slice("tasken:feed:external-paste:".length);
          const raw = localStorage.getItem(key);
          if (raw) nextPaste[postId] = JSON.parse(raw) as (typeof nextPaste)[string];
        }
      }
      if (Object.keys(nextCopy).length > 0) setCopyDrafts(nextCopy);
      if (Object.keys(nextPaste).length > 0) setPasteDrafts(nextPaste);
    } catch {
      // 下書きの復帰に失敗しても、今回の入力は画面内で扱う。
    }
  }, []);

  const updateCopyDraft = useCallback(
    (post: FeedPost, patch: Partial<{ question: string; excerpt: string; url: string }>) => {
      setCopyDrafts((current) => {
        const base = current[post.id] ?? { question: "", excerpt: defaultExcerpt(post), url: "" };
        const next = { ...base, ...patch };
        try {
          localStorage.setItem(externalCopyKey(post.id), JSON.stringify(next));
        } catch {
          // 保存先が使えなくても入力は画面内に残す。
        }
        return { ...current, [post.id]: next };
      });
    },
    [],
  );

  const updatePasteDraft = useCallback(
    (
      post: FeedPost,
      patch: Partial<{
        answer: string;
        question: string;
        source: string;
        url: string;
        comment: string;
      }>,
    ) => {
      setPasteDrafts((current) => {
        const base = current[post.id] ?? {
          answer: "",
          question: "",
          source: "",
          url: "",
          comment: "",
          saveId: uuid(),
        };
        const next = { ...base, ...patch };
        try {
          localStorage.setItem(externalPasteKey(post.id), JSON.stringify(next));
        } catch {
          // 保存先が使えなくても入力は画面内に残す。
        }
        return { ...current, [post.id]: next };
      });
    },
    [],
  );

  const discardExternalDraft = useCallback((post: FeedPost) => {
    setCopyDrafts((current) => {
      const next = { ...current };
      delete next[post.id];
      return next;
    });
    setPasteDrafts((current) => {
      const next = { ...current };
      delete next[post.id];
      return next;
    });
    setPasteEditingId((current) => ({ ...current, [post.id]: null }));
    try {
      localStorage.removeItem(externalCopyKey(post.id));
      localStorage.removeItem(externalPasteKey(post.id));
    } catch {
      // 削除に失敗しても画面内の下書きは消す。
    }
    setNotice("外部AI用の下書きを破棄しました。保存済みの返信は残っています。");
  }, []);

  const toggleExternal = useCallback((post: FeedPost, panel: "copy" | "paste") => {
    setExternalOpen((current) => ({
      ...current,
      [post.id]: current[post.id] === panel ? undefined : panel,
    }));
  }, []);

  /**
   * 質問と文脈をコピーする。プレビューした内容だけを送り、Taskenからの自動送信はしない。
   * 成功時だけ案内を出し、失敗時も質問を残す。falseと例外の両方を失敗として扱う。
   */
  const copyForExternalAi = useCallback(
    async (post: FeedPost) => {
      const draft = copyDrafts[post.id] ?? { question: "", excerpt: defaultExcerpt(post), url: "" };
      let preview = "";
      try {
        preview = buildExternalAiCopyText({
          question: draft.question,
          postParagraphs: draft.excerpt ? [draft.excerpt] : post.paragraphs,
          sourceLabel: authorOf(post).label,
          referenceUrl: draft.url,
          excerptTruncated: draft.excerpt.includes("（以下省略）"),
        });
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error), "warning");
        return;
      }
      if (usingFixtures) {
        setNotice("この投稿は開発用です。コピー内容は実データの投稿で使えます。");
        return;
      }
      setCopyBusy(true);
      try {
        const ok = await workspaceApi.copyText(preview);
        if (!ok) throw new Error("コピーできませんでした。");
        setNotice("コピーしました。普段使うAIに貼り付けてください。");
        setToast("コピーしました。普段使うAIに貼り付けてください。", "success");
        // 質問は貼り付け側へ引き継げるよう残す。
        updatePasteDraft(post, {
          question: draft.question.trim() || pasteDrafts[post.id]?.question || "",
        });
      } catch (error) {
        setToast(
          `コピーできませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setCopyBusy(false);
      }
    },
    [copyDrafts, pasteDrafts, setToast, updatePasteDraft, usingFixtures],
  );

  /** 外部AIの回答を元投稿のスレッドへ保存する。明示的な保存後だけ表示する。 */
  const saveManualPaste = useCallback(
    async (post: FeedPost) => {
      if (usingFixtures) {
        setNotice("この投稿は開発用です。回答は実データの投稿へ残せます。");
        return;
      }
      const draft = pasteDrafts[post.id];
      if (!draft) {
        setToast("回答の本文を入力してください。", "warning");
        return;
      }
      // 元投稿の削除時は誤った投稿へ保存しない。入力は回収できる形で残す。
      const exists = [...livePosts, ...replyPosts, ...ownPosts].some(
        (entry) => entry.id === post.id,
      );
      if (!exists) {
        setToast("元の投稿が見つかりません。下書きは残しています。", "danger");
        return;
      }
      const editingId = pasteEditingId[post.id] ?? null;
      const saveId = editingId ?? draft.saveId;
      let entity;
      try {
        entity = feedManualPasteEntity({
          id: saveId,
          postId: post.id,
          body: draft.answer,
          createdAt: new Date().toISOString(),
          question: draft.question,
          externalSource: draft.source,
          externalUrl: draft.url,
          comment: draft.comment,
        });
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error), "warning");
        return;
      }
      setBusy(true);
      try {
        await saveEntities(
          [{ action: "save", type: "feed_reply", entity: entity as never }],
          editingId ? "貼り付けた回答を訂正しました。" : "外部AIの回答を返信として保存しました。",
          "main_ui",
        );
        // 二重送信を避けるため、回答と訂正対象だけを消し、質問・出所は残す。
        setPasteDrafts((current) => {
          const next = {
            ...current,
            [post.id]: { ...current[post.id], answer: "", comment: "", saveId: uuid() },
          };
          try {
            localStorage.setItem(externalPasteKey(post.id), JSON.stringify(next[post.id]));
          } catch {
            // 保存先が使えなくても画面内は更新する。
          }
          return next;
        });
        setPasteEditingId((current) => ({ ...current, [post.id]: null }));
        setNotice(
          editingId
            ? "貼り付けた回答を訂正しました。Taskと未解決件数は変わっていません。"
            : "外部AIの回答を保存しました。Taskと未解決件数は変わっていません。",
        );
      } catch (error) {
        // 同じIDで再試行できるよう入力とsaveIdを残す。
        setToast(
          `保存できませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [
      livePosts,
      ownPosts,
      pasteDrafts,
      pasteEditingId,
      replyPosts,
      saveEntities,
      setToast,
      usingFixtures,
    ],
  );

  /** 保存済みの手動貼付を訂正用に開く。 */
  const startPasteCorrection = useCallback(
    (post: FeedPost, reply: FeedPost) => {
      updatePasteDraft(post, {
        answer: reply.paragraphs.join("\n\n"),
        question: reply.manualQuestion ?? "",
        source: reply.manualSource ?? "",
        url: reply.manualUrl ?? "",
        comment: reply.manualComment ?? "",
      });
      setPasteEditingId((current) => ({ ...current, [post.id]: reply.replyId ?? null }));
      setExternalOpen((current) => ({ ...current, [post.id]: "paste" }));
    },
    [updatePasteDraft],
  );

  /** 必要な回答・自分の一言だけを既存Note作成画面へ渡す。人が確認して保存する。 */
  const saveManualPasteAsNote = useCallback(
    (post: FeedPost, reply: FeedPost) => {
      try {
        const candidate = manualPasteNoteCandidate({
          postId: post.id,
          question: reply.manualQuestion ?? "",
          answer: reply.paragraphs.join("\n\n"),
          externalSource: reply.manualSource ?? "",
          externalUrl: reply.manualUrl ?? "",
          comment: reply.manualComment ?? "",
        });
        closeFeedContext();
        openDrawer({
          type: "note",
          mode: "edit",
          entity: {
            title: candidate.title,
            body_markdown: candidate.body_markdown,
            note_type: "memo",
          },
        });
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error), "warning");
      }
    },
    [closeFeedContext, openDrawer, setToast],
  );

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

  /**
   * 自分の投稿はFeed専用の正本（`feed_post`）として保存する。Notesには残さない。
   */
  const publishOwnPost = useCallback(async () => {
    const body = compose.trim();
    if (!body) {
      setToast("投稿する本文を入力してください。", "warning");
      return;
    }
    setBusy(true);
    try {
      await saveEntities(
        [
          {
            action: "save",
            type: "feed_post",
            entity: feedPostEntity({ id: uuid(), body, publishedAt: new Date().toISOString() }),
          },
        ],
        "Feedへ投稿しました。",
        "main_ui",
      );
      setCompose("");
      setNotice("投稿しました。自分の投稿はFeedだけに残ります。");
    } catch (error) {
      // 失敗しても入力は消さない。
      setToast(
        `投稿できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }, [compose, saveEntities, setToast]);

  /** 自分の投稿をFeed専用の正本から削除する。既存の「元に戻す」で復元できる。 */
  const deleteOwnPost = useCallback(
    (post: FeedPost) => {
      const stored = (domain.feed_posts as unknown as Array<{ id: string }>).find(
        (entry) => entry.id === post.id,
      );
      if (!stored) {
        setToast("投稿が見つかりません。読み直してください。", "danger");
        return;
      }
      if (editingOwnPostId === post.id) {
        setEditingOwnPostId(null);
        setEditingOwnPostBody("");
      }
      void removeEntity("feed_post", stored);
    },
    [domain.feed_posts, editingOwnPostId, removeEntity, setToast],
  );

  /** 自分の投稿の本文を同じIDで直す。公開時刻・Theme・出所は変えない。 */
  const startOwnPostEdit = useCallback(
    (post: FeedPost) => {
      const stored = (domain.feed_posts as unknown as Array<{ id: string }>).find(
        (entry) => entry.id === post.id,
      );
      if (!stored) {
        setToast("投稿が見つかりません。読み直してください。", "danger");
        return;
      }
      setEditingOwnPostId(post.id);
      setEditingOwnPostBody(post.paragraphs.join("\n\n"));
    },
    [domain.feed_posts, setToast],
  );

  const cancelOwnPostEdit = useCallback(() => {
    setEditingOwnPostId(null);
    setEditingOwnPostBody("");
  }, []);

  const saveOwnPostEdit = useCallback(
    async (post: FeedPost) => {
      const stored = domain.feed_posts.find((entry) => entry.id === post.id);
      if (!stored) {
        setToast("投稿が見つかりません。読み直してください。", "danger");
        return;
      }
      const body = editingOwnPostBody.trim();
      if (!body) {
        setToast("投稿する本文を入力してください。", "warning");
        return;
      }
      setBusy(true);
      try {
        const updated = updateFeedOwnPost(body);
        await saveEntities(
          [
            {
              action: "save",
              type: "feed_post",
              entity: { ...stored, ...updated } as never,
            },
          ],
          "投稿を更新しました。",
          "main_ui",
        );
        setEditingOwnPostId(null);
        setEditingOwnPostBody("");
      } catch (error) {
        // 失敗しても編集中の入力は消さない。
        setToast(
          `投稿を更新できませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [domain.feed_posts, editingOwnPostBody, saveEntities, setToast],
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
      if (note) {
        closeFeedContext();
        openDrawer({ type: "note", entity: note as never });
      }
    },
    [closeFeedContext, openDrawer, savedNoteOf],
  );

  /** 既存Noteへの参照を、既存のNote読書面で開く（編集や別ウィンドウも既存導線を使う）。 */
  const openNoteEntity = useCallback(
    (note: Record<string, unknown>) => {
      closeFeedContext();
      openDrawer({ type: "note", entity: note as never });
    },
    [closeFeedContext, openDrawer],
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

  /**
   * 成果確認の詳細（#599の読み順）。
   * 報告はProposal経由とReceipt単体の両方がありうるので、両方から確認事項を引く。
   */
  const reviewDetailOf = useCallback(
    (
      sourceId: string | null | undefined,
    ): { verification: string; remainingWork: string; completedItems: string } => {
      if (!sourceId) return { verification: "", remainingWork: "", completedItems: "" };
      const receipt = (data.work_receipts as Array<Record<string, unknown>>).find(
        (entry) => String(entry.id) === sourceId,
      );
      const proposal = (domain.ai_proposals as Array<Record<string, unknown>>).find(
        (entry) => String(entry.id) === sourceId,
      );
      const entry =
        receipt ||
        (proposal ? taskWorkEntry(proposal as { id: string } & Record<string, unknown>) : null);
      return {
        verification: listJoined(entry?.verification).join("／"),
        remainingWork: listJoined(entry?.remaining_work).join("／"),
        completedItems: listJoined(entry?.completed_checklist_item_ids).join("／"),
      };
    },
    [data.work_receipts, domain.ai_proposals],
  );

  const openTaskDrawer = useCallback(
    (item: FeedItem) => {
      const task = taskOf(item);
      if (task) {
        closeFeedContext();
        openDrawer({ type: "task", entity: task as never, commandSource: "main_ui" });
        return;
      }
      // Taskに紐づかない判断の確認はFeedの「対応待ち」で行う。面を移動しない。
      closeFeedContext();
      navigate("feed");
    },
    [closeFeedContext, navigate, openDrawer, taskOf],
  );

  /** 投稿に添えられたTask参照を開く。Taskが見つからなければ既存のAI連携面へ送る。 */
  const openPostTask = useCallback(
    (post: FeedPost) => {
      openTaskDrawer({
        id: post.id,
        taskId: null,
        kind: "today_task",
        group: "today_change",
        actor: "self",
        receivedAt: post.createdAt,
        dueAt: null,
        headline: post.attachment?.title ?? "Task",
        summary: post.attachment?.intro ?? "",
        state: "info",
        stateLabel: "Task",
        generated: null,
        reasonShown: "",
        pathLabel: post.attachment?.refLabel ?? "",
        sourceLabel: null,
        actions: [],
        detail: { title: post.attachment?.title ?? "Task", rows: [] },
      });
    },
    [openTaskDrawer],
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

  /**
   * 報告の採用（Agent Desk集約）。`ApplyTaskWorkProposal` で提案を採用し、
   * Task完了まで進める場合は続けて `AcceptTaskWork` を送る。Command経路は既存のまま。
   */
  const acceptReport = useCallback(
    async (item: FeedItem, withCompletion: boolean) => {
      if (busy || !item.taskId || !item.sourceId) return;
      const task = taskOf(item) as { id: string; version?: number } | null;
      if (!task) return;
      // Proposal側の版も渡す。Task Work Proposalはexpected versionが無いと採用できない（#599）。
      const proposal = (domain.ai_proposals as Array<Record<string, unknown>>).find(
        (entry) => String(entry.id) === item.sourceId,
      );
      if (!proposal) return;
      setBusy(true);
      try {
        const receipt = (await executeCommand({
          commandId: `${item.sourceId}:accept`,
          name: "ApplyTaskWorkProposal",
          payload: { proposalId: item.sourceId, decision: "accept" },
          actor: { kind: "user" },
          source: "main_ui",
          expectedVersions: [
            { type: "task", id: item.taskId, version: Number(task.version ?? 0) },
            { type: "ai_proposal", id: item.sourceId, version: Number(proposal.version ?? 0) },
          ],
          issuedAt: new Date().toISOString(),
        } as never)) as {
          changes?: Array<{ type?: string; entity?: { id?: string; version?: number } }>;
        } | null;
        if (!withCompletion) {
          setToast("報告を採用しました。Taskは継続します。", "success");
          setSelectedNeedsId(null);
          return;
        }
        // 採用でTaskの版が進む。完了は採用後に返った版で送る（前半だけ成功した場合を壊さない）。
        const accepted = receipt?.changes?.find(
          (entry) => entry.type === "task" && entry.entity?.id === item.taskId,
        );
        const nextVersion = Number(accepted?.entity?.version || task.version || 0);
        await executeCommand({
          commandId: `${item.sourceId}:accept:complete`,
          name: "AcceptTaskWork",
          payload: {
            taskId: item.taskId,
            receiptId: item.sourceId,
            completeTask: true,
          },
          actor: { kind: "user" },
          source: "main_ui",
          expectedVersions: [{ type: "task", id: item.taskId, version: nextVersion }],
          issuedAt: new Date().toISOString(),
        } as never);
        setToast("報告を採用し、Taskを完了しました。", "success");
        setSelectedNeedsId(null);
      } catch (error) {
        setToast(
          `報告を採用できませんでした。${error instanceof Error ? error.message : String(error)} 既に採用済みの場合は、Task完了だけを再試行できます。`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, domain.ai_proposals, executeCommand, setToast, taskOf],
  );

  /**
   * 一覧の行から詳細へ渡す提案。作業報告・変更案は同じ `ai_proposals` を引く。
   * 見つからない場合は詳細の代わりに再読み込みを案内する（成功扱いにしない）。
   */
  const proposalOf = useCallback(
    (item: FeedItem): BaseRecord | null => {
      if (!item.sourceId) return null;
      return (
        (domain.ai_proposals as BaseRecord[]).find(
          (proposal) => String(proposal.id) === item.sourceId,
        ) ?? null
      );
    },
    [domain.ai_proposals],
  );

  /** 報告の差し戻し。修正してほしい点を `ReturnTaskWork` で返す。 */
  const returnReport = useCallback(
    async (item: FeedItem) => {
      const note = draftReviewNote.trim();
      if (!note) {
        setToast("修正してほしい点を入力してください。", "warning");
        return;
      }
      if (busy || !item.taskId || !item.sourceId) return;
      const task = taskOf(item) as { id: string; version?: number } | null;
      if (!task) return;
      setBusy(true);
      try {
        await executeCommand({
          commandId: `${item.sourceId}:return`,
          name: "ReturnTaskWork",
          payload: { taskId: item.taskId, receiptId: item.sourceId, reviewNote: note },
          actor: { kind: "user" },
          source: "main_ui",
          expectedVersions: [{ type: "task", id: item.taskId, version: Number(task.version ?? 0) }],
          issuedAt: new Date().toISOString(),
        } as never);
        setToast("修正を依頼しました。Taskは継続します。", "success");
        setDraftReviewNote("");
        setSelectedNeedsId(null);
      } catch (error) {
        setToast(
          `修正を依頼できませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, draftReviewNote, executeCommand, setToast, taskOf],
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

      <div ref={pageRef} className={`feed-shell feed-layout${openThreadPost ? " has-thread" : ""}`}>
        <section className="feed-main">
          <header className="feed-tabs" role="tablist" aria-label="Feedの切り替え">
            {TABS.map((entry) => {
              const tabId = `feed-tab-${entry.id}`;
              const panelId = `feed-panel-${entry.id}`;
              return (
                <button
                  key={entry.id}
                  id={tabId}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  aria-controls={panelId}
                  className={tab === entry.id ? "is-active" : undefined}
                  onClick={() => {
                    setTab(entry.id);
                    setSelectedNeedsId(null);
                    setOpenArticleId(null);
                    setOpenThreadId(null);
                  }}
                >
                  {entry.label}
                  {entry.id === "needs" && live.unresolved > 0 ? (
                    <span className="feed-tab-count">{live.unresolved}</span>
                  ) : null}
                </button>
              );
            })}
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

          {tab === "bookmarks" ? (
            <div className="feed-bookmark-filters" role="group" aria-label="ブックマークの種類">
              {(
                [
                  ["bookmark", "保存済み", "ブックマーク"],
                  ["interesting", "おもしろい", "おもしろい印"],
                  ["known", "既知だった", "既知だった印"],
                ] as const
              ).map(([id, label, ariaLabel]) => (
                <button
                  key={id}
                  type="button"
                  className={bookmarkFilter === id ? "is-active" : undefined}
                  aria-pressed={bookmarkFilter === id}
                  aria-label={ariaLabel}
                  onClick={() => setBookmarkFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          {notice ? (
            <p className="feed-notice-line" role="status">
              {notice}
            </p>
          ) : null}

          {/* 自分の投稿欄。Feed専用の投稿へ保存し、Notesには残さない。実データ0件のfixture表示中も出す。初投稿で実データ表示へ切り替わる。 */}
          {tab !== "needs" ? (
            <form
              className="feed-compose"
              onSubmit={(event) => {
                event.preventDefault();
                void publishOwnPost();
              }}
            >
              <label htmlFor="feed-compose-body">自分の投稿をFeedへ載せる</label>
              <textarea
                id="feed-compose-body"
                value={compose}
                onChange={(event) => setCompose(event.target.value)}
                rows={2}
                placeholder="気づいたことや、あとで読み返したいことを短く"
              />
              <div className="feed-detail-actions">
                <Button variant="primary" type="submit" disabled={busy}>
                  Feedへ投稿
                </Button>
                <span className="feed-compose-note">Notesには残りません</span>
              </div>
            </form>
          ) : null}

          {tab === "needs" ? (
            <section
              id="feed-panel-needs"
              role="tabpanel"
              aria-labelledby="feed-tab-needs"
              className="feed-timeline"
              aria-label="対応待ち"
            >
              {needsRows.length === 0 ? (
                <EmptyState
                  title="いま対応する更新はありません"
                  action="ホームを読む"
                  onAction={() => setTab("home")}
                />
              ) : (
                /* 判断・変更案・確認待ちを1本の一覧にし、選んだ1件だけを詳細で決着させる。 */
                <div className={`feed-needs-panel${selectedNeedsItem ? " has-selection" : ""}`}>
                  <div className="feed-needs-heading">
                    <h2>対応待ち</h2>
                    <div className="proposal-inbox-actions">
                      <span className="proposal-pending-count">{needsRows.length}件</span>
                      <Button
                        variant="secondary"
                        disabled={refreshingNeeds}
                        onClick={() => void refreshNeeds(true)}
                      >
                        {refreshingNeeds ? "更新中" : "更新"}
                      </Button>
                    </div>
                  </div>
                  <ul className="feed-needs-list">
                    {needsRows.map((item, index) => {
                      const proposal = proposalOf(item);
                      // 変更案は種別ラベルではなく中身の見出しを先頭に出す（旧「提案の確認」の行と同じ）。
                      const title =
                        item.kind === "proposal_pending" && proposal
                          ? proposalHeadline(proposal)
                          : item.headline;
                      return (
                        <Fragment key={item.id}>
                          {/* 判断と確認待ちの境目を1か所だけ示す（Androidの「確認待ち」と同じ意味）。 */}
                          {item.group === "confirmation" &&
                          needsRows[index - 1]?.group !== "confirmation" ? (
                            <li className="feed-needs-section" role="presentation">
                              <h3>確認待ち</h3>
                            </li>
                          ) : null}
                          <li className="feed-needs-row">
                            <button
                              type="button"
                              className="feed-needs-select"
                              aria-pressed={item.id === selectedNeedsId}
                              onClick={() => {
                                setSelectedNeedsId(item.id === selectedNeedsId ? null : item.id);
                                setDraftAnswer("");
                              }}
                              ref={(node) => {
                                if (node) rowRefs.current.set(`needs-${item.id}`, node);
                                else rowRefs.current.delete(`needs-${item.id}`);
                              }}
                            >
                              <span className="feed-needs-head">
                                <span className={`feed-state feed-state-${item.state}`}>
                                  {item.stateLabel}
                                </span>
                                <span className="feed-author-name">
                                  {item.actorLabel ?? "Tasken"}
                                </span>
                                {item.kind === "proposal_pending" && proposal ? (
                                  <ProposalRisk proposal={proposal} />
                                ) : null}
                                {item.receivedAt ? (
                                  <time className="feed-needs-time" dateTime={item.receivedAt}>
                                    {feedTimeLabel(item.receivedAt)}
                                  </time>
                                ) : null}
                              </span>
                              <strong className="feed-needs-title">{title}</strong>
                              {/* 見出しと中身の要旨が違うときだけ、要旨も行に出す。 */}
                              {item.summary && item.summary !== title ? (
                                <span className="feed-needs-summary">{item.summary}</span>
                              ) : null}
                              <span className="feed-post-meta">{item.pathLabel}</span>
                            </button>
                          </li>
                        </Fragment>
                      );
                    })}
                  </ul>
                  {selectedNeedsItem ? (
                    <div className="feed-needs-detail" aria-label="選んだ対応待ち">
                      {usesProposalDetail(selectedNeedsItem) &&
                      proposalOf(selectedNeedsItem) ? null : (
                        <div className="section-heading">
                          <h3>{needsDetailHeading(selectedNeedsItem)}</h3>
                          <span className={`feed-state feed-state-${selectedNeedsItem.state}`}>
                            {selectedNeedsItem.stateLabel}
                          </span>
                        </div>
                      )}
                      <p className="feed-post-meta">表示理由: {selectedNeedsItem.reasonShown}</p>
                      <dl className="feed-detail-rows">
                        {selectedNeedsItem.detail.rows.map((row) => (
                          <div key={row.label}>
                            <dt>{row.label}</dt>
                            <dd>{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                      {usesProposalDetail(selectedNeedsItem) ? (
                        proposalOf(selectedNeedsItem) ? (
                          <ProposalDetail
                            {...props}
                            proposal={proposalOf(selectedNeedsItem) as BaseRecord}
                            onDecided={() => setSelectedNeedsId(null)}
                          />
                        ) : (
                          <p className="feed-post-meta">
                            この提案を読み込めませんでした。画面を更新してください。
                          </p>
                        )
                      ) : selectedNeedsItem.requestId ? (
                        <form
                          className="feed-reply"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submitAnswer(selectedNeedsItem);
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
                              onClick={() => void changeTodayDate(selectedNeedsItem, null)}
                            >
                              今日の選択を外す
                            </Button>
                          </div>
                        </form>
                      ) : selectedNeedsItem.kind === "review_ready" ? (
                        <div className="feed-review">
                          {/* 読み順は #599 の契約どおり。生成文で順序を変えない。 */}
                          <dl className="feed-detail-rows">
                            <div>
                              <dt>成果</dt>
                              <dd>{selectedNeedsItem.summary}</dd>
                            </div>
                            <div>
                              <dt>確認できたこと</dt>
                              <dd>
                                {reviewDetailOf(selectedNeedsItem.sourceId).verification || "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>未確認事項</dt>
                              <dd>
                                {reviewDetailOf(selectedNeedsItem.sourceId).remainingWork || "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Taskenへ反映する内容</dt>
                              <dd>
                                {reviewDetailOf(selectedNeedsItem.sourceId).completedItems ||
                                  "チェック項目の変更はありません"}
                              </dd>
                            </div>
                          </dl>
                          {/* 既定の主操作は「報告を採用」。Task完了は選ばれていない明示オプション（#599）。 */}
                          <label className="feed-review-check">
                            <input
                              type="checkbox"
                              checked={completeTask}
                              onChange={(event) => setCompleteTask(event.target.checked)}
                            />
                            Taskも完了する
                          </label>
                          <div className="feed-detail-actions">
                            <Button
                              variant="primary"
                              disabled={busy}
                              onClick={() => void acceptReport(selectedNeedsItem, completeTask)}
                            >
                              {busy ? "処理中" : completeTask ? "採用してTaskを完了" : "報告を採用"}
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() => openTaskDrawer(selectedNeedsItem)}
                            >
                              Taskを開く
                            </Button>
                          </div>
                          <form
                            className="feed-reply"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void returnReport(selectedNeedsItem);
                            }}
                          >
                            <label htmlFor="feed-review-note">修正してほしい点</label>
                            <textarea
                              id="feed-review-note"
                              value={draftReviewNote}
                              onChange={(event) => setDraftReviewNote(event.target.value)}
                              rows={2}
                              disabled={busy}
                            />
                            <div className="feed-detail-actions">
                              <Button variant="secondary" type="submit" disabled={busy}>
                                {busy ? "送信中" : "修正を依頼"}
                              </Button>
                            </div>
                          </form>
                        </div>
                      ) : (
                        <div className="feed-detail-actions">
                          <Button
                            variant="secondary"
                            compact
                            onClick={() => openTaskDrawer(selectedNeedsItem)}
                          >
                            Taskを開く
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
              {/* 決着済みの変更案とhookの観測だけを残す。判断の選択は対応待ちの一覧が持つ。 */}
              <AiProposalPanel {...props} />
            </section>
          ) : (
            <section
              id={`feed-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`feed-tab-${tab}`}
              className="feed-timeline"
              aria-label={
                tab === "learn" ? "学び" : tab === "bookmarks" ? "ブックマーク" : "ホーム"
              }
            >
              <FeedStream
                posts={shownPosts}
                replyPosts={replyPosts}
                notes={domain.notes}
                now={now}
                authorFilter={authorFilter}
                expanded={expanded}
                openThreadId={openThreadId}
                busy={busy}
                bookmarks={shownBookmarks}
                interesting={shownInteresting}
                known={shownKnown}
                hasMore={hasMorePosts}
                emptyTitle={
                  tab === "bookmarks"
                    ? bookmarkFilter === "bookmark"
                      ? "保存した投稿はまだありません"
                      : bookmarkFilter === "interesting"
                        ? "「おもしろい」を付けた投稿はまだありません"
                        : "「既知だった」を付けた投稿はまだありません"
                    : tab === "learn"
                      ? "学びの投稿はまだありません"
                      : "まだ読める投稿がありません"
                }
                emptyAction={
                  tab === "home"
                    ? { label: "記録する", onClick: focusCompose }
                    : { label: "ホームを読む", onClick: () => setTab("home") }
                }
                onToggleExpanded={toggleExpanded}
                onAuthorFilter={setAuthorFilter}
                onOpenThread={openThread}
                onOpenArticle={openArticle}
                onToggleReaction={(target, kind) => void toggleReaction(target, kind)}
                onHide={hidePost}
                onOpenNote={openNoteEntity}
                onOpenTask={openPostTask}
                onSaveDraft={(target) => void saveDraftAsNote(target)}
                onOpenSavedNote={openSavedNote}
                editingOwnPostId={editingOwnPostId}
                editingOwnPostBody={editingOwnPostBody}
                onStartOwnPostEdit={startOwnPostEdit}
                onChangeOwnPostEdit={setEditingOwnPostBody}
                onCancelOwnPostEdit={cancelOwnPostEdit}
                onSaveOwnPostEdit={(target) => void saveOwnPostEdit(target)}
                onDeleteOwnPost={deleteOwnPost}
                onMore={() => setLimit((value) => value + FEED_PAGE_SIZE)}
                registerRow={(postId, node) => {
                  if (node) rowRefs.current.set(`post-${postId}`, node);
                  else rowRefs.current.delete(`post-${postId}`);
                }}
              />
            </section>
          )}

          {openArticlePost ? (
            <FeedArticleReader
              post={openArticlePost}
              savedNote={savedNoteOf(openArticlePost)}
              busy={busy}
              onClose={closeArticle}
              onOpenThread={openThread}
              onSaveDraft={(post) => void saveDraftAsNote(post)}
              onOpenSavedNote={openSavedNote}
            />
          ) : null}
        </section>

        {/* 右レール。Thread（会話スロット）を開いている間は非表示（右側補助は1スロット、design-guide §21）。 */}
        {!openThreadPost ? (
          <FeedContextRail
            data={data}
            domain={domain}
            activeTheme={activeTheme}
            attention={railAttention}
            openDrawer={openDrawer}
            navigate={navigate}
            onOpenAttention={openAttentionFromRail}
            onFilterAuthor={(authorId) => setAuthorFilter(authorId as FeedAuthorId | null)}
          />
        ) : null}

        {openThreadPost ? (
          <FeedThreadPanel
            post={openThreadPost}
            replies={threadReplies}
            draft={drafts[openThreadPost.id] ?? ""}
            copyDraft={copyDrafts[openThreadPost.id] as FeedThreadDraft | undefined}
            pasteDraft={pasteDrafts[openThreadPost.id] as FeedPasteDraft | undefined}
            pasteEditingId={pasteEditingId[openThreadPost.id] ?? null}
            externalOpen={externalOpen[openThreadPost.id]}
            busy={busy}
            copyBusy={copyBusy}
            onClose={closeThread}
            onOpenArticle={openArticle}
            onDraftChange={updateDraft}
            onSubmitReply={(post, options) => void submitReply(post, options)}
            onDeleteReply={(reply) => void deleteReply(reply)}
            onToggleExternal={toggleExternal}
            onUpdateCopyDraft={updateCopyDraft}
            onCopyForExternalAi={(post) => void copyForExternalAi(post)}
            onUpdatePasteDraft={updatePasteDraft}
            onSaveManualPaste={(post) => void saveManualPaste(post)}
            onDiscardExternalDraft={discardExternalDraft}
            onStartPasteCorrection={startPasteCorrection}
            onSaveManualPasteAsNote={(post, reply) => void saveManualPasteAsNote(post, reply)}
          />
        ) : null}
      </div>
    </div>
  );
}
