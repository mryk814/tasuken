import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

async function importBundled(relativePaths) {
  const result = await build({
    stdin: {
      contents: relativePaths
        .map((relativePath, index) => `export * as bundled${index} from "./${relativePath}";`)
        .join("\n"),
      resolveDir: process.cwd(),
    },
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

// 同じbundleから読む。別bundleに分けるとApplicationCommandErrorのinstanceofが跨げない。
const bundled = await importBundled([
  "src/main/services/applicationCommandService.ts",
  "src/main/composition/taskenCoreRuntime.ts",
  "src/shared/contracts/mobile/public.mjs",
]);
const { ApplicationCommandService } = bundled.bundled0;
const { TaskenCoreRuntime } = bundled.bundled1;
const { TASKEN_MOBILE_ENDPOINTS } = bundled.bundled2;

const AT = "2026-09-20T09:00:00.000Z";
const TASK_ID = "task-roundtrip-viscosity";
const THEME_ID = "theme-roundtrip";
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const PRINCIPAL = {
  kind: "mobile_device",
  deviceId: "device-fold-7",
  scopes: ["mobile:read", "mobile:human-review", "mobile:task-write"],
};

function command(name, payload, commandId, expectedVersions = []) {
  return {
    commandId,
    name,
    payload,
    actor: { kind: "user", id: "fixture-desktop" },
    source: "main_ui",
    expectedVersions,
    issuedAt: AT,
  };
}

function taskVersion(database) {
  return [{ type: "task", id: TASK_ID, version: database.get("task", TASK_ID).version }];
}

/**
 * 一つのTaskをDesktop・MCP・Androidで往復させる受け入れ証跡（#602 / 単位K）。
 *
 * 実SQLite + 実stdio MCP + 実mobile gatewayを同じworkspaceへ向け、
 * 「作成 → Handoff → MCP開始 → 質問 → Android回答 → MCP再取得 → 再開 → 成果報告 →
 * Desktop採用 → 明示完了」を同じTask IDで通す。
 */
async function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-roundtrip-"));
  const dbPath = path.join(root, "workspace.sqlite");
  const database = new WorkspaceDatabase(dbPath);
  database.loadWorkspace();
  database.save("theme", { id: THEME_ID, name: "往復の確認", ai_visibility: ["coding_agent"] });
  database.setPreference("artifactDirectory", path.join(root, "Canonical"));
  const application = new ApplicationCommandService(database);
  const runtime = new TaskenCoreRuntime(root, database, (envelope) =>
    application.execute(envelope),
  );
  const adapter = runtime.createMobileGateway({
    current: () => ({
      serverId: "desktop-roundtrip",
      serverRevision: database.list("change_event", true).length,
      generatedAt: new Date().toISOString(),
    }),
  });
  return { root, dbPath, database, application, adapter, runtime };
}

async function withWorkspace(run) {
  const workspace = await createWorkspace();
  const inboxPath = path.join(workspace.root, "mcp-inbox");
  // DesktopのCoreを実際に起動する。MCPは起動中のCoreを見つけて同じworkspaceへ繋ぐ。
  await workspace.runtime.start();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: {
      ...process.env,
      TASKEN_DB_PATH: workspace.dbPath,
      TASKEN_MCP_INBOX_PATH: inboxPath,
      TASKEN_USER_DATA_DIR: workspace.root,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-roundtrip-acceptance", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await run({ ...workspace, client, inboxPath });
  } finally {
    await client.close().catch(() => {});
    await workspace.runtime.stop().catch(() => {});
    workspace.database.db.close();
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
}

function mobile(suffix) {
  return {
    apiVersion: "1",
    schemaVersion: "7",
    requestId: `request-${suffix}`,
  };
}

async function readAttention(adapter) {
  const response = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.attention,
    principal: PRINCIPAL,
    query: mobile(`attention-${randomUUID()}`),
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

async function answerFromAndroid(adapter, item, body, commandId = `reply-${randomUUID()}`) {
  return adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.agentReplies,
    principal: PRINCIPAL,
    body: {
      apiVersion: 1,
      schemaVersion: 7,
      requestId: `request-${commandId}`,
      commandId,
      idempotencyKey: commandId,
      clientDeviceId: PRINCIPAL.deviceId,
      issuedAt: new Date().toISOString(),
      taskId: item.taskId,
      questionId: item.requestId,
      body,
      choiceId: null,
      expectedTaskVersion: item.taskVersion,
    },
  });
}

function adoptProposal(application, database, proposalId) {
  application.execute(
    command("ApplyTaskWorkProposal", { proposalId, decision: "accept" }, `${proposalId}:accept`, [
      { type: "task", id: TASK_ID, version: database.get("task", TASK_ID).version },
      {
        type: "ai_proposal",
        id: proposalId,
        version: database.get("ai_proposal", proposalId).version,
      },
    ]),
  );
}

test("Task一件をDesktop・MCP・Androidで往復させ、同じTask IDのまま完了する (#602)", async () => {
  await withWorkspace(async ({ database, application, adapter, client, root }) => {
    // 1. DesktopでTaskを作り、AIへ任せる（Handoff）。
    application.execute(
      command(
        "CreateTask",
        {
          task: {
            id: TASK_ID,
            title: "粘度測定の条件を決める",
            state: "todo",
            priority: "normal",
            project_id: THEME_ID,
            requester: "self",
            intended_executor: "self",
          },
        },
        "create-roundtrip",
      ),
    );
    const handoffTask = database.get("task", TASK_ID);
    application.execute(
      command(
        "UpdateTask",
        {
          task: {
            ...handoffTask,
            intended_executor: "ai_agent",
            executor_identity: "外部AI",
            work_state: "ready_for_agent",
            handoff_expected_result: "測定条件の比較表",
            handoff_instruction: "25℃と40℃を比べる",
            handoff_requested_at: AT,
          },
        },
        "handoff-roundtrip",
        taskVersion(database),
      ),
    );
    assert.equal(database.get("task", TASK_ID).work_state, "ready_for_agent");
    assert.equal(database.get("task", TASK_ID).handoff_expected_result, "測定条件の比較表");
    assert.equal(database.get("task", TASK_ID).handoff_instruction, "25℃と40℃を比べる");

    // 2. agentがMCPで作業を開始する。Task IDは同じ。
    const startVersion = database.get("task", TASK_ID).version;
    const started = await callTool(client, "tasken.start_task_work", {
      task_id: TASK_ID,
      expected_version: startVersion,
      idempotency_key: "roundtrip-start",
      caller: "Codex",
      source_session: "roundtrip-session",
      work_attempt_id: ATTEMPT_ID,
      started_at: AT,
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(database.get("task", TASK_ID).work_state, "in_progress");
    assert.equal(database.get("task", TASK_ID).work_attempt_id, ATTEMPT_ID);

    // 3. 判断できない点をMCPで質問として報告する（まだTaskは変わらない）。
    const queued = await callTool(client, "tasken.report_task_blocked", {
      task_id: TASK_ID,
      expected_version: database.get("task", TASK_ID).version,
      idempotency_key: "roundtrip-question",
      caller: "Codex",
      source_session: "roundtrip-session",
      source_app: "codex",
      work_attempt_id: ATTEMPT_ID,
      report_sequence: 0,
      executor_kind: "ai_agent",
      executor_label: "Codex",
      blocker: "測定温度が決まっていません。",
      needed_input: ["25℃と40℃のどちらで進めますか。"],
      request_id: REQUEST_ID,
      reported_at: AT,
    });
    assert.equal(database.list("work_receipt").length, 0, "質問は人の採用を待つ");
    assert.equal(database.get("task", TASK_ID).work_state, "in_progress");

    // Desktopの人が質問を採用して、回答待ちになる。
    adoptProposal(application, database, queued.proposal_id);
    assert.equal(database.get("task", TASK_ID).work_state, "blocked");

    // 4. Androidが同じ判断を要対応として受け取り、質問IDとTask版を持つ。
    const queue = await readAttention(adapter);
    assert.equal(queue.counts.needsYou, 1);
    const question = queue.attention.find((item) => item.kind === "answer_request");
    assert.ok(question, JSON.stringify(queue.attention));
    assert.equal(question.taskId, TASK_ID);
    assert.equal(question.requestId, REQUEST_ID, "質問IDはagentが送った値をそのまま使う");
    assert.equal(question.workAttemptId, ATTEMPT_ID);

    // 5. Androidから短い返答を送る。Taskは変えず、回答Receiptだけが増える。
    const beforeReply = database.get("task", TASK_ID);
    const reply = await answerFromAndroid(adapter, question, "25℃で進めてください。");
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(reply.body.data.displayState, "answered_resume_waiting");
    const afterReply = database.get("task", TASK_ID);
    assert.equal(afterReply.work_state, beforeReply.work_state);
    assert.equal(afterReply.version, beforeReply.version);
    const humanReply = database
      .list("work_receipt")
      .find((receipt) => receipt.receipt_kind === "human_reply");
    assert.ok(humanReply, "回答はWork Receiptとして残る");
    assert.equal(humanReply.summary, "25℃で進めてください。");
    assert.equal(humanReply.request_id, REQUEST_ID);
    assert.equal(humanReply.provenance.reported_via, "mobile");

    // 6. agentがMCPで回答を再取得する。往復は同じTask IDのまま。
    const resumed = await callTool(client, "tasken.get_task_context", { task_id: TASK_ID });
    assert.equal(resumed.task.id, TASK_ID);
    const receipts = resumed.related.work_receipts;
    const visibleReply = receipts.find((receipt) => receipt.receipt_kind === "human_reply");
    assert.ok(visibleReply, JSON.stringify(receipts));
    assert.equal(visibleReply.summary, "25℃で進めてください。");
    assert.equal(visibleReply.request_id, REQUEST_ID);
    assert.equal(visibleReply.work_attempt_id, ATTEMPT_ID);

    // 7. 回答後は要対応から外れる（DesktopとAndroidが同じ判断で収束する）。
    const converged = await readAttention(adapter);
    assert.equal(converged.counts.needsYou, 0);
    assert.equal(
      converged.attention.some((item) => item.requestId === REQUEST_ID),
      false,
    );

    // 8. agentが成果を報告し、Desktopの人が採用する。Taskは未完了のまま。
    const done = await callTool(client, "tasken.report_task_done", {
      task_id: TASK_ID,
      expected_version: database.get("task", TASK_ID).version,
      idempotency_key: "roundtrip-done",
      caller: "Codex",
      source_session: "roundtrip-session",
      source_app: "codex",
      work_attempt_id: ATTEMPT_ID,
      report_sequence: 1,
      executor_kind: "ai_agent",
      executor_label: "Codex",
      summary: "25℃で比較表を作成しました。",
      completed_items: ["25℃の比較表"],
      changed_or_created_items: ["docs/measurement.md"],
      verification: ["数値の再計算"],
      remaining_work: [],
      reported_at: AT,
    });
    adoptProposal(application, database, done.proposal_id);
    const adopted = database.get("task", TASK_ID);
    assert.equal(adopted.work_state, "accepted");
    assert.equal(adopted.state, "todo", "採用は完了ではない");
    assert.equal(database.get("task", TASK_ID).id, TASK_ID);

    // 9. Desktopの人が明示的に完了する。
    application.execute(
      command(
        "CompleteTask",
        { taskId: TASK_ID, completionNote: "比較表を確認して完了" },
        "complete-roundtrip",
        taskVersion(database),
      ),
    );
    const completed = database.get("task", TASK_ID);
    assert.equal(completed.id, TASK_ID);
    assert.equal(completed.state, "done");
    assert.equal(completed.work_state, "accepted");
    // 途中で作られた作業単位と回答は履歴として残る。
    assert.equal(completed.work_attempt_id, ATTEMPT_ID);
    assert.equal(
      database.list("work_receipt").filter((receipt) => receipt.receipt_kind === "human_reply")
        .length,
      1,
    );
    assert.equal(path.dirname(root), os.tmpdir());
  });
});

test("Androidの古い回答は競合として拒否し、Desktopの状態を巻き戻さない (#602 端末間競合)", async () => {
  await withWorkspace(async ({ database, application, adapter }) => {
    application.execute(
      command(
        "CreateTask",
        {
          task: {
            id: TASK_ID,
            title: "粘度測定の条件を決める",
            state: "todo",
            priority: "normal",
            project_id: THEME_ID,
            requester: "self",
            intended_executor: "ai_agent",
            work_state: "ready_for_agent",
          },
        },
        "create-conflict",
      ),
    );
    application.execute(
      command(
        "StartTaskWork",
        {
          taskId: TASK_ID,
          executorKind: "ai_agent",
          executorIdentity: "Codex",
          startedAt: AT,
          workAttemptId: ATTEMPT_ID,
        },
        "start-conflict",
        taskVersion(database),
      ),
    );
    const proposal = database.save("ai_proposal", {
      id: "conflict-question",
      source: "mcp",
      source_app: "codex",
      payload_type: "task_work",
      status: "pending",
      received_at: AT,
      created_at: AT,
      payload: {
        task_work: [
          {
            task_id: TASK_ID,
            expected_version: database.get("task", TASK_ID).version,
            caller: "Codex",
            action: "report_blocked",
            executor_label: "Codex",
            blocker: "測定温度が決まっていません。",
            summary: "測定温度が決まっていません。",
            needed_input: ["25℃と40℃のどちらで進めますか。"],
            reported_at: AT,
            work_attempt_id: ATTEMPT_ID,
            request_id: REQUEST_ID,
          },
        ],
      },
    });
    adoptProposal(application, database, proposal.id);

    const queue = await readAttention(adapter);
    const question = queue.attention.find((item) => item.requestId === REQUEST_ID);
    assert.ok(question);

    // Desktopの人が先に答える。
    application.execute(
      command(
        "ReplyToAgentRequest",
        { taskId: TASK_ID, requestId: REQUEST_ID, body: "40℃で進めてください。" },
        "desktop-reply",
        taskVersion(database),
      ),
    );

    // Androidが古い版のまま返信すると、成功にせず競合として返す。
    const stale = await answerFromAndroid(
      adapter,
      question,
      "25℃で進めてください。",
      "android-late",
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "entity_conflict");
    const replies = database
      .list("work_receipt")
      .filter((receipt) => receipt.receipt_kind === "human_reply");
    assert.equal(replies.length, 1, "遅い回答は記録を作らない");
    assert.equal(replies[0].summary, "40℃で進めてください。");
  });
});
