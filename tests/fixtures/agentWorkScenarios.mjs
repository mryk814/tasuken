/**
 * Agent work の状態導出で共有するfixture。
 *
 * Desktop の read model テストと、後続の Android golden fixture (#601/#602) が
 * 同じ意味の入力を参照できるように、シナリオを一箇所へ置く。
 * `docs/agent-collaboration.md` の状態導出表（§6.3）と同じ並びで読めるようにしてある。
 */

export const WORK_ATTEMPT_A = "11111111-1111-4111-8111-111111111111";
export const WORK_ATTEMPT_B = "22222222-2222-4222-8222-222222222222";
export const REQUEST_MEASUREMENT = "33333333-3333-4333-8333-333333333333";

export const TASK_ID = "task-viscosity";

export function makeTask(overrides = {}) {
  return {
    id: TASK_ID,
    title: "粘度測定の条件を決める",
    state: "doing",
    version: 7,
    intended_executor: "ai_agent",
    executor_identity: "Codex",
    work_state: "ready_for_agent",
    ...overrides,
  };
}

/**
 * 保留中の Task Work Proposal を作る。
 * `entry` は `payload.task_work[0]` に入るため、proposal contract と同じ field 名を使う。
 */
export function makeProposal(id, entry, overrides = {}) {
  return {
    id,
    status: "pending",
    source: "mcp",
    source_app: "codex",
    payload_type: "task_work",
    version: 1,
    received_at: entry.reported_at || "2026-09-20T09:00:00.000Z",
    created_at: entry.reported_at || "2026-09-20T09:00:00.000Z",
    payload: { task_work: [{ task_id: TASK_ID, expected_version: 7, caller: "Codex", ...entry }] },
    ...overrides,
  };
}

/** 採用済み Proposal から materialize された Work Receipt を作る。 */
export function makeReceipt(id, overrides = {}) {
  return {
    id,
    task_id: TASK_ID,
    executor_kind: "ai_agent",
    executor_label: "Codex",
    reported_at: "2026-09-20T09:00:00.000Z",
    created_at: "2026-09-20T09:00:00.000Z",
    summary: id,
    ...overrides,
  };
}

/** 作業単位IDを持たない旧Task。従来どおり全報告を current として扱う。 */
export function legacyScenario() {
  const task = makeTask({ work_state: "in_progress", work_started_at: "2026-09-20T08:00:00.000Z" });
  const progress = makeProposal("legacy-progress", {
    action: "append_receipt",
    summary: "条件を比較中",
    reported_at: "2026-09-20T08:30:00.000Z",
  });
  return { task, proposals: [progress], receipts: [] };
}

/** 再割当後。Agent B が作業中で、Agent A の遅い done が届く。 */
export function reassignedScenario() {
  const task = makeTask({
    work_state: "in_progress",
    work_started_at: "2026-09-20T11:00:00.000Z",
    work_attempt_id: WORK_ATTEMPT_B,
  });
  const previousAttemptDone = makeProposal("attempt-a-done", {
    action: "report_done",
    work_attempt_id: WORK_ATTEMPT_A,
    summary: "A の完了報告（遅着）",
    reported_at: "2026-09-20T12:30:00.000Z",
  });
  const acceptedA = makeReceipt("attempt-a-start", {
    work_attempt_id: WORK_ATTEMPT_A,
    reported_at: "2026-09-20T10:00:00.000Z",
    created_at: "2026-09-20T10:00:00.000Z",
    summary: "A の作業開始",
  });
  return { task, proposals: [previousAttemptDone], receipts: [acceptedA] };
}

/** 同じ作業単位で report_sequence の到着順が入れ替わった場合。 */
export function outOfOrderScenario() {
  const task = makeTask({
    work_state: "in_progress",
    work_started_at: "2026-09-20T08:00:00.000Z",
    work_attempt_id: WORK_ATTEMPT_A,
  });
  const second = makeProposal(
    "second",
    {
      action: "append_receipt",
      work_attempt_id: WORK_ATTEMPT_A,
      report_sequence: 2,
      summary: "2番目",
      reported_at: "2026-09-20T08:10:00.000Z",
    },
    { received_at: "2026-09-20T08:20:00.000Z" },
  );
  const first = makeProposal(
    "first",
    {
      action: "append_receipt",
      work_attempt_id: WORK_ATTEMPT_A,
      report_sequence: 1,
      summary: "1番目",
      reported_at: "2026-09-20T08:40:00.000Z",
    },
    { received_at: "2026-09-20T09:00:00.000Z" },
  );
  return { task, proposals: [second, first], receipts: [] };
}

/**
 * 未解決の質問の後に progress が届いた場合（受け入れシナリオの「質問とprogress」）。
 *
 * 進捗は判断ではないので、後から届いても回答待ちは消えない。
 */
export function questionThenProgressScenario() {
  const task = makeTask({
    work_state: "blocked",
    work_started_at: "2026-09-20T08:00:00.000Z",
    work_attempt_id: WORK_ATTEMPT_A,
  });
  const question = makeProposal("question-1", {
    action: "report_blocked",
    work_attempt_id: WORK_ATTEMPT_A,
    request_id: REQUEST_MEASUREMENT,
    executor_label: "Codex",
    blocker: "測定温度が決まっていません。",
    needed_input: ["25℃と40℃のどちらで進めますか。"],
    reported_at: "2026-09-20T09:00:00.000Z",
  });
  const progress = makeProposal(
    "progress-after-question",
    {
      action: "append_receipt",
      work_attempt_id: WORK_ATTEMPT_A,
      report_sequence: 2,
      summary: "比較の準備だけ先に進めました。",
      reported_at: "2026-09-20T09:30:00.000Z",
    },
    { received_at: "2026-09-20T09:35:00.000Z" },
  );
  return { task, proposals: [question, progress], receipts: [] };
}

/** 差戻しの理由。Task詳細とMCPのcontextが同じ値を持つ（#602 差戻し）。 */
export const REVISION_NOTE = "検証結果を追記してください。";

/**
 * 差戻し後（受け入れシナリオの「差戻し」）。
 *
 * `ReturnTaskWork` は理由を残し、開始時刻と報告時刻を消して開始待ちへ戻す。
 * 作業単位IDは変わらないので、やり直しの報告は同じ作業単位の current として届く。
 */
export function revisionRequestedScenario() {
  const task = makeTask({
    work_state: "ready_for_agent",
    work_started_at: null,
    work_reported_at: null,
    work_review_note: REVISION_NOTE,
    work_attempt_id: WORK_ATTEMPT_A,
  });
  const returned = makeProposal(
    "done-1",
    {
      action: "report_done",
      work_attempt_id: WORK_ATTEMPT_A,
      executor_label: "Codex",
      summary: "3条件の比較表を作成しました。",
      reported_at: "2026-09-20T09:20:00.000Z",
    },
    { status: "accepted" },
  );
  const receipt = makeReceipt("done-1", {
    work_attempt_id: WORK_ATTEMPT_A,
    reported_at: "2026-09-20T09:20:00.000Z",
    summary: "3条件の比較表を作成しました。",
    runtime_metadata: { report_kind: "done" },
  });
  return { task, proposals: [returned], receipts: [receipt] };
}

/** 同じ質問の再送。判断としては1件にまとまる。 */
export function repeatedQuestionScenario() {
  const task = makeTask({
    work_state: "blocked",
    work_started_at: "2026-09-20T08:00:00.000Z",
    work_attempt_id: WORK_ATTEMPT_A,
  });
  const entry = {
    action: "report_blocked",
    work_attempt_id: WORK_ATTEMPT_A,
    request_id: REQUEST_MEASUREMENT,
    executor_label: "Codex",
    blocker: "測定温度が決まっていません。",
    needed_input: ["25℃と40℃のどちらで進めますか。"],
    reported_at: "2026-09-20T09:00:00.000Z",
  };
  const original = makeProposal("question-1", entry, {
    received_at: "2026-09-20T09:00:00.000Z",
  });
  const resend = makeProposal("question-1-resend", entry, {
    received_at: "2026-09-20T09:05:00.000Z",
  });
  return { task, proposals: [original, resend], receipts: [] };
}
