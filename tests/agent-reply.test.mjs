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

function taskVersion(repo) {
  return [
    { type: "task", id: "task-viscosity", version: repo.get("task", "task-viscosity").version },
  ];
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

function startWork(service, repo, { commandId, attemptId }) {
  service.execute(
    envelope(
      "StartTaskWork",
      {
        taskId: "task-viscosity",
        executorKind: "ai_agent",
        executorIdentity: "Codex",
        startedAt: "2026-09-20T08:00:00.000Z",
        ...(attemptId ? { workAttemptId: attemptId } : {}),
      },
      commandId,
      taskVersion(repo),
    ),
  );
}

/** 停止報告（質問）を採用し、質問Receiptを残す。 */
function adoptQuestion(service, repo, { proposalId, attemptId, requestId }) {
  const task = repo.get("task", "task-viscosity");
  const proposal = repo.save("ai_proposal", {
    id: proposalId,
    source: "mcp",
    source_app: "codex",
    payload_type: "task_work",
    status: "pending",
    received_at: "2026-09-20T09:00:00.000Z",
    created_at: "2026-09-20T09:00:00.000Z",
    payload: {
      task_work: [
        {
          task_id: "task-viscosity",
          expected_version: task.version,
          caller: "Codex",
          action: "report_blocked",
          executor_label: "Codex",
          blocker: "測定温度が決まっていません。",
          summary: "測定温度が決まっていません。",
          needed_input: ["25℃と40℃のどちらで進めますか。"],
          reported_at: "2026-09-20T09:00:00.000Z",
          ...(attemptId ? { work_attempt_id: attemptId } : {}),
          ...(requestId ? { request_id: requestId } : {}),
        },
      ],
    },
  });
  service.execute(
    envelope(
      "ApplyTaskWorkProposal",
      { proposalId: proposal.id, decision: "accept" },
      `${proposal.id}:accept`,
      [
        { type: "task", id: "task-viscosity", version: repo.get("task", "task-viscosity").version },
        { type: "ai_proposal", id: proposal.id, version: proposal.version },
      ],
    ),
  );
}

function reply(service, repo, payload = {}, commandId = "reply-1", actor) {
  return service.execute(
    envelope(
      "ReplyToAgentRequest",
      {
        taskId: "task-viscosity",
        requestId: REQUEST_ID,
        body: "25℃で進めてください。",
        choiceId: "choice-25c",
        ...payload,
      },
      commandId,
      taskVersion(repo),
      actor,
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

test("人の返答は質問IDへ紐づくWork Receiptとして保存され、Taskの状態を変えない", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, { commandId: "start-a", attemptId: ATTEMPT_A });
  adoptQuestion(service, repo, {
    proposalId: "question-a",
    attemptId: ATTEMPT_A,
    requestId: REQUEST_ID,
  });
  const before = repo.get("task", "task-viscosity");
  assert.equal(before.work_state, "blocked");

  const receipt = reply(service, repo);
  assert.equal(receipt.status, "applied");

  const stored = repo.list("work_receipt").find((item) => item.receipt_kind === "human_reply");
  assert.ok(stored, "回答Receiptが保存されている");
  assert.equal(stored.receipt_kind, "human_reply");
  assert.equal(stored.executor_kind, "human");
  assert.equal(stored.summary, "25℃で進めてください。");
  assert.equal(stored.reply_choice_id, "choice-25c");
  assert.equal(stored.work_attempt_id, ATTEMPT_A);
  assert.equal(stored.runtime_metadata, undefined);

  // 回答はTaskを変えない。
  const after = repo.get("task", "task-viscosity");
  assert.equal(after.work_state, before.work_state);
  assert.equal(after.state, before.state);
  assert.equal(after.work_review_note, before.work_review_note);
});

test("回答後は「回答済み／再開待ち」になり、要対応から外れる", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, { commandId: "start-a", attemptId: ATTEMPT_A });
  adoptQuestion(service, repo, {
    proposalId: "question-a",
    attemptId: ATTEMPT_A,
    requestId: REQUEST_ID,
  });
  assert.equal(readModel(repo).state, "answer_waiting");
  assert.equal(readModel(repo).attention.length, 1);

  reply(service, repo);

  const state = readModel(repo);
  assert.equal(state.state, "answered_resume_waiting");
  assert.equal(state.attention.length, 0);
});

test("同じ回答の再送は同じ結果を返し、Receiptを増やさない", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, { commandId: "start-a", attemptId: ATTEMPT_A });
  adoptQuestion(service, repo, {
    proposalId: "question-a",
    attemptId: ATTEMPT_A,
    requestId: REQUEST_ID,
  });
  reply(service, repo);
  const replies = repo
    .list("work_receipt")
    .filter((item) => item.receipt_kind === "human_reply").length;
  const task = repo.get("task", "task-viscosity");

  // 応答を失った再送。同じ記録を返し、Entityを増やさない。
  const replayed = reply(service, repo, {}, "reply-2");

  assert.equal(replayed.status, "no_change");
  assert.equal(
    repo.list("work_receipt").filter((item) => item.receipt_kind === "human_reply").length,
    replies,
  );
  assert.deepEqual(repo.get("task", "task-viscosity"), task);
  assert.equal(readModel(repo).state, "answered_resume_waiting");
});

test("同じ質問へ違う内容を送ると競合し、既存の回答を上書きしない", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, { commandId: "start-a", attemptId: ATTEMPT_A });
  adoptQuestion(service, repo, {
    proposalId: "question-a",
    attemptId: ATTEMPT_A,
    requestId: REQUEST_ID,
  });
  reply(service, repo);

  assert.throws(
    () => reply(service, repo, { body: "40℃で進めてください。" }, "reply-other"),
    /すでに回答済みです/,
  );
  const stored = repo.list("work_receipt").find((item) => item.receipt_kind === "human_reply");
  assert.equal(stored.summary, "25℃で進めてください。");
});

test("現在有効でない質問への返答は拒否される", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, { commandId: "start-a", attemptId: ATTEMPT_A });
  adoptQuestion(service, repo, {
    proposalId: "question-a",
    attemptId: ATTEMPT_A,
    requestId: REQUEST_ID,
  });

  assert.throws(
    () =>
      reply(service, repo, { requestId: "44444444-4444-4444-8444-444444444444" }, "reply-unknown"),
    /この質問は現在有効ではありません/,
  );
  assert.equal(
    repo.list("work_receipt").filter((item) => item.receipt_kind === "human_reply").length,
    0,
  );
});

test("再割当後は前の作業単位の質問へ答えられない", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, { commandId: "start-a", attemptId: ATTEMPT_A });
  adoptQuestion(service, repo, {
    proposalId: "question-a",
    attemptId: ATTEMPT_A,
    requestId: REQUEST_ID,
  });
  // いったん回答して再開し、別の作業単位へ委任し直す。
  reply(service, repo);
  service.execute(
    envelope(
      "StartTaskWork",
      {
        taskId: "task-viscosity",
        executorKind: "ai_agent",
        executorIdentity: "Claude",
        startedAt: "2026-09-20T11:00:00.000Z",
        workAttemptId: ATTEMPT_B,
      },
      "start-b",
      taskVersion(repo),
    ),
  );
  assert.equal(repo.get("task", "task-viscosity").work_attempt_id, ATTEMPT_B);

  assert.throws(
    () =>
      reply(
        service,
        repo,
        { requestId: "55555555-5555-4555-8555-555555555555" },
        "reply-old-attempt",
      ),
    /この質問は現在有効ではありません/,
  );
});

test("agentからは返答できない", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  startWork(service, repo, { commandId: "start-a", attemptId: ATTEMPT_A });
  adoptQuestion(service, repo, {
    proposalId: "question-a",
    attemptId: ATTEMPT_A,
    requestId: REQUEST_ID,
  });

  assert.throws(
    () => reply(service, repo, {}, "reply-agent", { kind: "ai_agent" }),
    /AI agentはTaskを直接変更・完了できません/,
  );
});

test("UUIDでない質問IDは返答を拒否する", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  createAiTask(service);
  assert.throws(
    () => reply(service, repo, { requestId: "not-a-uuid" }, "reply-bad"),
    /requestIdまたはbodyが不正です/,
  );
});
