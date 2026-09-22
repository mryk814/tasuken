/**
 * Theme監査（計画フェーズ4）の隔離workspaceを用意する。
 *
 * `scripts/theme-surface-audit.mjs` はThemeの四面（概要／タスク／投稿／Notes）を
 * 実データで確認するため、起動前に一時userDataへ最小のworkspaceを書く。
 * SQLiteはElectronのABIでビルドされているため、この script は `run-electron-node.mjs`
 * 経由で実行する。
 *
 *   node scripts/run-electron-node.mjs scripts/seed-theme-audit-workspace.mjs <userDataDir>
 *
 * 置くのは次の五点だけである。面ごとの投影は既存データから作るので、
 * Theme側に表示用の複製や要約は作らない。
 *
 * - Theme一件
 * - 現在地（`status_update`）一件
 * - 未完了のTask一件
 * - 報告書（`note_type: "report"`）一件
 * - Themeに紐づくFeed投稿（記事つき）一件と、そのThemeのKnowledge一件
 *
 * 正本は docs/feed-sns-implementation-plan-2026-09-22.md のフェーズ4。
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

mkdirSync(userDataDir, { recursive: true });
const database = new WorkspaceDatabase(path.join(userDataDir, "research-desk.sqlite"));
database.loadWorkspace();

database.save("theme", { id: "theme-surface-audit", name: "高分子材料評価" });

// 概要: 「いま分かっていること」の出典1（現在地）と、現在地のカード。
database.save("status_update", {
  id: "theme-surface-audit-status",
  theme_id: "theme-surface-audit",
  date: today,
  status: "active",
  summary: "25℃の比較が終わり、次は40℃の条件を決める段階です。",
  next_actions: "40℃で測るかを決める",
  risks: "温度を上げると前回のデータと直接は比べられません。",
});

// 概要とタスク: 未完了の一件。締切はScheduleが持つ。
database.save("task", {
  id: "theme-surface-audit-task",
  title: "40℃の比較条件を決める",
  state: "todo",
  priority: "normal",
  project_id: "theme-surface-audit",
});
database.save("schedule", {
  id: "theme-surface-audit-task-schedule",
  owner_type: "task",
  owner_id: "theme-surface-audit-task",
  date_kind: "deadline",
  start_date: null,
  end_date: `${TODAY.getFullYear()}-09-30`,
  confidence: "fixed",
  granularity: "day",
  range_semantics: "once_within_window",
});

// Notes: 報告書。Theme側の正本はNoteで、ここでは題名と書き出しだけを読む。
database.save("note", {
  id: "theme-surface-audit-report",
  title: "週報（高分子材料評価）",
  note_type: "report",
  content_format: "markdown",
  project_id: "theme-surface-audit",
  body_markdown:
    "今週は25℃の比較を終えました。\n\n次は40℃で測るかを決めます。条件を変えると前回と直接は比べられません。",
  properties_json: {
    report_type: "weekly",
    period_start: today,
    period_end: today,
  },
});

// 概要: 「いま分かっていること」の出典3（Knowledge）。
database.save("knowledge_node", {
  id: "theme-surface-audit-knowledge",
  theme_id: "theme-surface-audit",
  title: "温度を上げると裾が広がる",
  node_type: "insight",
  body: "40℃では平均が近くても分布の広がりが大きくなります。",
  status: "active",
});

// 投稿: Themeに紐づく読み物投稿。記事つきなので「記事を読む」が出る。
database.save("ai_proposal", {
  id: "theme-surface-audit-post",
  source: "mcp",
  source_app: "codex",
  payload_type: "feed_posts",
  status: "pending",
  received_at: at,
  created_at: at,
  version: 1,
  payload: {
    feed_posts: [
      {
        action: "publish",
        topic: "insight",
        body: [
          "溶媒を替えた3条件を、同じ軸で並べ直しました。",
          "温度を上げれば差が出るという前提は、この系では成り立ちませんでした。",
        ],
        theme: "theme-surface-audit",
        article: {
          title: "条件を変えた比較を、同じ軸で読み直す",
          body: [
            "比較の条件を変えたとき、平均だけを見ると差が見えません。",
            "分布を重ねると、40℃では値の広がりが大きくなっていました。",
          ].join("\n\n"),
          note_type: "memo",
        },
        evidence: ["測定記録: 25℃ 3回 / 40℃ 3回"],
      },
    ],
  },
  request: {
    idempotency_key: "theme-surface-audit-post",
    source: "mcp",
    tool: "tasken.propose_feed_post",
  },
});

database.db.close();
console.log(
  `Theme監査のworkspaceを用意しました: ${path.join(userDataDir, "research-desk.sqlite")}`,
);
