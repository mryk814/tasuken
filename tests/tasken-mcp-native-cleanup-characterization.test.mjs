import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const forbidden =
  /better-sqlite3|ReadOnlyTaskenContext|ELECTRON_RUN_AS_NODE|TASKEN_MCP_INBOX_PATH|queueMcpProposal|mcp-inbox/;

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
  "tasken.get_agent_session_context",
  "tasken.get_recent_notes",
  "tasken.search_knowledge",
  "tasken.get_knowledge_context",
  "tasken.get_plan_health",
  "tasken.get_knowledge_health",
  "tasken.get_activity",
  "tasken.get_context_subgraph",
  "tasken.get_feed_context",
  "tasken.get_proposal_status",
  "tasken.export_ai_context",
  "tasken.get_debrief_context",
  "tasken.get_work_context",
  "tasken.get_planning_context",
  "tasken.get_learning_context",
];
const proposalTools = [
  "tasken.append_work_receipt",
  "tasken.report_task_done",
  "tasken.report_task_blocked",
  "tasken.start_agent_session",
  "tasken.finish_agent_session",
  "tasken.submit_agent_session_record",
  "tasken.propose_repository_context",
  "tasken.propose_task",
  "tasken.propose_note",
  "tasken.propose_note_edit",
  "tasken.propose_feed_post",
  "tasken.answer_feed_question",
  "tasken.propose_knowledge",
  "tasken.propose_sketch",
  "tasken.propose_artifact",
];

/**
 * 画像toolは `withCoreClient` ではなく `imageToolHandler` 経由でCoreへ渡す。
 * 一覧を分けているのは、Core経由であることの示し方が違うため。
 */
const imageTools = ["tasken.get_capture_image", "tasken.get_task_image"];
/**
 * Proposalを作らず直接書き込む唯一の例外（人がAI ReadyにしたTaskの開始）。
 * 注釈が `PROPOSAL_ANNOTATIONS` ではないので、proposal群とは分けて検査する。
 */
const directWriteTools = ["tasken.start_task_work"];

function toolBlock(value, toolName) {
  const marker = new RegExp(`server\\.registerTool\\(\\s*"${toolName.replaceAll(".", "\\.")}"`);
  const match = marker.exec(value);
  const start = match?.index ?? -1;
  assert.notEqual(start, -1, `${toolName} registration`);
  const next = value.indexOf("server.registerTool(", start + (match?.[0].length ?? 0));
  return value.slice(start, next === -1 ? value.length : next);
}

/**
 * 正本の登録をread/proposalへ分ける。
 * 一覧を手で持つだけにすると、toolを増やしても古いまま素通りする（実際に28/15のまま31/16とずれていた）。
 */
function registeredSplit() {
  const serverSource = source("src/main/mcp/server.mjs");
  const boundary = serverSource.indexOf("if (readOnly) return server;");
  assert.notEqual(boundary, -1, "read-only boundary");
  const registrations = [...serverSource.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map(
    (match) => ({ name: match[1], offset: match.index }),
  );
  return {
    read: registrations.filter((entry) => entry.offset < boundary).map((entry) => entry.name),
    proposal: registrations.filter((entry) => entry.offset > boundary).map((entry) => entry.name),
  };
}

test("#413 MCP production graph is Core-only and native-free", () => {
  for (const removed of [
    "scripts/tasken-mcp-launcher.mjs",
    "scripts/mcp-runtime.mjs",
    "src/main/mcp/readOnlyContext.mjs",
    "src/main/mcp/proposalInbox.mjs",
  ])
    assert.equal(fs.existsSync(path.join(root, removed)), false, `${removed} must remain deleted`);

  const packageJson = JSON.parse(source("package.json"));
  assert.equal(packageJson.scripts.mcp, "node scripts/mcp-server.mjs");
  assert.ok(
    packageJson.dependencies["better-sqlite3"],
    "Desktop keeps its native SQLite dependency",
  );

  for (const relativePath of [
    "scripts/mcp-server.mjs",
    "scripts/mcp-doctor.mjs",
    "scripts/build-mcp-bridge.mjs",
    "src/main/mcp/server.mjs",
    "src/main/mcp/taskenCoreClient.mjs",
    "src/main/services/workspaceService.ts",
    "src/main/index.ts",
  ])
    assert.doesNotMatch(
      source(relativePath),
      forbidden,
      `${relativePath} contains a retired native/inbox path`,
    );

  const packageSmoke = source("scripts/mcp-package-smoke.mjs");
  assert.doesNotMatch(
    packageSmoke,
    /better-sqlite3|ReadOnlyTaskenContext|ELECTRON_RUN_AS_NODE|queueMcpProposal|proposalInbox/,
  );
  assert.match(packageSmoke, /TASKEN_MCP_INBOX_PATH: legacyInboxPath/);
  assert.match(packageSmoke, /for \(const forbiddenPath of \[fakeDbPath, legacyInboxPath\]\)/);
  assert.match(packageSmoke, /command: process\.env\.TASKEN_NODE_EXEC_PATH \|\| process\.execPath/);
  assert.match(packageSmoke, /spawn\(executable/);
  assert.match(source("scripts/mcp-doctor.mjs"), /\.inspect\(\)/);
  assert.match(
    source("src/main/services/workspaceService.ts"),
    /this\.taskenCoreClient\.getTaskContext/,
  );
  assert.match(source("src/main/services/workspaceService.ts"), /createMcpBridgeInfo/);
  assert.match(source("src/shared/ipc/contracts.ts"), /const command = "node"/);
  assert.doesNotMatch(
    source("src/main/services/workspaceService.ts"),
    /mcpServers:[\s\S]{0,300}\benv\b/,
  );
  assert.doesNotMatch(
    source("src/renderer/src/features/workspace/pages/SettingsPage.tsx"),
    /MCP Inbox|Inboxを開く|pendingFileCount/,
  );
});

test("#413 all reads and proposals use Core without fallback", () => {
  const mcpServer = source("src/main/mcp/server.mjs");
  const registered = registeredSplit();
  // 一覧は正本の登録と一致させる。toolを増やしたらこの一覧も更新する。
  assert.deepEqual(
    [...readTools, ...imageTools].sort(),
    [...registered.read].sort(),
    "read tools must cover every read registration",
  );
  assert.deepEqual(
    [...proposalTools, ...directWriteTools].sort(),
    [...registered.proposal].sort(),
    "proposal tools must cover every proposal registration",
  );
  for (const toolName of readTools) assert.match(toolBlock(mcpServer, toolName), /withCoreClient/);
  for (const toolName of imageTools) {
    assert.match(toolBlock(mcpServer, toolName), /imageToolHandler/);
    assert.match(toolBlock(mcpServer, toolName), /coreClient\.get(Capture|Task)Image/);
  }
  for (const toolName of proposalTools) {
    const block = toolBlock(mcpServer, toolName);
    assert.match(block, /withCoreClient/);
    assert.match(block, /annotations: PROPOSAL_ANNOTATIONS/);
  }
  for (const toolName of directWriteTools) {
    const block = toolBlock(mcpServer, toolName);
    assert.match(block, /withCoreClient/);
    assert.match(block, /annotations: DIRECT_WRITE_ANNOTATIONS/);
  }
  assert.doesNotMatch(mcpServer, /withReadContext|readContextProvider|queueMcpProposal/);
});

test(
  "#413 built MCP package contains no retired native bridge",
  { skip: process.env.TASKEN_MCP_NATIVE_CLEANUP_ENFORCE !== "1" },
  () => {
    const bundledPath = path.join(root, "mcp-dist", "server.mjs");
    assert.ok(fs.existsSync(bundledPath), "run npm run build:mcp before enforcing package gate");
    assert.doesNotMatch(fs.readFileSync(bundledPath, "utf8"), forbidden);
  },
);
