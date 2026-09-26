import assert from "node:assert/strict";
import test from "node:test";

import { buildAttentionQueue, countAttention } from "../src/shared/contracts/task/public.ts";
import { buildLiveFeed } from "../src/renderer/src/features/workspace/lib/feedProjection.ts";
import {
  buildFeedProjection,
  selectNeedsYou,
} from "../src/renderer/src/features/workspace/lib/feedFixtures.ts";
import {
  REQUEST_MEASUREMENT,
  TASK_ID,
  WORK_ATTEMPT_A,
  makeProposal,
  makeReceipt,
  makeTask,
} from "./fixtures/agentWorkScenarios.mjs";

const TODAY = "2026-09-20";

/** 質問・成果確認・Note変更案・今日のTaskを1件ずつ持つ実データ相当のworkspace。 */
function workspace(overrides = {}) {
  const tasks = [
    makeTask({
      id: TASK_ID,
      title: "粘度測定の条件を決める",
      work_state: "blocked",
      work_attempt_id: WORK_ATTEMPT_A,
      project_id: "theme-materials",
      today_date: TODAY,
      version: 12,
      checklist_items: [{ id: "c1", title: "条件を確認", done: false, sort_order: 0 }],
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
      id: "task-tomorrow",
      title: "明日扱うTask",
      work_state: "ready_for_agent",
      today_date: "2026-09-21",
      version: 2,
    }),
  ];
  const proposals = [
    makeProposal("ai-question", {
      action: "report_blocked",
      work_attempt_id: WORK_ATTEMPT_A,
      request_id: REQUEST_MEASUREMENT,
      executor_label: "Codex",
      blocker: "測定温度が決まっていません。",
      needed_input: ["測定温度を選んでください"],
      reported_at: "2026-09-20T09:10:00.000Z",
    }),
    makeProposal("ai-review", {
      task_id: TASK_ID,
      action: "report_done",
      work_attempt_id: WORK_ATTEMPT_A,
      executor_label: "Codex",
      summary: "3条件の比較表を作成しました。",
      reported_at: "2026-09-20T09:20:00.000Z",
    }),
    {
      id: "ai-note-proposal",
      status: "pending",
      source: "mcp",
      source_app: "codex",
      payload_type: "notes",
      payload: { notes: [{}] },
      request: {},
      received_at: "2026-09-20T09:30:00.000Z",
      created_at: "2026-09-20T09:30:00.000Z",
      version: 1,
    },
  ];
  // 成果確認のProposalはtask-reviewのものへ差し替える。
  proposals[1] = makeProposal(
    "ai-review",
    {
      task_id: "task-review",
      action: "report_done",
      work_attempt_id: WORK_ATTEMPT_A,
      executor_label: "Codex",
      summary: "3条件の比較表を作成しました。",
      reported_at: "2026-09-20T09:20:00.000Z",
    },
    {},
  );
  return {
    tasks,
    proposals,
    receipts: [],
    themes: [{ id: "theme-materials", name: "高分子材料評価" }],
    schedules: [{ owner_type: "task", owner_id: TASK_ID, end_date: "2026-09-25" }],
    today: TODAY,
    ...overrides,
  };
}

test("要対応の行はDesktopと同じ導出から作り、件数も同じ意味になる（#604後半）", () => {
  const input = workspace();
  const live = buildLiveFeed(input);
  const attention = buildAttentionQueue({
    tasks: input.tasks,
    proposals: input.proposals,
    receipts: input.receipts,
    themes: input.themes,
  });

  // badge・Agent Deskと同じ数。Feedだけの数え方を持たない。
  assert.equal(live.unresolved, countAttention(attention));
  assert.equal(live.unresolved, 3);
  const attentionRows = live.items.filter(
    (item) => item.id.startsWith("feed:") && !item.id.startsWith("feed:today:"),
  );
  assert.deepEqual(
    attentionRows.map((item) => item.id),
    attention.map((item) => `feed:${item.attentionId}`),
  );
  // 質問は回答に必要なIDを落とさない。
  const question = live.items.find((item) => item.kind === "human_question");
  assert.equal(question.requestId, REQUEST_MEASUREMENT);
  assert.equal(question.taskId, TASK_ID);
  assert.equal(question.stateLabel, "回答待ち");
  // 独立したNote変更案は同じTaskの質問と別の行として残る。
  const proposal = live.items.find((item) => item.kind === "proposal_pending");
  assert.equal(proposal.taskId, null);
  // 生成ラベル（AI提案）と重ならない見出しを使う。
  assert.equal(proposal.stateLabel, "変更案");
  assert.equal(proposal.generated, "ai_suggestion");
  assert.deepEqual(
    live.items.filter((item) => item.group === "needs_you" || item.group === "review").length,
    3,
  );
});

test("今日の行は today_date が今日のTaskだけで、締切はScheduleから読む（#604後半）", () => {
  const live = buildLiveFeed(workspace());
  const todayRows = live.items.filter((item) => item.kind === "today_task");

  assert.deepEqual(
    todayRows.map((item) => item.taskId),
    [TASK_ID],
  );
  // 締切はScheduleの値。Task本文から推測しない。
  assert.equal(todayRows[0].dueAt, "2026-09-25");
  assert.equal(todayRows[0].summary, "今日扱う。締切は9月25日。");
  assert.deepEqual(
    todayRows[0].actions.map((action) => action.id),
    ["open_task", "change_today_date"],
  );
  assert.equal(
    live.items.some((item) => item.taskId === "task-tomorrow"),
    false,
  );
});

test("出所のない行を作らず、AI生成ラベルを勝手に付けない（#604後半）", () => {
  const empty = buildLiveFeed({ tasks: [], proposals: [], receipts: [], themes: [], today: TODAY });
  assert.deepEqual(empty.items, []);
  // 0件は「取得できていない」ではなく、出所が無いという事実。
  assert.equal(empty.unresolved, 0);

  const live = buildLiveFeed(workspace());
  // Feedを開くたびに文章を生成しない。生成ラベルはAIの変更案だけに付ける。
  assert.deepEqual(
    live.items.filter((item) => item.generated !== null).map((item) => item.kind),
    ["proposal_pending"],
  );
  // 出所の表示名は実在のagent名をそのまま使う。
  const question = live.items.find((item) => item.kind === "human_question");
  assert.equal(question.actorLabel, "Codex");
  assert.equal(question.actor, "codex");
});

test("後で見るは未解決の件数を減らさず、並びは段階どおりにする（#604後半）", () => {
  const live = buildLiveFeed(workspace());
  const question = live.items.find((item) => item.kind === "human_question");
  const first = buildFeedProjection(live.items);
  const deferred = buildFeedProjection(live.items, { deferred: new Set([question.id]) });

  assert.equal(
    deferred.items.some((item) => item.id === question.id),
    false,
  );
  assert.equal(deferred.deferredCount, 1);
  // 未解決の件数は元データのまま。要対応タブの件数も変わらない。
  assert.equal(live.unresolved, 3);
  assert.equal(selectNeedsYou(deferred.items).length, 2);
  // 段階は 要対応 → 成果確認・変更案 → 今日の変化。
  assert.deepEqual(
    [...new Set(first.items.map((item) => item.group))],
    ["needs_you", "review", "today_change"],
  );
});

test("常時表示する操作は型付きIDで2つまでにする（#604後半）", () => {
  const live = buildLiveFeed(workspace());
  const allowed = new Set([
    "open_task",
    "change_today_date",
    "view_proposal",
    "dismiss",
    "answer_request",
    "defer_attention",
    "review_report",
    "open_record",
    "complete_task",
  ]);

  for (const item of live.items) {
    assert.ok(item.actions.length > 0 && item.actions.length <= 2, `${item.id} の操作数`);
    for (const action of item.actions) {
      assert.ok(allowed.has(action.id), `${item.id} の未知の操作 ${action.id}`);
    }
    assert.ok(item.reasonShown.length > 0, `${item.id} に表示理由がない`);
  }
});

test("確認待ちは要対応の件数を増やさず、同じ一覧の後ろへ並ぶ（#604後半）", () => {
  const base = workspace();
  const progress = makeProposal("ai-progress", {
    action: "append_receipt",
    work_attempt_id: WORK_ATTEMPT_A,
    executor_label: "Codex",
    summary: "条件を比較中です。",
    reported_at: "2026-09-20T09:05:00.000Z",
  });
  const live = buildLiveFeed({ ...base, proposals: [...base.proposals, progress] });

  // badge（要対応）は判断だけを数える。進捗の追記では増えない。
  assert.equal(live.unresolved, 3);
  const needs = selectNeedsYou(buildFeedProjection(live.items).items);
  const confirmations = needs.filter((item) => item.group === "confirmation");
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].kind, "progress_report");
  assert.equal(confirmations[0].stateLabel, "進捗追記");
  assert.equal(confirmations[0].sourceId, "ai-progress");
  assert.equal(confirmations[0].taskId, TASK_ID);
  // 事実の記録なのでAI生成ラベルを付けない。
  assert.equal(confirmations[0].generated, null);
  // 採用/却下は行では決めず、詳細（提案の経路）へ戻す。
  assert.deepEqual(
    confirmations[0].actions.map((action) => action.id),
    ["view_proposal", "open_task"],
  );
  // 判断の後ろに並ぶ。別の面ではなく同じ一覧である。
  assert.equal(needs.at(-1).id, confirmations[0].id);

  // 回答済みの停止報告も、判断から外れて確認待ちへ移る。
  const reply = makeReceipt("reply-1", {
    executor_kind: "human",
    executor_label: "自分",
    receipt_kind: "human_reply",
    request_id: REQUEST_MEASUREMENT,
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "25℃で進めてください。",
  });
  const answered = buildLiveFeed({ ...base, receipts: [reply] });
  assert.equal(answered.unresolved, 2);
  const answeredNeeds = selectNeedsYou(buildFeedProjection(answered.items).items);
  const answeredRow = answeredNeeds.find((item) => item.kind === "answered_report");
  assert.equal(answeredRow.stateLabel, "回答済み");
  assert.equal(answeredRow.group, "confirmation");
  assert.equal(answeredRow.sourceId, "ai-question");
});
