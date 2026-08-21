import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { TaskenCoreClient, TaskenCoreClientError } from "../src/main/mcp/taskenCoreClient.mjs";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
} from "../src/shared/contracts/core/public.mjs";

const workspaceRepositoryModule = "../src/main/repositories/" + "workspaceRepository.mjs";
const { WorkspaceDatabase } = await import(workspaceRepositoryModule);
const bundledCore = await build({
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
  `data:text/javascript;base64,${Buffer.from(bundledCore.outputFiles[0].text).toString("base64")}`
);

function root(name) {
  const value = fs.mkdtempSync(path.join(process.cwd(), `.${name}-`));
  fs.chmodSync(value, 0o700);
  return value;
}

function requestIdentity(idempotencyKey) {
  return {
    idempotency_key: idempotencyKey,
    caller: "Codex",
    actor: { kind: "ai_agent", id: "agent-1" },
    source: "mcp",
    source_session: "session-1",
    source_app: "proposal-wave-b-test",
  };
}

test("Core persists normalized RepositoryContext and exact Task proposals with restart-safe identity idempotency", async () => {
  const userDataPath = root("tasken-repository-task-core");
  const database = new WorkspaceDatabase(path.join(userDataPath, "workspace.sqlite3"));
  let host;
  const start = async () => {
    host = new TaskenCoreHost({ userDataPath, ...createTaskenCore(database) });
    await host.start();
    return new TaskenCoreClient({ discoveryPath: path.join(userDataPath, "tasken-core.json") });
  };
  const repositoryRequest = {
    ...requestIdentity("repository-1"),
    kind: "repository_context",
    label: "Tasuken",
    provider: "github",
    remote_url: "https://github.com/mryk814/tasuken.git",
    web_url: "https://github.com/mryk814/tasuken",
    repository_slug: "mryk814/tasuken",
    subdirectory: "packages/core",
    default_branch: "main",
    reason: "Agent workspace",
  };
  try {
    let client = await start();
    const discovery = JSON.parse(fs.readFileSync(path.join(userDataPath, "tasken-core.json"), "utf8"));
    assert.equal(discovery.capabilities.includes(TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY), true);
    const wrongMethod = await fetch(`${discovery.origin}/v1/commands/propose-repository-task`, {
      headers: { authorization: `Bearer ${discovery.token}` },
    });
    assert.equal(wrongMethod.status, 405);
    const oversized = await fetch(`${discovery.origin}/v1/commands/propose-repository-task`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${discovery.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...repositoryRequest, padding: "x".repeat(70 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "BODY_TOO_LARGE");
    const first = await client.proposeRepositoryTask(repositoryRequest);
    assert.equal(first.status, "queued");
    assert.equal((await client.proposeRepositoryTask(repositoryRequest)).status, "duplicate");
    await host.stop();
    host = null;
    client = await start();
    assert.equal((await client.proposeRepositoryTask(repositoryRequest)).status, "duplicate");
    await assert.rejects(
      client.proposeRepositoryTask({ ...repositoryRequest, caller: "Another agent" }),
      (error) => error instanceof TaskenCoreClientError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      client.proposeRepositoryTask({
        ...repositoryRequest,
        idempotency_key: "repository-private",
        provider: "local",
        remote_url: undefined,
        web_url: undefined,
        repository_slug: undefined,
        local_path: "C:/private/tasuken",
      }),
      (error) => error instanceof TaskenCoreClientError && error.code === "VALIDATION_FAILED",
    );
    const task = await client.proposeRepositoryTask({
      ...requestIdentity("task-1"),
      kind: "task",
      title: "Proposed task",
      description: "Description",
      theme: "Theme",
      priority: "high",
      reason: "Needed",
    });
    assert.equal(task.payload_type, "items");
    const proposals = database.list("ai_proposal");
    assert.equal(proposals.length, 2);
    const repository = proposals.find((proposal) => proposal.id === first.proposal_id);
    assert.deepEqual(repository.payload, {
      repository_contexts: [{
        action: "create",
        label: "Tasuken",
        provider: "github",
        canonical_url: "https://github.com/mryk814/tasuken",
        canonical_identity: "github.com/mryk814/tasuken",
        repository_slug: "mryk814/tasuken",
        owner: "mryk814",
        name: "tasuken",
        web_url: "https://github.com/mryk814/tasuken",
        remote_aliases: ["https://github.com/mryk814/tasuken"],
        subdirectory: "packages/core",
        default_branch: "main",
        active: true,
        metadata: {},
        reason: "Agent workspace",
      }],
    });
    assert.equal(JSON.stringify(repository).includes("C:/private"), false);
    const taskProposal = proposals.find((proposal) => proposal.id === task.proposal_id);
    assert.deepEqual(taskProposal.payload, {
      items: [{
        action: "create",
        kind: "task",
        status: "todo",
        title: "Proposed task",
        description: "Description",
        theme: "Theme",
        priority: "high",
        planned_start: null,
        planned_end: null,
        reason: "Needed",
      }],
    });
    assert.deepEqual(taskProposal.request.actor, { kind: "ai_agent", id: "agent-1" });
    assert.equal(taskProposal.request.source_session, "session-1");
    assert.equal(fs.existsSync(path.join(userDataPath, "mcp-inbox")), false);
  } finally {
    await host?.stop();
    database.db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("Repository/Task proposal client requires its named capability and rejects additive responses", async () => {
  const userDataPath = root("tasken-repository-task-client");
  const discoveryPath = path.join(userDataPath, "tasken-core.json");
  const request = {
    ...requestIdentity("strict-response-1"),
    kind: "task",
    title: "Strict response",
  };
  const writeDiscovery = (capabilities) => {
    fs.writeFileSync(discoveryPath, JSON.stringify({
      schema_version: 1,
      api_version: TASKEN_CORE_API_VERSION,
      origin: "http://127.0.0.1:43123",
      token: Buffer.alloc(32, 1).toString("base64url"),
      capabilities,
      pid: process.pid,
      started_at: "2026-08-21T00:00:00.000Z",
    }), { mode: 0o600 });
    fs.chmodSync(discoveryPath, 0o600);
  };
  try {
    writeDiscovery([]);
    const unavailable = new TaskenCoreClient({ discoveryPath, fetch: async () => assert.fail("fetch must not run") });
    await assert.rejects(
      unavailable.proposeRepositoryTask(request),
      (error) => error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE",
    );
    writeDiscovery([TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY]);
    const strict = new TaskenCoreClient({
      discoveryPath,
      fetch: async () => new Response(JSON.stringify({
        proposal_id: "85efbb6c-54cf-5a66-8c21-b3072862b9d4",
        status: "queued",
        payload_type: "items",
        message: "queued",
        additive: true,
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-tasken-core-version": TASKEN_CORE_API_VERSION },
      }),
    });
    await assert.rejects(
      strict.proposeRepositoryTask(request),
      (error) => error instanceof TaskenCoreClientError
        && error.code === "INVALID_RESPONSE"
        && error.details?.operation === "propose-repository-task",
    );
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("actual MCP stdio queues both tools through Core and never falls back to filesystem inbox", async () => {
  const userDataPath = root("tasken-repository-task-stdio");
  const inboxPath = path.join(userDataPath, "must-not-exist");
  const database = new WorkspaceDatabase(path.join(userDataPath, "workspace.sqlite3"));
  const host = new TaskenCoreHost({ userDataPath, ...createTaskenCore(database) });
  await host.start();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: { ...process.env, TASKEN_USER_DATA_DIR: userDataPath, TASKEN_MCP_INBOX_PATH: inboxPath },
    stderr: "pipe",
  });
  const client = new Client({ name: "proposal-wave-b-stdio", version: "1.0.0" });
  try {
    await client.connect(transport);
    const repository = await client.callTool({
      name: "tasken.propose_repository_context",
      arguments: {
        idempotency_key: "stdio-repository-1",
        caller: "Codex",
        source_session: "stdio-session",
        label: "Tasuken",
        remote_url: "https://github.com/mryk814/tasuken.git",
      },
    });
    assert.equal(repository.isError, undefined);
    assert.equal(repository.structuredContent.payload_type, "repository_contexts");
    const task = await client.callTool({
      name: "tasken.propose_task",
      arguments: {
        idempotency_key: "stdio-task-1",
        caller: "Codex",
        source_session: "stdio-session",
        title: "Core-only proposal",
      },
    });
    assert.equal(task.isError, undefined);
    assert.equal(task.structuredContent.payload_type, "items");
    assert.equal(database.list("ai_proposal").length, 2);
    assert.equal(fs.existsSync(inboxPath), false);
    await host.stop();
    const unavailable = await client.callTool({
      name: "tasken.propose_task",
      arguments: { idempotency_key: "stdio-task-2", caller: "Codex", title: "No fallback" },
    });
    assert.equal(unavailable.isError, true);
    assert.equal(unavailable.structuredContent.error.code, "CORE_UNAVAILABLE");
    assert.equal(fs.existsSync(inboxPath), false);
  } finally {
    await client.close();
    await host.stop();
    database.db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
