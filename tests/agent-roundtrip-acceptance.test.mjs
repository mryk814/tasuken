import { nodeExecPath } from "./helpers/childProcessNode.mjs";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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
]);
const { ApplicationCommandService } = bundled.bundled0;
const { TaskenCoreRuntime } = bundled.bundled1;

const AT = "2026-09-20T09:00:00.000Z";
const TASK_ID = "task-roundtrip-viscosity";
const THEME_ID = "theme-roundtrip";
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

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
 * 一つのTaskをDesktop・MCPで往復させる受け入れ証跡（#602 / 単位K）。
 *
 * 実SQLite + 実stdio MCPを同じworkspaceへ向け、
 * 「作成 → Handoff → MCP開始 → 質問 → Desktop回答 → MCP再取得 → 再開 → 成果報告 →
 * Desktop採用 → 明示完了」を同じTask IDで通す。
 * Androidからの回答（要対応と返答の受け口）は #755 束9b で外した。
 */
async function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-roundtrip-"));
  const dbPath = path.join(root, "workspace.sqlite");
  const database = new WorkspaceDatabase(dbPath);
  database.loadWorkspace();
  database.save("theme", { id: THEME_ID, name: "往復の確認" });
  database.setPreference("artifactDirectory", path.join(root, "Canonical"));
  const application = new ApplicationCommandService(database);
  // Desktopと同じく、開始はCoreの限定の入口（Themeと依頼者を問わない`any`）を通す。
  const runtime = new TaskenCoreRuntime(
    root,
    database,
    (envelope) => application.execute(envelope),
    undefined,
    undefined,
    undefined,
    undefined,
    { executeAiTaskStart: (envelope) => application.executeAiTaskStart(envelope, "any") },
  );
  return { root, dbPath, database, application, runtime };
}

async function withWorkspace(run) {
  const workspace = await createWorkspace();
  const inboxPath = path.join(workspace.root, "mcp-inbox");
  // DesktopのCoreを実際に起動する。MCPは起動中のCoreを見つけて同じworkspaceへ繋ぐ。
  await workspace.runtime.start();
  const transport = new StdioClientTransport({
    command: nodeExecPath,
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

test("Task一件をDesktop・MCPで往復させ、同じTask IDのまま完了する (#602)", async () => {
  await withWorkspace(async ({ database, application, client, root }) => {
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
    const queued = await callTool(client, "tasken.report_work", {
      status: "blocked",
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

    // 4-5. Desktopの人が質問に短く答える。Taskは変えず、回答Receiptだけが増える。
    const beforeReply = database.get("task", TASK_ID);
    application.execute(
      command(
        "ReplyToAgentRequest",
        { taskId: TASK_ID, requestId: REQUEST_ID, body: "25℃で進めてください。" },
        "desktop-reply-roundtrip",
        taskVersion(database),
      ),
    );
    const afterReply = database.get("task", TASK_ID);
    assert.equal(afterReply.work_state, beforeReply.work_state);
    assert.equal(afterReply.version, beforeReply.version);
    const humanReply = database
      .list("work_receipt")
      .find((receipt) => receipt.receipt_kind === "human_reply");
    assert.ok(humanReply, "回答はWork Receiptとして残る");
    assert.equal(humanReply.summary, "25℃で進めてください。");
    assert.equal(humanReply.request_id, REQUEST_ID);

    // 6. agentがMCPで回答を再取得する。往復は同じTask IDのまま。
    const resumed = await callTool(client, "tasken.get_task_context", { task_id: TASK_ID });
    assert.equal(resumed.task.id, TASK_ID);
    const receipts = resumed.related.work_receipts;
    const visibleReply = receipts.find((receipt) => receipt.receipt_kind === "human_reply");
    assert.ok(visibleReply, JSON.stringify(receipts));
    assert.equal(visibleReply.summary, "25℃で進めてください。");
    assert.equal(visibleReply.request_id, REQUEST_ID);
    assert.equal(visibleReply.work_attempt_id, ATTEMPT_ID);

    // 8. agentが成果を報告し、Desktopの人が採用する。Taskは未完了のまま。
    const done = await callTool(client, "tasken.report_work", {
      status: "done",
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
