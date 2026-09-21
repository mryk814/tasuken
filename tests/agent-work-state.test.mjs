import assert from "node:assert/strict";
import test from "node:test";

import { deriveAgentWorkState } from "../src/shared/contracts/task/public.ts";
import {
  REQUEST_MEASUREMENT,
  REVISION_NOTE,
  WORK_ATTEMPT_A,
  WORK_ATTEMPT_B,
  legacyScenario,
  makeProposal,
  makeTask,
  outOfOrderScenario,
  questionThenProgressScenario,
  reassignedScenario,
  repeatedQuestionScenario,
  revisionRequestedScenario,
} from "./fixtures/agentWorkScenarios.mjs";

test("旧Taskは作業単位IDなしでも従来どおり導出できる", () => {
  const { task, proposals, receipts } = legacyScenario();
  const state = deriveAgentWorkState({ task, proposals, receipts });
  assert.equal(state.legacyAttemptTracking, true);
  assert.equal(state.workAttemptId, null);
  assert.equal(state.state, "working");
  assert.equal(state.attention.length, 0);
  assert.equal(state.reports.length, 1);
  assert.equal(state.reports[0].isCurrentAttempt, true);
  assert.deepEqual(state.evidence, ["legacy_attempt_tracking"]);
});

test("別作業単位からの遅い報告は過去の報告として読め、current判断を復活させない", () => {
  const { task, proposals, receipts } = reassignedScenario();
  const state = deriveAgentWorkState({ task, proposals, receipts });
  assert.equal(state.workAttemptId, WORK_ATTEMPT_B);
  assert.equal(state.legacyAttemptTracking, false);
  // B はまだ開始も報告もしていない。A の遅い done で確認待ちになってはいけない。
  assert.equal(state.state, "working");
  assert.equal(state.attention.length, 0);
  const late = state.reports.find((report) => report.workAttemptId === WORK_ATTEMPT_A);
  assert.ok(late, "A の報告が履歴として残っている");
  assert.equal(late.isCurrentAttempt, false);
  assert.equal(late.displayState, "past_attempt_report");
  assert.equal(
    state.reports.some((report) => report.displayState === "review_waiting"),
    false,
  );
});

test("再割当してもTaskは一つで、委任先と履歴が同じTaskに載る", () => {
  const { task, proposals, receipts } = reassignedScenario();
  const state = deriveAgentWorkState({ task, proposals, receipts });
  assert.equal(state.taskId, task.id);
  assert.deepEqual(new Set(state.reports.map((report) => report.taskId)), new Set([task.id]));
  assert.equal(state.delegate.intendedExecutor, "ai_agent");
  assert.equal(state.delegate.executorIdentity, "Codex");
  assert.equal(state.delegate.lastExecutorLabel, "Codex");
});

test("作業単位IDを持たないTaskではIDなし報告を遅着扱いしない", () => {
  const task = makeTask({ work_state: "in_progress", work_attempt_id: WORK_ATTEMPT_B });
  const idless = makeProposal("idless-done", {
    action: "report_done",
    summary: "IDなしの完了報告",
    reported_at: "2026-09-20T12:00:00.000Z",
  });
  const state = deriveAgentWorkState({ task, proposals: [idless], receipts: [] });
  assert.equal(state.legacyAttemptTracking, false);
  const report = state.reports[0];
  assert.equal(report.isCurrentAttempt, false);
  assert.equal(report.displayState, "past_attempt_report");
  assert.equal(state.attention.length, 0);
  assert.equal(state.state, "working");
});

test("report_sequence は到着順と発信時刻より優先して並びを決める", () => {
  const { task, proposals, receipts } = outOfOrderScenario();
  const state = deriveAgentWorkState({ task, proposals, receipts });
  assert.deepEqual(
    state.reports.map((report) => report.proposalId),
    ["first", "second"],
  );
});

test("未解決の入力要求は回答待ち1件になり、同じ質問の再送で増えない", () => {
  const { task, proposals, receipts } = repeatedQuestionScenario();
  const state = deriveAgentWorkState({ task, proposals, receipts });
  assert.equal(state.state, "answer_waiting");
  assert.equal(state.attention.length, 1);
  const [item] = state.attention;
  assert.equal(item.attentionId, `request:${REQUEST_MEASUREMENT}`);
  assert.equal(item.requestId, REQUEST_MEASUREMENT);
  assert.equal(item.kind, "answer_request");
  assert.equal(item.displayState, "answer_waiting");
  assert.equal(item.sourceRef.type, "ai_proposal");
  assert.ok(item.availableActions.includes("answer_request"));
  assert.ok(item.availableActions.includes("defer_attention"));
});

test("同じTaskの独立した判断は件数を分けて数える", () => {
  const { task, receipts } = repeatedQuestionScenario();
  const question = makeProposal("question", {
    action: "report_blocked",
    work_attempt_id: WORK_ATTEMPT_A,
    executor_label: "Codex",
    blocker: "測定温度が決まっていません。",
    needed_input: ["25℃と40℃のどちらで進めますか。"],
    reported_at: "2026-09-20T09:00:00.000Z",
  });
  const report = makeProposal("report", {
    action: "report_done",
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "比較表を作成しました",
    reported_at: "2026-09-20T09:10:00.000Z",
  });
  const state = deriveAgentWorkState({ task, proposals: [question, report], receipts });
  assert.equal(state.attention.length, 2);
  assert.deepEqual(state.attention.map((item) => item.kind).sort(), [
    "answer_request",
    "review_report",
  ]);
  // 回答待ちを先に出す。件数は判断単位で数える。
  assert.equal(state.state, "answer_waiting");
});

test("質問の後にprogressが届いても回答待ちは消えない", () => {
  const { task, proposals, receipts } = questionThenProgressScenario();
  const state = deriveAgentWorkState({ task, proposals, receipts });
  assert.equal(state.state, "answer_waiting");
  assert.equal(state.attention.length, 1);
  assert.equal(state.attention[0].kind, "answer_request");
  assert.equal(state.attention[0].requestId, REQUEST_MEASUREMENT);
  // progressは判断ではない。成果確認待ちに読み替えたり、質問を消したりしない。
  assert.equal(
    state.attention.some((item) => item.kind === "review_report"),
    false,
  );
  // 報告としては両方読める。並びは report_sequence が先に効く。
  assert.deepEqual(
    state.reports.map((report) => report.proposalId),
    ["progress-after-question", "question-1"],
  );
});

test("差戻し後は未完了のままで、新しい成果報告が届くまで成果確認待ちにならない", () => {
  const { task, proposals, receipts } = revisionRequestedScenario();
  const returned = deriveAgentWorkState({ task, proposals, receipts });
  // 理由を残して開始待ちへ戻る。確認待ちは残さない。
  assert.equal(returned.state, "start_waiting");
  assert.equal(returned.attention.length, 0);
  assert.equal(returned.workAttemptId, WORK_ATTEMPT_A);
  assert.equal(task.state, "doing");
  assert.equal(task.work_review_note, REVISION_NOTE);
  // 差戻した成果は履歴として読める（採用済みのまま）。
  const previous = returned.reports.find((report) => report.action === "report_done");
  assert.equal(previous.proposalStatus, "accepted");

  // 同じ作業単位でやり直しの成果報告が届くと、成果確認待ちになる。
  const again = makeProposal("done-2", {
    action: "report_done",
    work_attempt_id: WORK_ATTEMPT_A,
    executor_label: "Codex",
    summary: "検証結果を追記しました。",
    reported_at: "2026-09-20T11:00:00.000Z",
  });
  const updated = deriveAgentWorkState({ task, proposals: [proposals[0], again], receipts });
  assert.equal(updated.state, "review_waiting");
  assert.equal(updated.attention.length, 1);
  assert.equal(updated.attention[0].kind, "review_report");
  assert.equal(updated.attention[0].summary, "検証結果を追記しました。");
});

test("成果報告が届いた作業単位は成果確認待ちになる", () => {
  const task = makeTask({ work_state: "needs_human_review", work_attempt_id: WORK_ATTEMPT_A });
  const done = makeProposal("done", {
    action: "report_done",
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "3条件の比較を終えました",
    reported_at: "2026-09-20T13:00:00.000Z",
  });
  const state = deriveAgentWorkState({ task, proposals: [done], receipts: [] });
  assert.equal(state.state, "review_waiting");
  assert.equal(state.attention.length, 1);
  assert.equal(state.attention[0].kind, "review_report");
  assert.equal(state.attention[0].generated, true);
  assert.ok(state.attention[0].availableActions.includes("accept_and_complete"));
});

test("採用済みでTaskが継続のときは受入れ済みとして区別する", () => {
  const accepted = deriveAgentWorkState({
    task: makeTask({ work_state: "accepted", work_attempt_id: WORK_ATTEMPT_A }),
  });
  assert.equal(accepted.state, "accepted_continuing");
  const completed = deriveAgentWorkState({
    task: makeTask({ state: "done", work_state: "accepted", work_attempt_id: WORK_ATTEMPT_A }),
  });
  assert.equal(completed.state, "accepted_completed");
});

test("委任前のTaskはnot_delegatedとして扱う", () => {
  const state = deriveAgentWorkState({
    task: makeTask({ work_state: "not_delegated", intended_executor: "unassigned" }),
  });
  assert.equal(state.state, "not_delegated");
  assert.equal(state.attention.length, 0);
});

test("sourceを取得できないときは最後の確定状態を保持し、更新を確認できませんを返す", () => {
  const { task, proposals, receipts } = reassignedScenario();
  const state = deriveAgentWorkState({ task, proposals, receipts, sourceAvailable: false });
  assert.equal(state.state, "unknown_source");
  assert.equal(state.workAttemptId, WORK_ATTEMPT_B);
  assert.equal(state.reports.length, 0);
  assert.deepEqual(state.evidence, ["source_unavailable"]);
});

test("削除済みTaskと削除済み報告は導出に含めない", () => {
  assert.equal(
    deriveAgentWorkState({ task: makeTask({ deleted_at: "2026-09-21T00:00:00.000Z" }) }),
    null,
  );
  const task = makeTask({ work_state: "in_progress", work_attempt_id: WORK_ATTEMPT_A });
  const removed = makeProposal(
    "removed",
    { action: "append_receipt", work_attempt_id: WORK_ATTEMPT_A, summary: "削除済み" },
    { deleted_at: "2026-09-21T00:00:00.000Z" },
  );
  const state = deriveAgentWorkState({ task, proposals: [removed], receipts: [] });
  assert.equal(state.reports.length, 0);
  assert.equal(state.state, "working");
});
