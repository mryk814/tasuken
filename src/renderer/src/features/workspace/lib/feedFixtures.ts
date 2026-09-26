/**
 * Tasken Feed の設計検証用fixture（#604前半）。
 *
 * **すべて架空の研究業務データ。実データではない。**
 * この段階では保存を伴う接続をせず、行動の違いと並び順の意味だけを検証する。
 * 実Taskと要対応への接続は #604後半（L単位）で行う。
 *
 * 正本は docs/feed-surface.md。5種類の意味は docs/issue-design-plan-2026-09-20.md「最初の5種類のfixture」。
 */

/** 表示行の種類。同じ文章を並べず、行動の違いを検証する単位。 */
export type FeedItemKind =
  | "today_task"
  | "stale_suggestion"
  | "human_question"
  | "review_ready"
  | "past_context"
  /** 実データの未処理Proposal（#604後半）。提案を見る／今回は見送るの組を持つ。 */
  | "proposal_pending"
  /** 進捗の追記（確認待ち）。採用/却下だけが残る。 */
  | "progress_report"
  /** 回答済みだが採用が未決着の報告（確認待ち）。 */
  | "answered_report";

/**
 * 並び順の段階。docs/feed-surface.md の順序規則そのもの。
 * 0が先頭。段階の中では人が設定した期限 → 受信の古い順に並べる。
 *
 * `confirmation` は判断ではない（進捗追記・回答済み）。**要対応の件数には数えない**が、
 * 採用/却下が未決着なので同じ一覧へ並べる（Androidの「確認待ち」と同じ意味）。
 */
export type FeedGroup = "needs_you" | "review" | "confirmation" | "today_change" | "optional";

/** 行の状態。色だけでなく文字ラベルも必ず併記する。 */
export type FeedItemState = "active" | "blocked" | "review" | "done" | "info";

/** 出所。SNSのaccount表現を借りるが、架空の人格は増やさない。 */
export type FeedActorId = "codex" | "external_ai" | "tasken" | "own_record" | "self";

export interface FeedActor {
  id: FeedActorId;
  label: string;
}

export const FEED_ACTORS: Record<FeedActorId, FeedActor> = {
  codex: { id: "codex", label: "Codex" },
  external_ai: { id: "external_ai", label: "外部AI" },
  tasken: { id: "tasken", label: "Tasken AI" },
  own_record: { id: "own_record", label: "自分の記録" },
  self: { id: "self", label: "自分" },
};

export interface FeedAction {
  /** 文言からCommandを選ばず、型付きIDで分岐する。 */
  id:
    | "open_task"
    | "change_today_date"
    | "view_proposal"
    | "dismiss"
    | "answer_request"
    | "defer_attention"
    | "review_report"
    | "open_record"
    | "complete_task";
  label: string;
  role: "primary" | "secondary";
}

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  group: FeedGroup;
  actor: FeedActorId;
  /**
   * 実データの出所表示名（#604後半）。fixtureでは未設定で、`actor` のラベルを使う。
   * 実在のagent名をそのまま出し、架空のactorへ寄せない。
   */
  actorLabel?: string | null;
  /** 実データの参照（#604後半）。回答とTask操作はこのIDを使う。 */
  taskId?: string | null;
  /** 回答対象の質問ID。質問以外では null。 */
  requestId?: string | null;
  /** 受信時刻。並び順はこの値を使い、発信側の時計だけに依存しない。 */
  receivedAt: string;
  /** 人が設定した期限。同段階の並びで優先する。 */
  dueAt: string | null;
  headline: string;
  summary: string;
  state: FeedItemState;
  stateLabel: string;
  /** AIが生成した文章か。事実と提案を色だけで判定させないため文字ラベルを付ける。 */
  generated: "ai_suggestion" | "ai_summary" | null;
  /** なぜ今これを出したか。rankingを説明可能に保つ。 */
  reasonShown: string;
  /** Theme › 対象。 */
  pathLabel: string;
  /** 原文・記録への参照。AI要約には必須。 */
  sourceLabel: string | null;
  /** 報告・提案の元Entity ID。報告の採用/差し戻し操作に使う（実データのみ）。 */
  sourceId?: string | null;
  actions: FeedAction[];
  /** 詳細で確認するもの。 */
  detail: { title: string; rows: Array<{ label: string; value: string }> };
}

const OPEN_TASK: FeedAction = { id: "open_task", label: "Taskを開く", role: "secondary" };
const CHANGE_DAY: FeedAction = {
  id: "change_today_date",
  label: "扱う日を変更",
  role: "secondary",
};
const DEFER: FeedAction = { id: "defer_attention", label: "後で見る", role: "secondary" };
const DISMISS: FeedAction = { id: "dismiss", label: "今回は見送る", role: "secondary" };

/**
 * 5種類のfixture。順番は計画書の表と同じ。
 * 広幅・狭幅の設計確認と、操作の意味の検証に使う。
 */
export const FEED_CANONICAL_ITEMS: readonly FeedItem[] = [
  {
    id: "fx-today-tensile",
    kind: "today_task",
    group: "today_change",
    actor: "self",
    receivedAt: "2026-09-20T08:10:00+09:00",
    dueAt: "2026-09-25",
    headline: "引張試験の結果を比較する",
    summary: "今日扱う。締切は9月25日。",
    state: "active",
    stateLabel: "今日",
    generated: null,
    reasonShown: "自分が今日扱うと決めたTaskです。",
    pathLabel: "高分子材料評価 › 引張試験",
    sourceLabel: null,
    actions: [OPEN_TASK, CHANGE_DAY],
    detail: {
      title: "引張試験の結果を比較する",
      rows: [
        { label: "扱う日", value: "9月20日" },
        { label: "締切", value: "9月25日" },
        { label: "チェック項目", value: "3件（未完了2件）" },
      ],
    },
  },
  {
    id: "fx-stale-comparison",
    kind: "stale_suggestion",
    group: "optional",
    actor: "tasken",
    receivedAt: "2026-09-20T07:40:00+09:00",
    dueAt: null,
    headline: "比較条件を先に揃える案",
    summary: "AI提案。3日間更新がないため表示しています。",
    state: "info",
    stateLabel: "AI提案",
    generated: "ai_suggestion",
    reasonShown: "最終更新が3日前です。停滞かどうかは分かりません。",
    pathLabel: "高分子材料評価 › 引張試験",
    sourceLabel: "最終更新 9月17日 14:20",
    actions: [{ id: "view_proposal", label: "提案を見る", role: "primary" }, DISMISS],
    detail: {
      title: "比較条件を先に揃える案",
      rows: [
        { label: "根拠", value: "9月17日以降、このTaskの更新がありません" },
        { label: "提案の範囲", value: "チェック項目の並べ替えのみ" },
        { label: "採用前に確認", value: "本文と締切は変更しません" },
      ],
    },
  },
  {
    id: "fx-question-temperature",
    kind: "human_question",
    group: "needs_you",
    actor: "codex",
    receivedAt: "2026-09-20T09:12:00+09:00",
    dueAt: null,
    headline: "測定温度を選んでください",
    summary: "25℃か40℃かを確認したい。",
    state: "blocked",
    stateLabel: "回答待ち",
    generated: null,
    reasonShown: "回答が届くまで作業を再開できません。",
    pathLabel: "高分子材料評価 › 粘度測定の条件を決める",
    sourceLabel: null,
    actions: [{ id: "answer_request", label: "回答する", role: "primary" }, DEFER],
    detail: {
      title: "測定温度を選んでください",
      rows: [
        { label: "選択肢", value: "25℃で測定する／40℃で測定する" },
        { label: "推奨", value: "25℃（前回と同じ条件で比較できるため）" },
        { label: "作業単位", value: "粘度測定 1回目" },
      ],
    },
  },
  {
    id: "fx-review-comparison-table",
    kind: "review_ready",
    group: "review",
    actor: "codex",
    receivedAt: "2026-09-20T08:55:00+09:00",
    dueAt: null,
    headline: "比較表の作成報告が届きました",
    summary: "3条件を比較。検証結果1件、未確認事項1件。",
    state: "review",
    stateLabel: "成果確認",
    generated: null,
    reasonShown: "報告が届き、まだ採用していません。",
    pathLabel: "高分子材料評価 › 比較表の作成",
    sourceLabel: null,
    actions: [{ id: "review_report", label: "成果を確認", role: "primary" }, OPEN_TASK],
    detail: {
      title: "比較表の作成報告が届きました",
      rows: [
        { label: "成果", value: "3条件の比較表（Artifact 1件）" },
        { label: "確認できたこと", value: "数値の転記誤りがないことを確認" },
        { label: "未確認事項", value: "測定条件が妥当かは人が判断" },
      ],
    },
  },
  {
    id: "fx-context-past-decision",
    kind: "past_context",
    group: "optional",
    actor: "own_record",
    receivedAt: "2026-09-20T07:05:00+09:00",
    dueAt: null,
    headline: "この条件を選んだ記録があります",
    summary: "9月4日のNoteへの参照。",
    state: "info",
    stateLabel: "記録",
    generated: "ai_summary",
    reasonShown: "同じTaskの条件を過去に自分で決めています。",
    pathLabel: "高分子材料評価 › 粘度測定の条件を決める",
    sourceLabel: "9月4日 10:30 のNote",
    actions: [{ id: "open_record", label: "記録を開く", role: "primary" }, DISMISS],
    detail: {
      title: "この条件を選んだ記録があります",
      rows: [
        { label: "元の記述", value: "比較のため、まず25℃で揃える。" },
        { label: "記録日", value: "9月4日 10:30" },
        { label: "Taskとの関係", value: "同じThemeの先行検討" },
      ],
    },
  },
];

/**
 * 量と並び順を確認するための追加fixture。
 * 5種類の文章を焼き増しせず、別の研究業務の内容にしてある。
 */
const VOLUME_ITEMS: readonly FeedItem[] = [
  {
    id: "fx-v1",
    kind: "human_question",
    group: "needs_you",
    actor: "external_ai",
    receivedAt: "2026-09-20T09:30:00+09:00",
    dueAt: null,
    headline: "サンプル数を決めてください",
    summary: "n=3 か n=5 かを確認したい。",
    state: "blocked",
    stateLabel: "回答待ち",
    generated: null,
    reasonShown: "回答が届くまで作業を再開できません。",
    pathLabel: "高分子材料評価 › 劣化試験の計画",
    sourceLabel: null,
    actions: [{ id: "answer_request", label: "回答する", role: "primary" }, DEFER],
    detail: {
      title: "サンプル数を決めてください",
      rows: [
        { label: "選択肢", value: "n=3／n=5" },
        { label: "推奨", value: "n=5（ばらつきが大きい試料のため）" },
        { label: "作業単位", value: "劣化試験 1回目" },
      ],
    },
  },
  {
    id: "fx-v2",
    kind: "review_ready",
    group: "review",
    actor: "codex",
    receivedAt: "2026-09-20T08:20:00+09:00",
    dueAt: null,
    headline: "測定手順の下書きができました",
    summary: "手順書を1件作成。未確認事項2件。",
    state: "review",
    stateLabel: "成果確認",
    generated: null,
    reasonShown: "報告が届き、まだ採用していません。",
    pathLabel: "高分子材料評価 › 粘度測定の条件を決める",
    sourceLabel: null,
    actions: [{ id: "review_report", label: "成果を確認", role: "primary" }, OPEN_TASK],
    detail: {
      title: "測定手順の下書きができました",
      rows: [
        { label: "成果", value: "手順書（Artifact 1件）" },
        { label: "確認できたこと", value: "手順の順序が実際の操作と一致" },
        { label: "未確認事項", value: "安全手順の要否は人が判断" },
      ],
    },
  },
  {
    id: "fx-v3",
    kind: "today_task",
    group: "today_change",
    actor: "self",
    receivedAt: "2026-09-20T07:55:00+09:00",
    dueAt: "2026-09-20",
    headline: "比較グラフをNoteへ残す",
    summary: "今日扱う。締切は9月20日。",
    state: "active",
    stateLabel: "今日",
    generated: null,
    reasonShown: "自分が今日扱うと決めたTaskです。",
    pathLabel: "高分子材料評価 › 比較表の作成",
    sourceLabel: null,
    actions: [OPEN_TASK, CHANGE_DAY],
    detail: {
      title: "比較グラフをNoteへ残す",
      rows: [
        { label: "扱う日", value: "9月20日" },
        { label: "締切", value: "9月20日" },
        { label: "チェック項目", value: "2件（未完了1件）" },
      ],
    },
  },
  {
    id: "fx-v4",
    kind: "today_task",
    group: "today_change",
    actor: "self",
    receivedAt: "2026-09-18T09:00:00+09:00",
    dueAt: "2026-09-30",
    headline: "劣化試験の計画を立てる",
    summary: "今日扱う。締切は9月30日。",
    state: "active",
    stateLabel: "今日",
    generated: null,
    reasonShown: "自分が今日扱うと決めたTaskです。",
    pathLabel: "高分子材料評価 › 劣化試験の計画",
    sourceLabel: null,
    actions: [OPEN_TASK, CHANGE_DAY],
    detail: {
      title: "劣化試験の計画を立てる",
      rows: [
        { label: "扱う日", value: "9月20日" },
        { label: "締切", value: "9月30日" },
        { label: "チェック項目", value: "4件（未完了4件）" },
      ],
    },
  },
  {
    id: "fx-v5",
    kind: "stale_suggestion",
    group: "optional",
    actor: "tasken",
    receivedAt: "2026-09-19T18:40:00+09:00",
    dueAt: null,
    headline: "Themeの現在地を更新する案",
    summary: "AI提案。現在地の最終更新が3週間前です。",
    state: "info",
    stateLabel: "AI提案",
    generated: "ai_suggestion",
    reasonShown: "Themeの現在地の最終更新が3週間前です。",
    pathLabel: "高分子材料評価",
    sourceLabel: "最終更新 8月29日",
    actions: [{ id: "view_proposal", label: "提案を見る", role: "primary" }, DISMISS],
    detail: {
      title: "Themeの現在地を更新する案",
      rows: [
        { label: "根拠", value: "現在地の最終更新が8月29日です" },
        { label: "提案の範囲", value: "現在地の1行のみ" },
        { label: "採用前に確認", value: "Charterは変更しません" },
      ],
    },
  },
  {
    id: "fx-v6",
    kind: "past_context",
    group: "optional",
    actor: "own_record",
    receivedAt: "2026-09-19T11:05:00+09:00",
    dueAt: null,
    headline: "同じ装置の校正記録があります",
    summary: "8月22日のNoteへの参照。",
    state: "info",
    stateLabel: "記録",
    generated: "ai_summary",
    reasonShown: "同じ装置を使うTaskがあります。",
    pathLabel: "高分子材料評価 › 装置の校正",
    sourceLabel: "8月22日 09:00 のNote",
    actions: [{ id: "open_record", label: "記録を開く", role: "primary" }, DISMISS],
    detail: {
      title: "同じ装置の校正記録があります",
      rows: [
        { label: "元の記述", value: "校正は測定の前日までに済ませる。" },
        { label: "記録日", value: "8月22日 09:00" },
        { label: "Taskとの関係", value: "同じ装置を使う別Task" },
      ],
    },
  },
  {
    id: "fx-v7",
    kind: "stale_suggestion",
    group: "optional",
    actor: "tasken",
    receivedAt: "2026-09-18T20:15:00+09:00",
    dueAt: null,
    headline: "似たTaskが2件あります",
    summary: "AI提案。同じ装置の校正Taskが重複しています。",
    state: "info",
    stateLabel: "AI提案",
    generated: "ai_suggestion",
    reasonShown: "タイトルとThemeが近いTaskが2件あります。",
    pathLabel: "高分子材料評価 › 装置の校正",
    sourceLabel: null,
    actions: [{ id: "view_proposal", label: "提案を見る", role: "primary" }, DISMISS],
    detail: {
      title: "似たTaskが2件あります",
      rows: [
        { label: "根拠", value: "同じ装置名を含む未完のTaskが2件あります" },
        { label: "提案の範囲", value: "どちらかを残す判断材料の提示のみ" },
        { label: "採用前に確認", value: "Taskの統合や削除は行いません" },
      ],
    },
  },
];

/** 並び順と量を確認するための全fixture。 */
export const FEED_FIXTURE_ITEMS: readonly FeedItem[] = [...FEED_CANONICAL_ITEMS, ...VOLUME_ITEMS];

export const FEED_GROUP_ORDER: Record<FeedGroup, number> = {
  needs_you: 0,
  review: 1,
  confirmation: 2,
  today_change: 3,
  optional: 4,
};

/** 任意の提案と関連記録は初期値として一日合計5件まで。要対応項目をこの上限で隠さない。 */
export const FEED_OPTIONAL_DAILY_BUDGET = 5;

/** 初回表示行数。続きは明示操作で開く。 */
export const FEED_PAGE_SIZE = 20;

export interface FeedProjection {
  items: FeedItem[];
  /** 一日の上限で今日は出さない任意項目。件数だけ末尾に示す。 */
  budgetedOptionalCount: number;
  /** 後で見るへ回した項目。未解決件数は減らさない。 */
  deferredCount: number;
}

/** 期限なしは同じ段階の末尾へ置く。期限は人が設定した値であり、AIの緊急度ではない。 */
function dueKey(item: FeedItem): string {
  return item.dueAt ?? "9999-12-31";
}

function compareFeedItems(a: FeedItem, b: FeedItem): number {
  const byGroup = FEED_GROUP_ORDER[a.group] - FEED_GROUP_ORDER[b.group];
  if (byGroup !== 0) return byGroup;
  const byDue = dueKey(a).localeCompare(dueKey(b));
  if (byDue !== 0) return byDue;
  return a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id);
}

/**
 * 「今見る」の並びを決める。
 *
 * 1. 保留していない人間への質問と判断依頼
 * 2. 未処理の成果確認と変更Proposal
 * 3. 判断ではないが未決着の報告（確認待ち。進捗追記・回答済み）
 * 4. 今日扱うTaskに関する新しい変化
 * 5. 任意の提案と関連記録（一日の上限あり）
 *
 * 同じ段階では人が設定した期限を優先し、次に受信の古いものを先にする。
 * AIの自己申告による緊急度では順位を変えない。
 */
export function buildFeedProjection(
  items: readonly FeedItem[],
  options: { deferred?: ReadonlySet<string>; optionalBudget?: number } = {},
): FeedProjection {
  const deferred = options.deferred ?? new Set<string>();
  const budget = options.optionalBudget ?? FEED_OPTIONAL_DAILY_BUDGET;
  const visible = items.filter((item) => !deferred.has(item.id));
  const budgeted = new Set(
    visible
      .filter((item) => item.group === "optional")
      .sort(compareFeedItems)
      .slice(budget)
      .map((item) => item.id),
  );
  return {
    items: visible.filter((item) => !budgeted.has(item.id)).sort(compareFeedItems),
    budgetedOptionalCount: budgeted.size,
    deferredCount: items.filter((item) => deferred.has(item.id)).length,
  };
}

/**
 * 「対応待ち」タブ。未解決の判断と、判断ではないが未決着の報告（確認待ち）を出す。
 * 段階の順序は `FEED_GROUP_ORDER` が決める（判断 → 確認待ち）。
 */
export function selectNeedsYou(items: readonly FeedItem[]): FeedItem[] {
  return items.filter(
    (item) =>
      item.group === "needs_you" || item.group === "review" || item.group === "confirmation",
  );
}

/** 「最近の更新」タブ。受信の新しい順にし、判断待ちの重要順と混ぜない。 */
export function selectRecent(items: readonly FeedItem[]): FeedItem[] {
  return [...items].sort(
    (a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id),
  );
}

/**
 * 要対応件数は未解決の**判断**単位の数。「後で見る」は減らさない。
 * 確認待ち（進捗追記・回答済み）は判断ではないので数えない（badgeと同じ意味）。
 */
export function countUnresolved(items: readonly FeedItem[]): number {
  return items.filter((item) => item.group === "needs_you" || item.group === "review").length;
}
