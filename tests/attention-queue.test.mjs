import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAttentionQueue,
  countAttention,
  isPassiveAgentSessionProposal,
} from "../src/shared/contracts/task/public.ts";
import {
  REQUEST_MEASUREMENT,
  TASK_ID,
  WORK_ATTEMPT_A,
  makeProposal,
  makeReceipt,
  makeTask,
  questionThenProgressScenario,
} from "./fixtures/agentWorkScenarios.mjs";

/** Taskに紐づかないProposal（Note / Artifact等）。 */
function contentProposal(id, payloadType, overrides = {}) {
  return {
    id,
    status: "pending",
    source: "mcp",
    source_app: "codex",
    payload_type: payloadType,
    payload: { [payloadType]: [{}] },
    request: {},
    received_at: "2026-09-20T10:00:00.000Z",
    created_at: "2026-09-20T10:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function questionProposal(id, overrides = {}) {
  return makeProposal(
    id,
    {
      action: "report_blocked",
      work_attempt_id: WORK_ATTEMPT_A,
      request_id: REQUEST_MEASUREMENT,
      executor_label: "Codex",
      blocker: "測定温度が決まっていません。",
      needed_input: ["25℃と40℃のどちらで進めますか。"],
      reported_at: "2026-09-20T09:00:00.000Z",
    },
    overrides,
  );
}

test("質問・判断・成果確認・変更案を同じattention contractへ写像できる", () => {
  const task = makeTask({ work_state: "blocked", work_attempt_id: WORK_ATTEMPT_A });
  const question = questionProposal("question-1");
  const review = makeProposal("review-1", {
    action: "report_done",
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "比較表を作成しました",
    reported_at: "2026-09-20T09:20:00.000Z",
  });
  const note = contentProposal("note-1", "notes");
  const queue = buildAttentionQueue({
    tasks: [task],
    proposals: [question, review, note],
    receipts: [],
  });
  assert.deepEqual(queue.map((item) => item.kind).sort(), [
    "answer_request",
    "proposal_pending",
    "review_report",
  ]);
  // 4種類すべてが同じ形（locator・操作・時刻）を持つ。
  for (const item of queue) {
    assert.ok(item.attentionId);
    assert.ok(["ai_proposal", "work_receipt", "task"].includes(item.sourceType));
    assert.ok(item.sourceId);
    assert.ok(Array.isArray(item.availableActions) && item.availableActions.length > 0);
    assert.ok(item.questionOrAction.length > 0);
  }
  // Taskに紐づかないProposalでもtaskIdはnullで写像できる。
  const taskless = queue.find((item) => item.sourceId === "note-1");
  assert.equal(taskless.taskId, null);
  assert.equal(taskless.taskTitle, null);
  assert.equal(taskless.headline, "Noteの変更案");
  assert.ok(taskless.availableActions.includes("view_proposal"));
});

test("同じTaskの独立した判断は件数を分けて数える", () => {
  const task = makeTask({ work_state: "blocked", work_attempt_id: WORK_ATTEMPT_A });
  const question = questionProposal("question-1");
  const review = makeProposal("review-1", {
    action: "report_done",
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "比較表を作成しました",
    reported_at: "2026-09-20T09:20:00.000Z",
  });
  const queue = buildAttentionQueue({ tasks: [task], proposals: [question, review] });
  assert.equal(countAttention(queue), 2);
  assert.deepEqual(
    queue.map((item) => item.taskId),
    [TASK_ID, TASK_ID],
  );
});

test("同じreportから生じたreviewとProposalは1件にまとまる", () => {
  const task = makeTask({ work_state: "needs_human_review", work_attempt_id: WORK_ATTEMPT_A });
  const done = makeProposal("done-1", {
    action: "report_done",
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "比較表を作成しました",
    reported_at: "2026-09-20T09:20:00.000Z",
  });
  // 採用後に materialize されたReceiptが同じ判断を二重に生まない。
  const queue = buildAttentionQueue({
    tasks: [task],
    proposals: [done],
    receipts: [makeReceipt("done-1", { work_attempt_id: WORK_ATTEMPT_A })],
  });
  assert.equal(countAttention(queue), 1);
  assert.equal(queue[0].kind, "review_report");
});

test("同じ質問の再送はattention itemを増殖させない", () => {
  const task = makeTask({ work_state: "blocked", work_attempt_id: WORK_ATTEMPT_A });
  const original = questionProposal("question-1");
  const resend = questionProposal("question-1-resend", {
    received_at: "2026-09-20T09:05:00.000Z",
  });
  const queue = buildAttentionQueue({
    tasks: [task],
    proposals: [original, resend],
    receipts: [],
  });
  assert.equal(countAttention(queue), 1);
  assert.equal(queue[0].attentionId, `task-work:request:${REQUEST_MEASUREMENT}`);
});

test("解決したsourceはqueueから自然に消える", () => {
  const task = makeTask({ work_state: "accepted", work_attempt_id: WORK_ATTEMPT_A });
  const accepted = makeProposal(
    "done-1",
    {
      action: "report_done",
      work_attempt_id: WORK_ATTEMPT_A,
      summary: "比較表を作成しました",
      reported_at: "2026-09-20T09:20:00.000Z",
    },
    { status: "accepted" },
  );
  const rejected = contentProposal("note-1", "notes", { status: "rejected" });
  assert.equal(
    countAttention(buildAttentionQueue({ tasks: [task], proposals: [accepted, rejected] })),
    0,
  );
});

test("回答済みの質問はqueueから外れる", () => {
  const task = makeTask({ work_state: "blocked", work_attempt_id: WORK_ATTEMPT_A });
  const question = questionProposal("question-1");
  const reply = makeReceipt("reply-1", {
    executor_kind: "human",
    executor_label: "自分",
    receipt_kind: "human_reply",
    request_id: REQUEST_MEASUREMENT,
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "25℃で進めてください。",
  });
  const queue = buildAttentionQueue({ tasks: [task], proposals: [question], receipts: [reply] });
  assert.equal(countAttention(queue), 0);
});

test("質問と独立したNote変更案は合計2件で、一方を処理しても他方が残る", () => {
  const task = makeTask({ work_state: "blocked", work_attempt_id: WORK_ATTEMPT_A });
  const question = questionProposal("question-1");
  // Noteの変更案は作業とは独立した判断。Taskに紐づかない届き方でも2件目として残す。
  const note = contentProposal("note-1", "notes");
  const queue = buildAttentionQueue({ tasks: [task], proposals: [question, note] });
  assert.equal(countAttention(queue), 2);
  assert.deepEqual(
    queue.map((item) => item.kind),
    ["answer_request", "proposal_pending"],
  );
  assert.deepEqual(
    queue.map((item) => item.taskId),
    [TASK_ID, null],
  );

  // 質問へ回答しても、Noteの変更案は消えない。
  const reply = makeReceipt("reply-1", {
    executor_kind: "human",
    executor_label: "自分",
    receipt_kind: "human_reply",
    request_id: REQUEST_MEASUREMENT,
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "25℃で進めてください。",
  });
  const afterAnswer = buildAttentionQueue({
    tasks: [task],
    proposals: [question, note],
    receipts: [reply],
  });
  assert.equal(countAttention(afterAnswer), 1);
  assert.equal(afterAnswer[0].sourceId, "note-1");

  // Noteの変更案を却下しても、質問は消えない。
  const rejected = contentProposal("note-1", "notes", { status: "rejected" });
  const afterReject = buildAttentionQueue({ tasks: [task], proposals: [question, rejected] });
  assert.equal(countAttention(afterReject), 1);
  assert.equal(afterReject[0].kind, "answer_request");
  assert.equal(afterReject[0].requestId, REQUEST_MEASUREMENT);
});

test("Note変更案がTaskに紐づいて届いても、質問とは別の判断として残る", () => {
  const task = makeTask({ work_state: "blocked", work_attempt_id: WORK_ATTEMPT_A });
  const question = questionProposal("question-1");
  // 書き込み側がTaskへ紐づけて届けたNote変更案（`request.task_id`）。
  const note = contentProposal("note-1", "notes", { request: { task_id: TASK_ID } });
  const queue = buildAttentionQueue({ tasks: [task], proposals: [question, note] });
  assert.equal(countAttention(queue), 2);
  const noteRow = queue.find((item) => item.sourceId === "note-1");
  assert.equal(noteRow.kind, "proposal_pending");
  assert.equal(noteRow.taskId, TASK_ID);
  assert.equal(noteRow.taskTitle, "粘度測定の条件を決める");
  // 質問へ回答しても、同じTaskのNote変更案は残る。
  const reply = makeReceipt("reply-1", {
    executor_kind: "human",
    executor_label: "自分",
    receipt_kind: "human_reply",
    request_id: REQUEST_MEASUREMENT,
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "25℃で進めてください。",
  });
  const afterAnswer = buildAttentionQueue({
    tasks: [task],
    proposals: [question, note],
    receipts: [reply],
  });
  assert.equal(countAttention(afterAnswer), 1);
  assert.equal(afterAnswer[0].sourceId, "note-1");
  assert.equal(afterAnswer[0].taskId, TASK_ID);
});

test("未解決の質問の後にprogressが届いても、要対応の質問は残る", () => {
  const { task, proposals, receipts } = questionThenProgressScenario();
  const queue = buildAttentionQueue({ tasks: [task], proposals, receipts });
  assert.equal(countAttention(queue), 1);
  assert.equal(queue[0].kind, "answer_request");
  assert.equal(queue[0].requestId, REQUEST_MEASUREMENT);
  assert.equal(queue[0].taskId, TASK_ID);
});

test("削除されたsourceは成功扱いせずqueueから消える", () => {
  const task = makeTask({ work_state: "blocked", work_attempt_id: WORK_ATTEMPT_A });
  const question = questionProposal("question-1", { deleted_at: "2026-09-21T00:00:00.000Z" });
  const note = contentProposal("note-1", "notes", { deleted_at: "2026-09-21T00:00:00.000Z" });
  const queue = buildAttentionQueue({ tasks: [task], proposals: [question, note] });
  assert.equal(countAttention(queue), 0);
});

test("接続hookのAgent Session観測は要対応に数えない", () => {
  const passive = contentProposal("session-1", "agent_sessions", {
    source_app: "tasken-session-hook:codex",
  });
  assert.equal(isPassiveAgentSessionProposal(passive), true);
  assert.equal(countAttention(buildAttentionQueue({ proposals: [passive] })), 0);
  // 同じagent_sessionsでも手動の提案は判断待ちとして残す。
  const manual = contentProposal("session-2", "agent_sessions", { source_app: "codex" });
  assert.equal(isPassiveAgentSessionProposal(manual), false);
  assert.equal(countAttention(buildAttentionQueue({ proposals: [manual] })), 1);
});

test("並びは種類ごとの固定順で、同じ種類では受信の古い順にする", () => {
  const task = makeTask({ work_state: "blocked", work_attempt_id: WORK_ATTEMPT_A });
  const question = questionProposal("question-1");
  const review = makeProposal("review-1", {
    action: "report_done",
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "比較表を作成しました",
    reported_at: "2026-09-20T09:20:00.000Z",
  });
  const newer = contentProposal("note-new", "notes", {
    received_at: "2026-09-20T11:00:00.000Z",
  });
  const older = contentProposal("note-old", "notes", {
    received_at: "2026-09-20T10:00:00.000Z",
  });
  const queue = buildAttentionQueue({
    tasks: [task],
    proposals: [newer, review, older, question],
  });
  assert.deepEqual(
    queue.map((item) => item.kind),
    ["answer_request", "review_report", "proposal_pending", "proposal_pending"],
  );
  assert.deepEqual(
    queue.slice(2).map((item) => item.sourceId),
    ["note-old", "note-new"],
  );
});

test("Taskの情報がitemへ引き継がれ、元のsourceへ辿れる", () => {
  const task = makeTask({
    work_state: "blocked",
    work_attempt_id: WORK_ATTEMPT_A,
    project_id: "theme-materials",
  });
  const question = questionProposal("question-1");
  const [item] = buildAttentionQueue({
    tasks: [task],
    proposals: [question],
    themes: [{ id: "theme-materials", name: "高分子材料評価" }],
  });
  assert.equal(item.taskId, TASK_ID);
  assert.equal(item.taskTitle, "粘度測定の条件を決める");
  assert.equal(item.themeId, "theme-materials");
  assert.equal(item.themeName, "高分子材料評価");
  assert.equal(item.agentLabel, "Codex");
  assert.equal(item.workAttemptId, WORK_ATTEMPT_A);
  assert.equal(item.requestId, REQUEST_MEASUREMENT);
  assert.equal(item.sourceType, "ai_proposal");
  assert.equal(item.sourceId, "question-1");
  assert.ok(item.availableActions.includes("answer_request"));
});

test("委任もProposalも無いTaskは要対応を生まない", () => {
  const task = makeTask({ work_state: "not_delegated", intended_executor: "unassigned" });
  assert.equal(countAttention(buildAttentionQueue({ tasks: [task] })), 0);
});
