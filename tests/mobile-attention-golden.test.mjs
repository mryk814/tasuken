import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";

import { mobileAttentionResponseSchema } from "../src/shared/contracts/mobile/public.ts";
import { buildAgentDeskSummary } from "../src/shared/contracts/task/public.ts";
import {
  REQUEST_MEASUREMENT,
  TASK_ID,
  WORK_ATTEMPT_A,
  makeProposal,
  makeReceipt,
  makeTask,
  outOfOrderScenario,
} from "./fixtures/agentWorkScenarios.mjs";

const GOLDEN = "contracts/mobile/v1/attention-response.golden.json";
const buildProjection = async () => {
  const { projectAttentionQueue } = await import("../src/main/gateway/mobile/public.ts");
  return projectAttentionQueue;
};

/**
 * DesktopとAndroidが同じ意味を共有するための入力（#601）。
 * 同じfixtureから作ったread modelを、両側がこのgoldenで突き合わせる。
 */
function goldenWorkspace() {
  const tasks = [
    makeTask({
      id: TASK_ID,
      title: "粘度測定の条件を決める",
      work_state: "blocked",
      work_attempt_id: WORK_ATTEMPT_A,
      project_id: "theme-materials",
      version: 12,
    }),
    makeTask({
      id: "task-review",
      title: "比較表の作成",
      work_state: "needs_human_review",
      work_attempt_id: WORK_ATTEMPT_A,
      project_id: "theme-materials",
      version: 7,
    }),
    makeTask({
      id: "task-working",
      title: "劣化試験の計画",
      work_state: "in_progress",
      work_attempt_id: WORK_ATTEMPT_A,
      project_id: "theme-materials",
      version: 3,
    }),
    makeTask({
      id: "task-queued",
      title: "粘度データの整理",
      work_state: "ready_for_agent",
      project_id: "theme-materials",
      version: 2,
    }),
  ];
  const proposals = [
    makeProposal("attention-question", {
      task_id: TASK_ID,
      action: "report_blocked",
      work_attempt_id: WORK_ATTEMPT_A,
      request_id: REQUEST_MEASUREMENT,
      executor_label: "Codex",
      blocker: "測定温度が決まっていません。",
      needed_input: ["25℃で測定する", "40℃で測定する"],
      reported_at: "2026-09-20T09:10:00.000Z",
    }),
    makeProposal("attention-review", {
      task_id: "task-review",
      action: "report_done",
      work_attempt_id: WORK_ATTEMPT_A,
      executor_label: "Codex",
      summary: "3条件の比較表を作成しました。",
      reported_at: "2026-09-20T09:20:00.000Z",
    }),
    {
      id: "attention-note",
      status: "pending",
      source: "mcp",
      source_app: "codex",
      payload_type: "notes",
      payload: { notes: [{}] },
      request: {},
      received_at: "2026-09-20T10:00:00.000Z",
      created_at: "2026-09-20T10:00:00.000Z",
      version: 1,
    },
  ];
  const receipts = [outOfOrderScenario().receipts[0]].filter(Boolean);
  return { tasks, proposals, receipts };
}

async function readModel() {
  const { tasks, proposals, receipts } = goldenWorkspace();
  // DesktopのCoreと同じ導出を通す。goldenは「Androidが受け取る形」だけを固定する。
  const summary = buildAgentDeskSummary({
    tasks,
    proposals,
    receipts,
    themes: [{ id: "theme-materials", name: "高分子材料評価" }],
  });
  const projectAttentionQueue = await buildProjection();
  const projected = projectAttentionQueue({
    items: summary.attention,
    taskVersions: new Map(tasks.map((task) => [String(task.id), Number(task.version || 0)])),
    working: summary.working,
    queued: summary.queued,
    limit: 50,
  });
  return {
    ok: true,
    meta: {
      apiVersion: 1,
      schemaVersion: 7,
      serverId: "server-1",
      serverRevision: 1,
      generatedAt: "2026-09-20T10:00:00.000Z",
      truncated: projected.truncated,
    },
    data: {
      attention: projected.attention,
      counts: projected.counts,
      truncated: projected.truncated,
    },
  };
}

test("Androidへ渡す要対応read modelがgoldenと一致する（#601）", async () => {
  const projected = await readModel();
  // goldenの更新は意図したときだけ。差分が出たら契約変更としてレビューする。
  if (process.env.TASKEN_UPDATE_GOLDEN === "1") {
    writeFileSync(GOLDEN, `${JSON.stringify(projected, null, 2)}\n`);
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
  // 実際にAndroidが受け取るのはJSONを通した形。undefinedの有無で差が出ないよう揃える。
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), golden);
  // 契約としても読めること（Androidが同じschemaで検証する）。
  assert.equal(mobileAttentionResponseSchema.safeParse(golden).success, true);
});

test("件数は判断単位で数え、Desktopのbadgeと同じ意味になる（#601）", async () => {
  const projected = await readModel();
  const { counts, attention } = projected.data;
  // 要対応は未処理の判断の数。作業中と開始待ちは別枠で数える。
  assert.equal(counts.needsYou, attention.length);
  assert.equal(counts.needsYou, 3);
  assert.equal(counts.working, 1);
  assert.equal(counts.queued, 1);
  // Taskに紐づかないProposalも同じ一覧へ載る。
  const taskless = attention.find((item) => item.sourceId === "attention-note");
  assert.equal(taskless.taskId, null);
  assert.equal(taskless.taskVersion, null);
  assert.equal(taskless.kind, "proposal_pending");
});

test("回答に必要な質問IDとTask版を落とさない（#601）", async () => {
  const projected = await readModel();
  const question = projected.data.attention.find((item) => item.kind === "answer_request");
  assert.equal(question.requestId, REQUEST_MEASUREMENT);
  assert.equal(question.taskId, TASK_ID);
  assert.equal(question.taskVersion, 12);
  assert.equal(question.workAttemptId, WORK_ATTEMPT_A);
  assert.ok(question.availableActions.includes("answer_request"));
});

test("Androidの射影はDesktopの導出と食い違わない（#601）", async () => {
  const { tasks, proposals, receipts } = goldenWorkspace();
  const summary = buildAgentDeskSummary({ tasks, proposals, receipts });
  const items = summary.attention;
  const projectAttentionQueue = await buildProjection();
  const projected = projectAttentionQueue({
    items,
    taskVersions: new Map(),
    working: 0,
    queued: 0,
    limit: 2,
  });
  // 上限を超えた分は truncated で示し、0件と混同させない。
  assert.equal(projected.truncated, true);
  assert.equal(projected.attention.length, 2);
  assert.equal(projected.counts.needsYou, items.length);
  // 並び順はDesktopと同じ。
  assert.deepEqual(
    projected.attention.map((item) => item.kind),
    items.slice(0, 2).map((item) => item.kind),
  );
  // 空のworkspaceは成功した0件として返る（取得できない状態と区別する）。
  const empty = projectAttentionQueue({
    items: [],
    taskVersions: new Map(),
    working: 0,
    queued: 0,
    limit: 50,
  });
  assert.equal(empty.attention.length, 0);
  assert.equal(empty.truncated, false);
});
