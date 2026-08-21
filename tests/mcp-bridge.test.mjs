import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Database from "better-sqlite3";

import {
  McpProposalInboxService,
  queueMcpProposal,
  validateMcpProposalEnvelope,
} from "../src/main/mcp/proposalInbox.mjs";

function tempDirectory(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

test("MCP Proposal is queued as an atomic envelope and imported by the Tasken repository boundary", () => {
  const root = tempDirectory("tasken-mcp-inbox");
  const inboxPath = path.join(root, "mcp-inbox");
  const queued = queueMcpProposal({
    inboxPath,
    payloadType: "notes",
    sourceApp: "test-client",
    payload: { notes: [{ action: "create", title: "MCP Note", body: "本文" }] },
    request: { tool: "tasken.propose_note" },
  });
  assert.equal(queued.status, "queued");
  const files = fs.readdirSync(inboxPath);
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith(".json"));
  assert.equal(files.some((name) => name.endsWith(".tmp")), false);

  const saved = [];
  const repository = {
    get: () => null,
    save: (type, entity) => {
      saved.push({ type, entity });
      return { ...entity, version: 1 };
    },
  };
  const importedNotifications = [];
  const service = new McpProposalInboxService(repository, root, (entities) => importedNotifications.push(entities));
  const imported = service.drain();
  assert.equal(imported.length, 1);
  assert.equal(saved[0].type, "ai_proposal");
  assert.equal(saved[0].entity.source, "mcp");
  assert.equal(saved[0].entity.status, "pending");
  assert.equal(saved[0].entity.payload.notes[0].title, "MCP Note");
  assert.equal(importedNotifications.length, 1);
  assert.deepEqual(fs.readdirSync(inboxPath), []);

  fs.rmSync(root, { recursive: true, force: true });
});

test("invalid MCP Proposal is rejected before it reaches the repository", () => {
  assert.throws(
    () => validateMcpProposalEnvelope({
      schema_version: 1,
      id: "not-a-uuid",
      created_at: new Date().toISOString(),
      source_app: "test",
      payload_type: "notes",
      payload: {},
    }),
    /Proposal ID/,
  );
  assert.throws(
    () => validateMcpProposalEnvelope({
      schema_version: 1,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      source_app: "test",
      payload_type: "notes",
      payload: { notes: [{ action: "create", title: "本文がない" }] },
    }),
    /body/,
  );
});

test("canonical MCP launcher fails closed for migrated reads without Core and exposes proposal-only writes", async () => {
  const root = tempDirectory("tasken-mcp-stdio");
  const inboxPath = path.join(root, "mcp-inbox");
  const dbPath = path.join(root, "workspace.sqlite");
  const database = new Database(dbPath);
  database.exec(`
    CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      device_id TEXT,
      source TEXT NOT NULL,
      version INTEGER NOT NULL
    );
  `);
  const insert = database.prepare(`
    INSERT INTO entities (id, entity_type, data_json, created_at, updated_at, deleted_at, device_id, source, version)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 1)
  `);
  const fixtureAt = "2026-08-20T00:00:00.000Z";
  insert.run("theme-mcp-launcher", "theme", JSON.stringify({
    name: "MCP Launcher",
    code: "MCP",
    default_ai_visibility: ["coding_agent"],
  }), fixtureAt, fixtureAt, "fixture-device", "test");
  insert.run("task-mcp-launcher", "task", JSON.stringify({
    title: "Canonical launcher fixture",
    state: "todo",
    project_id: "theme-mcp-launcher",
  }), fixtureAt, fixtureAt, "fixture-device", "test");
  database.close();
  const transport = new StdioClientTransport({
    command: process.env.TASKEN_NODE_EXEC_PATH || "node",
    args: ["scripts/tasken-mcp-launcher.mjs"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      TASKEN_DB_PATH: dbPath,
      TASKEN_USER_DATA_DIR: root,
      TASKEN_MCP_INBOX_PATH: inboxPath,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    assert.ok(names.has("tasken.search_items"));
    assert.ok(names.has("tasken.propose_task"));
    assert.ok(names.has("tasken.propose_note_edit"));

    const search = await client.callTool({
      name: "tasken.search_items",
      arguments: { query: "Canonical launcher fixture", limit: 5 },
    });
    assert.equal(search.isError, true);
    assert.match(JSON.stringify(search.content), /CORE_UNAVAILABLE/);
    assert.doesNotMatch(JSON.stringify(search.content), /Canonical launcher fixture/);

    const result = await client.callTool({
      name: "tasken.propose_task",
      arguments: {
        idempotency_key: "canonical-launcher-proposal-1",
        caller: "node-test",
        title: "MCP経由の確認",
        description: "正式保存前のProposal",
        source_app: "node-test",
      },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /CORE_UNAVAILABLE/);
    assert.equal(fs.existsSync(inboxPath), false);
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
