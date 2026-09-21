import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { build } from "esbuild";
import path from "node:path";
import test from "node:test";

import { deriveAgentWorkState } from "../src/shared/contracts/task/public.ts";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { ApplicationCommandService } = await importBundled(
  "src/main/services/applicationCommandService.ts",
);

const ATTEMPT_A = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_B = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

function repository() {
  const records = new Map([
    [
      "theme:theme-personal-default",
      { __type: "theme", id: "theme-personal-default", name: "個人業務", version: 1 },
    ],
  ]);
  const key = (type, id) => `${type}:${id}`;
  return {
    records,
    list(type) {
      return [...records.values()].filter((entity) => entity.__type === type);
    },
    get(type, id, includeDeleted = false) {
      const entity = records.get(key(type, id)) || null;
      return entity && (!entity.deleted_at || includeDeleted) ? entity : null;
    },
    saveMany(operations) {
      return operations.map(({ type, entity }) => {
        const current = records.get(key(type, entity.id));
        const saved = { ...entity, __type: type, version: Number(current?.version || 0) + 1 };
        records.set(key(type, entity.id), saved);
        return saved;
      });
    },
    save(type, entity) {
      return this.saveMany([{ action: "save", type, entity }])[0];
    },
    remove() {
      return null;
    },
    runTransaction(callback) {
      return callback(this);
    },
  };
}

function envelope(name, payload, commandId, expectedVersions = [], actor = { kind: "user" }) {
  return {
    commandId,
    name,
    payload,
    actor,
    source: "main_ui",
    expectedVersions,
    issuedAt: "2026-09-20T00:00:00.000Z",
  };
}

function createAiTask(service) {
  service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "task-viscosity",
          title: "粘度測定の条件を決める",
          state: "todo",
          project_id: "theme-personal-default",
          intended_executor: "ai_agent",
          requester: "self",
          work_state: "ready_for_agent",
        },
      },
      "create-ai",
    ),
  );
}

function startWork(service, repo, { commandId, attemptId, executorIdentity }) {
  const task = repo.get("task", "task-viscosity");
  return service.execute(
    envelope(
      "StartTaskWork",
      {
        taskId: task.id,
        executorKind: "ai_agent",
        executorIdentity,
        startedAt: "2026-09-20T08:00:00.000Z",
        ...(attemptId ? { workAttemptId: attemptId } : {}),
      },
      commandId,
      [{ type: "task", id: task.id, version: task.version }],
    ),
  );
}

function saveWorkProposal(repo, fields) {
  const task = repo.get("task", "task-viscosity");
  return repo.save("ai_proposal", {
    id: fields.proposalId,
    source: "mcp",
    source_app: "codex",
    payload_type: "task_work",
    status: "pending",
    received_at: fields.reportedAt,
    created_at: fields.reportedAt,
    payload: {
      task_work: [
        {
          task_id: task.id,
          expected_version: task.version,
          caller: "Codex",
          action: fields.action,
          summary: fields.summary,
          reported_at: fields.reportedAt,
          ...(fields.workAttemptId ? { work_attempt_id: fields.workAttemptId } : {}),
          ...(fields.requestId ? { request_id: fields.requestId } : {}),
          ...(fields.neededInput ? { needed_input: fields.neededInput } : {}),
          ...(fields.blocker ? { blocker: fields.blocker } : {}),
        },
      ],
    },
  });
}

function adoptWorkProposal(service, repo, proposal) {
  const task = repo.get("task", "task-viscosity");
  return service.execute(
    envelope(
      "ApplyTaskWorkProposal",
      { proposalId: proposal.id, decision: "accept" },
      `${proposal.id}:accept`,
      [
        { type: "task", id: task.id, version: task.version },
        { type: "ai_proposal", id: proposal.id, version: proposal.version },
      ],
    ),
  );
}

function readModel(repo) {
  return deriveAgentWorkState({
    task: repo.get("task", "task-viscosity"),
    proposals: repo.list("ai_proposal"),
    receipts: repo.list("work_receipt"),
  });
}

test("明示startの作業単位IDはTaskへ保存され、報告へ引き継がれる", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, {
    commandId: "start-a",
    attemptId: ATTEMPT_A,
    executorIdentity: "Codex",
  });
  assert.equal(repo.get("task", "task-viscosity").work_attempt_id, ATTEMPT_A);

  const progress = saveWorkProposal(repo, {
    proposalId: "progress-a",
    action: "append_receipt",
    summary: "条件を比較中",
    reportedAt: "2026-09-20T08:30:00.000Z",
    workAttemptId: ATTEMPT_A,
  });
  adoptWorkProposal(service, repo, progress);
  assert.equal(repo.get("work_receipt", "progress-a").work_attempt_id, ATTEMPT_A);

  const state = readModel(repo);
  assert.equal(state.workAttemptId, ATTEMPT_A);
  assert.equal(state.legacyAttemptTracking, false);
  assert.equal(state.state, "working");
  assert.equal(state.reports[0].isCurrentAttempt, true);
});

test("再割当後は前の作業単位の報告が過去の報告になり、確認待ちを復活させない", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, {
    commandId: "start-a",
    attemptId: ATTEMPT_A,
    executorIdentity: "Codex",
  });
  adoptWorkProposal(
    service,
    repo,
    saveWorkProposal(repo, {
      proposalId: "progress-a",
      action: "append_receipt",
      summary: "条件を比較中",
      reportedAt: "2026-09-20T08:30:00.000Z",
      workAttemptId: ATTEMPT_A,
    }),
  );
  startWork(service, repo, {
    commandId: "start-b",
    attemptId: ATTEMPT_B,
    executorIdentity: "Claude",
  });
  assert.equal(repo.get("task", "task-viscosity").work_attempt_id, ATTEMPT_B);

  // A の遅い完了報告が後から届く。
  saveWorkProposal(repo, {
    proposalId: "done-a-late",
    action: "report_done",
    summary: "A の完了報告",
    reportedAt: "2026-09-20T12:00:00.000Z",
    workAttemptId: ATTEMPT_A,
  });

  const state = readModel(repo);
  assert.equal(state.taskId, "task-viscosity");
  assert.equal(state.workAttemptId, ATTEMPT_B);
  assert.equal(state.state, "working");
  assert.equal(state.attention.length, 0);
  const past = state.reports.filter((report) => report.displayState === "past_attempt_report");
  assert.equal(past.length, 2);
  assert.deepEqual(new Set(past.map((report) => report.workAttemptId)), new Set([ATTEMPT_A]));
});

function reassign(service, repo, { commandId = "reassign-b", executorIdentity = "Claude" } = {}) {
  const task = repo.get("task", "task-viscosity");
  return service.execute(
    envelope(
      "ReassignTaskWork",
      { taskId: task.id, executorIdentity, reason: "相手を交代" },
      commandId,
      [{ type: "task", id: task.id, version: task.version }],
    ),
  );
}

test("明示Commandで任せ直すと新しい作業単位になり、前の相手の報告は履歴になる（#602 再割当）", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, {
    commandId: "start-a",
    attemptId: ATTEMPT_A,
    executorIdentity: "Codex",
  });
  adoptWorkProposal(
    service,
    repo,
    saveWorkProposal(repo, {
      proposalId: "progress-a",
      action: "append_receipt",
      summary: "条件を比較中",
      reportedAt: "2026-09-20T08:30:00.000Z",
      workAttemptId: ATTEMPT_A,
    }),
  );

  // 作業中でも、人間の明示操作なら委任を解除して任せ直せる。
  const receipt = reassign(service, repo);
  assert.equal(receipt.status, "applied");
  const task = repo.get("task", "task-viscosity");
  const attemptB = task.work_attempt_id;
  assert.ok(attemptB && attemptB !== ATTEMPT_A, "作業単位IDが新しくなる");
  assert.equal(task.intended_executor, "ai_agent");
  assert.equal(task.executor_identity, "Claude");
  assert.equal(task.work_state, "ready_for_agent");
  assert.equal(task.work_started_at ?? null, null);
  assert.equal(task.work_reported_at ?? null, null);

  // 前の相手の遅い完了報告は履歴として読め、現在の判断を復活させない。
  saveWorkProposal(repo, {
    proposalId: "done-a-late",
    action: "report_done",
    summary: "A の完了報告",
    reportedAt: "2026-09-20T12:00:00.000Z",
    workAttemptId: ATTEMPT_A,
  });
  const state = readModel(repo);
  assert.equal(state.workAttemptId, attemptB);
  assert.equal(state.state, "start_waiting");
  assert.equal(state.attention.length, 0);
  assert.equal(
    state.reports.some((report) => report.displayState === "past_attempt_report"),
    true,
  );

  // 任せ直しはActivityへ残る。
  const event = repo
    .list("change_event")
    .find((entry) => entry.event_kind === "task_ai_reassigned");
  assert.ok(event);
  assert.equal(event.metadata.work_action, "reassigned");
  assert.equal(event.metadata.executor_label, "Claude");
  assert.equal(event.metadata.previous_work_attempt_id, ATTEMPT_A);
  assert.equal(event.metadata.work_attempt_id, attemptB);
});

test("確認待ちの委任は任せ直せず、先に採用か差戻しを求める", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  repo.save("task", {
    ...repo.get("task", "task-viscosity"),
    work_state: "needs_human_review",
    work_attempt_id: ATTEMPT_A,
    work_reported_at: "2026-09-20T09:00:00.000Z",
  });
  assert.throws(
    () => reassign(service, repo),
    /確認待ちの委任は、先に採用か差戻しを行ってください/,
  );
  assert.equal(repo.get("task", "task-viscosity").work_attempt_id, ATTEMPT_A);
});

test("任せ直しはMCPやAI agentからは実行できない", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  const task = repo.get("task", "task-viscosity");
  assert.throws(
    () =>
      service.execute({
        ...envelope(
          "ReassignTaskWork",
          { taskId: task.id, executorIdentity: "Claude" },
          "reassign-mcp",
          [{ type: "task", id: task.id, version: task.version }],
        ),
        source: "mcp",
      }),
    /人間UIからのみ/,
  );
  assert.throws(
    () =>
      service.execute(
        envelope(
          "ReassignTaskWork",
          { taskId: task.id, executorIdentity: "Claude" },
          "reassign-ai",
          [{ type: "task", id: task.id, version: task.version }],
          { kind: "ai_agent", id: "codex" },
        ),
      ),
    /AI agentはTaskを直接変更・完了できません/,
  );
});

test("質問IDは受領したReceiptへ保存され、回答待ちの識別子になる", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, {
    commandId: "start-a",
    attemptId: ATTEMPT_A,
    executorIdentity: "Codex",
  });
  const question = saveWorkProposal(repo, {
    proposalId: "question-a",
    action: "report_blocked",
    blocker: "測定温度が決まっていません。",
    neededInput: ["25℃と40℃のどちらで進めますか。"],
    summary: "測定温度が決まっていません。",
    reportedAt: "2026-09-20T09:00:00.000Z",
    workAttemptId: ATTEMPT_A,
    requestId: REQUEST_ID,
  });
  adoptWorkProposal(service, repo, question);
  assert.equal(repo.get("work_receipt", "question-a").request_id, REQUEST_ID);

  const state = readModel(repo);
  assert.equal(state.state, "answer_waiting");
  assert.equal(state.attention.length, 1);
  assert.equal(state.attention[0].attentionId, `request:${REQUEST_ID}`);
  assert.equal(state.attention[0].kind, "answer_request");
});

test("作業単位IDを持たない従来のTaskは、これまでと同じ状態を返す", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, { commandId: "start-legacy", executorIdentity: "Codex" });
  assert.equal(repo.get("task", "task-viscosity").work_attempt_id, undefined);

  adoptWorkProposal(
    service,
    repo,
    saveWorkProposal(repo, {
      proposalId: "progress-legacy",
      action: "append_receipt",
      summary: "従来の進捗",
      reportedAt: "2026-09-20T08:30:00.000Z",
    }),
  );

  const state = readModel(repo);
  assert.equal(state.legacyAttemptTracking, true);
  assert.equal(state.state, "working");
  assert.equal(
    state.reports.every((report) => report.isCurrentAttempt),
    true,
  );
});

test("UUIDでない作業単位IDはStartTaskWorkを拒否する", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  assert.throws(
    () =>
      startWork(service, repo, {
        commandId: "start-bad",
        attemptId: "not-a-uuid",
        executorIdentity: "Codex",
      }),
    /workAttemptIdはUUIDで指定してください/,
  );
  assert.equal(repo.get("task", "task-viscosity").work_attempt_id, undefined);
});
