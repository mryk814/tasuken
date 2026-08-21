import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { TASKEN_MCP_REQUIRED_CORE_CAPABILITIES, TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { TASKEN_MCP_PACKAGE_SMOKE_MARKER_FILE } from "../src/shared/taskenPaths.mjs";
import { monitorPackagedProcess, waitForPackagedReadiness } from "./mcp-package-smoke-readiness.mjs";

const executable = path.resolve(process.argv[2] || path.join("release", "win-unpacked", "Tasken.exe"));
if (!fs.existsSync(executable)) throw new Error("Tasken packaged executable was not found.");
const PACKAGED_CORE_STARTUP_TIMEOUT_MS = 90_000;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-packaged-mcp-"));
const serverPath = path.join(path.dirname(executable), "resources", "mcp", "server.mjs");
if (!fs.existsSync(serverPath)) throw new Error("Packaged MCP server was not found.");
const canonicalDbPath = path.join(root, "research-desk.sqlite");
const fakeDbPath = path.join(root, "fake-mcp.sqlite");
const legacyInboxPath = path.join(root, "mcp-inbox-must-not-exist");
const verificationPath = path.join(root, "proposal-verification.json");
const markerToken = randomBytes(32).toString("hex");
fs.writeFileSync(path.join(root, TASKEN_MCP_PACKAGE_SMOKE_MARKER_FILE), markerToken, { flag: "wx", mode: 0o600 });
const desktopArgs = [`--user-data-dir=${root}`, "--mcp-package-smoke", `--mcp-package-smoke-marker=${markerToken}`];
const desktopEnvironment = { ...process.env, TASKEN_MCP_PACKAGE_SMOKE_MARKER: markerToken };
const environment = {
  ...desktopEnvironment,
  TASKEN_USER_DATA_DIR: root,
  TASKEN_DB_PATH: fakeDbPath,
  TASKEN_MCP_INBOX_PATH: legacyInboxPath,
};
const coreClient = new TaskenCoreClient({ env: environment, timeoutMs: 2_000 });
function launchDesktop(args) {
  const child = spawn(executable, args, {
    env: desktopEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return monitorPackagedProcess(child, { redactions: [markerToken, root] });
}

let desktop = launchDesktop(desktopArgs);
let client;

async function waitForCore() {
  return waitForPackagedReadiness({
    monitor: desktop,
    probe: () => coreClient.inspect(),
    timeoutMs: PACKAGED_CORE_STARTUP_TIMEOUT_MS,
  });
}

async function connectMcp() {
  const transport = new StdioClientTransport({
    command: process.env.TASKEN_NODE_EXEC_PATH || process.execPath,
    args: [serverPath],
    env: environment,
    stderr: "pipe",
  });
  const connected = new Client({ name: "tasken-package-smoke", version: "1.0.0" });
  await connected.connect(transport);
  return connected;
}

async function stopDesktop() {
  desktop.child.kill();
  if (desktop.child.exitCode === null) {
    await new Promise((resolve) => {
      desktop.child.once("exit", resolve);
      setTimeout(resolve, 5_000).unref();
    });
  }
}

async function launchVerification(proposalId, verifyOnly = false) {
  if (fs.existsSync(verificationPath)) fs.rmSync(verificationPath);
  desktop = launchDesktop([
    ...desktopArgs,
    `--mcp-package-smoke-proposal-id=${proposalId}`,
    `--mcp-package-smoke-result-path=${verificationPath}`,
    ...(verifyOnly ? ["--mcp-package-smoke-verify-only"] : []),
  ]);
  if (!verifyOnly) return;
  const termination = await desktop.termination;
  if (termination.kind !== "exit" || termination.code !== 0 || !fs.existsSync(verificationPath)) {
    const diagnostic = desktop.diagnostic();
    throw new Error(
      `Packaged Desktop Proposal verification failed (${termination.kind === "exit" ? `exit ${termination.code}` : "spawn error"}).`
        + (diagnostic ? `\nPackaged process diagnostic:\n${diagnostic}` : ""),
    );
  }
}

try {
  const core = await waitForCore();
  for (const capability of TASKEN_MCP_REQUIRED_CORE_CAPABILITIES) {
    if (!core.capabilities.includes(capability)) throw new Error(`Packaged Core capability missing: ${capability}`);
  }
  client = await connectMcp();
  const listed = await client.listTools();
  if (listed.tools.length !== 33) throw new Error(`Expected 33 packaged MCP tools, found ${listed.tools.length}.`);

  const read = await client.callTool({
    name: "tasken.list_open_items",
    arguments: { theme_id: "theme-mcp-package-smoke", limit: 10 },
  });
  if (read.isError) throw new Error("Packaged Core rejected the MCP read.");
  const item = read.structuredContent?.items?.find((entry) => entry.id === "task-mcp-package-smoke");
  if (!item
    || item.title !== "Canonical packaged MCP task"
    || item.description !== "Read through packaged Desktop Core and bundled MCP."
    || item.status !== "todo"
    || item.priority !== "high"
    || item.theme_id !== "theme-mcp-package-smoke"
    || item.locator?.entity_id !== "task-mcp-package-smoke") {
    throw new Error("Packaged MCP read did not return the exact canonical fixture.");
  }

  const proposalArguments = {
    title: "Packaged MCP Smoke Proposal",
    body: "Pending review from the packaged MCP smoke.",
    source_app: "package-smoke",
    caller: "package-smoke-agent",
    source_session: "package-smoke-session",
    idempotency_key: "package-smoke-note-v1",
  };
  const proposal = await client.callTool({ name: "tasken.propose_note", arguments: proposalArguments });
  if (proposal.isError || proposal.structuredContent?.status !== "queued") {
    throw new Error("Packaged Core did not queue the canonical MCP Proposal.");
  }
  const proposalId = proposal.structuredContent.proposal_id;
  await client.close();
  client = undefined;
  await stopDesktop();

  await launchVerification(proposalId);
  await waitForCore();
  client = await connectMcp();
  const restartedRead = await client.callTool({
    name: "tasken.list_open_items",
    arguments: { theme_id: "theme-mcp-package-smoke", limit: 10 },
  });
  if (restartedRead.structuredContent?.items?.filter((entry) => entry.id === "task-mcp-package-smoke").length !== 1) {
    throw new Error("Canonical MCP fixture did not survive Desktop restart.");
  }
  const duplicate = await client.callTool({ name: "tasken.propose_note", arguments: proposalArguments });
  if (duplicate.isError
    || duplicate.structuredContent?.status !== "duplicate"
    || duplicate.structuredContent?.proposal_id !== proposalId) {
    throw new Error("Packaged MCP Proposal idempotency did not survive Desktop restart.");
  }
  await client.close();
  client = undefined;
  await stopDesktop();

  await launchVerification(proposalId, true);
  const verified = JSON.parse(fs.readFileSync(verificationPath, "utf8"));
  if (verified.proposal_id !== proposalId || verified.status !== "pending" || verified.matching_count !== 1) {
    throw new Error("Packaged Desktop did not verify one canonical pending Proposal.");
  }
  for (const forbiddenPath of [fakeDbPath, legacyInboxPath]) {
    if (fs.existsSync(forbiddenPath)) throw new Error(`Retired MCP persistence path was created: ${path.basename(forbiddenPath)}`);
  }
  if (!fs.existsSync(canonicalDbPath)) throw new Error("Packaged Desktop canonical database was not created.");
  process.stdout.write(`${JSON.stringify({
    toolCount: listed.tools.length,
    coreCapabilityCount: core.capabilities.length,
    readFixtureId: item.id,
    proposalId,
    proposalStatus: verified.status,
    proposalCount: verified.matching_count,
    restartReadSucceeded: true,
    duplicateSuppressed: true,
    retiredPersistenceAbsent: true,
  })}\n`);
} finally {
  await client?.close().catch(() => {});
  if (desktop.child.exitCode === null) await stopDesktop();
  fs.rmSync(root, { recursive: true, force: true });
}
