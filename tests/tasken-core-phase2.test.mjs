import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { build } from "esbuild";

import { ReadOnlyTaskenContext } from "../src/main/mcp/readOnlyContext.mjs";
import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";
import { TaskenCoreClient, TaskenCoreClientError } from "../src/main/mcp/taskenCoreClient.mjs";

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

const now = "2026-08-20T00:00:00.000Z";

function task(id, overrides = {}) {
  return {
    id,
    title: id,
    project_id: "theme-visible",
    intended_executor: "ai_agent",
    state: "todo",
    updated_at: now,
    ...overrides,
  };
}

function fixture() {
  return {
    themes: [
      { id: "theme-visible", name: "Visible", default_ai_visibility: ["coding_agent"], updated_at: now },
      { id: "theme-hidden", name: "Hidden", default_ai_visibility: ["m365"], updated_at: now },
    ],
    tasks: [
      task("ready-new", { updated_at: "2026-08-20T03:00:00.000Z", legacy_extension: "retained" }),
      task("ready-old", { work_state: "ready_for_agent", updated_at: "2026-08-20T02:00:00.000Z" }),
      task("working", { work_state: "in_progress" }),
      task("hidden", { project_id: "theme-hidden" }),
    ],
  };
}

class FixtureRepository {
  constructor(workspace) {
    this.workspace = workspace;
  }

  list(type, includeDeleted = false) {
    const records = type === "task" ? this.workspace.tasks : this.workspace.themes;
    return records.filter((record) => includeDeleted || !record.deleted_at);
  }

  readPreference(key) {
    assert.equal(key, "aiVisibilityDefault");
    return ["coding_agent"];
  }
}

async function mcpResult(coreClient, request, readContextProvider = () => {
  throw new Error("DB_CONSTRUCTOR_SENTINEL");
}) {
  const server = createTaskenMcpServer({ coreClient, readContextProvider, readOnly: true });
  const client = new Client({ name: "tasken-core-phase2-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name: "tasken.list_agent_ready_tasks", arguments: request });
  } finally {
    await client.close();
    await server.close();
  }
}

test("Phase 2: legacy, in-process, HTTP, and MCP agent-ready results are deep-equal", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-phase2-"));
  const workspace = fixture();
  const repository = new FixtureRepository(workspace);
  const core = createTaskenCore(repository);
  const host = new TaskenCoreHost({ userDataPath: root, listAgentReadyTasks: core.listAgentReadyTasks });
  const context = new ReadOnlyTaskenContext("phase2.sqlite", {
    workspace,
    aiVisibilityDefault: ["coding_agent"],
  });
  try {
    await host.start();
    const request = { theme_id: "theme-visible", limit: 20 };
    const legacy = context.toolListAgentReadyTasks(request);
    const inProcess = core.listAgentReadyTasks.execute(request);
    const httpResult = await new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") })
      .listAgentReadyTasks(request);
    const mcp = await mcpResult(
      new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") }),
      request,
    );

    assert.deepEqual(inProcess, legacy);
    assert.deepEqual(httpResult, legacy);
    assert.deepEqual(mcp.structuredContent, legacy);
  } finally {
    context.close();
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 2: discovery, auth, health, capabilities, body, and timeout boundaries are enforced", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-security-"));
  const core = createTaskenCore(new FixtureRepository(fixture()));
  const host = new TaskenCoreHost({ userDataPath: root, listAgentReadyTasks: core.listAgentReadyTasks });
  try {
    await host.start();
    const discoveryPath = path.join(root, "tasken-core.json");
    const discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
    assert.equal(Buffer.from(discovery.token, "base64url").length, 32);
    if (typeof process.getuid === "function") assert.equal(fs.statSync(discoveryPath).uid, process.getuid());
    assert.match(fs.readFileSync("src/main/infrastructure/http/taskenCoreHost.ts", "utf8"), /chmod\([^,]+, 0o600\)/);

    const headers = { authorization: `Bearer ${discovery.token}` };
    const health = await fetch(`${discovery.origin}/health`, { headers });
    const version = await fetch(`${discovery.origin}/version`, { headers });
    const capabilities = await fetch(`${discovery.origin}/capabilities`, { headers });
    assert.deepEqual(await health.json(), { status: "ok", api_version: "1" });
    assert.deepEqual(await version.json(), { api_version: "1" });
    assert.deepEqual(await capabilities.json(), { capabilities: ["list_agent_ready_tasks"] });
    assert.equal((await fetch(`${discovery.origin}/health`)).status, 401);
    const wrongContentType = await fetch(`${discovery.origin}/v1/queries/list-agent-ready-tasks`, {
      method: "POST",
      headers: { ...headers, "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(wrongContentType.status, 415);
    assert.equal((await wrongContentType.json()).error.code, "UNSUPPORTED_MEDIA_TYPE");
    const wrongMethod = await fetch(`${discovery.origin}/health`, { method: "POST", headers });
    assert.equal(wrongMethod.status, 405);
    assert.equal((await wrongMethod.json()).error.code, "METHOD_NOT_ALLOWED");
    const unknownPath = await fetch(`${discovery.origin}/missing`, { headers });
    assert.equal(unknownPath.status, 404);
    assert.equal((await unknownPath.json()).error.code, "NOT_FOUND");

    const oversized = await fetch(`${discovery.origin}/v1/queries/list-agent-ready-tasks`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(70_000) }),
    });
    assert.equal(oversized.status, 413);

    const timeoutClient = new TaskenCoreClient({
      discoveryPath,
      timeoutMs: 10,
      fetch: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    await assert.rejects(timeoutClient.listAgentReadyTasks({}), (error) => (
      error instanceof TaskenCoreClientError && error.code === "CORE_UNAVAILABLE"
    ));
  } finally {
    await host.stop();
    assert.equal(fs.existsSync(path.join(root, "tasken-core.json")), false);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 2: Core stop closes a partial keep-alive connection and remains idempotent", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-stop-"));
  const core = createTaskenCore(new FixtureRepository(fixture()));
  const host = new TaskenCoreHost({ userDataPath: root, listAgentReadyTasks: core.listAgentReadyTasks });
  let socket;
  try {
    const { origin } = await host.start();
    const { hostname, port } = new URL(origin);
    socket = net.createConnection({ host: hostname, port: Number(port) });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(`GET /health HTTP/1.1\r\nHost: ${hostname}\r\nConnection: keep-alive\r\n`);

    await Promise.race([
      host.stop(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Core stop timed out")), 500).unref();
      }),
    ]);
    await host.stop();
    assert.equal(fs.existsSync(path.join(root, "tasken-core.json")), false);
  } finally {
    socket?.destroy();
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 2: unavailable Core never constructs the legacy DB context", async () => {
  const missingDiscovery = path.join(os.tmpdir(), `tasken-core-missing-${crypto.randomUUID()}.json`);
  const result = await mcpResult(new TaskenCoreClient({ discoveryPath: missingDiscovery }), {});

  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /Tasken Core/);
  assert.doesNotMatch(JSON.stringify(result.content), /DB_CONSTRUCTOR_SENTINEL/);
});

test("Phase 2: version and auth failures never fall back to the legacy DB context", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-fail-closed-"));
  const discoveryPath = path.join(root, "tasken-core.json");
  fs.writeFileSync(discoveryPath, JSON.stringify({
    schema_version: 1,
    api_version: "999",
    origin: "http://127.0.0.1:1",
    token: "x".repeat(43),
    capabilities: ["list_agent_ready_tasks"],
  }), { mode: 0o600 });
  fs.chmodSync(discoveryPath, 0o600);
  const versionResult = await mcpResult(new TaskenCoreClient({ discoveryPath }), {});
  assert.equal(versionResult.isError, true);
  assert.match(JSON.stringify(versionResult.content), /version/);
  assert.doesNotMatch(JSON.stringify(versionResult.content), /DB_CONSTRUCTOR_SENTINEL/);

  const core = createTaskenCore(new FixtureRepository(fixture()));
  const host = new TaskenCoreHost({ userDataPath: root, listAgentReadyTasks: core.listAgentReadyTasks });
  try {
    await host.start();
    const discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
    fs.writeFileSync(discoveryPath, JSON.stringify({ ...discovery, token: Buffer.alloc(32, 9).toString("base64url") }));
    fs.chmodSync(discoveryPath, 0o600);
    const authResult = await mcpResult(new TaskenCoreClient({ discoveryPath }), {});
    assert.equal(authResult.isError, true);
    assert.match(JSON.stringify(authResult.content), /認証/);
    assert.doesNotMatch(JSON.stringify(authResult.content), /DB_CONSTRUCTOR_SENTINEL/);
    assert.equal(JSON.stringify(authResult.content).includes(discovery.token), false);
  } finally {
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Wave 5: migrated MCP detail tool never opens the legacy context provider", async () => {
  let legacyCalls = 0;
  const server = createTaskenMcpServer({
    readOnly: true,
    coreClient: {
      getNote: () => ({
        note: { id: "core-note" },
        next_tools: [],
        read_only: true,
        ai_audience: "coding_agent",
      }),
    },
    readContextProvider: async () => ({
      toolGetNote: () => {
        legacyCalls += 1;
        return { note: { id: "legacy-note" } };
      },
      close: () => undefined,
    }),
  });
  const client = new Client({ name: "tasken-core-legacy-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: "tasken.get_note", arguments: { note_id: "legacy-note" } });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.note.id, "core-note");
    assert.equal(legacyCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("Phase 2: pure Core client imports under normal Node without SQLite or native modules", () => {
  const nodeExecutable = process.env.TASKEN_NODE_EXEC_PATH || "node";
  const result = spawnSync(nodeExecutable, ["--input-type=module", "--eval", `
    import { TaskenCoreClient } from "./src/main/mcp/taskenCoreClient.mjs";
    if (typeof TaskenCoreClient !== "function") process.exit(2);
  `], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
  assert.equal(result.status, 0, result.stderr);
  const source = fs.readFileSync("src/main/mcp/taskenCoreClient.mjs", "utf8");
  assert.doesNotMatch(source, /better-sqlite3|readOnlyContext|\.node["']/);
});

test("Phase 2: discovery symlinks and malformed credentials are rejected without secret disclosure", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-discovery-"));
  const target = path.join(root, "target.json");
  const link = path.join(root, "tasken-core.json");
  const token = Buffer.alloc(32, 7).toString("base64url");
  fs.writeFileSync(target, JSON.stringify({
    schema_version: 1,
    api_version: "1",
    origin: "http://127.0.0.1:1",
    token,
    capabilities: ["list_agent_ready_tasks"],
  }), { mode: 0o600 });
  fs.symlinkSync(target, link);
  try {
    await assert.rejects(
      new TaskenCoreClient({ discoveryPath: link }).listAgentReadyTasks({}),
      (error) => error instanceof TaskenCoreClientError
        && error.code === "INVALID_DISCOVERY"
        && !error.message.includes(token),
    );
    fs.rmSync(link);
    fs.writeFileSync(link, JSON.stringify({
      schema_version: 1,
      api_version: "1",
      origin: "http://127.0.0.1:1",
      token: "not-base64url",
      capabilities: ["list_agent_ready_tasks"],
    }), { mode: 0o600 });
    await assert.rejects(
      new TaskenCoreClient({ discoveryPath: link }).listAgentReadyTasks({}),
      (error) => error instanceof TaskenCoreClientError
        && error.code === "INVALID_DISCOVERY"
        && !error.message.includes("not-base64url"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
