import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function occurrences(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function toolBlock(value, toolName) {
  const marker = `server.registerTool("${toolName}"`;
  const start = value.indexOf(marker);
  assert.notEqual(start, -1, `${toolName} registration`);
  const next = value.indexOf("server.registerTool(", start + marker.length);
  return value.slice(start, next === -1 ? value.length : next);
}

const readTools = [
  "tasken.search_items",
  "tasken.list_open_items",
  "tasken.list_agent_ready_tasks",
  "tasken.get_task_assignment",
  "tasken.get_task_context",
  "tasken.get_note",
  "tasken.get_conversation",
  "tasken.get_artifact_metadata",
  "tasken.get_activity_entries",
  "tasken.resolve_repository_context",
  "tasken.find_themes_for_repository",
  "tasken.find_tasks_for_repository",
  "tasken.get_repository_context",
  "tasken.get_theme_context",
  "tasken.get_recent_notes",
  "tasken.search_knowledge",
  "tasken.get_knowledge_context",
  "tasken.get_plan_health",
  "tasken.get_knowledge_health",
  "tasken.get_activity",
  "tasken.get_context_subgraph",
  "tasken.export_ai_context",
];

const proposalTools = [
  "tasken.start_task_work",
  "tasken.append_work_receipt",
  "tasken.report_task_done",
  "tasken.report_task_blocked",
  "tasken.propose_repository_context",
  "tasken.propose_task",
  "tasken.propose_note",
  "tasken.propose_note_edit",
  "tasken.propose_knowledge",
  "tasken.propose_sketch",
  "tasken.propose_artifact",
];

test("#413 characterization fixes the current MCP native/runtime inventory", () => {
  const launcher = source("scripts/tasken-mcp-launcher.mjs");
  const serverEntrypoint = source("scripts/mcp-server.mjs");
  const runtime = source("scripts/mcp-runtime.mjs");
  const doctor = source("scripts/mcp-doctor.mjs");
  const packageSmoke = source("scripts/mcp-package-smoke.mjs");
  const bridgeBuild = source("scripts/build-mcp-bridge.mjs");
  const packageJson = source("package.json");
  const mcpServer = source("src/main/mcp/server.mjs");
  const readOnlyContext = source("src/main/mcp/readOnlyContext.mjs");
  const proposalInbox = source("src/main/mcp/proposalInbox.mjs");
  const workspaceService = source("src/main/services/workspaceService.ts");
  const main = source("src/main/index.ts");

  assert.match(launcher, /ELECTRON_RUN_AS_NODE/);
  assert.match(launcher, /electronExecutable/);
  assert.match(serverEntrypoint, /isElectronAsNodeRuntime/);
  assert.match(serverEntrypoint, /src\/main\/mcp\/server\.mjs/);
  assert.match(runtime, /better-sqlite3/);
  assert.match(runtime, /resolveTaskenDatabasePath/);
  assert.match(runtime, /NATIVE_BINDING_(?:NODE|ELECTRON)_ABI_MISMATCH/);
  assert.match(doctor, /better-sqlite3/);
  assert.match(doctor, /ELECTRON_RUN_AS_NODE/);
  assert.match(doctor, /probeNode/);
  assert.match(packageSmoke, /ELECTRON_RUN_AS_NODE/);
  assert.match(packageSmoke, /TASKEN_MCP_INBOX_PATH/);
  assert.match(bridgeBuild, /external:\s*\["better-sqlite3"\]/);
  assert.match(packageJson, /"mcp":\s*"node scripts\/tasken-mcp-launcher\.mjs"/);
  assert.match(packageJson, /"better-sqlite3"/);
  assert.match(packageJson, /"from":\s*"mcp-dist"/);

  // Read tool registration is already Core-only on this baseline. These
  // assertions also prevent a future cleanup from silently reintroducing the
  // legacy context as a fallback while #413 is being completed.
  assert.equal(readTools.length, 22);
  for (const toolName of readTools) {
    const block = toolBlock(mcpServer, toolName);
    assert.match(block, /withCoreClient/);
    assert.doesNotMatch(block, /withReadContext|readContextProvider|ReadOnlyTaskenContext/);
  }
  assert.match(mcpServer, /readOnlyContextModulePromise/);
  assert.match(mcpServer, /defaultReadContextProvider/);
  assert.match(mcpServer, /withReadContext/);
  assert.match(mcpServer, /queueMcpProposal/);

  assert.match(readOnlyContext, /class ReadOnlyTaskenContext/);
  assert.match(readOnlyContext, /better-sqlite3/);
  assert.match(readOnlyContext, /resolveTaskenDatabasePath/);
  assert.match(proposalInbox, /function queueMcpProposal/);
  assert.match(proposalInbox, /class McpProposalInboxService/);
  assert.match(proposalInbox, /mcp-inbox/);

  assert.match(workspaceService, /ReadOnlyTaskenContext/);
  assert.match(workspaceService, /ELECTRON_RUN_AS_NODE/);
  assert.match(main, /McpProposalInboxService/);

  assert.equal(proposalTools.length, 11);
  assert.match(mcpServer, /coreClient\.proposeTaskWork/);
  for (const [index, toolName] of proposalTools.entries()) {
    const block = toolBlock(mcpServer, toolName);
    assert.match(block, /annotations: PROPOSAL_ANNOTATIONS/);
    if (index < 4) {
      assert.match(block, /withCoreClient/);
      assert.match(block, /queueTaskWork/);
      assert.doesNotMatch(block, /queueMcpProposal/);
    } else {
      assert.match(block, /queueMcpProposal/);
      assert.doesNotMatch(block, /withCoreClient|coreClient\.propose/);
    }
  }
  assert.equal(occurrences(mcpServer, /queueMcpProposal\(/g), 7);
});

test("#413 cleanup gate is opt-in until the final Proposal migration", () => {
  if (process.env.TASKEN_MCP_NATIVE_CLEANUP_ENFORCE !== "1") {
    assert.ok(true, "Enable TASKEN_MCP_NATIVE_CLEANUP_ENFORCE=1 only after #412 read and Proposal migration.");
    return;
  }

  const forbidden = /better-sqlite3|ReadOnlyTaskenContext|ELECTRON_RUN_AS_NODE|TASKEN_MCP_INBOX_PATH|queueMcpProposal|mcp-inbox/;
  for (const relativePath of [
    "scripts/tasken-mcp-launcher.mjs",
    "scripts/mcp-server.mjs",
    "scripts/mcp-runtime.mjs",
    "scripts/mcp-doctor.mjs",
    "scripts/mcp-package-smoke.mjs",
    "scripts/build-mcp-bridge.mjs",
    "src/main/mcp/server.mjs",
    "src/main/mcp/readOnlyContext.mjs",
    "src/main/mcp/proposalInbox.mjs",
    "src/main/services/workspaceService.ts",
    "src/main/index.ts",
  ]) {
    assert.doesNotMatch(source(relativePath), forbidden, `${relativePath} still contains a native/inbox bridge symbol`);
  }

  const packageJson = JSON.parse(source("package.json"));
  assert.equal(packageJson.scripts.mcp, "node scripts/mcp-server.mjs");
  const bundledPath = path.join(root, "mcp-dist", "server.mjs");
  assert.ok(fs.existsSync(bundledPath), "run npm run build:mcp before enforcing the package gate");
  assert.doesNotMatch(fs.readFileSync(bundledPath, "utf8"), forbidden);
});
