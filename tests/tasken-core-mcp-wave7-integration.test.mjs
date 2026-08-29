import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { ReadOnlyTaskenContext } from "./fixtures/legacyReadOnlyContext.mjs";
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
const record = (id, fields = {}) => ({
  id,
  created_at: timestamp,
  updated_at: timestamp,
  ...fields,
});

function fixture() {
  const publicTheme = record("theme-public", {
    name: "Public",
    default_ai_visibility: ["coding_agent"],
  });
  const privateTheme = record("theme-private", { name: "Private", default_ai_visibility: [] });
  const visibleNote = record("note-visible", {
    title: "Visible note",
    project_id: publicTheme.id,
    body_markdown: "visible note body",
  });
  const hiddenNote = record("note-hidden", {
    title: "Hidden note",
    project_id: privateTheme.id,
    body_markdown: "PRIVATE_NOTE",
  });
  const visibleClaim = record("knowledge-visible-claim", {
    title: "Visible query claim",
    body: "visible claim body",
    node_type: "claim",
    theme_id: publicTheme.id,
    source_note_id: visibleNote.id,
    source_type: "task",
    source_id: "task-visible",
  });
  const visibleEvidence = record("knowledge-visible-evidence", {
    title: "Visible evidence",
    body: "visible evidence body",
    node_type: "evidence",
    theme_id: publicTheme.id,
  });
  const hiddenNode = record("knowledge-hidden", {
    title: "Hidden query",
    body: "PRIVATE_KNOWLEDGE",
    node_type: "claim",
    theme_id: privateTheme.id,
  });
  return {
    themes: [publicTheme, privateTheme],
    notes: [visibleNote, hiddenNote],
    knowledge_nodes: [visibleClaim, visibleEvidence, hiddenNode],
    knowledge_edges: [
      record("edge-public", {
        source_node_id: visibleClaim.id,
        target_node_id: visibleEvidence.id,
        relation_type: "supports",
      }),
      record("edge-hidden", {
        source_node_id: visibleClaim.id,
        target_node_id: hiddenNode.id,
        relation_type: "similar_to",
      }),
    ],
    tasks: [
      record("task-visible", { title: "Visible task", state: "doing", project_id: publicTheme.id }),
    ],
    waitings: [],
    plan_nodes: [],
    schedules: [],
    items: [],
    links: [],
    resources: [],
  };
}

function equalTimestampCapFixture() {
  const publicTheme = record("theme-stable", {
    name: "Stable",
    default_ai_visibility: ["coding_agent"],
  });
  const descending = (prefix, count, fields) =>
    Array.from({ length: count }, (_, index) => {
      const padded = String(index).padStart(3, "0");
      return record(`${prefix}-${padded}`, fields(index, padded));
    }).reverse();
  const notes = descending("note-stable", 101, (index) => ({
    title: `Note ${index}`,
    body_markdown: "ordinary",
    project_id: publicTheme.id,
  }));
  const knowledgeNodes = descending("node-stable", 101, (index, padded) => ({
    title: `Question ${index}`,
    body: "ordinary",
    node_type: "question",
    theme_id: publicTheme.id,
    source_type: "note",
    source_id: `note-stable-${padded}`,
    source_note_id: `note-stable-${padded}`,
  }));
  const knowledgeEdges = descending("edge-stable", 205, () => ({
    source_node_id: "node-stable-000",
    target_node_id: "node-stable-001",
    relation_type: "supports",
  }));
  const tasks = descending("task-stable", 101, (index) => ({
    title: `Task ${index}`,
    state: "doing",
    project_id: publicTheme.id,
  }));
  return {
    themes: [publicTheme],
    notes,
    knowledge_nodes: knowledgeNodes,
    knowledge_edges: knowledgeEdges,
    tasks,
    waitings: [],
    plan_nodes: [],
    schedules: [],
    items: [],
    links: [],
    resources: [],
  };
}

function adversarialMetadata() {
  const metadata = {
    ordinary: "ordinary metadata",
    nested: {
      label: "ordinary nested label",
      apiKey: "NESTED_API_KEY_SECRET",
      accessToken: "NESTED_ACCESS_TOKEN_SECRET",
    },
  };
  Object.defineProperty(metadata, "__proto__", { value: "PROTO_SECRET", enumerable: true });
  Object.defineProperty(metadata, "constructor", { value: "CONSTRUCTOR_SECRET", enumerable: true });
  Object.defineProperty(metadata.nested, "prototype", {
    value: "PROTOTYPE_SECRET",
    enumerable: true,
  });
  return metadata;
}

class FixturePersistence {
  constructor(workspace) {
    this.workspace = workspace;
  }
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
  const {
    read_only: _readOnly,
    next_tools: _nextTools,
    truncated: _truncated,
    result_meta: _resultMeta,
    ...legacy
  } = value;
  return legacy;
}

async function mcpCall(coreClient, name, args) {
  const server = createTaskenMcpServer({
    coreClient,
    readOnly: true,
    readContextProvider: () => {
      throw new Error("READ_ONLY_CONTEXT_FALLBACK_SENTINEL");
    },
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
  const legacy = new ReadOnlyTaskenContext("ignored.sqlite", {
    workspace,
    aiVisibilityDefault: ["coding_agent"],
  });
  try {
    await host.start();
    const client = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
    const cases = [
      ["tasken.get_recent_notes", {}, "getRecentNotes", "toolGetRecentNotes"],
      ["tasken.search_knowledge", { query: "query" }, "searchKnowledge", "toolSearchKnowledge"],
      [
        "tasken.get_knowledge_context",
        { theme_id: "theme-public", include_relations: false },
        "getKnowledgeContext",
        "toolGetKnowledgeContext",
      ],
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
      assert.deepEqual(
        comparable,
        JSON.parse(JSON.stringify(expected)),
        `${tool} legacy transport fields`,
      );
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
  assert.deepEqual(
    result.knowledge_edges.map((edge) => edge.id),
    ["edge-public"],
  );
  assert.doesNotMatch(JSON.stringify(result), /edge-hidden|knowledge-hidden|PRIVATE_/);
});

test("Wave 7 Note visibility and Theme filters prefer canonical project_id", () => {
  const workspace = fixture();
  workspace.notes.push(
    record("note-canonical-private", {
      title: "Canonical private",
      body_markdown: "PRIVATE_CANONICAL_NOTE",
      project_id: "theme-private",
      theme_id: "theme-public",
    }),
    record("note-canonical-public", {
      title: "Canonical public",
      body_markdown: "canonical public body",
      project_id: "theme-public",
      theme_id: "theme-private",
    }),
  );
  const core = createTaskenCore(new FixturePersistence(workspace));
  const result = core.getRecentNotes.execute({ theme_id: "theme-public", include_raw_body: true });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /note-canonical-public|canonical public body/);
  assert.doesNotMatch(serialized, /note-canonical-private|PRIVATE_CANONICAL_NOTE/);
});

test("Wave 7 all five tools allowlist fields and recursively redact adversarial values", () => {
  const workspace = fixture();
  const hostileText =
    "ordinary accessToken=CAMEL_SECRET /etc/passwd /tmp/private C:\\Users\\me\\secret.txt https://user:pass@example.com/path?q=secret#fragment";
  workspace.notes[0].title = hostileText;
  workspace.notes[0].metadata = adversarialMetadata();
  workspace.notes[0].clientSecret = "TOP_LEVEL_NOTE_SECRET";
  workspace.knowledge_nodes[0].body = hostileText;
  workspace.knowledge_nodes[0].metadata = adversarialMetadata();
  workspace.knowledge_nodes[0].authorizationToken = "TOP_LEVEL_NODE_SECRET";
  workspace.knowledge_nodes[1].node_type = "question";
  workspace.knowledge_nodes[1].metadata = adversarialMetadata();
  workspace.knowledge_edges[0].description = hostileText;
  workspace.knowledge_edges[0].metadata = adversarialMetadata();
  workspace.resources.push(
    record("resource-adversarial", {
      title: hostileText,
      project_id: "theme-public",
      url: "https://user:pass@example.com/source?q=secret#fragment",
      metadata: adversarialMetadata(),
    }),
  );
  workspace.knowledge_nodes[1].source_type = "resource";
  workspace.knowledge_nodes[1].source_id = "resource-adversarial";
  workspace.tasks[0].title = hostileText;
  workspace.tasks[0].metadata = adversarialMetadata();

  const core = createTaskenCore(new FixturePersistence(workspace));
  const results = {
    notes: core.getRecentNotes.execute({}),
    search: core.searchKnowledge.execute({ query: "visible" }),
    context: core.getKnowledgeContext.execute({ theme_id: "theme-public", include_sources: true }),
    plan: core.getPlanHealth.execute({}),
    health: core.getKnowledgeHealth.execute({}),
  };
  for (const [name, result] of Object.entries(results)) {
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(
      serialized,
      /CAMEL_SECRET|NESTED_API_KEY_SECRET|NESTED_ACCESS_TOKEN_SECRET|TOP_LEVEL_|PROTO_SECRET|CONSTRUCTOR_SECRET|PROTOTYPE_SECRET|user:pass|q=secret|#fragment|\/etc\/passwd|\/tmp\/private|C:\\\\Users/i,
      name,
    );
    assert.match(serialized, /ordinary/, name);
  }
  assert.equal(results.notes.notes[0].metadata.ordinary, "ordinary metadata");
  assert.equal(results.search.knowledge_nodes[0].metadata.nested.label, "ordinary nested label");
  assert.equal(results.context.knowledge_edges[0].metadata.ordinary, "ordinary metadata");
  assert.equal(results.context.sources.resources[0].source_url, "https://example.com/source");
  assert.equal(results.context.sources.resources[0].metadata.ordinary, "ordinary metadata");
  assert.equal(
    results.health.issues.some((issue) => issue.node.metadata?.ordinary === "ordinary metadata"),
    true,
  );
  assert.equal(Object.prototype.polluted, undefined);
});

test("Wave 7 dense graph and health arrays are deterministically capped after visibility", () => {
  const workspace = fixture();
  workspace.knowledge_edges = Array.from({ length: 205 }, (_, index) =>
    record(`edge-dense-${String(index).padStart(3, "0")}`, {
      source_node_id: "knowledge-visible-claim",
      target_node_id: "knowledge-visible-evidence",
      relation_type: "supports",
    }),
  );
  workspace.knowledge_nodes.push(
    ...Array.from({ length: 101 }, (_, index) =>
      record(`question-dense-${String(index).padStart(3, "0")}`, {
        title: `Question ${index}`,
        body: "ordinary",
        node_type: "question",
        theme_id: "theme-public",
      }),
    ),
  );
  workspace.tasks.push(
    ...Array.from({ length: 101 }, (_, index) =>
      record(`task-dense-${String(index).padStart(3, "0")}`, {
        title: `Task ${index}`,
        state: "doing",
        project_id: "theme-public",
      }),
    ),
  );
  const core = createTaskenCore(new FixturePersistence(workspace));

  const context = core.getKnowledgeContext.execute({ theme_id: "theme-public", limit: 1 });
  assert.equal(context.knowledge_edges.length, 200);
  assert.equal(context.truncated, true);
  assert.equal(context.result_meta.returned_edge_count, 200);
  assert.equal(context.result_meta.matched_public_edge_count, 205);
  assert.equal(context.knowledge_edges[0].id, "edge-dense-000");
  assert.equal(context.knowledge_edges.at(-1).id, "edge-dense-199");

  const plan = core.getPlanHealth.execute({ theme_id: "theme-public" });
  assert.equal(plan.unscheduled_items.length, 100);
  assert.equal(plan.truncated, true);
  assert.equal(
    plan.result_meta.matched_visible_item_count > plan.result_meta.returned_item_count,
    true,
  );

  const health = core.getKnowledgeHealth.execute({ theme_id: "theme-public" });
  assert.equal(health.issues.length, 100);
  assert.equal(health.unresolved_questions.length, 100);
  assert.equal(health.truncated, true);
  assert.equal(
    health.result_meta.matched_issue_count > health.result_meta.returned_issue_count,
    true,
  );
});

test("Wave 7 equal-timestamp caps use stable id subsets across Core, HTTP, and MCP", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave7-stable-order-"));
  fs.chmodSync(root, 0o700);
  const workspace = equalTimestampCapFixture();
  const core = createTaskenCore(new FixturePersistence(workspace));
  const host = new TaskenCoreHost({ userDataPath: root, ...core });
  const expectedIds = (prefix, count) =>
    Array.from({ length: count }, (_, index) => `${prefix}-${String(index).padStart(3, "0")}`);
  const requests = [
    ["tasken.get_recent_notes", { theme_id: "theme-stable", limit: 100 }, "getRecentNotes"],
    ["tasken.search_knowledge", { theme_id: "theme-stable", limit: 100 }, "searchKnowledge"],
    [
      "tasken.get_knowledge_context",
      {
        theme_id: "theme-stable",
        limit: 100,
        include_relations: true,
        include_sources: true,
      },
      "getKnowledgeContext",
    ],
    ["tasken.get_plan_health", { theme_id: "theme-stable" }, "getPlanHealth"],
    ["tasken.get_knowledge_health", { theme_id: "theme-stable" }, "getKnowledgeHealth"],
  ];
  try {
    await host.start();
    const client = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
    const results = {};
    for (const [tool, request, method] of requests) {
      const inProcess = core[method].execute(request);
      assert.deepEqual(await client[method](request), inProcess, `${tool} HTTP stable order`);
      assert.deepEqual(
        (await mcpCall(client, tool, request)).structuredContent,
        inProcess,
        `${tool} MCP stable order`,
      );
      results[method] = inProcess;
    }

    assert.deepEqual(
      results.getRecentNotes.notes.map((entry) => entry.id),
      expectedIds("note-stable", 100),
    );
    assert.deepEqual(
      results.searchKnowledge.knowledge_nodes.map((entry) => entry.id),
      expectedIds("node-stable", 100),
    );
    assert.deepEqual(
      results.getKnowledgeContext.knowledge_nodes.map((entry) => entry.id),
      expectedIds("node-stable", 100),
    );
    assert.deepEqual(
      results.getKnowledgeContext.knowledge_edges.map((entry) => entry.id),
      expectedIds("edge-stable", 200),
    );
    assert.deepEqual(
      results.getKnowledgeContext.sources.notes.map((entry) => entry.id),
      expectedIds("note-stable", 100),
    );
    assert.deepEqual(
      results.getPlanHealth.unscheduled_items.map((entry) => entry.id),
      expectedIds("task-stable", 100),
    );
    assert.deepEqual(
      results.getKnowledgeHealth.unresolved_questions.map((entry) => entry.id),
      expectedIds("node-stable", 100),
    );

    const expectedIssueIds = expectedIds("node-stable", 101)
      .flatMap((id, index) => [
        `${id}:unanswered_question`,
        ...(index >= 2 ? [`${id}:isolated_node`] : []),
      ])
      .sort()
      .slice(0, 100);
    assert.deepEqual(
      results.getKnowledgeHealth.issues.map((entry) => entry.id),
      expectedIssueIds,
    );
  } finally {
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Wave 7 named capabilities fail before fetch and malformed responses fail closed", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave7-client-"));
  const discoveryPath = path.join(root, "tasken-core.json");
  const writeDiscovery = (capabilities) => {
    fs.writeFileSync(
      discoveryPath,
      JSON.stringify({
        schema_version: 1,
        api_version: "1",
        origin: "http://127.0.0.1:43210",
        token: Buffer.alloc(32, 7).toString("base64url"),
        capabilities,
      }),
      { mode: 0o600 },
    );
    fs.chmodSync(discoveryPath, 0o600);
  };
  try {
    writeDiscovery([]);
    let fetchCalls = 0;
    const noCapability = new TaskenCoreClient({
      discoveryPath,
      fetch: async () => {
        fetchCalls += 1;
      },
    });
    for (const [method, request] of [
      ["getRecentNotes", {}],
      ["searchKnowledge", {}],
      ["getKnowledgeContext", {}],
      ["getPlanHealth", {}],
      ["getKnowledgeHealth", {}],
    ]) {
      await assert.rejects(
        noCapability[method](request),
        (error) =>
          error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE",
      );
    }
    assert.equal(fetchCalls, 0);

    writeDiscovery(["get_recent_notes"]);
    const malformed = new TaskenCoreClient({
      discoveryPath,
      fetch: async () =>
        new Response(JSON.stringify({ notes: "not-an-array" }), {
          status: 200,
          headers: { "content-type": "application/json", "x-tasken-core-version": "1" },
        }),
    });
    await assert.rejects(
      malformed.getRecentNotes({}),
      (error) => error instanceof TaskenCoreClientError && error.code === "INVALID_RESPONSE",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Wave 7 MCP registrations reject the same nonempty and maximum inputs as shared contracts", async () => {
  let calls = 0;
  const rejectIfCalled = async () => {
    calls += 1;
    return {};
  };
  const coreClient = {
    getRecentNotes: rejectIfCalled,
    searchKnowledge: rejectIfCalled,
    getKnowledgeContext: rejectIfCalled,
    getPlanHealth: rejectIfCalled,
    getKnowledgeHealth: rejectIfCalled,
  };
  const cases = [
    ["tasken.get_recent_notes", { theme_id: "" }],
    ["tasken.get_recent_notes", { theme_id: "x".repeat(201) }],
    ["tasken.search_knowledge", { query: "" }],
    ["tasken.search_knowledge", { query: "x".repeat(1_001) }],
    ["tasken.search_knowledge", { node_types: [""] }],
    ["tasken.search_knowledge", { node_types: Array.from({ length: 9 }, () => "claim") }],
    ["tasken.get_knowledge_context", { theme_id: "" }],
    ["tasken.get_plan_health", { theme_id: "x".repeat(201) }],
    ["tasken.get_knowledge_health", { theme_id: "" }],
  ];
  for (const [name, args] of cases) {
    const result = await mcpCall(coreClient, name, args);
    assert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.match(result.content[0].text, /invalid|argument/i, `${name} ${JSON.stringify(args)}`);
  }
  assert.equal(calls, 0);
});

test("actual stdio MCP reads Wave 7/8 from Core-owned SQLite without writes or native fallback", async () => {
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
    const metaCountBefore = database.db
      .prepare("SELECT COUNT(*) AS count FROM workspace_meta")
      .get().count;
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
      ["tasken.get_activity", {}, "events"],
      ["tasken.get_context_subgraph", { entity_type: "task", entity_id: "task-visible" }, "nodes"],
      ["tasken.export_ai_context", { format: "json" }, "items"],
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
    assert.deepEqual(
      context.structuredContent.knowledge_edges.map((edge) => edge.id),
      ["edge-public"],
    );
    assert.doesNotMatch(
      JSON.stringify(context.structuredContent),
      /edge-hidden|knowledge-hidden|PRIVATE_/,
    );
    assert.equal(fs.existsSync(path.join(root, "must-not-be-opened.sqlite3")), false);
    assert.equal(
      database.db.prepare("SELECT COUNT(*) AS count FROM workspace_meta").get().count,
      metaCountBefore,
    );
    assert.equal(
      database.db.prepare("SELECT total_changes() AS count").get().count,
      totalChangesBefore,
    );
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
