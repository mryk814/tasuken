import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { _electron as electron } from "playwright";

import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";

const executableArgument = process.argv[2] || "";
const packaged = Boolean(executableArgument);
const executablePath = packaged ? path.resolve(executableArgument) : "";
if (packaged && !fs.existsSync(executablePath)) {
  throw new Error("Tasken packaged executable was not found.");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-live-proposal-"));
fs.chmodSync(root, 0o700);
const environment = { ...process.env, TASKEN_USER_DATA_DIR: root };
const serverPath = packaged
  ? path.join(path.dirname(executablePath), "resources", "mcp", "server.mjs")
  : path.resolve("scripts", "mcp-server.mjs");
if (!fs.existsSync(serverPath)) throw new Error("Tasken MCP server was not found.");

const title = "MCP live Proposalを確認する";
const rejectedTitle = "拒否するlive Proposal";
const staleWorkSummary = "古いversionのWork Receiptは採用しない";
const recoveredWorkSummary = "最新versionで再提案したWork Receipt";
const proposalArguments = {
  idempotency_key: "electron-live-proposal-v1",
  caller: "Electron live Proposal smoke",
  source_app: "electron-live-smoke",
  title,
  description: "起動中AI Inboxへreloadなしで反映し、採用後にTaskへ収束する",
};

let electronApp;
let mcpClient;
let smokeCompleted = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCore() {
  const client = new TaskenCoreClient({ env: environment, timeoutMs: 2_000 });
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await client.inspect();
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }
  throw new Error(
    `Tasken Core did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function connectMcp() {
  const transport = new StdioClientTransport({
    command: process.env.TASKEN_NODE_EXEC_PATH || process.execPath,
    args: [serverPath],
    env: environment,
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-electron-live-smoke", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function openNavigation(page, label) {
  await page.getByText(label, { exact: true }).first().click();
}

async function waitForPendingCount(page, expected) {
  await page.waitForFunction(
    (count) =>
      document.querySelector(".proposal-pending-count")?.textContent?.trim() === `${count}件`,
    expected,
    { timeout: 15_000 },
  );
}

async function waitForWorkProposalDecision(page) {
  const outcomeHandle = await page.waitForFunction(
    () => {
      if (document.querySelector(".proposal-pending-count")?.textContent?.trim() === "0件") {
        return { status: "accepted" };
      }
      const message = document.querySelector(".toast-message")?.textContent?.trim() || "";
      return message.includes("Work proposalを採用できませんでした")
        ? { status: "error", message }
        : false;
    },
    undefined,
    { timeout: 15_000 },
  );
  const outcome = await outcomeHandle.jsonValue();
  assert.equal(outcome.status, "accepted", outcome.message || "Work proposal was not accepted.");
}

async function bodyText(page) {
  return page.locator("body").innerText();
}

async function callMcp(toolName, arguments_) {
  assert.ok(mcpClient, "Tasken MCP client is not connected.");
  const result = await mcpClient.callTool({ name: toolName, arguments: arguments_ });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.ok(
    result.structuredContent && typeof result.structuredContent === "object",
    `${toolName} did not return structured content.`,
  );
  return result.structuredContent;
}

async function getTaskContext(taskId) {
  const context = await callMcp("tasken.get_task_context", {
    task_id: taskId,
    include: ["work_receipts"],
  });
  assert.equal(context.task?.id, taskId);
  assert.ok(Array.isArray(context.related?.work_receipts));
  return context;
}

function workReceiptArguments({ taskId, expectedVersion, idempotencyKey, summary }) {
  return {
    task_id: taskId,
    expected_version: expectedVersion,
    idempotency_key: idempotencyKey,
    caller: "Electron live Proposal smoke",
    source_session: "electron-live-proposal-task-work",
    source_app: "electron-live-smoke",
    executor_kind: "ai_agent",
    executor_label: "Electron live smoke",
    summary,
    completed_items: ["AI InboxのTask Work Proposalを確認"],
    changed_or_created_items: ["Work Receipt"],
    verification: ["実Electronとstdio MCPの縦断確認"],
    remaining_work: [],
    reported_at: new Date().toISOString(),
  };
}

function startTaskWorkArguments(taskId, expectedVersion) {
  return {
    task_id: taskId,
    expected_version: expectedVersion,
    idempotency_key: "electron-live-task-work-start-v1",
    caller: "Electron live Proposal smoke",
    source_session: "electron-live-proposal-task-work",
    source_app: "electron-live-smoke",
    executor_kind: "ai_agent",
    executor_identity: "electron-live-smoke",
    started_at: new Date().toISOString(),
  };
}

async function closeElectron() {
  if (!electronApp) return;
  const processHandle = electronApp.process();
  const closed = await Promise.race([
    electronApp.close().then(() => true),
    delay(10_000).then(() => false),
  ]);
  if (!closed && processHandle.exitCode === null) processHandle.kill();
  electronApp = undefined;
  assert.equal(closed, true, "Tasken did not close within ten seconds.");
}

try {
  electronApp = await electron.launch({
    ...(packaged ? { executablePath } : {}),
    args: [
      ...(packaged ? [] : ["."]),
      "--disable-gpu",
      "--disable-gpu-compositing",
      `--user-data-dir=${root}`,
    ],
    cwd: process.cwd(),
    env: environment,
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByText("Today", { exact: true }).first().waitFor();

  const core = await waitForCore();
  assert.equal(String(core.api_version), "1");
  mcpClient = await connectMcp();

  await openNavigation(page, "AI Inbox");
  await waitForPendingCount(page, 0);
  const routeBeforeProposal = await page.evaluate(() => location.hash);

  const queued = await mcpClient.callTool({
    name: "tasken.propose_task",
    arguments: proposalArguments,
  });
  assert.equal(queued.isError, undefined);
  assert.equal(queued.structuredContent?.status, "queued");
  const proposalId = queued.structuredContent?.proposal_id;
  assert.equal(typeof proposalId, "string");
  await waitForPendingCount(page, 1);
  assert.equal(await page.evaluate(() => location.hash), routeBeforeProposal);

  const duplicate = await mcpClient.callTool({
    name: "tasken.propose_task",
    arguments: proposalArguments,
  });
  assert.equal(duplicate.structuredContent?.status, "duplicate");
  assert.equal(duplicate.structuredContent?.proposal_id, proposalId);
  await waitForPendingCount(page, 1);

  const conflict = await mcpClient.callTool({
    name: "tasken.propose_task",
    arguments: { ...proposalArguments, title: "同じkeyで異なる内容" },
  });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent?.error?.code, "IDEMPOTENCY_CONFLICT");
  assert.match(conflict.structuredContent?.error?.next_action || "", /idempotency_key/);
  await waitForPendingCount(page, 1);

  await openNavigation(page, "Settings");
  await page.getByText("Context & MCP", { exact: true }).click();
  await page.getByRole("button", { name: "状態を再確認" }).click();
  await page.waitForFunction(
    (id) =>
      document.body.innerText.includes("Core\n接続済み") && document.body.innerText.includes(id),
    proposalId,
    { timeout: 15_000 },
  );
  const diagnosticsText = await bodyText(page);
  assert.match(diagnosticsText, /Pending Proposal\n1件/);
  assert.doesNotMatch(diagnosticsText, /API key|AI Provider|OpenAI/);

  await openNavigation(page, "AI Inbox");
  await page.locator(".proposal-inbox-row").getByRole("button", { name: "Preview" }).click();
  assert.match(await page.locator(".proposal-preview-panel").innerText(), new RegExp(title));
  await page.getByRole("button", { name: "採用を保存" }).click();
  await waitForPendingCount(page, 0);
  assert.doesNotMatch(await bodyText(page), /Proposalを採用できませんでした/);

  await openNavigation(page, "ToDo");
  await page.getByText(title, { exact: true }).waitFor();
  assert.equal(await page.getByText(title, { exact: true }).count(), 1);

  const taskSearch = await callMcp("tasken.search_items", { query: title, limit: 10 });
  const taskItem = taskSearch.items?.find(
    (item) => item.title === title && item.locator?.tool === "tasken.get_task_context",
  );
  assert.ok(taskItem, "Accepted Task was not discoverable through tasken.search_items.");
  const taskId = taskItem.locator.arguments?.task_id;
  assert.equal(typeof taskId, "string");
  const initialTaskContext = await getTaskContext(taskId);
  const initialTaskVersion = Number(initialTaskContext.task.version);
  assert.ok(
    Number.isInteger(initialTaskVersion) && initialTaskVersion > 0,
    "Accepted Task needs a positive version for the stale-version journey.",
  );

  const startWork = await callMcp(
    "tasken.start_task_work",
    startTaskWorkArguments(taskId, initialTaskVersion),
  );
  assert.equal(startWork.status, "queued");
  await openNavigation(page, "AI Inbox");
  await waitForPendingCount(page, 1);
  await page.locator(".proposal-inbox-row").getByRole("button", { name: "Preview" }).click();
  await page.locator(".proposal-preview-panel").getByRole("button", { name: "採用を保存" }).click();
  await waitForWorkProposalDecision(page);
  const workingTaskContext = await getTaskContext(taskId);
  const workingTaskVersion = Number(workingTaskContext.task.version);
  assert.ok(
    Number.isInteger(workingTaskVersion) && workingTaskVersion > initialTaskVersion,
    "Starting Task Work must advance the Task version.",
  );

  const staleWorkArguments = workReceiptArguments({
    taskId,
    expectedVersion: workingTaskVersion - 1,
    idempotencyKey: "electron-live-task-work-stale-v1",
    summary: staleWorkSummary,
  });
  const staleWork = await callMcp("tasken.append_work_receipt", staleWorkArguments);
  assert.equal(staleWork.status, "queued");
  await waitForPendingCount(page, 1);
  await page.locator(".proposal-inbox-row").getByRole("button", { name: "Preview" }).click();
  await page.locator(".proposal-preview-panel").getByRole("button", { name: "採用を保存" }).click();
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        text.includes("Taskが更新されています") &&
        text.includes("tasken.get_task_context") &&
        text.includes("最新version") &&
        text.includes("新しいidempotency_key")
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  const previewReject = page
    .locator(".proposal-preview-panel")
    .getByRole("button", { name: "拒否する" });
  if (await previewReject.count()) await previewReject.click();
  else await page.locator(".proposal-inbox-row").getByText("拒否する", { exact: true }).click();
  await waitForPendingCount(page, 0);

  const refreshedTaskContext = await getTaskContext(taskId);
  const refreshedTaskVersion = Number(refreshedTaskContext.task.version);
  assert.ok(Number.isInteger(refreshedTaskVersion) && refreshedTaskVersion >= workingTaskVersion);
  const recoveredWorkArguments = workReceiptArguments({
    taskId,
    expectedVersion: refreshedTaskVersion,
    idempotencyKey: "electron-live-task-work-recovered-v1",
    summary: recoveredWorkSummary,
  });
  const recoveredWork = await callMcp("tasken.append_work_receipt", recoveredWorkArguments);
  assert.equal(recoveredWork.status, "queued");
  await waitForPendingCount(page, 1);
  await page.locator(".proposal-inbox-row").getByRole("button", { name: "Preview" }).click();
  await page.locator(".proposal-preview-panel").getByRole("button", { name: "採用を保存" }).click();
  await waitForWorkProposalDecision(page);

  const duplicateRecoveredWork = await callMcp(
    "tasken.append_work_receipt",
    recoveredWorkArguments,
  );
  assert.equal(duplicateRecoveredWork.status, "duplicate");
  assert.equal(duplicateRecoveredWork.proposal_id, recoveredWork.proposal_id);
  await waitForPendingCount(page, 0);

  const finalTaskContext = await getTaskContext(taskId);
  const recoveredReceipts = finalTaskContext.related.work_receipts.filter(
    (receipt) => receipt.summary === recoveredWorkSummary,
  );
  assert.equal(recoveredReceipts.length, 1);
  assert.equal(
    finalTaskContext.related.work_receipts.some((receipt) => receipt.summary === staleWorkSummary),
    false,
  );

  const rejected = await mcpClient.callTool({
    name: "tasken.propose_task",
    arguments: {
      ...proposalArguments,
      idempotency_key: "electron-live-proposal-reject-v1",
      title: rejectedTitle,
    },
  });
  assert.equal(rejected.structuredContent?.status, "queued");
  await waitForPendingCount(page, 1);
  await page.locator(".proposal-inbox-row").getByText("拒否する", { exact: true }).click();
  await waitForPendingCount(page, 0);

  await openNavigation(page, "ToDo");
  assert.equal(await page.getByText(rejectedTitle, { exact: true }).count(), 0);

  await mcpClient.close();
  mcpClient = undefined;
  await closeElectron();
  smokeCompleted = true;

  console.log(
    JSON.stringify({
      mode: packaged ? "packaged" : "development",
      liveWithoutReload: true,
      duplicateSuppressed: true,
      conflictGuidance: true,
      acceptedTaskVisible: true,
      taskWorkStarted: true,
      staleTaskWorkGuidance: true,
      staleTaskWorkRecovered: true,
      taskWorkAppliedOnce: true,
      rejectedTaskAbsent: true,
      embeddedProviderSurfaceAbsent: true,
    }),
  );
} finally {
  await mcpClient?.close().catch(() => {});
  if (electronApp) await closeElectron().catch(() => {});
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedRoot = path.resolve(root);
  if (
    path.dirname(resolvedRoot) === tempRoot &&
    path.basename(resolvedRoot).startsWith("tasken-live-proposal-")
  ) {
    if (smokeCompleted) {
      fs.rmSync(resolvedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } else {
      console.error(`Live Proposal smoke failed; preserving diagnostics at ${resolvedRoot}`);
    }
  }
}
