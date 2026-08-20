import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { build } from "esbuild";

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

const now = "2026-08-21T00:00:00.000Z";

function fixture() {
  return {
    items: [
      { id: "legacy-shadowed", title: "old duplicate", kind: "task", status: "todo", theme_id: "theme-visible", updated_at: "2026-08-20T00:00:00.000Z" },
      { id: "legacy-visible", title: "Legacy needle", kind: "task", status: "doing", theme_id: "theme-visible", due_date: "2026-08-25", updated_at: "2026-08-19T00:00:00.000Z" },
    ],
    tasks: [
      { id: "task-hidden", title: "Needle hidden newest", state: "todo", project_id: "theme-hidden", updated_at: "2026-08-23T00:00:00.000Z" },
      { id: "task-visible", legacy_item_id: "legacy-shadowed", title: "Needle task", description: "visible", state: "doing", project_id: "theme-visible", updated_at: "2026-08-22T00:00:00.000Z" },
      { id: "task-archived", title: "Needle archived", state: "todo", project_id: "theme-visible", deleted_at: now, updated_at: now },
    ],
    waitings: [
      { id: "waiting-open", title: "Needle waiting", state: "waiting", waiting_for: "review", project_id: "theme-visible", updated_at: "2026-08-18T00:00:00.000Z" },
      { id: "waiting-received", title: "Needle received", state: "received", project_id: "theme-visible", updated_at: "2026-08-17T00:00:00.000Z" },
    ],
    plan_nodes: [
      { id: "plan-open", title: "Needle milestone", type: "milestone", state: "active", project_id: "theme-visible", updated_at: "2026-08-16T00:00:00.000Z" },
    ],
    schedules: [
      { id: "schedule-task", owner_type: "task", owner_id: "task-visible", start_date: "2026-08-10", end_date: "2026-08-12", updated_at: now },
      { id: "schedule-waiting", owner_type: "waiting", owner_id: "waiting-open", start_date: "2026-08-05", end_date: "2026-08-06", updated_at: now },
    ],
    themes: [
      { id: "theme-visible", name: "Visible", default_ai_visibility: ["coding_agent"] },
      { id: "theme-hidden", name: "Hidden", default_ai_visibility: [] },
    ],
  };
}

class FixtureRepository {
  constructor(workspace) {
    this.workspace = workspace;
    this.calls = [];
  }

  list(type, includeDeleted = false) {
    this.calls.push({ type, includeDeleted });
    const records = this.workspace[`${type}s`] || [];
    return records.filter((record) => includeDeleted || !record.deleted_at);
  }

  readWorkspaceSnapshot() {
    throw new Error("FULL_WORKSPACE_SNAPSHOT_SENTINEL");
  }

  getPreference(key) {
    assert.equal(key, "aiVisibilityDefault");
    return ["coding_agent"];
  }
}

async function callMcp(coreClient, name, args) {
  const server = createTaskenMcpServer({
    coreClient,
    readOnly: true,
    readContextProvider: () => { throw new Error("DB_CONSTRUCTOR_SENTINEL"); },
  });
  const client = new Client({ name: "tasken-core-wave4-test", version: "1.0.0" });
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

test("Wave 4 mixed Item queries preserve ordering, dedupe, visibility-before-limit, locators, and guidance", () => {
  const repository = new FixtureRepository(fixture());
  const core = createTaskenCore(repository);

  const search = core.searchItems.execute({ query: "needle", limit: 1 });
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].id, "legacy-shadowed");
  assert.equal(search.items[0].title, "Needle task");
  assert.equal(search.items[0].planned_end, "2026-08-12");
  assert.deepEqual(search.items[0].locator, {
    entity_type: "task",
    entity_id: "task-visible",
    tool: "tasken.get_task_context",
    arguments: { task_id: "task-visible" },
  });
  assert.equal(search.excluded_count, 1);
  assert.equal(search.read_only, true);
  assert.equal(search.next_tools[0].tool, "tasken.get_task_context");

  const all = core.searchItems.execute({ query: "needle", limit: 100 });
  assert.equal(all.items.filter((item) => item.id === "legacy-shadowed").length, 1);
  assert.equal(all.items.some((item) => item.id === "task-archived"), false);
  assert.equal(core.searchItems.execute({ query: "needle", include_archived: true, limit: 100 }).items.some((item) => item.id === "task-archived"), true);

  const open = core.listOpenItems.execute({ limit: 100 });
  assert.deepEqual(open.items.map((item) => item.id), ["waiting-open", "legacy-shadowed", "legacy-visible", "plan-open"]);
  assert.equal(open.items.some((item) => item.id === "waiting-received"), false);
  assert.equal(repository.calls.some((call) => call.type === "theme" && call.includeDeleted), true);
});

test("Wave 4 named HTTP and pure MCP paths expose both capabilities without a native DB", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave4-"));
  const core = createTaskenCore(new FixtureRepository(fixture()));
  const host = new TaskenCoreHost({ userDataPath: root, ...core });
  try {
    const started = await host.start();
    const discovery = JSON.parse(fs.readFileSync(path.join(root, "tasken-core.json"), "utf8"));
    assert.ok(discovery.capabilities.includes("search_items"));
    assert.ok(discovery.capabilities.includes("list_open_items"));
    const client = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
    assert.equal((await client.searchItems({ query: "needle", limit: 1 })).items[0].title, "Needle task");
    assert.equal((await client.listOpenItems({ limit: 1 })).items[0].id, "waiting-open");

    const mcpSearch = await callMcp(client, "tasken.search_items", { query: "needle", limit: 1 });
    assert.equal(mcpSearch.isError, undefined);
    assert.equal(mcpSearch.structuredContent.items[0].locator.entity_id, "task-visible");
    const mcpOpen = await callMcp(client, "tasken.list_open_items", { limit: 1 });
    assert.equal(mcpOpen.structuredContent.items[0].id, "waiting-open");

    const response = await fetch(`${started.origin}/v1/queries/search-items`, {
      method: "POST",
      headers: { authorization: `Bearer ${discovery.token}`, "content-type": "application/json" },
      body: JSON.stringify({ limit: 0, "C:\\Users\\private\\TOKEN_PRIVATE_SENTINEL": true }),
    });
    assert.equal(response.status, 400);
    const error = await response.json();
    assert.equal(error.error.code, "VALIDATION_FAILED");
    assert.ok(error.error.details.issues.length > 0);
    assert.doesNotMatch(JSON.stringify(error), /stack|tasken-core-wave4|token|PRIVATE_SENTINEL|Users/i);
    await assert.rejects(
      client.searchItems({ limit: 0 }),
      (failure) => failure instanceof TaskenCoreClientError
        && failure.code === "VALIDATION_FAILED"
        && failure.status === 400
        && failure.details.issues[0].path[0] === "limit",
    );
    await assert.rejects(
      client.listAgentReadyTasks({ limit: 0 }),
      (failure) => failure instanceof TaskenCoreClientError
        && failure.code === "VALIDATION_FAILED"
        && failure.details.issues[0].path[0] === "limit",
    );
  } finally {
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Core HTTP errors remain lossless in the client and MCP typed error result", async () => {
  const details = { issues: [{ path: ["limit"], code: "too_small", message: "Too small" }] };
  const coreError = new TaskenCoreClientError("VALIDATION_FAILED", "requestがschemaに適合しません。", { status: 400, details });
  const result = await callMcp({ searchItems: async () => { throw coreError; } }, "tasken.search_items", {});
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: { code: "VALIDATION_FAILED", message: "requestがschemaに適合しません。", status: 400, details },
  });
  assert.doesNotMatch(JSON.stringify(result), /stack|cause|DB_CONSTRUCTOR_SENTINEL/);
});

test("Wave 4 public limit rejects values outside 1..100", () => {
  const core = createTaskenCore(new FixtureRepository(fixture()));
  assert.throws(() => core.searchItems.execute({ limit: 0 }), />=1/);
  assert.throws(() => core.listOpenItems.execute({ limit: 101 }), /<=100/);
});

test("normal Node Wave 4 MCP registrations are Core-only", () => {
  const source = fs.readFileSync("src/main/mcp/server.mjs", "utf8");
  const slice = source.slice(
    source.indexOf('server.registerTool("tasken.search_items"'),
    source.indexOf('server.registerTool("tasken.list_agent_ready_tasks"'),
  );
  assert.match(slice, /coreClient\.searchItems/);
  assert.match(slice, /coreClient\.listOpenItems/);
  assert.doesNotMatch(slice, /withReadContext|ReadOnlyTaskenContext|better-sqlite3/);
});
