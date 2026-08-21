import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { TASKEN_MCP_REQUIRED_CORE_CAPABILITIES, TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";

const executable = path.resolve(process.argv[2] || path.join("release", "win-unpacked", "Tasken.exe"));
if (!fs.existsSync(executable)) throw new Error("Tasken packaged executable was not found.");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-packaged-mcp-"));
const serverPath = path.join(path.dirname(executable), "resources", "mcp", "server.mjs");
if (!fs.existsSync(serverPath)) throw new Error("Packaged MCP server was not found.");

const desktop = spawn(executable, [`--user-data-dir=${root}`], {
  stdio: "ignore",
  windowsHide: true,
});
const environment = { ...process.env, TASKEN_USER_DATA_DIR: root };
const coreClient = new TaskenCoreClient({ env: environment, timeoutMs: 2_000 });

async function waitForCore() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await coreClient.inspect();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("Tasken Core did not become ready.");
}

const transport = new StdioClientTransport({
  command: process.env.TASKEN_NODE_EXEC_PATH || process.execPath,
  args: [serverPath],
  env: environment,
  stderr: "pipe",
});
const client = new Client({ name: "tasken-package-smoke", version: "1.0.0" });

try {
  const core = await waitForCore();
  for (const capability of TASKEN_MCP_REQUIRED_CORE_CAPABILITIES) {
    if (!core.capabilities.includes(capability)) throw new Error(`Packaged Core capability missing: ${capability}`);
  }
  await client.connect(transport);
  const listed = await client.listTools();
  if (listed.tools.length !== 33) throw new Error(`Expected 33 packaged MCP tools, found ${listed.tools.length}.`);
  const read = await client.callTool({ name: "tasken.list_open_items", arguments: { limit: 1 } });
  if (read.isError) throw new Error("Packaged Core rejected the MCP read.");
  const proposal = await client.callTool({
    name: "tasken.propose_note",
    arguments: {
      title: "Packaged MCP Smoke",
      body: "The packaged Desktop Core accepted this Proposal for review.",
      source_app: "package-smoke",
    },
  });
  if (proposal.isError) throw new Error("Packaged Core rejected the MCP Proposal.");
  process.stdout.write(`${JSON.stringify({ toolCount: listed.tools.length, coreCapabilityCount: core.capabilities.length, readSucceeded: true, proposalQueued: true })}\n`);
} finally {
  await client.close().catch(() => {});
  desktop.kill();
  if (desktop.exitCode === null) {
    await new Promise((resolve) => {
      desktop.once("exit", resolve);
      setTimeout(resolve, 5_000).unref();
    });
  }
  fs.rmSync(root, { recursive: true, force: true });
}
