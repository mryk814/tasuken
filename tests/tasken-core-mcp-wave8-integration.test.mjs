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
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";

const bundled = await build({
  stdin: { contents: `
    export { TaskenCoreHost } from "./src/main/infrastructure/http/taskenCoreHost.ts";
    export { createTaskenCore } from "./src/main/infrastructure/sqlite/public.ts";
  `, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
});
const { TaskenCoreHost, createTaskenCore } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const now = "2026-08-21T00:00:00.000Z";
const record = (id, fields = {}) => ({ id, created_at: now, updated_at: now, ...fields });

function fixture() {
  const theme = record("theme-wave8", { name: "Wave 8", state: "active", repository_context_ids: ["repo-wave8"], default_ai_visibility: ["coding_agent"] });
  const m365Theme = record("theme-m365", { name: "M365 only", state: "active", default_ai_visibility: ["m365"] });
  const task = record("task-wave8", { title: "Visible task", state: "todo", project_id: theme.id });
  const hidden = record("task-hidden", { title: "PRIVATE", state: "todo", project_id: theme.id, ai_visibility: [] });
  const event = buildActivityEvent({ id: "event-wave8", entity_type: "task", entity_id: task.id, event_kind: "task_work_recorded", occurred_at: "2026-08-20T15:30:00.000Z", after: task, summary: "safe", metadata: { dedupe_key: "wave8" } });
  const hiddenEvent = buildActivityEvent({ id: "event-hidden", entity_type: "task", entity_id: hidden.id, event_kind: "task_work_recorded", occurred_at: "2026-08-20T15:31:00.000Z", after: hidden, summary: "PRIVATE", metadata: { dedupe_key: "wave8-hidden" } });
  const note = record("note-wave8", { title: "Visible note", body_markdown: "body token=SECRET C:/private/note.md", project_id: theme.id });
  const knowledge = record("knowledge-wave8", { title: "Question", body: "body", node_type: "question", theme_id: theme.id });
  return {
    themes: [theme, m365Theme], tasks: [task, hidden, record("task-m365", { title: "M365 task", state: "todo", project_id: m365Theme.id })], waitings: [], plan_nodes: [], schedules: [], items: [],
    notes: [note, record("note-m365", { title: "M365 note", body_markdown: "m365 body", project_id: m365Theme.id })], knowledge_nodes: [knowledge, record("knowledge-m365", { title: "M365 question", body: "m365", node_type: "question", theme_id: m365Theme.id })], knowledge_edges: [], links: [],
    resources: [record("resource-wave8", { title: "Resource", project_id: theme.id, url: "https://user:pass@example.com/private?token=SECRET#frag", local_path: "C:/private/resource.md", token: "SECRET" }), record("resource-m365", { title: "M365 resource", project_id: m365Theme.id, url: "https://example.com/m365" })],
    repository_contexts: [record("repo-wave8", { label: "Repo", provider: "github", canonical_url: "https://github.com/mryk814/tasuken", canonical_identity: "github.com/mryk814/tasuken", repository_slug: "mryk814/tasuken", local_path: "C:/private/repo", active: true })],
    references: [record("ref-task-note", { source_type: "task", source_id: task.id, target_type: "note", target_id: note.id, relation_type: "related_to" }), record("ref-note-knowledge", { source_type: "note", source_id: note.id, target_type: "knowledge_node", target_id: knowledge.id, relation_type: "answers" })],
    change_events: [event, hiddenEvent],
  };
}

class FixturePersistence {
  constructor(workspace) { this.workspace = workspace; }
  list(type, includeDeleted = false) {
    return [...(this.workspace[`${type}s`] || [])].filter((entry) => includeDeleted || !entry.deleted_at)
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")) || String(a.id).localeCompare(String(b.id)));
  }
  readPreference(key) { assert.equal(key, "aiVisibilityDefault"); return ["coding_agent"]; }
  readWorkspaceSnapshot(includeDeleted = false) {
    return Object.fromEntries(Object.entries(this.workspace).map(([key, value]) => [key, Array.isArray(value) ? value.filter((entry) => includeDeleted || !entry.deleted_at) : value]));
  }
}

async function mcpCall(coreClient, name, args) {
  const server = createTaskenMcpServer({ coreClient, readOnly: true, readContextProvider: () => { throw new Error("READ_ONLY_CONTEXT_FALLBACK_SENTINEL"); } });
  const client = new Client({ name: "wave8-integration", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try { return await client.callTool({ name, arguments: args }); }
  finally { await client.close(); await server.close(); }
}

test("Wave 8 Core, loopback, and MCP return one canonical result without legacy fallback", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave8-"));
  fs.chmodSync(root, 0o700);
  const core = createTaskenCore(new FixturePersistence(fixture()));
  const host = new TaskenCoreHost({ userDataPath: root, ...core });
  try {
    await host.start();
    const client = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
    const cases = [
      ["tasken.get_activity", { date: "2026-08-21", timezone: "Asia/Tokyo", limit: 1 }, "getActivity"],
      ["tasken.get_context_subgraph", { entity_type: "task", entity_id: "task-wave8" }, "getContextSubgraph"],
      ["tasken.export_ai_context", { format: "json", scope: "open_items", max_items: 1, max_notes: 1, max_knowledge_nodes: 1, max_chars: 20 }, "exportAiContext"],
    ];
    for (const [tool, request, method] of cases) {
      const inProcess = core[method].execute(request);
      const overHttp = await client[method](request);
      const overMcp = (await mcpCall(client, tool, request)).structuredContent;
      if (method === "exportAiContext") {
        assert.match(overHttp.generated_at, /^20\d\d-/);
        assert.match(overMcp.generated_at, /^20\d\d-/);
        delete inProcess.generated_at; delete overHttp.generated_at; delete overMcp.generated_at;
      }
      assert.deepEqual(overHttp, inProcess, `${tool} HTTP`);
      assert.deepEqual(overMcp, inProcess, `${tool} MCP`);
      assert.equal(inProcess.read_only, true);
      assert.equal(inProcess.result_meta.contract_version, 1);
    }
    const markdown = core.exportAiContext.execute({ format: "markdown" });
    assert.equal(typeof markdown, "string");
    const mcpMarkdown = await mcpCall(client, "tasken.export_ai_context", { format: "markdown" });
    assert.equal(mcpMarkdown.content[0].text, markdown);
    assert.equal(mcpMarkdown.structuredContent, undefined);
  } finally { await host.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("Wave 8 applies visibility before caps and recursively removes secret/path/resource fields", () => {
  const core = createTaskenCore(new FixturePersistence(fixture()));
  const activity = core.getActivity.execute({ date: "2026-08-21", timezone: "Asia/Tokyo", limit: 1 });
  assert.deepEqual(activity.events.map((entry) => entry.id), ["event-wave8"]);
  assert.equal(activity.result_meta.matched_visible_count, 1);
  const graph = core.getContextSubgraph.execute({ entity_type: "task", entity_id: "task-wave8" });
  assert.ok(graph.nodes.some((node) => node.id === "task-wave8"));
  assert.ok(graph.nodes.some((node) => node.id === "note-wave8"));
  assert.ok(graph.nodes.some((node) => node.id === "knowledge-wave8"));
  assert.equal(graph.nodes.some((node) => node.id === "task-hidden"), false);
  assert.equal(graph.paths.some((entry) => entry.hops === 2), true);
  const exported = core.exportAiContext.execute({ format: "json", max_items: 1, max_notes: 1, max_knowledge_nodes: 1, max_chars: 20 });
  assert.equal(exported.resources[0].source_url, "https://example.com/private");
  assert.equal("local_path" in exported.resources[0], false);
  assert.equal("token" in exported.resources[0], false);
  assert.doesNotMatch(JSON.stringify({ graph, exported }), /PRIVATE|user:pass|token=SECRET|C:\/private|#frag|local_path/);
  const m365 = core.exportAiContext.execute({ format: "json", audience: "m365" });
  assert.deepEqual(m365.themes.map((entry) => entry.id), ["theme-m365"]);
  assert.deepEqual(m365.items.map((entry) => entry.id), ["task-m365"]);
  assert.deepEqual(m365.notes.map((entry) => entry.id), ["note-m365"]);
  assert.deepEqual(m365.knowledge_nodes.map((entry) => entry.id), ["knowledge-m365"]);
  assert.deepEqual(m365.resources.map((entry) => entry.id), ["resource-m365"]);
  assert.equal(m365.ai_audience, "m365");
});

test("Wave 8 public inputs, named capabilities, and nested responses fail closed", async () => {
  const core = createTaskenCore(new FixturePersistence(fixture()));
  assert.throws(() => core.getActivity.execute({ event_kinds: Array.from({ length: 21 }, () => "kind") }));
  assert.throws(() => core.getContextSubgraph.execute({ entity_type: "task", entity_id: "task-wave8", max_edges: 0 }));
  assert.throws(() => core.exportAiContext.execute({ format: "json", max_items: 101 }));
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave8-client-"));
  const discoveryPath = path.join(root, "tasken-core.json");
  fs.writeFileSync(discoveryPath, JSON.stringify({ schema_version: 1, api_version: "1", origin: "http://127.0.0.1:43210", token: Buffer.alloc(32, 7).toString("base64url"), capabilities: [] }), { mode: 0o600 });
  fs.chmodSync(discoveryPath, 0o600);
  try {
    let fetchCalls = 0;
    const noCapability = new TaskenCoreClient({ discoveryPath, fetch: async () => { fetchCalls += 1; } });
    for (const [method, request] of [["getActivity", {}], ["getContextSubgraph", { entity_type: "task", entity_id: "x" }], ["exportAiContext", {}]]) {
      await assert.rejects(noCapability[method](request), (error) => error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE");
    }
    assert.equal(fetchCalls, 0);
    fs.writeFileSync(discoveryPath, JSON.stringify({ schema_version: 1, api_version: "1", origin: "http://127.0.0.1:43210", token: Buffer.alloc(32, 7).toString("base64url"), capabilities: ["get_activity"] }), { mode: 0o600 });
    const malformed = new TaskenCoreClient({ discoveryPath, fetch: async () => new Response(JSON.stringify({ schema_version: 1, timezone: "UTC", date: null, events: [], excluded_count: 0, excluded_reasons: [], truncated: false, activity: { schema_version: 1, timezone: "UTC", date: null, events: [], excluded_count: 0, excluded_reasons: [], truncated: false, nested_extra: true }, format: "json", result_meta: { contract_version: 1, returned_count: 0, matched_visible_count: 0, truncated: false }, ai_audience: "coding_agent", read_only: true }), { status: 200, headers: { "content-type": "application/json", "x-tasken-core-version": "1" } }) });
    await assert.rejects(malformed.getActivity({}), (error) => error instanceof TaskenCoreClientError && error.code === "INVALID_RESPONSE");

    const unsafeGraph = structuredClone(core.getContextSubgraph.execute({ entity_type: "task", entity_id: "task-wave8" }));
    unsafeGraph.nodes[0].access_token = "MALICIOUS_RESPONSE_SECRET";
    fs.writeFileSync(discoveryPath, JSON.stringify({ schema_version: 1, api_version: "1", origin: "http://127.0.0.1:43210", token: Buffer.alloc(32, 7).toString("base64url"), capabilities: ["get_context_subgraph"] }), { mode: 0o600 });
    const unsafeGraphClient = new TaskenCoreClient({ discoveryPath, fetch: async () => new Response(JSON.stringify(unsafeGraph), { status: 200, headers: { "content-type": "application/json", "x-tasken-core-version": "1" } }) });
    await assert.rejects(unsafeGraphClient.getContextSubgraph({ entity_type: "task", entity_id: "task-wave8" }), (error) => error instanceof TaskenCoreClientError && error.code === "INVALID_RESPONSE");

    const unsafeExport = structuredClone(core.exportAiContext.execute({ format: "json" }));
    unsafeExport.resources[0].constructor = "prototype-pollution";
    fs.writeFileSync(discoveryPath, JSON.stringify({ schema_version: 1, api_version: "1", origin: "http://127.0.0.1:43210", token: Buffer.alloc(32, 7).toString("base64url"), capabilities: ["export_ai_context"] }), { mode: 0o600 });
    const unsafeExportClient = new TaskenCoreClient({ discoveryPath, fetch: async () => new Response(JSON.stringify(unsafeExport), { status: 200, headers: { "content-type": "application/json", "x-tasken-core-version": "1" } }) });
    await assert.rejects(unsafeExportClient.exportAiContext({ format: "json" }), (error) => error instanceof TaskenCoreClientError && error.code === "INVALID_RESPONSE");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Wave 8 MCP registrations contain no legacy read-context fallback", () => {
  const source = fs.readFileSync(new URL("../src/main/mcp/server.mjs", import.meta.url), "utf8");
  for (const method of ["toolGetActivity", "toolGetContextSubgraph", "toolExportAiContext"]) assert.equal(source.includes(`context.${method}`), false, method);
});
