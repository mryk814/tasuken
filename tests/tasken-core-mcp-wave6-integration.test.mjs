import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
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

const now = "2026-08-21T00:00:00.000Z";

function fixture() {
  const repository = {
    id: "repository-wave6",
    label: "Wave 6 repo",
    provider: "github",
    canonical_url: "https://user:secret@github.com/acme/wave6.git?token=secret#private",
    local_path: "C:\\Users\\private\\wave6",
    repository_slug: "acme/wave6",
    active: true,
    updated_at: now,
  };
  const theme = {
    id: "theme-wave6",
    name: "Wave 6",
    description: "Theme description",
    repository_context_ids: [repository.id, "repository-subdir", "repository-amb-a", "repository-amb-b"],
    default_ai_visibility: ["coding_agent"],
    updated_at: now,
  };
  return {
    themes: [
      theme,
      { id: "theme-hidden", name: "Hidden", repository_context_ids: ["repository-hidden"], default_ai_visibility: [], updated_at: now },
      { id: "theme-archived", name: "Archived", repository_context_ids: ["repository-archived"], default_ai_visibility: ["coding_agent"], deleted_at: now, updated_at: now },
    ],
    repository_contexts: [
      repository,
      { ...repository, id: "repository-subdir", label: "Subdir", subdirectory: "packages/core" },
      { ...repository, id: "repository-amb-a", label: "Ambiguous A" },
      { ...repository, id: "repository-amb-b", label: "Ambiguous B" },
      { id: "repository-hidden", provider: "local", local_path: "C:\\Users\\private\\hidden", active: true, updated_at: now },
      { ...repository, id: "repository-archived", label: "Archived repo", deleted_at: now },
    ],
    tasks: [
      { id: "task-wave6", title: "Open Wave 6", description: "Do the work", state: "doing", project_id: theme.id, updated_at: now },
      { id: "task-done", title: "Done Wave 6", state: "done", project_id: theme.id, updated_at: "2026-08-20T00:00:00.000Z" },
      { id: "task-hidden", title: "Hidden work", state: "doing", project_id: "theme-hidden", updated_at: now },
      { id: "task-archived", title: "Archived work", state: "doing", project_id: "theme-archived", deleted_at: now, updated_at: now },
    ],
    notes: [
      { id: "note-wave6", title: "Wave 6 note", body_markdown: "A".repeat(2_000), project_id: theme.id, updated_at: now },
    ],
    knowledge_nodes: [
      { id: "knowledge-wave6", title: "Wave knowledge", body: "Knowledge", theme_id: theme.id, updated_at: now },
    ],
    canonical_root_status: {},
  };
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
    return Object.fromEntries(Object.entries(this.workspace).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.filter((record) => includeDeleted || !record.deleted_at) : value,
    ]));
  }
}

async function callMcp(coreClient, name, args) {
  const server = createTaskenMcpServer({
    coreClient,
    readOnly: true,
    readContextProvider: () => { throw new Error("LEGACY_DB_FALLBACK_SENTINEL"); },
  });
  const client = new Client({ name: "wave6-integration", version: "1.0.0" });
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

test("Wave 6 repository/theme reads are exact across legacy, Core, HTTP, and pure MCP", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave6-integration-"));
  fs.chmodSync(root, 0o700);
  const workspace = fixture();
  const core = createTaskenCore(new FixturePersistence(workspace));
  const host = new TaskenCoreHost({ userDataPath: root, ...core });
  const legacy = new ReadOnlyTaskenContext("ignored.sqlite", { workspace, aiVisibilityDefault: ["coding_agent"] });
  try {
    await host.start();
    const client = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
    const cases = [
      ["tasken.find_themes_for_repository", { remote_url: "https://github.com/acme/wave6", git_root: "C:\\Users\\private\\wave6", workspace_folder: "C:\\Users\\private\\wave6" }, "findThemesForRepository", "toolFindThemesForRepository"],
      ["tasken.get_repository_context", { repository_context_id: "repository-wave6" }, "getRepositoryContext", "toolGetRepositoryContext"],
      ["tasken.get_theme_context", { theme_id: "theme-wave6", max_chars: 80 }, "getThemeContext", "toolGetThemeContext"],
    ];
    for (const [tool, request, method, legacyMethod] of cases) {
      const expected = legacy[legacyMethod](request);
      const inProcess = core[method].execute(request);
      const overHttp = await client[method](request);
      const overMcp = await callMcp(client, tool, request);
      assert.deepEqual(inProcess, expected, `${tool} Core legacy parity`);
      const wireShape = JSON.parse(JSON.stringify(inProcess));
      assert.deepEqual(overHttp, wireShape, `${tool} HTTP parity`);
      assert.deepEqual(overMcp.structuredContent, wireShape, `${tool} MCP parity`);
      assert.equal(overMcp.isError, undefined);
    }

    const repository = await client.getRepositoryContext({ repository_context_id: "repository-wave6" });
    assert.equal(repository.repository_context.canonical_url, "https://github.com/acme/wave6");
    assert.equal("local_path" in repository.repository_context, false);
    assert.doesNotMatch(JSON.stringify(repository), /user:secret|token=secret|Users\\\\private/);
    assert.equal((await client.getRepositoryContext({ repository_context_id: "repository-hidden" })).repository_context, null);
    const ambiguous = await client.findThemesForRepository({
      remote_url: "https://github.com/acme/wave6",
      git_root: "C:\\Users\\private\\wave6",
      workspace_folder: "C:\\Users\\private\\wave6",
    });
    assert.equal(ambiguous.status, "ambiguous");
    assert.deepEqual(ambiguous.candidates.map((candidate) => candidate.context.id), ["repository-amb-a", "repository-amb-b", "repository-wave6"]);
    const subdirectory = await client.findThemesForRepository({
      remote_url: "https://github.com/acme/wave6",
      git_root: "C:\\Users\\private\\wave6",
      workspace_folder: "C:\\Users\\private\\wave6\\packages\\core\\src",
    });
    assert.equal(subdirectory.status, "matched");
    assert.equal(subdirectory.selected.id, "repository-subdir");
    assert.equal((await client.getRepositoryContext({ repository_context_id: "repository-archived" })).repository_context, null);
    const archived = await client.getRepositoryContext({ repository_context_id: "repository-archived", include_archived: true });
    assert.equal(archived.repository_context.id, "repository-archived");
    assert.deepEqual(archived.themes.map((entry) => entry.id), ["theme-archived"]);
    assert.deepEqual(archived.tasks.map((entry) => entry.id), ["task-archived"]);

    const theme = await client.getThemeContext({ theme_id: "theme-wave6", max_chars: 80 });
    assert.equal(theme.truncated, true);
    assert.equal(theme.warnings.some((warning) => warning.code === "text_truncated"), true);
    assert.equal(theme.open_items.some((item) => item.id === "task-done"), false);
    assert.equal(theme.open_items.some((item) => item.id === "task-hidden"), false);
    for (const [limit, expectedNodes, expectedEdges] of [[1, 1, 4], [50, 50, 200], [100, 100, 200]]) {
      const bounded = core.getThemeContext.execute({ theme_id: "theme-wave6", limit });
      assert.equal(bounded.limits.graph.maxNodes, expectedNodes);
      assert.equal(bounded.limits.graph.maxEdges, expectedEdges);
    }

    const discovery = JSON.parse(fs.readFileSync(path.join(root, "tasken-core.json"), "utf8"));
    const overMaximum = await fetch(`${discovery.origin}/v1/queries/get-theme-context`, {
      method: "POST",
      headers: { authorization: `Bearer ${discovery.token}`, "content-type": "application/json" },
      body: JSON.stringify({ theme_id: "theme-wave6", limit: 101 }),
    });
    assert.equal(overMaximum.status, 400);
    assert.equal((await overMaximum.json()).error.code, "VALIDATION_FAILED");
  } finally {
    legacy.close();
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Wave 6 capabilities fail before fetch and malformed responses fail closed", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave6-client-"));
  const discoveryPath = path.join(root, "tasken-core.json");
  const writeDiscovery = (capabilities) => {
    fs.writeFileSync(discoveryPath, JSON.stringify({
      schema_version: 1,
      api_version: "1",
      origin: "http://127.0.0.1:43210",
      token: Buffer.alloc(32, 6).toString("base64url"),
      capabilities,
    }), { mode: 0o600 });
    fs.chmodSync(discoveryPath, 0o600);
  };
  try {
    writeDiscovery([]);
    let fetchCalls = 0;
    const noCapability = new TaskenCoreClient({ discoveryPath, fetch: async () => { fetchCalls += 1; } });
    for (const [method, request] of [
      ["findThemesForRepository", {}],
      ["getRepositoryContext", { repository_context_id: "repository-wave6" }],
      ["getThemeContext", { theme_id: "theme-wave6" }],
    ]) {
      await assert.rejects(noCapability[method](request), (error) => error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE");
    }
    assert.equal(fetchCalls, 0);

    writeDiscovery(["get_theme_context"]);
    const invalid = new TaskenCoreClient({
      discoveryPath,
      fetch: async () => new Response(JSON.stringify({ read_only: false, ai_audience: "coding_agent" }), {
        headers: { "content-type": "application/json", "x-tasken-core-version": "1" },
      }),
    });
    await assert.rejects(invalid.getThemeContext({ theme_id: "theme-wave6" }), (error) => error instanceof TaskenCoreClientError && error.code === "INVALID_RESPONSE");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Wave 6 MCP registrations contain no legacy/native fallback", () => {
  const source = fs.readFileSync("src/main/mcp/server.mjs", "utf8");
  for (const [tool, method] of [
    ["tasken.find_themes_for_repository", "findThemesForRepository"],
    ["tasken.get_repository_context", "getRepositoryContext"],
    ["tasken.get_theme_context", "getThemeContext"],
  ]) {
    const start = source.indexOf(`server.registerTool("${tool}"`);
    const end = source.indexOf("server.registerTool(", start + 20);
    const registration = source.slice(start, end);
    assert.match(registration, new RegExp(`withCoreClient\\(\\(args\\) => coreClient\\.${method}`));
    assert.doesNotMatch(registration, /withReadContext|ReadOnlyTaskenContext|better-sqlite3/);
  }
});
