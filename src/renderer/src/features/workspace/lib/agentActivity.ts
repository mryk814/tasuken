import {
  buildAttentionQueue,
  deriveAgentWorkState,
  type AttentionItem,
  type AgentWorkReadModel,
} from "../../../../../shared/contracts/task/public.ts";
import {
  authorIdForLabel,
  buildPostsFromProposals,
  FEED_AUTHORS,
  type FeedAuthorId,
  type FeedPost,
} from "./feedPosts.ts";

/**
 * AIごとの活動のread model（計画フェーズ5: Today / Agent Desk）。
 *
 * **AIアカウントや在席状態の新しい正本は作らない。** 既存のTask、Proposal、
 * Work Receipt、Feed投稿から「実際に活動があるAI」だけを導出する。
 * 観測できていない開始や稼働を、オンライン・作業中として推測表示しないため、
 * ここは保存も購読もしない純粋な派生に留める。
 *
 * 正本は docs/feed-sns-implementation-plan-2026-09-22.md のフェーズ5と
 * 「実装時の判断」。表示名はFeedと同じ `authorIdForLabel` を通し、
 * アバターの形・色・頭文字を画面ごとに作り直さない。
 */

type Row = { id: string; [key: string]: unknown };

/** Agent Deskの「作業中」「開始待ち」と同じ一件分の仕事。 */
export interface AgentWorkEntry {
  taskId: string;
  title: string;
  /** 表示状態。`deriveAgentWorkState` の値をそのまま使う（新しいenumを作らない）。 */
  state: string;
  /** 最終報告の時刻。報告が無ければnull。 */
  at: string | null;
}

/** Agent Deskの「最近の結果」と同じ一件分の報告。 */
export interface AgentRecentEntry {
  taskId: string;
  title: string;
  summary: string;
  at: string | null;
  /** 採用済みでTaskも完了しているか。 */
  completed: boolean;
}

export interface AgentActivity {
  authorId: FeedAuthorId;
  /** Feedと同じ表示名。ここで別名を作らない。 */
  label: string;
  /** 人の判断を待っている仕事。`buildAttentionQueue` の一件そのもの。 */
  waiting: AttentionItem[];
  /** 作業中・開始待ちの仕事。 */
  work: AgentWorkEntry[];
  /** 採用済みの報告（新しい順）。 */
  recent: AgentRecentEntry[];
  /** そのAIが書いたFeed投稿（新しい順）。 */
  posts: FeedPost[];
}

export interface AgentActivityInput {
  tasks?: readonly unknown[];
  proposals?: readonly unknown[];
  receipts?: readonly unknown[];
  themes?: readonly unknown[];
  /**
   * 返信とNote。**このread modelはまだ読まない。**
   *
   * Feedの返信は投稿と同じ `author` を持つため、いまはProposal側の投影だけで
   * AIごとの投稿が揃う。呼び出し側が同じ入力を毎回組み立て直さずに済むよう、
   * TodayとAgent Deskで共通の入口として受け取っておく。
   */
  feedReplies?: readonly unknown[];
  notes?: readonly unknown[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRows(value: readonly unknown[] | undefined): Row[] {
  const rows: Row[] = [];
  for (const entry of value ?? []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (!("id" in entry)) continue;
    rows.push(entry as Row);
  }
  return rows;
}

/** Agent Deskの「最近の結果」と同じ上限。 */
const RECENT_LIMIT = 8;

/**
 * 一件の仕事へ付ける表示名を決める。
 *
 * 報告済みならその報告の名前、まだ無ければ委任先の識別子を使う。
 * どちらも無い場合は名前を作らない（「AI」へ倒すのは表示側）。
 */
function executorLabelOf(row: Row, derived: AgentWorkReadModel | null): string {
  const report = derived?.reports.filter((entry) => entry.isCurrentAttempt).at(-1) ?? null;
  return (
    text(report?.executorLabel) ||
    text(derived?.delegate.executorIdentity) ||
    text(row.executor_identity)
  );
}

/**
 * 実際に活動があるAIだけを一つのread modelへまとめる。
 *
 * 出所は次の四つで、どれか一つでも活動があれば現れる。
 * - Task: `intended_executor === "ai_agent"` の行（`executor_identity` が表示名）
 * - Proposal: `source_app` / `request.caller`（要対応の表示名と同じ読み方）
 * - Feed投稿: 投稿の `author`（`buildPostsFromProposals` の導出をそのまま使う）
 * - Work Receipt: `executor_label`
 *
 * 並びは表示名の辞書順にする。活動の多さや新しさで順位を付けない
 * （架空のランキングや推薦を作らない）。
 */
export function buildAgentActivity(input: AgentActivityInput): AgentActivity[] {
  const tasks = asRows(input.tasks);
  const proposals = asRows(input.proposals);
  const receipts = asRows(input.receipts);
  const themes = asRows(input.themes);

  const attention = buildAttentionQueue({ tasks, proposals, receipts, themes });
  const posts = buildPostsFromProposals({ proposals, themes, tasks });

  /**
   * 同じAIへ複数の呼び名（`Codex` / `codex` など）が来ても一件へ寄せる。
   * 表示名は既知のAIならFeedの正式名、未知なら出所の文字列をそのまま使う。
   */
  const activities: AgentActivity[] = [];

  const ensure = (rawLabel: string): AgentActivity | null => {
    const label = rawLabel.trim();
    if (!label) return null;
    const authorId = authorIdForLabel(label);
    const author = FEED_AUTHORS[authorId];
    // 人はAIの活動として並べない（自分の投稿はFeedで読む）。
    if (author.kind !== "ai") return null;
    const existing = activities.find((entry) => entry.authorId === authorId);
    if (existing) return existing;
    const created: AgentActivity = {
      authorId,
      label: authorId === "external_ai" ? label : author.label,
      waiting: [],
      work: [],
      recent: [],
      posts: [],
    };
    activities.push(created);
    return created;
  };

  const find = (rawLabel: string): AgentActivity | null =>
    activities.find((entry) => entry.authorId === authorIdForLabel(rawLabel)) ?? null;

  for (const item of attention) {
    ensure(text(item.agentLabel))?.waiting.push(item);
  }

  /** Task一件の導出結果。Receiptの重複判定にも使う。 */
  const derivedByTask = new Map<string, AgentWorkReadModel>();

  for (const task of tasks) {
    if (text(task.intended_executor) !== "ai_agent") continue;
    const derived = deriveAgentWorkState({ task, proposals, receipts });
    if (!derived) continue;
    derivedByTask.set(derived.taskId, derived);
    const activity = ensure(executorLabelOf(task, derived));
    if (!activity) continue;
    const latest = derived.reports.filter((report) => report.isCurrentAttempt).at(-1) ?? null;
    if (derived.state !== "working" && derived.state !== "start_waiting") continue;
    activity.work.push({
      taskId: derived.taskId,
      title: text(task.title) || derived.taskId,
      state: derived.state,
      at: latest?.reportedAt ?? latest?.receivedAt ?? null,
    });
  }

  for (const [taskId, derived] of derivedByTask) {
    for (const report of derived.reports) {
      if (report.proposalStatus !== "accepted" || report.action === "human_reply") continue;
      const activity = find(text(report.executorLabel));
      if (!activity) continue;
      const task = tasks.find((entry) => String(entry.id) === taskId);
      activity.recent.push({
        taskId,
        title: task ? text(task.title) || taskId : taskId,
        summary: report.summary,
        at: report.reportedAt ?? report.receivedAt,
        completed: derived.state === "accepted_completed",
      });
    }
  }

  /**
   * Work Receiptは、Task側の導出へ入らない一件でも「そのAIが仕事をした」事実として読む。
   * 新しい状態は作らず、Receipt自身の情報だけを「最近の結果」へ置く。
   */
  for (const receipt of receipts) {
    const activity = ensure(text(receipt.executor_label));
    if (!activity) continue;
    const taskId = text(receipt.task_id);
    if (derivedByTask.has(taskId)) continue;
    const task = tasks.find((entry) => String(entry.id) === taskId);
    activity.recent.push({
      taskId,
      title: task ? text(task.title) || taskId : taskId,
      summary: text(receipt.summary),
      at: text(receipt.reported_at) || text(receipt.created_at) || null,
      completed: false,
    });
  }

  for (const activity of activities) {
    activity.recent.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    activity.recent = activity.recent.slice(0, RECENT_LIMIT);
    // 投稿は `buildPostsFromProposals` が新しい順に返す。
    activity.posts = posts.filter((post) => post.author === activity.authorId && !post.replyTo);
  }

  return activities
    .filter(
      (activity) =>
        activity.waiting.length ||
        activity.work.length ||
        activity.recent.length ||
        activity.posts.length,
    )
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));
}
