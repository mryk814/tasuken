import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const executable = path.resolve(process.argv[2] || path.join("release", "win-unpacked", "Tasken.exe"));
if (!fs.existsSync(executable)) {
  throw new Error(`Tasken executable not found: ${executable}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-packaged-mcp-"));
const inboxPath = path.join(root, "mcp-inbox");
const serverPath = path.join(path.dirname(executable), "resources", "mcp", "server.mjs");
if (!fs.existsSync(serverPath)) {
  throw new Error(`Packaged MCP server not found: ${serverPath}`);
}
const transport = new StdioClientTransport({
  command: executable,
  args: [serverPath],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    TASKEN_MCP_INBOX_PATH: inboxPath,
  },
  stderr: "pipe",
});
const client = new Client({ name: "tasken-package-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  for (const required of [
    "tasken.search_items",
    "tasken.export_ai_context",
    "tasken.get_task_context",
    "tasken.get_note",
    "tasken.get_conversation",
    "tasken.get_artifact_metadata",
    "tasken.get_activity_entries",
    "tasken.start_task_work",
    "tasken.append_work_receipt",
    "tasken.report_task_done",
    "tasken.report_task_blocked",
    "tasken.propose_task",
    "tasken.propose_note",
    "tasken.propose_note_edit",
    "tasken.propose_knowledge",
  ]) {
    if (!toolNames.includes(required)) throw new Error(`Packaged MCP tool missing: ${required}`);
  }
  await client.callTool({
    name: "tasken.propose_note",
    arguments: {
      title: "Packaged MCP Smoke",
      body: "The installed Tasken executable queued this Proposal.",
      source_app: "package-smoke",
    },
  });
  const proposals = fs.readdirSync(inboxPath).filter((name) => name.endsWith(".json"));
  if (proposals.length !== 1) {
    throw new Error(`Expected one packaged Proposal file, found ${proposals.length}.`);
  }
  process.stdout.write(`${JSON.stringify({
    executable,
    toolCount: toolNames.length,
    proposalQueued: true,
  })}\n`);
} finally {
  await client.close();
  fs.rmSync(root, { recursive: true, force: true });
}
