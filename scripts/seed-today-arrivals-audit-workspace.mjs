/**
 * Today「AIから届いたこと」とToDoのAI委任状態の監査（計画フェーズ5）の
 * 隔離workspaceを用意する。
 *
 * `scripts/today-arrivals-audit.mjs` は、届いた情報と委任状態を実データで確認するため、
 * 起動前に一時userDataへ小さなworkspaceを書く。SQLiteはElectronのABIで
 * ビルドされているため、この script は `run-electron-node.mjs` 経由で実行する。
 *
 *   node scripts/run-electron-node.mjs scripts/seed-today-arrivals-audit-workspace.mjs <userDataDir> [--empty]
 *
 * 置くのは次のものだけである。どれも既存のTask、Proposal、Feed投稿の形をそのまま使い、
 * 表示用の複製や新しいInbox Entityは作らない。
 *
 * - ToDoの5状態に対応するTask（AIへ渡せる／開始待ち／作業中／確認待ち／自分に戻った）
 * - 上記のどれにも当てはまらないTask一件（状態を出さないことの確認）
 * - 回答待ちの質問（`report_blocked` Proposal）
 * - 最後にFeedを見たあとに届いた学びの投稿（`feed_posts` Proposal）
 *
 * `--empty` では、届いた情報もAI委任も無いworkspaceを作る。
 * Todayのセクションが丸ごと消えることを確かめるために使う。
 *
 * 正本は docs/feed-sns-implementation-plan-2026-09-22.md のフェーズ5。
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

const userDataDir = process.argv[2];
if (!userDataDir) throw new Error("userDataDirを指定してください。");
const empty = process.argv.includes("--empty");

const TODAY = new Date();
const today = [
  TODAY.getFullYear(),
  String(TODAY.getMonth() + 1).padStart(2, "0"),
  String(TODAY.getDate()).padStart(2, "0"),
].join("-");
/** 投稿は「最後にFeedを見た」より前へ置く。Todayの到着判定はこの時刻で行う。 */
const postAt = new Date(Date.parse(`${today}T00:00:00.000Z`) - 60 * 60 * 1000).toISOString();
const requestAt = `${today}T00:10:00.000Z`;
const reviewAt = `${today}T00:20:00.000Z`;
const ATTEMPT = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";

mkdirSync(userDataDir, { recursive: true });
const database = new WorkspaceDatabase(path.join(userDataDir, "research-desk.sqlite"));
database.loadWorkspace();

database.save("theme", { id: "theme-arrivals-audit", name: "高分子材料評価" });

/** 割当が変わると work_state は idle へ正規化されるので、2回目の保存で状態を置く。 */
const seededTasks = [];

if (!empty) {
  const tasks = [
    {
      id: "arrivals-ai-ready",
      title: "比較表の下書きを作る",
      state: "todo",
      intended_executor: "ai_agent",
      executor_identity: "Codex",
      work_state: "ready_for_agent",
    },
    {
      id: "arrivals-start-waiting",
      title: "粘度データを整理する",
      state: "todo",
      intended_executor: "ai_agent",
      executor_identity: "Codex",
      work_state: "ready_for_agent",
      work_attempt_id: ATTEMPT,
    },
    {
      id: "arrivals-working",
      title: "劣化試験の計画を立てる",
      state: "doing",
      intended_executor: "ai_agent",
      executor_identity: "Claude Code",
      work_state: "in_progress",
      work_attempt_id: ATTEMPT,
      work_started_at: requestAt,
    },
    {
      id: "arrivals-review",
      title: "再集計の結果をまとめる",
      state: "doing",
      intended_executor: "ai_agent",
      executor_identity: "Codex",
      work_state: "needs_human_review",
      work_attempt_id: ATTEMPT,
    },
    {
      id: "arrivals-returned",
      title: "評価条件の見直し",
      state: "doing",
      intended_executor: "self",
      work_state: "not_delegated",
      work_review_note: "条件の根拠を明記して、もう一度まとめてください。",
    },
    {
      id: "arrivals-question",
      title: "測定温度を決める",
      state: "todo",
      intended_executor: "ai_agent",
      executor_identity: "Codex",
      work_state: "blocked",
      work_attempt_id: ATTEMPT,
    },
    // どのAI委任状態にも当てはまらない行。chipを出さないことを確かめる。
    {
      id: "arrivals-plain",
      title: "実験ノートを棚卸しする",
      state: "todo",
      intended_executor: "self",
      work_state: "not_delegated",
    },
  ];

  /**
   * 二段階で置く。
   *
   * 割当（`intended_executor`）が変わると `work_state` と差戻しの理由は正規化で
   * 初期化される（正常な仕様）。fixture側でも実運用と同じ順序を踏み、先に割当を
   * 確定してから、作業の記録を置く。2回目は割当が変わらないので記録が残る。
   */
  for (const task of tasks) {
    database.save("task", {
      id: task.id,
      title: task.title,
      state: task.state,
      priority: "normal",
      project_id: "theme-arrivals-audit",
      requester: "self",
      ...(task.intended_executor ? { intended_executor: task.intended_executor } : {}),
    });
  }

  for (const task of tasks) {
    database.save("task", task);
    seededTasks.push(task);
  }

  // 回答待ちの質問。回答が保存されるまで要対応に残る。
  database.save("ai_proposal", {
    id: "arrivals-question-proposal",
    source: "mcp",
    source_app: "codex",
    payload_type: "task_work",
    status: "pending",
    received_at: requestAt,
    created_at: requestAt,
    version: 1,
    payload: {
      task_work: [
        {
          action: "report_blocked",
          task_id: "arrivals-question",
          expected_version: 1,
          caller: "Codex",
          executor_kind: "ai_agent",
          executor_label: "Codex",
          blocker: "測定温度が決まっていません。",
          summary: "測定温度が決まっていません。",
          needed_input: ["25℃で測定する", "40℃で測定する"],
          reported_at: requestAt,
          work_attempt_id: ATTEMPT,
          request_id: REQUEST_ID,
          runtime_metadata: { report_kind: "blocked" },
        },
      ],
    },
    request: { idempotency_key: "arrivals-question", source: "mcp" },
  });

  // 確認待ちの成果。採用するまで要対応（`review_report`）に残る。
  database.save("ai_proposal", {
    id: "arrivals-review-proposal",
    source: "mcp",
    source_app: "codex",
    payload_type: "task_work",
    status: "pending",
    received_at: reviewAt,
    created_at: reviewAt,
    version: 1,
    payload: {
      task_work: [
        {
          action: "report_done",
          task_id: "arrivals-review",
          expected_version: 1,
          caller: "Codex",
          executor_kind: "ai_agent",
          executor_label: "Codex",
          summary: "再集計の結果をまとめました。",
          completed_items: ["再集計の一致"],
          verification: ["再計算の一致"],
          remaining_work: ["条件の妥当性は人が判断"],
          reported_at: reviewAt,
          work_attempt_id: ATTEMPT,
          runtime_metadata: { report_kind: "done" },
        },
      ],
    },
    request: { idempotency_key: "arrivals-review", source: "mcp" },
  });

  // 最後にFeedを見たあとに届いた学び。Todayの三件目はこれだけになる。
  database.save("ai_proposal", {
    id: "arrivals-learning-post",
    source: "mcp",
    source_app: "claude",
    payload_type: "feed_posts",
    status: "pending",
    received_at: postAt,
    created_at: postAt,
    version: 1,
    payload: {
      feed_posts: [
        {
          action: "publish",
          topic: "learning",
          body: [
            "同じ条件で測り直すと、ばらつきは測り方ではなく乾燥の時間で決まっていました。",
            "手順を変える前に、待ち時間を揃えるだけで比較できるようになりました。",
          ],
          theme: "theme-arrivals-audit",
          evidence: ["測定記録: 25℃ 3回 / 40℃ 3回"],
        },
      ],
    },
    request: {
      idempotency_key: "arrivals-learning-post",
      source: "mcp",
      tool: "tasken.propose_feed_post",
    },
  });

  // 割当が変わると work_state は idle へ正規化される（正常な仕様）。
  // 2回目の保存では、記録済みの行をそのまま読み直して work_state だけを置き換える
  // （割当は変えないので、作業単位や差戻しの理由は残る）。
  for (const task of seededTasks) {
    const stored = database.get("task", task.id);
    database.save("task", { ...stored, work_state: task.work_state });
  }
} else {
  // 届いた情報もAI委任も無い状態。Todayのセクションが出ないことだけを確かめる。
  database.save("task", {
    id: "arrivals-empty-task",
    title: "実験ノートを棚卸しする",
    state: "todo",
    priority: "normal",
    project_id: "theme-arrivals-audit",
    intended_executor: "self",
    work_state: "not_delegated",
  });
}

database.db.close();
console.log(
  `Today到着監査のworkspaceを用意しました: ${path.join(userDataDir, "research-desk.sqlite")}`,
);
