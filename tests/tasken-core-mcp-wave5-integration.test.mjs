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
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";

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

const now = "2026-08-21T00:00:00.000Z";

function fixture() {
  const theme = { id: "theme-wave5", name: "Wave 5", default_ai_visibility: ["coding_agent"], updated_at: now };
  const task = { id: "task-wave5", title: "Wave 5 task", state: "doing", project_id: theme.id, updated_at: now };
  const note = { id: "note-wave5", title: "Wave 5 note", body_markdown: "note body", project_id: theme.id, updated_at: now };
  const conversation = {
    id: "conversation-wave5",
    title: "Wave 5 conversation",
    description: "conversation",
    body_markdown: "conversation body",
    url: "https://user:secret@example.com/chat?token=secret#part",
    resource_scope: "chat_ref",
    project_id: theme.id,
    updated_at: now,
  };
  const artifact = {
    id: "artifact-wave5",
    title: "Wave 5 artifact",
    filename: "wave5.json",
    storage_mode: "managed",
    source_type: "note",
    source_id: note.id,
    origin_note_id: note.id,
    stored_path: "C:/private/wave5.json",
    project_id: theme.id,
    updated_at: now,
  };
  const events = Array.from({ length: 101 }, (_, index) => buildActivityEvent({
    id: `event-${String(index).padStart(3, "0")}`,
    entity_type: "task",
    entity_id: task.id,
    event_kind: "task_work_recorded",
    occurred_at: new Date(Date.parse(now) + index * 1_000).toISOString(),
    after: task,
    summary: `Activity ${index}`,
    metadata: { dedupe_key: `wave5-${index}` },
  }));
  return { themes: [theme], tasks: [task], notes: [note], resources: [conversation], artifacts: [artifact], change_events: events };
}

class FixturePersistence {
  constructor(workspace) {
    this.workspace = workspace;
  }

  list(type, includeDeleted = false) {
    return (this.workspace[`${type}s`] || []).filter((record) => includeDeleted || !record.deleted_at);
  }

  readPreference(key) {
    assert.equal(key, "aiVisibilityDefault");
    return ["coding_agent"];
  }

  readWorkspaceSnapshot(includeDeleted = false) {
    return Object.fromEntries(Object.entries(this.workspace).map(([key, records]) => [
      key,
      Array.isArray(records) ? records.filter((record) => includeDeleted || !record.deleted_at) : records,
    ]));
  }
}

function legacyFields(response) {
  const { next_tools: _nextTools, ...rest } = response;
  return rest;
}

async function mcpCall(coreClient, name, args) {
  const server = createTaskenMcpServer({
    coreClient,
    readOnly: true,
    readContextProvider: () => { throw new Error("READ_ONLY_CONTEXT_FALLBACK_SENTINEL"); },
  });
  const client = new Client({ name: "wave5-integration", version: "1.0.0" });
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

test("Wave 5 detail/activity are exact across legacy fields, Core, HTTP, and MCP with additive guidance", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave5-integration-"));
  fs.chmodSync(root, 0o700);
  const workspace = fixture();
  const core = createTaskenCore(new FixturePersistence(workspace));
  const host = new TaskenCoreHost({ userDataPath: root, ...core });
  const legacy = new ReadOnlyTaskenContext("ignored.sqlite", { workspace, aiVisibilityDefault: ["coding_agent"] });
  try {
    await host.start();
    const client = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
    const cases = [
      ["tasken.get_note", { note_id: "note-wave5" }, "getNote", "toolGetNote"],
      ["tasken.get_conversation", { conversation_id: "conversation-wave5" }, "getConversation", "toolGetConversation"],
      ["tasken.get_artifact_metadata", { artifact_id: "artifact-wave5" }, "getArtifactMetadata", "toolGetArtifactMetadata"],
      ["tasken.get_activity_entries", { task_id: "task-wave5", limit: 100 }, "getActivityEntries", "toolGetActivityEntries"],
    ];
    for (const [tool, request, method, legacyMethod] of cases) {
      const expected = legacy[legacyMethod](request);
      const inProcess = core[method].execute(request);
      const overHttp = await client[method](request);
      const overMcp = await mcpCall(client, tool, request);
      assert.deepEqual(legacyFields(inProcess), expected, `${tool} Core legacy fields`);
      assert.deepEqual(overHttp, inProcess, `${tool} HTTP`);
      assert.deepEqual(overMcp.structuredContent, inProcess, `${tool} MCP`);
      assert.equal(overMcp.isError, undefined);
      assert.equal(inProcess.next_tools.length > 0, true);
    }
    const activity = await client.getActivityEntries({ task_id: "task-wave5", limit: 100 });
    assert.equal(activity.events[0].id, "event-100");
    assert.equal(activity.result_meta.matched_visible_count, 101);
    assert.equal(activity.result_meta.truncated, true);

    const missing = await mcpCall(client, "tasken.get_note", { note_id: "missing" });
    assert.equal(missing.isError, undefined);
    assert.equal(missing.structuredContent.error.code, "not_found");
  } finally {
    legacy.close();
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Wave 5 named capabilities fail before fetch and strict responses fail closed", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave5-client-"));
  const discoveryPath = path.join(root, "tasken-core.json");
  const writeDiscovery = (capabilities) => {
    fs.writeFileSync(discoveryPath, JSON.stringify({
      schema_version: 1,
      api_version: "1",
      origin: "http://127.0.0.1:43210",
      token: Buffer.alloc(32, 5).toString("base64url"),
      capabilities,
    }), { mode: 0o600 });
    fs.chmodSync(discoveryPath, 0o600);
  };
  try {
    writeDiscovery([]);
    let fetchCalls = 0;
    const noCapability = new TaskenCoreClient({ discoveryPath, fetch: async () => { fetchCalls += 1; } });
    for (const [method, request] of [
      ["getNote", { note_id: "note-wave5" }],
      ["getConversation", { conversation_id: "conversation-wave5" }],
      ["getArtifactMetadata", { artifact_id: "artifact-wave5" }],
      ["getActivityEntries", { task_id: "task-wave5" }],
    ]) {
      await assert.rejects(
        noCapability[method](request),
        (error) => error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE",
      );
    }
    assert.equal(fetchCalls, 0);

    writeDiscovery(["get_note"]);
    const invalidResponse = new TaskenCoreClient({
      discoveryPath,
      fetch: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ note: { id: "incomplete" }, unexpected: true }), {
          headers: { "content-type": "application/json", "x-tasken-core-version": "1" },
        });
      },
    });
    await assert.rejects(
      invalidResponse.getNote({ note_id: "note-wave5" }),
      (error) => error instanceof TaskenCoreClientError
        && error.code === "INVALID_RESPONSE"
        && error.details.operation === "get-note",
    );
    assert.equal(fetchCalls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("actual stdio MCP reads all Wave 5 tools from a running Core host and injected SQLite owner", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave5-stdio-"));
  fs.chmodSync(root, 0o700);
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  let host;
  let client;
  try {
    const workspace = fixture();
    for (const [type, records] of Object.entries({
      theme: workspace.themes,
      task: workspace.tasks,
      note: workspace.notes,
      resource: workspace.resources,
      artifact: workspace.artifacts,
      change_event: workspace.change_events,
    })) {
      for (const record of records) database.save(type, record);
    }
    const metaCountBefore = database.db.prepare("SELECT COUNT(*) AS count FROM workspace_meta").get().count;
    const totalChangesBefore = database.db.prepare("SELECT total_changes() AS count").get().count;
    assert.equal(database.db.prepare("SELECT value FROM workspace_meta WHERE key = 'ai_visibility_default'").get(), undefined);
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
    client = new Client({ name: "wave5-actual-stdio", version: "1.0.0" });
    await client.connect(transport);
    const calls = [
      ["tasken.get_note", { note_id: "note-wave5" }, "note"],
      ["tasken.get_conversation", { conversation_id: "conversation-wave5" }, "conversation"],
      ["tasken.get_artifact_metadata", { artifact_id: "artifact-wave5" }, "artifact"],
      ["tasken.get_activity_entries", { task_id: "task-wave5", limit: 100 }, "events"],
    ];
    for (const [name, args, field] of calls) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.ok(result.structuredContent[field]);
    }
    assert.equal(fs.existsSync(path.join(root, "must-not-be-opened.sqlite3")), false);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM workspace_meta").get().count, metaCountBefore);
    assert.equal(database.db.prepare("SELECT total_changes() AS count").get().count, totalChangesBefore);
    assert.equal(database.db.prepare("SELECT value FROM workspace_meta WHERE key = 'ai_visibility_default'").get(), undefined);
  } finally {
    await client?.close();
    await host?.stop();
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Wave 5 MCP registrations have no legacy/native fallback", () => {
  const source = fs.readFileSync("src/main/mcp/server.mjs", "utf8");
  const start = source.indexOf('server.registerTool("tasken.get_note"');
  const end = source.indexOf('server.registerTool("tasken.resolve_repository_context"');
  const registrations = source.slice(start, end);
  for (const method of ["getNote", "getConversation", "getArtifactMetadata", "getActivityEntries"]) {
    assert.match(registrations, new RegExp(`coreClient\\.${method}`));
  }
  assert.doesNotMatch(registrations, /withReadContext|ReadOnlyTaskenContext|readContextProvider|better-sqlite3/);
});
