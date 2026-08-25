import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { taskenCoreErrorGuidance } from "../src/shared/contracts/core/public.mjs";

const workspaceRepositoryModule = "../src/main/repositories/" + "workspaceRepository.mjs";
const { WorkspaceDatabase } = await import(workspaceRepositoryModule);

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { TaskenCoreHost } = await importBundled("src/main/infrastructure/http/taskenCoreHost.ts");
const { createTaskenCore, WorkspaceAiProposalWriteAdapter } = await importBundled(
  "src/main/infrastructure/sqlite/public.ts",
);

async function connectMcp(root) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: { ...process.env, TASKEN_USER_DATA_DIR: root },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-live-sync-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

test("actual MCP proposal emits one post-commit Desktop delta and duplicate retry emits none", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-mcp-live-sync-"));
  fs.chmodSync(root, 0o700);
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  const delivered = [];
  const host = new TaskenCoreHost({
    userDataPath: root,
    ...createTaskenCore(database, {
      onProposalCommitted: (proposals) => delivered.push(...proposals),
    }),
  });
  await host.start();
  const client = await connectMcp(root);
  const args = {
    idempotency_key: "live-proposal-1",
    caller: "Live sync fixture",
    source_app: "live-sync-test",
    title: "MCP live Proposal",
    description: "Appear without reload",
  };
  try {
    const queued = await client.callTool({ name: "tasken.propose_task", arguments: args });
    assert.equal(queued.isError, undefined);
    assert.equal(queued.structuredContent.status, "queued");
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].id, queued.structuredContent.proposal_id);
    assert.equal(delivered[0].version, 1);
    assert.equal(database.get("ai_proposal", delivered[0].id).status, "pending");

    const duplicate = await client.callTool({ name: "tasken.propose_task", arguments: args });
    assert.equal(duplicate.structuredContent.status, "duplicate");
    assert.equal(delivered.length, 1);

    const conflict = await client.callTool({
      name: "tasken.propose_task",
      arguments: { ...args, title: "Changed payload" },
    });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(
      conflict.structuredContent.error.next_action,
      "内容を変える場合は新しいidempotency_keyを使用してください。",
    );
    assert.equal(delivered.length, 1);
  } finally {
    await client.close();
    await host.stop();
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("notification runs after commit and its failure never rolls back canonical Proposal", () => {
  let committed = false;
  let notificationAttempts = 0;
  const rows = new Map();
  const adapter = new WorkspaceAiProposalWriteAdapter(
    {
      runTransaction(callback) {
        const result = callback({
          get: (_type, id) => rows.get(id) || null,
          save: (_type, proposal) => {
            const saved = { ...proposal, version: 1 };
            rows.set(saved.id, saved);
            return saved;
          },
        });
        committed = true;
        return result;
      },
    },
    () => {
      notificationAttempts += 1;
      assert.equal(committed, true);
      throw new Error("renderer closed");
    },
  );
  const proposal = {
    id: "proposal-post-commit",
    source: "mcp",
    source_app: "fixture",
    payload_type: "items",
    payload: { items: [] },
    request: {},
    status: "pending",
    received_at: "2026-08-25T00:00:00.000Z",
  };
  const saved = adapter.runTransaction((transaction) => transaction.save(proposal));
  assert.equal(saved.version, 1);
  assert.equal(rows.get(proposal.id).status, "pending");
  assert.equal(notificationAttempts, 1);
});

test("Proposal recovery guidance distinguishes stale, idempotency, size, and Core failures", () => {
  assert.match(taskenCoreErrorGuidance("STALE_VERSION").next_action, /get_task_context/);
  assert.match(taskenCoreErrorGuidance("IDEMPOTENCY_CONFLICT").next_action, /idempotency_key/);
  assert.match(taskenCoreErrorGuidance("PROPOSAL_TOO_LARGE").next_action, /64KiB/);
  assert.equal(taskenCoreErrorGuidance("CORE_UNAVAILABLE").retryable, true);
  assert.equal(taskenCoreErrorGuidance("VERSION_MISMATCH").retryable, false);
});
