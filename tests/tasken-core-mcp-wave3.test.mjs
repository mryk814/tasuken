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
import { TaskenCoreClient, TaskenCoreClientError } from "../src/main/mcp/taskenCoreClient.mjs";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import {
  publicReceiptForContext,
  safeReceiptText,
  safeReceiptValue,
  TaskContextTextBudget,
} from "../src/shared/taskContext.mjs";

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
  const theme = {
    id: "theme-visible",
    name: "Visible",
    state: "active",
    default_ai_visibility: ["coding_agent"],
    repository_context_ids: ["repo-visible"],
    primary_repository_context_id: "repo-visible",
    updated_at: now,
  };
  const task = {
    id: "task-visible",
    title: "Wave 3 context",
    description: "D".repeat(20_000),
    state: "todo",
    priority: "high",
    project_id: theme.id,
    requester: "human",
    intended_executor: "ai_agent",
    work_state: "in_progress",
    repository_context_mode: "inherit",
    updated_at: now,
  };
  const notes = Array.from({ length: 45 }, (_, index) => ({
    id: `note-${String(index).padStart(2, "0")}`,
    title: `Note ${index}`,
    body_markdown: `Body ${index} ${"N".repeat(2_000)}`,
    project_id: theme.id,
    updated_at: new Date(Date.parse(now) - index * 1_000).toISOString(),
  }));
  notes.push({
    id: "note-hidden",
    title: "Private",
    body_markdown: "HIDDEN_BODY_SENTINEL",
    project_id: theme.id,
    ai_visibility: [],
    updated_at: now,
  });
  const conversation = {
    id: "conversation-visible",
    title: "Conversation",
    description: "Agent discussion",
    body_markdown: "Conversation body",
    url: "https://alice:secret@example.com/private?token=URL_SECRET#fragment",
    resource_scope: "chat_ref",
    project_id: theme.id,
    updated_at: now,
  };
  const artifact = {
    id: "artifact-visible",
    title: "Artifact",
    filename: "report.json",
    stored_path: "C:/Users/private/report.json",
    original_path: "/home/private/source.json",
    source_type: "task",
    source_id: task.id,
    project_id: theme.id,
    updated_at: now,
  };
  const references = [
    ...notes.map((note, index) => ({
      id: `ref-note-${index}`,
      source_type: "task",
      source_id: task.id,
      target_type: "note",
      target_id: note.id,
      relation_type: "context",
    })),
    {
      id: "ref-conversation",
      source_type: "task",
      source_id: task.id,
      target_type: "resource",
      target_id: conversation.id,
      relation_type: "context",
    },
    {
      id: "ref-artifact",
      source_type: "task",
      source_id: task.id,
      target_type: "artifact",
      target_id: artifact.id,
      relation_type: "created_for",
    },
  ];
  const receipt = {
    id: "receipt-visible",
    task_id: task.id,
    executor_kind: "ai_agent",
    executor_label: "Codex",
    summary:
      "普通の説明は保持。 token=TOP_SECRET C:\\Users\\private\\receipt.txt /home/private/receipt.txt https://bob:password@example.com/report?api_key=URL_KEY#x",
    completed_items: ["kept prose", "password=VERY_SECRET", "/mnt/c/private/item.txt"],
    changed_or_created_items: ["src/main/core/service.ts"],
    verification: ["Bearer abcdefghijklmnopqrstuvwxyz"],
    remaining_work: ["human review"],
    source_session: "secret=SESSION_SECRET",
    provenance: {
      reported_via: "mcp",
      caller: "codex",
      source_session: "/tmp/private/session.json",
      proposal_id: "proposal-safe",
    },
    external_references: [
      {
        kind: "issue token=KIND_SECRET",
        provider: "github secret=EXTERNAL_PROVIDER_SECRET",
        display_label: "safe issue C:\\private\\label.txt",
        url: "https://bob:password@example.com/report?api_key=URL_KEY#fragment",
        external_id: "token=EXTERNAL_ID_SECRET",
      },
    ],
    repository_context: {
      repository_context_id: "repo-visible",
      provider: "github token=REPO_PROVIDER_SECRET",
      repository_slug: "mryk814/tasuken",
      branch: "codex/wave3 secret=BRANCH_SECRET",
      cwd: "C:/private/repo",
    },
    runtime_metadata: {
      provider: "openai token=RUNTIME_PROVIDER_SECRET",
      model: "gpt-5.6 secret=MODEL_SECRET",
      report_kind: "done api_key=REPORT_SECRET",
      diagnostic_path: "/tmp/private/diagnostic",
    },
    updated_at: now,
  };
  return {
    themes: [
      theme,
      {
        id: "theme-hidden",
        name: "Hidden",
        state: "active",
        default_ai_visibility: ["m365"],
        updated_at: now,
      },
      {
        id: "theme-archived-private",
        name: "Archived private",
        state: "active",
        default_ai_visibility: ["m365"],
        deleted_at: now,
        updated_at: now,
      },
    ],
    tasks: [
      task,
      { ...task, id: "task-hidden", title: "Hidden", project_id: "theme-hidden" },
      {
        ...task,
        id: "task-active-under-archived-private-theme",
        title: "Active under archived private Theme",
        project_id: "theme-archived-private",
      },
      { ...task, id: "task-archived", title: "Archived", deleted_at: now },
    ],
    notes,
    resources: [conversation],
    artifacts: [artifact],
    references,
    work_receipts: [receipt],
    repository_contexts: [
      {
        id: "repo-visible",
        label: "Tasuken",
        provider: "github",
        canonical_url: "https://github.com/mryk814/tasuken",
        canonical_identity: "github.com/mryk814/tasuken",
        repository_slug: "mryk814/tasuken",
        remote_aliases: ["git@github.com:mryk814/tasuken.git"],
        local_path: "C:/Users/private/tasuken",
        active: true,
        updated_at: now,
      },
    ],
    change_events: [
      buildActivityEvent({
        id: "event-visible",
        entityType: "task",
        entityId: task.id,
        changeType: "updated",
        eventKind: "task_ai_reported",
        occurredAt: now,
        before: { ...task, work_state: "ready_for_agent" },
        after: task,
      }),
    ],
    canonical_root_status: { schema: "tasken-activity-roots/v1", roots: [] },
  };
}

class FixtureRepository {
  constructor(workspace) {
    this.workspace = workspace;
    this.calls = [];
  }

  list(type, includeDeleted = false) {
    this.calls.push({ operation: "list", type, includeDeleted });
    const collection = `${type.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())}s`;
    const key =
      {
        theme: "themes",
        task: "tasks",
        repository_context: "repository_contexts",
        work_receipt: "work_receipts",
      }[type] || collection;
    const records = this.workspace[key] || [];
    return records.filter((record) => includeDeleted || !record.deleted_at);
  }

  loadWorkspace(includeDeleted = false) {
    this.calls.push({ operation: "loadWorkspace", includeDeleted });
    return this.readWorkspaceSnapshot(includeDeleted);
  }

  readWorkspaceSnapshot(includeDeleted = false) {
    this.calls.push({ operation: "readWorkspaceSnapshot", includeDeleted });
    return Object.fromEntries(
      Object.entries(this.workspace).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? value.filter((record) => includeDeleted || !record.deleted_at)
          : value,
      ]),
    );
  }

  readPreference(key) {
    this.calls.push({ operation: "getPreference", key });
    return ["coding_agent"];
  }
}

async function callMcp(
  coreClient,
  name,
  args,
  readContextProvider = () => {
    throw new Error("DB_CONSTRUCTOR_SENTINEL");
  },
) {
  const server = createTaskenMcpServer({ coreClient, readContextProvider, readOnly: true });
  const client = new Client({ name: "tasken-core-wave3-test", version: "1.0.0" });
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

test("MCP Wave 3 get_task_context is exact across legacy, in-process, HTTP, and MCP", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-wave3-"));
  const workspace = fixture();
  const repository = new FixtureRepository(workspace);
  const core = createTaskenCore(repository);
  const host = new TaskenCoreHost({ userDataPath: root, ...core });
  const legacy = new ReadOnlyTaskenContext("wave3.sqlite", {
    workspace,
    aiVisibilityDefault: ["coding_agent"],
  });
  try {
    await host.start();
    const client = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
    const discovery = JSON.parse(fs.readFileSync(path.join(root, "tasken-core.json"), "utf8"));
    assert.ok(discovery.capabilities.includes("get_task_context"));
    for (const request of [
      {
        task_id: "task-visible",
        max_items_per_type: 3,
        max_text_length: 4_000,
        workspace: { remote_url: "git@github.com:mryk814/tasuken.git", cwd: "/private/tasuken" },
      },
      { task_id: "task-visible", include: ["repository"], max_text_length: 5_000 },
      { task_id: "task-hidden" },
      { task_id: "task-active-under-archived-private-theme" },
      { task_id: "task-archived" },
      { task_id: "task-archived", include_archived: true, max_items_per_type: 1 },
      { task_id: "missing" },
    ]) {
      const expected = legacy.toolGetTaskContext(request);
      if (request.task_id === "task-active-under-archived-private-theme") {
        assert.equal(expected.error.code, "not_found");
        assert.equal(expected.excluded_count, 1);
      }
      assert.deepEqual(core.getTaskContext.execute(request), expected);
      assert.deepEqual(await client.getTaskContext(request), expected);
      const mcp = await callMcp(client, "tasken.get_task_context", request);
      assert.equal(mcp.isError, undefined);
      assert.deepEqual(JSON.parse(mcp.content[0].text), expected);
    }
  } finally {
    legacy.close();
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Wave 3 preserves graph/text bounds and redacts receipt, URL, and local path secrets", () => {
  const workspace = fixture();
  const legacy = new ReadOnlyTaskenContext("wave3-security.sqlite", {
    workspace,
    aiVisibilityDefault: ["coding_agent"],
  });
  const core = createTaskenCore(new FixtureRepository(workspace));
  try {
    const request = { task_id: "task-visible", max_items_per_type: 25, max_text_length: 100_000 };
    const result = core.getTaskContext.execute(request);
    assert.deepEqual(result, legacy.toolGetTaskContext(request));
    assert.ok(result.context_graph.nodes.length <= 100);
    assert.ok(result.context_graph.edges.length <= 200);
    assert.ok(result.context_selection.estimated_characters <= 100_000);
    assert.equal(
      result.related.notes.some((note) => note.id === "note-hidden"),
      false,
    );
    assert.equal(result.related.work_receipts[0].summary.includes("普通の説明は保持"), true);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(
      serialized,
      /TOP_SECRET|VERY_SECRET|SESSION_SECRET|URL_SECRET|URL_KEY|KIND_SECRET|EXTERNAL_PROVIDER_SECRET|EXTERNAL_ID_SECRET|REPO_PROVIDER_SECRET|BRANCH_SECRET|RUNTIME_PROVIDER_SECRET|MODEL_SECRET|REPORT_SECRET|alice:secret|bob:password/,
    );
    assert.doesNotMatch(serialized, /C:\\\\Users|\/home\/private|\/mnt\/c\/private|\/tmp\/private/);
    assert.doesNotMatch(serialized, /HIDDEN_BODY_SENTINEL/);
    assert.doesNotMatch(serialized, /local_path|stored_path|original_path|diagnostic_path/);
    assert.equal(
      result.related.work_receipts[0].external_references[0].url,
      "https://example.com/report",
    );
    assert.doesNotMatch(
      result.related.work_receipts[0].external_references[0].url,
      /redacted-local-path/,
    );
    assert.equal(
      safeReceiptText(
        "keep https://alice:secret@example.com/report?token=URL_SECRET#fragment C:\\private\\report.txt /home/private/report.txt token=TEXT_SECRET",
      ),
      "keep https://example.com/report [redacted-local-path] [redacted-local-path] token=[redacted]",
    );
  } finally {
    legacy.close();
  }
});

test("Wave 3 Task context uses canonical Note project_id for visibility", () => {
  const workspace = fixture();
  workspace.themes.push({
    id: "theme-private-note",
    name: "Private Note Theme",
    default_ai_visibility: [],
    updated_at: now,
  });
  workspace.notes.push(
    {
      id: "note-canonical-private",
      title: "Canonical private",
      body_markdown: "PRIVATE_CANONICAL_TASK_CONTEXT",
      project_id: "theme-private-note",
      theme_id: "theme-visible",
      updated_at: "2026-08-22T00:00:00.000Z",
    },
    {
      id: "note-canonical-public",
      title: "Canonical public",
      body_markdown: "canonical public task context",
      project_id: "theme-visible",
      theme_id: "theme-private-note",
      updated_at: "2026-08-22T00:00:01.000Z",
    },
  );
  workspace.references.push(
    {
      id: "ref-canonical-private",
      source_type: "task",
      source_id: "task-visible",
      target_type: "note",
      target_id: "note-canonical-private",
      relation_type: "context",
    },
    {
      id: "ref-canonical-public",
      source_type: "task",
      source_id: "task-visible",
      target_type: "note",
      target_id: "note-canonical-public",
      relation_type: "context",
    },
  );
  const core = createTaskenCore(new FixtureRepository(workspace));
  const result = core.getTaskContext.execute({ task_id: "task-visible", max_items_per_type: 100 });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /note-canonical-public|canonical public task context/);
  assert.equal(
    result.related.notes.some((note) => note.id === "note-canonical-private"),
    false,
  );
  assert.doesNotMatch(serialized, /PRIVATE_CANONICAL_TASK_CONTEXT/);
});

test("Work Receipt sanitizer rejects URL-like locators, local paths, and short authorization credentials across public fields", () => {
  const hostileCases = [
    {
      label: "summary file URL",
      leak: "SUMMARY_SECRET",
      apply: (receipt) => {
        receipt.summary = "file:///absolute/SUMMARY_SECRET/report.txt";
      },
    },
    {
      label: "list FTP credential",
      leak: "LIST_SECRET",
      apply: (receipt) => {
        receipt.completed_items = ["ftp://user:LIST_SECRET@example.com/report"];
      },
    },
    {
      label: "repository path scheme",
      leak: "REPOSITORY_SECRET",
      apply: (receipt) => {
        receipt.repository_context.branch = "path:/home/REPOSITORY_SECRET/work";
      },
    },
    {
      label: "runtime bracketed Windows path",
      leak: "RUNTIME_SECRET",
      apply: (receipt) => {
        receipt.runtime_metadata.model = "<C:\\Users\\RUNTIME_SECRET\\model.txt>";
      },
    },
    {
      label: "provenance Basic credential",
      leak: "QWxhZGRpbjpPcGVuU2VzYW1l",
      apply: (receipt) => {
        receipt.provenance.caller = "Basic QWxhZGRpbjpPcGVuU2VzYW1l";
      },
    },
    {
      label: "source session short Bearer credential",
      leak: "Bearer x",
      apply: (receipt) => {
        receipt.source_session = "Bearer x";
      },
    },
    {
      label: "external reference provider",
      leak: "EXTERNAL_SECRET",
      apply: (receipt) => {
        receipt.external_references[0].provider = "ftp://user:EXTERNAL_SECRET@example.com/item";
      },
    },
    {
      label: "external reference URL",
      leak: "EXTERNAL_URL_SECRET",
      apply: (receipt) => {
        receipt.external_references[0].url = "ftp://user:EXTERNAL_URL_SECRET@example.com/item";
      },
    },
  ];

  for (const hostile of hostileCases) {
    const receipt = structuredClone(fixture().work_receipts[0]);
    hostile.apply(receipt);
    const serialized = JSON.stringify(
      publicReceiptForContext(receipt, new TaskContextTextBudget(100_000)),
    );
    assert.equal(serialized.includes(hostile.leak), false, hostile.label);
    assert.match(serialized, /\[redacted(?:-url|-local-path)?\]/, hostile.label);
  }

  assert.equal(
    safeReceiptText("safe https://user:pass@example.com/report?token=SECRET#fragment"),
    "safe https://example.com/report",
  );
});

test("Work Receipt sanitizer preserves ordinary colon text and consumes complete credential assignments", () => {
  const cases = [
    ["authorization=Bearer short", "authorization=[redacted]"],
    ["password=Basic c2VjcmV0", "password=[redacted]"],
    ["pwd: Basic c2VjcmV0", "pwd=[redacted]"],
    ["token=Bearer x", "token=[redacted]"],
    ["Status: done", "Status: done"],
    ["ordinary key: value", "ordinary key: value"],
    ["x|https://user:pass@example.com/a?q=secret#fragment", "x|https://example.com/a"],
    ["file:///absolute/private.txt", "[redacted-url]"],
    ["ftp://user:pass@example.com/private", "[redacted-url]"],
    ["path:/home/private/x", "[redacted-url]"],
    ["<C:\\Users\\private\\x>", "<[redacted-local-path]>"],
    ["x|/home/private/x", "x|[redacted-local-path]"],
    ["label:/home/private/x", "label:[redacted-local-path]"],
    ["https://host/path", "https://host/path"],
    ["Bearer x", "Bearer [redacted]"],
    ["Basic c2VjcmV0", "Basic [redacted]"],
  ];
  for (const [input, expected] of cases) assert.equal(safeReceiptText(input), expected, input);
});

test("shared receipt sanitizer covers credential label variants, object fields, and single-component POSIX paths", () => {
  const cases = [
    ["authorizationToken=AUTH_CAMEL_SECRET", "authorizationToken=[redacted]"],
    ["authorization_token=AUTH_SNAKE_SECRET", "authorization_token=[redacted]"],
    ["client-secret: CLIENT_KEBAB_SECRET", "client-secret=[redacted]"],
    ["accessToken='ACCESS QUOTED SECRET'", "accessToken=[redacted]"],
    ["refresh-token=REFRESH_SECRET", "refresh-token=[redacted]"],
    ["privateKey=PRIVATE_KEY_SECRET", "privateKey=[redacted]"],
    ["credentials=CREDENTIAL_SECRET", "credentials=[redacted]"],
    ["cookie=COOKIE_SECRET", "cookie=[redacted]"],
    ["read /etc then /tmp", "read [redacted-local-path] then [redacted-local-path]"],
    ["Status: done; metadata: public", "Status: done; metadata: public"],
    [
      "safe https://example.com/docs/status?view=full#section",
      "safe https://example.com/docs/status",
    ],
  ];
  for (const [input, expected] of cases) assert.equal(safeReceiptText(input), expected, input);

  const sanitized = safeReceiptValue({
    authorizationToken: "OBJECT_AUTH_SECRET",
    client_secret: "OBJECT_CLIENT_SECRET",
    "credential=OBJECT_KEY_SECRET": "ordinary",
    nested: { detail: "access-token=OBJECT_VALUE_SECRET at /tmp" },
    metadata: "public",
    status: "ready",
    url: "https://example.com/docs/status?token=URL_QUERY_SECRET#URL_HASH_SECRET",
  });
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(
    serialized,
    /OBJECT_AUTH_SECRET|OBJECT_CLIENT_SECRET|OBJECT_KEY_SECRET|OBJECT_VALUE_SECRET|URL_QUERY_SECRET|URL_HASH_SECRET|\/tmp/,
  );
  assert.equal(sanitized.authorizationToken, "[redacted]");
  assert.equal(sanitized.client_secret, "[redacted]");
  assert.equal(sanitized.metadata, "public");
  assert.equal(sanitized.status, "ready");
  assert.equal(sanitized.url, "https://example.com/docs/status");
  assert.equal(sanitized["credential=[redacted]"], "ordinary");
});

test("migrated Wave 3 tool fails closed and named capability is required", async () => {
  const result = await callMcp(
    {
      getTaskContext: async () => {
        throw new Error("CORE_UNAVAILABLE_SENTINEL");
      },
    },
    "tasken.get_task_context",
    { task_id: "task-visible" },
  );
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /CORE_UNAVAILABLE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(result.content), /DB_CONSTRUCTOR_SENTINEL/);

  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-capability-wave3-"));
  const discoveryPath = path.join(root, "tasken-core.json");
  fs.writeFileSync(
    discoveryPath,
    JSON.stringify({
      schema_version: 1,
      api_version: "1",
      origin: "http://127.0.0.1:65535",
      token: Buffer.alloc(32, 7).toString("base64url"),
      capabilities: ["list_agent_ready_tasks"],
    }),
    { mode: 0o600 },
  );
  fs.chmodSync(discoveryPath, 0o600);
  try {
    await assert.rejects(
      new TaskenCoreClient({ discoveryPath }).getTaskContext({ task_id: "task-visible" }),
      (error) => error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("normal Node Wave 3 MCP path stays native-free", () => {
  const clientSource = fs.readFileSync("src/main/mcp/taskenCoreClient.mjs", "utf8");
  const serverSource = fs.readFileSync("src/main/mcp/server.mjs", "utf8");
  assert.doesNotMatch(clientSource, /better-sqlite3|readOnlyContext/);
  const registration = serverSource.slice(
    serverSource.search(/server\.registerTool\(\s*"tasken\.get_task_context"/),
    serverSource.search(/server\.registerTool\(\s*"tasken\.get_note"/),
  );
  assert.match(registration, /coreClient\.getTaskContext/);
  assert.doesNotMatch(registration, /withReadContext|ReadOnlyTaskenContext/);
});
