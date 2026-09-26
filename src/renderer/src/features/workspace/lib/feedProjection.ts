import {
  buildAttentionQueue,
  buildConfirmationQueue,
  countAttention,
  type AttentionItem,
  type ConfirmationItem,
} from "../../../../../shared/contracts/task/public.ts";
import {
  FEED_ACTORS,
  type FeedAction,
  type FeedActorId,
  type FeedGroup,
  type FeedItem,
  type FeedItemKind,
  type FeedItemState,
} from "./feedFixtures.ts";

/**
 * Feedの実データ接続（#604後半 / L単位）。
 *
 * **Feedは独自の状態を持たない。** 要対応の行は `buildAttentionQueue`（Desktopのbadge、
 * Agent Deskと同じ導出）から作り、今日の行はTaskの `today_date` から作る。
 * 生成した文章で空白を埋めないため、出所のない行はここで作らない。
 *
 * 正本は docs/feed-surface.md。
 */

type Row = { id: string; [key: string]: unknown };

export interface LiveFeedInput {
  tasks?: readonly unknown[];
  proposals?: readonly unknown[];
  receipts?: readonly unknown[];
  themes?: readonly unknown[];
  schedules?: readonly unknown[];
  /** 今日の日付（YYYY-MM-DD）。呼び出し側が決める。 */
  today: string;
}

export interface LiveFeed {
  items: FeedItem[];
  /**
   * 未解決の判断の数。badgeと同じ意味で、**判断単位**で数える。
   * 「後で見る」や一日の上限では減らさない。
   */
  unresolved: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 出所の表示名からアイコン用のIDを選ぶ。架空のactorは増やさない。 */
export function actorIdFor(label: string | null): FeedActorId {
  const value = (label ?? "").toLowerCase();
  if (value.includes("codex")) return "codex";
  if (value.includes("claude")) return "external_ai";
  if (value.includes("tasken")) return "tasken";
  if (!value) return "tasken";
  return "external_ai";
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const [, month, day] = value.slice(0, 10).split("-");
  if (!month || !day) return "";
  return `${Number(month)}月${Number(day)}日`;
}

/** Taskの締切はScheduleが持つ。Task本文から推測しない。 */
function deadlineOf(schedules: readonly Row[], taskId: string): string | null {
  const schedule = schedules.find(
    (entry) => text(entry.owner_type) === "task" && text(entry.owner_id) === taskId,
  );
  const end = schedule ? text(schedule.end_date) : "";
  return end || null;
}

function pathLabel(themeName: string | null, taskTitle: string | null): string {
  if (themeName && taskTitle) return `${themeName} › ${taskTitle}`;
  return themeName || taskTitle || "";
}

const DEFER: FeedAction = { id: "defer_attention", label: "後で見る", role: "secondary" };
const OPEN_TASK: FeedAction = { id: "open_task", label: "Taskを開く", role: "secondary" };
const DISMISS: FeedAction = { id: "dismiss", label: "今回は見送る", role: "secondary" };
/** 確認待ちは行では決めず、詳細で採用/却下する（読み順と版の確認を飛ばさない）。 */
const REVIEW_WORK: FeedAction = { id: "view_proposal", label: "報告を確認", role: "primary" };

interface KindShape {
  kind: FeedItemKind;
  group: FeedGroup;
  state: FeedItemState;
  stateLabel: string;
  actions: FeedAction[];
  reasonShown: string;
}

function shapeFor(item: AttentionItem): KindShape {
  if (item.kind === "answer_request") {
    return {
      kind: "human_question",
      group: "needs_you",
      state: "blocked",
      stateLabel: "回答待ち",
      actions: [{ id: "answer_request", label: "回答する", role: "primary" }, DEFER],
      reasonShown: "agentが回答を待っています。回答が保存されるまで要対応に残ります。",
    };
  }
  if (item.kind === "decision_request") {
    return {
      kind: "human_question",
      group: "needs_you",
      state: "blocked",
      stateLabel: "判断待ち",
      actions: [{ id: "answer_request", label: "回答する", role: "primary" }, DEFER],
      reasonShown: "agentが判断を待っています。回答が保存されるまで要対応に残ります。",
    };
  }
  if (item.kind === "review_report") {
    return {
      kind: "review_ready",
      group: "review",
      state: "review",
      stateLabel: "成果確認",
      actions: [{ id: "review_report", label: "成果を確認", role: "primary" }, DEFER],
      reasonShown: "agentの成果報告が未処理です。採用するかどうかは人が決めます。",
    };
  }
  return {
    kind: "proposal_pending",
    group: "review",
    state: "info",
    // 生成ラベル（AI提案）と重ねない。DesktopのAgent Deskと同じ「変更案」を使う。
    stateLabel: "変更案",
    actions: [{ id: "view_proposal", label: "提案を見る", role: "primary" }, DISMISS],
    reasonShown: "AIからの変更案が未処理です。採用するまで正式データは変わりません。",
  };
}

/** 要対応1件をFeedの1行へ写す。文言は出所にある事実だけを使う。 */
function attentionRow(
  item: AttentionItem,
  themeName: string | null,
  dueAt: string | null,
): FeedItem {
  const shape = shapeFor(item);
  const agentLabel = item.agentLabel ?? null;
  return {
    id: `feed:${item.attentionId}`,
    kind: shape.kind,
    group: shape.group,
    actor: actorIdFor(agentLabel),
    actorLabel: agentLabel,
    taskId: item.taskId,
    requestId:
      item.kind === "answer_request" || item.kind === "decision_request" ? item.requestId : null,
    receivedAt: item.createdAt ?? item.updatedAt ?? "",
    dueAt,
    headline: item.headline || item.summary,
    summary: item.summary,
    state: shape.state,
    stateLabel: shape.stateLabel,
    // AIの変更案だけに生成ラベルを付ける。質問と報告は作業の事実なので付けない。
    generated: item.kind === "proposal_pending" ? "ai_suggestion" : null,
    reasonShown: shape.reasonShown,
    pathLabel: pathLabel(item.themeName ?? themeName, item.taskTitle),
    sourceLabel: null,
    sourceId: item.sourceId,
    actions: shape.actions,
    detail: {
      title: item.headline || item.summary,
      rows: [
        { label: "求めること", value: item.questionOrAction },
        { label: "対象Task", value: item.taskTitle ?? item.taskId ?? "Taskに紐づかない提案" },
        { label: "出所", value: agentLabel ?? "不明" },
        ...(item.workAttemptId
          ? [{ label: "作業単位", value: item.workAttemptId.slice(0, 8) }]
          : []),
        ...(item.createdAt
          ? [
              {
                label: "受信",
                value: `${item.createdAt.slice(0, 10)} ${item.createdAt.slice(11, 16)}`,
              },
            ]
          : []),
      ],
    },
  };
}

/**
 * 確認待ち1件をFeedの1行へ写す。
 *
 * 判断ではないので `group` は `confirmation` にし、要対応の件数へは数えない。
 * 採用/却下は提案ID（`sourceId`）で送る。Taskに紐づかない報告は作らない。
 */
function confirmationRow(
  item: ConfirmationItem,
  themeName: string | null,
  dueAt: string | null,
): FeedItem {
  const isProgress = item.kind === "progress_report";
  return {
    id: `feed:${item.confirmationId}`,
    kind: isProgress ? "progress_report" : "answered_report",
    group: "confirmation",
    actor: actorIdFor(item.agentLabel),
    actorLabel: item.agentLabel,
    taskId: item.taskId,
    requestId: null,
    receivedAt: item.createdAt ?? item.updatedAt ?? "",
    dueAt,
    headline: item.headline || item.summary,
    summary: item.summary,
    state: "info",
    stateLabel: isProgress ? "進捗追記" : "回答済み",
    // 事実の記録であってAIの提案ではない。生成ラベルは付けない。
    generated: null,
    reasonShown: isProgress
      ? "進捗の追記です。採用も却下もまだ決まっていません。"
      : "回答済みです。報告の採用はまだ決まっていません。",
    pathLabel: pathLabel(item.themeName ?? themeName, item.taskTitle),
    sourceLabel: null,
    sourceId: item.sourceId,
    actions: [REVIEW_WORK, OPEN_TASK],
    detail: {
      title: item.headline || item.summary,
      rows: [
        { label: "対象Task", value: item.taskTitle ?? item.taskId },
        { label: "出所", value: item.agentLabel ?? "不明" },
        ...(item.workAttemptId
          ? [{ label: "作業単位", value: item.workAttemptId.slice(0, 8) }]
          : []),
        ...(item.createdAt
          ? [
              {
                label: "受信",
                value: `${item.createdAt.slice(0, 10)} ${item.createdAt.slice(11, 16)}`,
              },
            ]
          : []),
      ],
    },
  };
}

/** 今日扱うTask。`today_date` が今日のものだけを出し、期限はScheduleから読む。 */
function todayRow(
  task: Row,
  themeName: string | null,
  dueAt: string | null,
  checklistCount: number,
): FeedItem {
  const title = text(task.title) || String(task.id);
  return {
    id: `feed:today:${String(task.id)}`,
    kind: "today_task",
    group: "today_change",
    actor: "self",
    actorLabel: null,
    taskId: String(task.id),
    requestId: null,
    receivedAt: text(task.updated_at),
    dueAt,
    headline: title,
    summary: dueAt ? `今日扱う。締切は${formatDate(dueAt)}。` : "今日扱う。",
    state: "active",
    stateLabel: "今日",
    generated: null,
    reasonShown: "自分が今日扱うと決めたTaskです。",
    pathLabel: pathLabel(themeName, title),
    sourceLabel: null,
    actions: [OPEN_TASK, { id: "change_today_date", label: "扱う日を変更", role: "secondary" }],
    detail: {
      title,
      rows: [
        { label: "扱う日", value: formatDate(text(task.today_date)) || "今日" },
        { label: "締切", value: formatDate(dueAt) || "設定なし" },
        { label: "チェック項目", value: `${checklistCount}件` },
      ],
    },
  };
}

/**
 * 実データからFeedの行を作る。
 *
 * - 要対応の行は `buildAttentionQueue` の結果だけを使う（**同じ判断を二重に数えない**）。
 * - 任意の提案と関連記録は、出所のある行だけを出す。無い場合は空のままにする。
 * - 並び順・上限・「後で見る」の扱いは `buildFeedProjection` が決める（既存の規則）。
 */
export function buildLiveFeed(input: LiveFeedInput): LiveFeed {
  const tasks = (input.tasks ?? []).filter((entry): entry is Row =>
    Boolean(entry && typeof entry === "object" && "id" in entry),
  );
  const themes = (input.themes ?? []).filter((entry): entry is Row =>
    Boolean(entry && typeof entry === "object" && "id" in entry),
  );
  const schedules = (input.schedules ?? []).filter((entry): entry is Row =>
    Boolean(entry && typeof entry === "object"),
  );
  const themeNames = new Map(themes.map((theme) => [String(theme.id), text(theme.name)]));

  const attention = buildAttentionQueue({
    tasks,
    proposals: input.proposals,
    receipts: input.receipts,
    themes,
  });
  const confirmations = buildConfirmationQueue({
    tasks,
    proposals: input.proposals,
    receipts: input.receipts,
    themes,
  });

  const items: FeedItem[] = attention.map((item) =>
    attentionRow(
      item,
      item.themeId ? (themeNames.get(item.themeId) ?? null) : null,
      item.taskId ? deadlineOf(schedules, item.taskId) : null,
    ),
  );

  // 判断ではないが未決着の報告（確認待ち）。**要対応の件数へは数えない。**
  for (const confirmation of confirmations) {
    items.push(
      confirmationRow(
        confirmation,
        confirmation.themeId ? (themeNames.get(confirmation.themeId) ?? null) : null,
        deadlineOf(schedules, confirmation.taskId),
      ),
    );
  }

  for (const task of tasks) {
    if (task.deleted_at) continue;
    if (text(task.today_date) !== input.today) continue;
    if (["done", "cancelled"].includes(text(task.state))) continue;
    const themeId = text(task.project_id);
    items.push(
      todayRow(
        task,
        themeId ? (themeNames.get(themeId) ?? null) : null,
        deadlineOf(schedules, String(task.id)),
        Array.isArray(task.checklist_items) ? task.checklist_items.length : 0,
      ),
    );
  }

  return { items, unresolved: countAttention(attention) };
}

/** 画面のコピーでも「同じ出所のラベルを使う」ことを示すための再輸出。 */
export const LIVE_FEED_ACTORS = FEED_ACTORS;
