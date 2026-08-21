import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { build } from "esbuild";

import { ReadOnlyTaskenContext } from "./fixtures/legacyReadOnlyContext.mjs";
import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";

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
    themes: [
      {
        id: "theme-visible",
        name: "Visible",
        repository_context_ids: ["repo-visible"],
        primary_repository_context_id: "repo-visible",
        default_ai_visibility: ["coding_agent"],
        updated_at: now,
      },
      {
        id: "theme-hidden",
        name: "Hidden",
        repository_context_ids: ["repo-hidden"],
        default_ai_visibility: ["m365"],
        updated_at: now,
      },
      {
        id: "theme-archived-private",
        name: "Archived private",
        repository_context_ids: ["repo-archived-private"],
        default_ai_visibility: ["m365"],
        deleted_at: "2026-08-20T00:00:00.000Z",
        updated_at: now,
      },
    ],
    tasks: [
      {
        id: "task-visible",
        title: "Visible task",
        state: "todo",
        project_id: "theme-visible",
        intended_executor: "ai_agent",
        repository_context_mode: "inherit",
        repository_subdirectory: "packages/core",
        updated_at: "2026-08-21T03:00:00.000Z",
      },
      {
        id: "task-hidden",
        title: "Hidden task",
        state: "todo",
        project_id: "theme-hidden",
        intended_executor: "ai_agent",
        updated_at: "2026-08-21T02:00:00.000Z",
      },
      {
        id: "task-active-under-archived-private-theme",
        title: "Must remain private",
        state: "todo",
        project_id: "theme-archived-private",
        intended_executor: "ai_agent",
        updated_at: "2026-08-21T01:00:00.000Z",
      },
    ],
    repository_contexts: [
      {
        id: "repo-visible",
        label: "Tasuken",
        provider: "github",
        canonical_url: "https://github.com/mryk814/tasuken",
        canonical_identity: "github:mryk814/tasuken",
        repository_slug: "mryk814/tasuken",
        local_path: "/private/tasuken",
        active: true,
        updated_at: now,
      },
      {
        id: "repo-hidden",
        label: "Hidden",
        provider: "github",
        canonical_url: "https://github.com/private/hidden",
        canonical_identity: "github:private/hidden",
        repository_slug: "private/hidden",
        local_path: "/private/hidden",
        active: true,
        updated_at: now,
      },
      {
        id: "repo-archived-private",
        label: "Archived private",
        provider: "github",
        canonical_url: "https://github.com/private/archived",
        canonical_identity: "github:private/archived",
        repository_slug: "private/archived",
        local_path: "/private/archived",
        active: true,
        updated_at: now,
      },
    ],
    work_receipts: [
      { id: "receipt-new", task_id: "task-visible", summary: "new", reported_at: now, updated_at: "2026-08-21T03:30:00.000Z" },
      { id: "receipt-old", task_id: "task-visible", summary: "old", reported_at: now, updated_at: "2026-08-21T02:30:00.000Z" },
    ],
  };
}

class FixtureRepository {
  constructor(workspace) {
    this.workspace = workspace;
  }

  list(type, includeDeleted = false) {
    const records = this.workspace[`${type === "repository_context" ? "repository_context" : type}s`] || [];
    return records
      .filter((record) => includeDeleted || !record.deleted_at)
      .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
  }

  readPreference(key) {
    assert.equal(key, "aiVisibilityDefault");
    return ["coding_agent"];
  }
}

async function callMcp(coreClient, name, args, readContextProvider = () => {
  throw new Error("DB_CONSTRUCTOR_SENTINEL");
}) {
  const server = createTaskenMcpServer({ coreClient, readContextProvider, readOnly: true });
  const client = new Client({ name: "tasken-core-wave2-test", version: "1.0.0" });
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

test("MCP Wave 2 is exact across legacy, in-process, HTTP, and MCP", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave2-"));
  const workspace = fixture();
  const core = createTaskenCore(new FixtureRepository(workspace));
  const host = new TaskenCoreHost({ userDataPath: root, ...core });
  const legacy = new ReadOnlyTaskenContext("wave2.sqlite", { workspace, aiVisibilityDefault: ["coding_agent"] });
  try {
    await host.start();
    const client = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
    const discovery = JSON.parse(fs.readFileSync(path.join(root, "tasken-core.json"), "utf8"));
    for (const capability of [
      "list_agent_ready_tasks",
      "resolve_repository_context",
      "find_tasks_for_repository",
      "get_task_assignment",
      "get_task_context",
    ]) assert.ok(discovery.capabilities.includes(capability), capability);
    const cases = [
      ["tasken.resolve_repository_context", "toolResolveRepositoryContext", "resolveRepositoryContext", {
        remote_url: "git@github.com:mryk814/tasuken.git",
        git_root: "/private/tasuken",
        cwd: "/private/tasuken/packages/core",
      }],
      ["tasken.find_tasks_for_repository", "toolFindTasksForRepository", "findTasksForRepository", {
        remote_url: "https://github.com/mryk814/tasuken",
        git_root: "/private/tasuken",
        cwd: "/private/tasuken/packages/core",
      }],
      ["tasken.get_task_assignment", "toolGetTaskAssignment", "getTaskAssignment", {
        task_id: "task-visible",
        limit: 1,
      }],
      ["tasken.resolve_repository_context", "toolResolveRepositoryContext", "resolveRepositoryContext", {
        remote_url: "https://github.com/private/archived",
      }],
      ["tasken.find_tasks_for_repository", "toolFindTasksForRepository", "findTasksForRepository", {
        remote_url: "https://github.com/private/archived",
      }],
      ["tasken.get_task_assignment", "toolGetTaskAssignment", "getTaskAssignment", {
        task_id: "task-active-under-archived-private-theme",
      }],
    ];
    for (const [toolName, legacyMethod, clientMethod, request] of cases) {
      const expected = legacy[legacyMethod](request);
      const inProcess = core[clientMethod].execute(request);
      const http = await client[clientMethod](request);
      const mcp = await callMcp(client, toolName, request);
      assert.deepEqual(inProcess, expected, `${toolName}: in-process`);
      assert.deepEqual(http, expected, `${toolName}: HTTP`);
      assert.deepEqual(mcp.structuredContent, expected, `${toolName}: MCP`);
      assert.doesNotMatch(JSON.stringify(expected), /\/private\//);
      if (request.task_id === "task-active-under-archived-private-theme") {
        assert.equal(expected.task, null);
        assert.equal(expected.excluded_count, 1);
      }
    }

    for (const request of [
      { repository_slug: "missing/repository" },
      { repository_context_id: "repo-hidden" },
    ]) {
      assert.deepEqual(
        core.resolveRepositoryContext.execute(request),
        legacy.toolResolveRepositoryContext(request),
      );
      assert.deepEqual(
        core.findTasksForRepository.execute(request),
        legacy.toolFindTasksForRepository(request),
      );
    }
    for (const request of [
      { task_id: "missing" },
      { task_id: "task-hidden" },
      { task_id: "task-visible", limit: 100, include_archived: true },
    ]) {
      assert.deepEqual(
        core.getTaskAssignment.execute(request),
        legacy.toolGetTaskAssignment(request),
      );
    }
  } finally {
    legacy.close();
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("migrated Wave 2 tools fail closed without constructing the legacy DB context", async () => {
  const coreClient = {
    resolveRepositoryContext: async () => { throw new Error("CORE_UNAVAILABLE_SENTINEL"); },
    findTasksForRepository: async () => { throw new Error("CORE_UNAVAILABLE_SENTINEL"); },
    getTaskAssignment: async () => { throw new Error("CORE_UNAVAILABLE_SENTINEL"); },
  };
  for (const [name, args] of [
    ["tasken.resolve_repository_context", {}],
    ["tasken.find_tasks_for_repository", {}],
    ["tasken.get_task_assignment", { task_id: "task-visible" }],
  ]) {
    const result = await callMcp(coreClient, name, args);
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /CORE_UNAVAILABLE_SENTINEL/);
    assert.doesNotMatch(JSON.stringify(result.content), /DB_CONSTRUCTOR_SENTINEL/);
  }
});

test("normal Node MCP Wave 2 client remains native-free", () => {
  const graph = fs.readFileSync("src/main/mcp/taskenCoreClient.mjs", "utf8");
  assert.doesNotMatch(graph, /better-sqlite3|readOnlyContext/);
});

test("each Core client operation requires its named discovery capability before HTTP", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-capability-wave2-"));
  const discoveryPath = path.join(root, "tasken-core.json");
  const operations = [
    ["listAgentReadyTasks", "list_agent_ready_tasks", {}],
    ["resolveRepositoryContext", "resolve_repository_context", {}],
    ["findTasksForRepository", "find_tasks_for_repository", {}],
    ["getTaskAssignment", "get_task_assignment", { task_id: "task-visible" }],
  ];
  const allCapabilities = operations.map(([, capability]) => capability);
  try {
    for (const [method, missingCapability, request] of operations) {
      fs.writeFileSync(discoveryPath, JSON.stringify({
        schema_version: 1,
        api_version: "1",
        origin: "http://127.0.0.1:65535",
        token: Buffer.alloc(32, 7).toString("base64url"),
        capabilities: allCapabilities.filter((capability) => capability !== missingCapability),
      }), { mode: 0o600 });
      fs.chmodSync(discoveryPath, 0o600);
      let fetchCalls = 0;
      const client = new TaskenCoreClient({
        discoveryPath,
        fetch: async () => {
          fetchCalls += 1;
          throw new Error("HTTP_MUST_NOT_RUN");
        },
      });
      await assert.rejects(client[method](request), (error) => (
        error?.code === "CAPABILITY_UNAVAILABLE" && String(error.message).includes(missingCapability)
      ));
      assert.equal(fetchCalls, 0, method);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
