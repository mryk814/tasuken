import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

test("Tasken MCP stdio server follows the official client transport and exposes safe write tools", async () => {
  const root = tempDirectory("tasken-mcp-stdio");
  const inboxPath = path.join(root, "mcp-inbox");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: {
      ...process.env,
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

    const result = await client.callTool({
      name: "tasken.propose_task",
      arguments: {
        title: "MCP経由の確認",
        description: "正式保存前のProposal",
        source_app: "node-test",
      },
    });
    assert.equal(result.isError, undefined);
    assert.equal(fs.readdirSync(inboxPath).filter((name) => name.endsWith(".json")).length, 1);
    const envelope = JSON.parse(fs.readFileSync(path.join(inboxPath, fs.readdirSync(inboxPath)[0]), "utf8"));
    assert.equal(envelope.payload_type, "items");
    assert.equal(envelope.payload.items[0].title, "MCP経由の確認");
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
