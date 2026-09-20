/**
 * Feed監査（#604後半）の隔離workspaceを用意する。
 *
 * `scripts/feed-surface-audit.mjs` は実データを表示するFeedを確認するため、
 * 起動前に一時userDataへ小さなworkspaceを書く。SQLiteはElectronのABIでビルドされて
 * いるため、この script は `run-electron-node.mjs` 経由で実行する。
 *
 *   node scripts/run-electron-node.mjs scripts/seed-feed-audit-workspace.mjs <userDataDir>
 *
 * 正本は docs/feed-surface.md。
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

const userDataDir = process.argv[2];
if (!userDataDir) throw new Error("userDataDirを指定してください。");

const TODAY = new Date();
const today = [
  TODAY.getFullYear(),
  String(TODAY.getMonth() + 1).padStart(2, "0"),
  String(TODAY.getDate()).padStart(2, "0"),
].join("-");
const at = `${today}T00:00:00.000Z`;
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

mkdirSync(userDataDir, { recursive: true });
const database = new WorkspaceDatabase(path.join(userDataDir, "research-desk.sqlite"));
database.loadWorkspace();

database.save("theme", { id: "theme-feed-audit", name: "高分子材料評価" });

// 今日扱うTask。締切はScheduleが持つ。
database.save("task", {
  id: "feed-audit-today",
  title: "引張試験の結果を比較する",
  state: "todo",
  priority: "normal",
  project_id: "theme-feed-audit",
  today_date: today,
  checklist_items: [
    { id: "audit-check-1", title: "条件を確認", done: false, sort_order: 0 },
    { id: "audit-check-2", title: "数値を比較", done: false, sort_order: 1 },
  ],
});
database.save("schedule", {
  id: "feed-audit-today-schedule",
  owner_type: "task",
  owner_id: "feed-audit-today",
  date_kind: "deadline",
  start_date: null,
  end_date: `${TODAY.getFullYear()}-09-25`,
  confidence: "fixed",
  granularity: "day",
  range_semantics: "once_within_window",
});

// 回答待ちの質問。回答に必要な request_id と作業単位を持つ。
database.save("task", {
  id: "feed-audit-question",
  title: "粘度測定の条件を決める",
  state: "todo",
  priority: "normal",
  project_id: "theme-feed-audit",
  requester: "self",
  intended_executor: "ai_agent",
  executor_identity: "Codex",
  work_state: "blocked",
  work_attempt_id: ATTEMPT,
});
database.save("ai_proposal", {
  id: "feed-audit-question-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "task_work",
  status: "pending",
  received_at: at,
  created_at: at,
  version: 1,
  payload: {
    task_work: [
      {
        action: "report_blocked",
        task_id: "feed-audit-question",
        expected_version: 1,
        caller: "Codex",
        executor_kind: "ai_agent",
        executor_label: "Codex",
        blocker: "測定温度が決まっていません。",
        summary: "測定温度が決まっていません。",
        needed_input: ["測定温度を選んでください"],
        reported_at: at,
        work_attempt_id: ATTEMPT,
        request_id: REQUEST_ID,
        runtime_metadata: { report_kind: "blocked" },
      },
    ],
  },
  request: { idempotency_key: "feed-audit-question", source: "mcp" },
});

// 成果確認。
database.save("task", {
  id: "feed-audit-review",
  title: "比較表の作成",
  state: "todo",
  priority: "normal",
  project_id: "theme-feed-audit",
  requester: "self",
  intended_executor: "ai_agent",
  executor_identity: "Codex",
  work_state: "needs_human_review",
  work_attempt_id: ATTEMPT,
});
database.save("ai_proposal", {
  id: "feed-audit-review-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "task_work",
  status: "pending",
  received_at: at,
  created_at: at,
  version: 1,
  payload: {
    task_work: [
      {
        action: "report_done",
        task_id: "feed-audit-review",
        expected_version: 1,
        caller: "Codex",
        executor_kind: "ai_agent",
        executor_label: "Codex",
        summary: "3条件の比較表を作成しました。",
        completed_items: ["25℃の比較表"],
        changed_or_created_items: [],
        verification: ["数値の再計算"],
        remaining_work: [],
        reported_at: at,
        work_attempt_id: ATTEMPT,
        runtime_metadata: { report_kind: "done" },
      },
    ],
  },
  request: { idempotency_key: "feed-audit-review", source: "mcp" },
});

// Taskに紐づかないAI変更案（Note提案）。
database.save("ai_proposal", {
  id: "feed-audit-note-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "notes",
  status: "pending",
  received_at: at,
  created_at: at,
  version: 1,
  title: "測定手順のNoteを作る案",
  summary: "測定手順のNoteを作る案",
  payload: { notes: [{ title: "測定手順" }] },
  request: { idempotency_key: "feed-audit-note", source: "mcp" },
});

database.db.close();
console.log(`Feed監査のworkspaceを用意しました: ${path.join(userDataDir, "research-desk.sqlite")}`);
