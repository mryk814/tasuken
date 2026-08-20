import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { ReadOnlyTaskenContext } from "../src/main/mcp/readOnlyContext.mjs";
import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";
import { TaskenCoreClient, TaskenCoreClientError } from "../src/main/mcp/taskenCoreClient.mjs";

const workspaceRepositoryModule = "../src/main/repositories/" + "workspaceRepository.mjs";
const { WorkspaceDatabase } = await import(workspaceRepositoryModule);

const bundled = await build({
  stdin: {
    contents: `
      export { TaskenCoreHost } from "./src/main/infrastructure/http/taskenCoreHost.ts";
      export { createTaskenCore } from "./src/main/infrastructure/sqlite/public.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { TaskenCoreHost, createTaskenCore } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const timestamp = "2026-08-20T00:00:00.000Z";
const record = (id, fields = {}) => ({ id, created_at: timestamp, updated_at: timestamp, ...fields });

function fixture() {
  const publicTheme = record("theme-public", { name: "Public", default_ai_visibility: ["coding_agent"] });
  const privateTheme = record("theme-private", { name: "Private", default_ai_visibility: [] });
  const visibleNote = record("note-visible", {
    title: "Visible note", project_id: publicTheme.id, body_markdown: "visible note body",
  });
  const hiddenNote = record("note-hidden", {
    title: "Hidden note", project_id: privateTheme.id, body_markdown: "PRIVATE_NOTE",
  });
  const visibleClaim = record("knowledge-visible-claim", {
    title: "Visible query claim", body: "visible claim body", node_type: "claim",
    theme_id: publicTheme.id, source_note_id: visibleNote.id, source_type: "task", source_id: "task-visible",
  });
  const visibleEvidence = record("knowledge-visible-evidence", {
    title: "Visible evidence", body: "visible evidence body", node_type: "evidence",
    theme_id: publicTheme.id,
  });
  const hiddenNode = record("knowledge-hidden", {
    title: "Hidden query", body: "PRIVATE_KNOWLEDGE", node_type: "claim", theme_id: privateTheme.id,
  });
  return {
    themes: [publicTheme, privateTheme],
    notes: [visibleNote, hiddenNote],
    knowledge_nodes: [visibleClaim, visibleEvidence, hiddenNode],
    knowledge_edges: [
      record("edge-public", { source_node_id: visibleClaim.id, target_node_id: visibleEvidence.id, relation_type: "supports" }),
      record("edge-hidden", { source_node_id: visibleClaim.id, target_node_id: hiddenNode.id, relation_type: "similar_to" }),
    ],
    tasks: [record("task-visible", { title: "Visible task", state: "doing", project_id: publicTheme.id })],
    waitings: [],
    plan_nodes: [],
    schedules: [],
    items: [],
    links: [],
    resources: [],
  };
}

class FixturePersistence {
  constructor(workspace) { this.workspace = workspace; }
  list(type, includeDeleted = false) {
    return [...(this.workspace[`${type}s`] || [])]
      .filter((entry) => includeDeleted || !entry.deleted_at)
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  }
  readPreference(key) {
    assert.equal(key, "aiVisibilityDefault");
    return ["coding_agent"];
  }
}

function legacyFields(value) {
  const { read_only: _readOnly, next_tools: _nextTools, ...legacy } = value;
  return legacy;
}

async function mcpCall(coreClient, name, args) {
  const server = createTaskenMcpServer({
    coreClient,
    readOnly: true,
    readContextProvider: () => { throw new Error("READ_ONLY_CONTEXT_FALLBACK_SENTINEL"); },
  });
  const client = new Client({ name: "wave7-integration", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}

test("Wave 7 safe legacy fields are exact across Core, HTTP, and MCP", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave7-integration-"));
  fs.chmodSync(root, 0o700);
  const workspace = fixture();
  const core = createTaskenCore(new FixturePersistence(workspace));
  const host = new TaskenCoreHost({ userDataPath: root, ...core });
  const legacy = new ReadOnlyTaskenContext("ignored.sqlite", { workspace, aiVisibilityDefault: ["coding_agent"] });
  try {
    await host.start();
    const client = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
    const cases = [
      ["tasken.get_recent_notes", {}, "getRecentNotes", "toolGetRecentNotes"],
      ["tasken.search_knowledge", { query: "query" }, "searchKnowledge", "toolSearchKnowledge"],
      ["tasken.get_knowledge_context", { theme_id: "theme-public", include_relations: false }, "getKnowledgeContext", "toolGetKnowledgeContext"],
      ["tasken.get_plan_health", {}, "getPlanHealth", "toolGetPlanHealth"],
      ["tasken.get_knowledge_health", {}, "getKnowledgeHealth", "toolGetKnowledgeHealth"],
    ];
    for (const [tool, request, method, legacyMethod] of cases) {
      const expected = legacy[legacyMethod](request);
      const inProcess = core[method].execute(request);
      const overHttp = await client[method](request);
      const overMcp = await mcpCall(client, tool, request);
      const comparable = legacyFields(inProcess);
      if (!("ai_audience" in expected)) delete comparable.ai_audience;
      assert.deepEqual(comparable, JSON.parse(JSON.stringify(expected)), `${tool} legacy transport fields`);
      assert.deepEqual(overHttp, inProcess, `${tool} HTTP`);
      assert.deepEqual(overMcp.structuredContent, inProcess, `${tool} MCP`);
      assert.equal(overMcp.isError, undefined);
      assert.equal(inProcess.read_only, true);
      assert.equal(inProcess.next_tools.length > 0, true);
    }
  } finally {
    legacy.close();
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Wave 7 drops every relation with a non-public endpoint", () => {
  const workspace = fixture();
  const core = createTaskenCore(new FixturePersistence(workspace));
  const result = core.getKnowledgeContext.execute({ theme_id: "theme-public" });
  assert.deepEqual(result.knowledge_edges.map((edge) => edge.id), ["edge-public"]);
  assert.doesNotMatch(JSON.stringify(result), /edge-hidden|knowledge-hidden|PRIVATE_/);
});

test("Wave 7 named capabilities fail before fetch and malformed responses fail closed", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave7-client-"));
  const discoveryPath = path.join(root, "tasken-core.json");
  const writeDiscovery = (capabilities) => {
    fs.writeFileSync(discoveryPath, JSON.stringify({
      schema_version: 1,
      api_version: "1",
      origin: "http://127.0.0.1:43210",
      token: Buffer.alloc(32, 7).toString("base64url"),
      capabilities,
    }), { mode: 0o600 });
    fs.chmodSync(discoveryPath, 0o600);
  };
  try {
    writeDiscovery([]);
    let fetchCalls = 0;
    const noCapability = new TaskenCoreClient({ discoveryPath, fetch: async () => { fetchCalls += 1; } });
    for (const [method, request] of [
      ["getRecentNotes", {}],
      ["searchKnowledge", {}],
      ["getKnowledgeContext", {}],
      ["getPlanHealth", {}],
      ["getKnowledgeHealth", {}],
    ]) {
      await assert.rejects(noCapability[method](request), (error) =>
        error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE");
    }
    assert.equal(fetchCalls, 0);

    writeDiscovery(["get_recent_notes"]);
    const malformed = new TaskenCoreClient({
      discoveryPath,
      fetch: async () => new Response(JSON.stringify({ notes: "not-an-array" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-tasken-core-version": "1" },
      }),
    });
    await assert.rejects(malformed.getRecentNotes({}), (error) =>
      error instanceof TaskenCoreClientError && error.code === "INVALID_RESPONSE");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("actual stdio MCP reads Wave 7 from Core-owned SQLite without writes or native fallback", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave7-stdio-"));
  fs.chmodSync(root, 0o700);
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  let host;
  let client;
  try {
    const workspace = fixture();
    for (const [type, records] of Object.entries({
      theme: workspace.themes,
      note: workspace.notes,
      knowledge_node: workspace.knowledge_nodes,
      knowledge_edge: workspace.knowledge_edges,
      task: workspace.tasks,
    })) {
      for (const entry of records) database.save(type, entry);
    }
    const metaCountBefore = database.db.prepare("SELECT COUNT(*) AS count FROM workspace_meta").get().count;
    const totalChangesBefore = database.db.prepare("SELECT total_changes() AS count").get().count;
    host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(database) });
    await host.start();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["scripts/mcp-server.mjs"],
      env: {
        ...process.env,
        TASKEN_USER_DATA_DIR: root,
        TASKEN_DB_PATH: path.join(root, "must-not-be-opened.sqlite3"),
        TASKEN_MCP_READ_ONLY: "true",
      },
      stderr: "pipe",
    });
    client = new Client({ name: "wave7-actual-stdio", version: "1.0.0" });
    await client.connect(transport);
    for (const [name, args, field] of [
      ["tasken.get_recent_notes", {}, "notes"],
      ["tasken.search_knowledge", { query: "visible" }, "knowledge_nodes"],
      ["tasken.get_knowledge_context", { theme_id: "theme-public" }, "knowledge_edges"],
      ["tasken.get_plan_health", {}, "open_count"],
      ["tasken.get_knowledge_health", {}, "issues"],
    ]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.notEqual(result.structuredContent[field], undefined);
      assert.equal(result.structuredContent.read_only, true);
    }
    const context = await client.callTool({
      name: "tasken.get_knowledge_context",
      arguments: { theme_id: "theme-public" },
    });
    assert.deepEqual(context.structuredContent.knowledge_edges.map((edge) => edge.id), ["edge-public"]);
    assert.doesNotMatch(JSON.stringify(context.structuredContent), /edge-hidden|knowledge-hidden|PRIVATE_/);
    assert.equal(fs.existsSync(path.join(root, "must-not-be-opened.sqlite3")), false);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM workspace_meta").get().count, metaCountBefore);
    assert.equal(database.db.prepare("SELECT total_changes() AS count").get().count, totalChangesBefore);
  } finally {
    try {
      await client?.close();
    } finally {
      try {
        await host?.stop();
      } finally {
        try {
          database.db.close();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    }
  }
});

test("Wave 7 MCP registrations contain no legacy read-context fallback", () => {
  const source = fs.readFileSync(new URL("../src/main/mcp/server.mjs", import.meta.url), "utf8");
  for (const method of [
    "toolGetRecentNotes",
    "toolSearchKnowledge",
    "toolGetKnowledgeContext",
    "toolGetPlanHealth",
    "toolGetKnowledgeHealth",
  ]) {
    assert.equal(source.includes(`context.${method}`), false, method);
  }
});
