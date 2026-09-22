import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import os from "node:os";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
      export { TaskenCoreRuntime } from "./src/main/composition/taskenCoreRuntime.ts";
      export { TASKEN_MOBILE_ENDPOINTS } from "./src/shared/contracts/mobile/public.mjs";
      export {
        mobileAttentionResponseSchema,
        mobileAgentReplyRequestSchema,
        mobileAgentReplyResponseSchema,
      } from "./src/shared/contracts/mobile/public.ts";
      export { deriveAgentWorkState, buildAttentionQueue } from "./src/shared/contracts/task/public.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});

const {
  ApplicationCommandService,
  TaskenCoreRuntime,
  TASKEN_MOBILE_ENDPOINTS,
  mobileAttentionResponseSchema,
  mobileAgentReplyRequestSchema,
  mobileAgentReplyResponseSchema,
  deriveAgentWorkState,
  buildAttentionQueue,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const now = "2026-09-20T10:00:00.000Z";
const ATTEMPT_A = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_B = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const QUESTION_TASK = "task-viscosity";
const WORKING_TASK = "task-working";
const QUEUED_TASK = "task-queued";

const principal = {
  kind: "mobile_device",
  deviceId: "device-fold-7",
  scopes: ["mobile:read", "mobile:human-review"],
};

class MemoryRepository {
  constructor() {
    this.records = new Map();
    this.records.set("theme:theme-materials", {
      type: "theme",
      id: "theme-materials",
      name: "高分子材料評価",
      version: 1,
    });
  }

  list(type, includeDeleted = false) {
    return [...this.records.values()].filter(
      (entity) => entity.type === type && (includeDeleted || !entity.deleted_at),
    );
  }

  get(type, id, includeDeleted = false) {
    const entity = this.records.get(`${type}:${id}`) || null;
    return entity && (includeDeleted || !entity.deleted_at) ? { ...entity } : null;
  }

  save(type, entity) {
    return this.saveMany([{ action: "save", type, entity }])[0];
  }

  saveMany(operations) {
    return operations.map(({ type, entity }) => {
      const current = this.records.get(`${type}:${entity.id}`);
      const saved = {
        ...entity,
        type,
        version: Number(current?.version || 0) + 1,
        source: entity.source || "manual",
        created_at: entity.created_at || current?.created_at || now,
        updated_at: now,
        deleted_at: entity.deleted_at || null,
      };
      this.records.set(`${type}:${entity.id}`, saved);
      return { ...saved };
    });
  }

  remove(type, id) {
    const current = this.records.get(`${type}:${id}`);
    if (!current) return null;
    const deleted = { ...current, deleted_at: now, version: Number(current.version) + 1 };
    this.records.set(`${type}:${id}`, deleted);
    return deleted;
  }

  runTransaction(callback) {
    return callback(this);
  }
}

function envelope(name, payload, commandId, expectedVersions = []) {
  return {
    commandId,
    name,
    payload,
    actor: { kind: "user" },
    source: "main_ui",
    expectedVersions,
    issuedAt: now,
  };
}

function taskVersion(repo, taskId) {
  return [{ type: "task", id: taskId, version: repo.get("task", taskId).version }];
}

/** agentへ委任したTaskを3つ用意する。質問待ち・作業中・開始待ちを1件ずつ。 */
function workspace() {
  const repository = new MemoryRepository();
  const application = new ApplicationCommandService(repository);
  for (const [id, title, workState] of [
    [QUESTION_TASK, "粘度測定の条件を決める", "blocked"],
    [WORKING_TASK, "劣化試験の計画", "ready_for_agent"],
    [QUEUED_TASK, "粘度データの整理", "ready_for_agent"],
  ]) {
    application.execute(
      envelope(
        "CreateTask",
        {
          task: {
            id,
            title,
            state: "todo",
            project_id: "theme-materials",
            intended_executor: "ai_agent",
            requester: "self",
            work_state: workState,
          },
        },
        `create-${id}`,
      ),
    );
  }
  application.execute(
    envelope(
      "StartTaskWork",
      {
        taskId: QUESTION_TASK,
        executorKind: "ai_agent",
        executorIdentity: "Codex",
        startedAt: "2026-09-20T08:00:00.000Z",
        workAttemptId: ATTEMPT_A,
      },
      "start-question",
      taskVersion(repository, QUESTION_TASK),
    ),
  );
  application.execute(
    envelope(
      "StartTaskWork",
      {
        taskId: WORKING_TASK,
        executorKind: "ai_agent",
        executorIdentity: "Codex",
        startedAt: "2026-09-20T08:30:00.000Z",
        workAttemptId: ATTEMPT_B,
      },
      "start-working",
      taskVersion(repository, WORKING_TASK),
    ),
  );
  // 質問は「停止報告を採用した」という既存経路で作る。mobile専用の近道は作らない。
  const proposal = repository.save("ai_proposal", {
    id: "question-a",
    source: "mcp",
    source_app: "codex",
    payload_type: "task_work",
    status: "pending",
    received_at: "2026-09-20T09:10:00.000Z",
    created_at: "2026-09-20T09:10:00.000Z",
    payload: {
      task_work: [
        {
          task_id: QUESTION_TASK,
          expected_version: repository.get("task", QUESTION_TASK).version,
          caller: "Codex",
          action: "report_blocked",
          executor_label: "Codex",
          blocker: "測定温度が決まっていません。",
          summary: "測定温度が決まっていません。",
          needed_input: ["25℃と40℃のどちらで進めますか。"],
          reported_at: "2026-09-20T09:10:00.000Z",
          work_attempt_id: ATTEMPT_A,
          request_id: REQUEST_ID,
        },
      ],
    },
  });
  application.execute(
    envelope(
      "ApplyTaskWorkProposal",
      { proposalId: proposal.id, decision: "accept" },
      "question-a:accept",
      [
        { type: "task", id: QUESTION_TASK, version: repository.get("task", QUESTION_TASK).version },
        { type: "ai_proposal", id: proposal.id, version: proposal.version },
      ],
    ),
  );
  const runtime = new TaskenCoreRuntime(os.tmpdir(), repository, (command) =>
    application.execute(command),
  );
  const adapter = runtime.createMobileGateway({
    current: () => ({ serverId: "desktop-home", serverRevision: 42, generatedAt: now }),
  });
  return { repository, application, adapter };
}

function attentionQuery(overrides = {}) {
  return {
    apiVersion: "1",
    schemaVersion: "7",
    requestId: "request-attention",
    ...overrides,
  };
}

function readAttention(adapter, query = {}) {
  return adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.attention,
    principal,
    query: attentionQuery(query),
  });
}

function replyRequest(repository, overrides = {}) {
  const commandId = overrides.commandId || "reply-1";
  return {
    apiVersion: 1,
    schemaVersion: 7,
    requestId: `request-${commandId}`,
    commandId,
    idempotencyKey: commandId,
    clientDeviceId: principal.deviceId,
    issuedAt: now,
    taskId: QUESTION_TASK,
    questionId: REQUEST_ID,
    body: "25℃で進めてください。",
    choiceId: "choice-25c",
    expectedTaskVersion: repository.get("task", QUESTION_TASK).version,
    ...overrides,
  };
}

function postReply(adapter, body) {
  return adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.agentReplies,
    principal,
    body: mobileAgentReplyRequestSchema.parse(body),
  });
}

test("Androidの要対応はDesktopと同じ導出で、判断単位の件数を返す（#601）", async () => {
  const { repository, adapter } = workspace();
  const response = await readAttention(adapter);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  mobileAttentionResponseSchema.parse(response.body);
  const { attention, counts, truncated } = response.body.data;

  // Desktopと同じ導出をそのまま使う。mobile側の独自解釈を挟まない。
  const desktop = buildAttentionQueue({
    tasks: repository.list("task"),
    proposals: repository.list("ai_proposal"),
    receipts: repository.list("work_receipt"),
    themes: repository.list("theme"),
  });
  assert.deepEqual(
    attention.map((item) => item.attentionId),
    desktop.map((item) => item.attentionId),
  );
  assert.equal(counts.needsYou, 1);
  assert.equal(counts.working, 1);
  assert.equal(counts.queued, 1);
  assert.equal(truncated, false);

  const question = attention.find((item) => item.kind === "answer_request");
  assert.equal(question.taskId, QUESTION_TASK);
  assert.equal(question.requestId, REQUEST_ID);
  assert.equal(question.workAttemptId, ATTEMPT_A);
  assert.equal(question.taskVersion, repository.get("task", QUESTION_TASK).version);
  assert.equal(question.themeName, "高分子材料評価");
});

test("要対応の取得はscope・引数・上限を検証する（#601）", async () => {
  const { repository, adapter } = workspace();
  // 判断が上限を超えたら truncated で示す。0件と「取得できていない」を混同させない。
  repository.save("ai_proposal", {
    id: "note-proposal",
    source: "mcp",
    source_app: "codex",
    payload_type: "notes",
    status: "pending",
    request: {},
    received_at: now,
    created_at: now,
  });
  const limited = await readAttention(adapter, { limit: "1" });
  assert.equal(limited.status, 200);
  assert.equal(limited.body.data.attention.length, 1);
  assert.equal(limited.body.data.truncated, true);
  // 切り詰めても件数は判断の総数のまま。
  assert.equal(limited.body.data.counts.needsYou, 2);

  const noScope = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.attention,
    principal: { ...principal, scopes: ["mobile:human-review"] },
    query: attentionQuery(),
  });
  assert.equal(noScope.status, 403);

  const unknownKey = await readAttention(adapter, { taskId: QUESTION_TASK });
  assert.equal(unknownKey.status, 400);
  assert.equal(unknownKey.body.error.code, "validation_failed");

  const badVersion = await readAttention(adapter, { schemaVersion: "6" });
  assert.equal(badVersion.status, 400);
  const zeroLimit = await readAttention(adapter, { limit: "0" });
  assert.equal(zeroLimit.status, 400);
});

test("Androidからの回答はTaskを変えず、要対応から外れる（#601）", async () => {
  const { repository, adapter } = workspace();
  const before = repository.get("task", QUESTION_TASK);

  const response = await postReply(adapter, replyRequest(repository));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  mobileAgentReplyResponseSchema.parse(response.body);
  assert.equal(response.body.data.commandStatus, "applied");
  assert.equal(response.body.data.taskId, QUESTION_TASK);
  assert.equal(response.body.data.questionId, REQUEST_ID);
  assert.equal(response.body.data.displayState, "answered_resume_waiting");
  assert.equal(response.body.data.taskVersion, before.version);

  const stored = repository
    .list("work_receipt")
    .find((receipt) => receipt.receipt_kind === "human_reply");
  assert.ok(stored, "回答Receiptが保存されている");
  assert.equal(stored.summary, "25℃で進めてください。");
  assert.equal(stored.reply_choice_id, "choice-25c");
  assert.equal(stored.request_id, REQUEST_ID);
  assert.equal(stored.work_attempt_id, ATTEMPT_A);
  // どこから答えたかを取り違えない。
  assert.equal(stored.provenance.reported_via, "mobile");

  // 回答はTaskを変えない。
  const after = repository.get("task", QUESTION_TASK);
  assert.equal(after.work_state, before.work_state);
  assert.equal(after.state, before.state);
  assert.equal(after.version, before.version);
  assert.equal(
    deriveAgentWorkState({
      task: after,
      proposals: repository.list("ai_proposal"),
      receipts: repository.list("work_receipt"),
    }).state,
    "answered_resume_waiting",
  );

  // 表示状態と要対応の消え方が一致する。
  const reloaded = await readAttention(adapter);
  assert.equal(reloaded.body.data.counts.needsYou, 0);
  assert.equal(reloaded.body.data.counts.working, 1);
  assert.equal(
    reloaded.body.data.attention.some((item) => item.requestId === REQUEST_ID),
    false,
  );
});

test("応答を失った再送は同じ結果を返し、回答を増やさない（#601）", async () => {
  const { repository, adapter } = workspace();
  const request = replyRequest(repository);
  const first = await postReply(adapter, request);
  assert.equal(first.status, 200);
  const receiptCount = repository
    .list("work_receipt")
    .filter((receipt) => receipt.receipt_kind === "human_reply").length;

  // 同じcommandIdの再送。同じreceiptを返し、Entityを増やさない。
  const replay = await postReply(adapter, request);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.commandStatus, "applied");
  assert.deepEqual(replay.body.data, first.body.data);

  // 届いたか分からないまま新しいcommandIdで送り直した場合も、回答は増えない。
  const resent = await postReply(adapter, replyRequest(repository, { commandId: "reply-1b" }));
  assert.equal(resent.status, 200);
  assert.equal(resent.body.data.commandStatus, "no_change");
  assert.equal(
    repository.list("work_receipt").filter((receipt) => receipt.receipt_kind === "human_reply")
      .length,
    receiptCount,
  );
});

test("回答済み・古いTask版・scope不足は成功として返さない（#601）", async () => {
  const { repository, adapter } = workspace();
  const request = replyRequest(repository);
  assert.equal((await postReply(adapter, request)).status, 200);

  // 二度目の回答は別commandIdでも競合にする。黙って上書きしない。
  const second = await postReply(
    adapter,
    replyRequest(repository, { commandId: "reply-2", body: "40℃に変えてください。" }),
  );
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, "entity_conflict");
  assert.equal(
    repository.list("work_receipt").filter((receipt) => receipt.receipt_kind === "human_reply")
      .length,
    1,
  );
  assert.equal(
    repository.list("work_receipt").find((receipt) => receipt.receipt_kind === "human_reply")
      .summary,
    "25℃で進めてください。",
  );

  const stale = await postReply(
    adapter,
    replyRequest(repository, { commandId: "reply-3", expectedTaskVersion: 0 }),
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "entity_conflict");

  const wrongDevice = await postReply(adapter, {
    ...replyRequest(repository, { commandId: "reply-4" }),
    clientDeviceId: "device-other",
  });
  assert.equal(wrongDevice.status, 400);

  const noScope = await adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.agentReplies,
    principal: { ...principal, scopes: ["mobile:read"] },
    body: mobileAgentReplyRequestSchema.parse(replyRequest(repository, { commandId: "reply-5" })),
  });
  assert.equal(noScope.status, 403);
});
