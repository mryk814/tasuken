import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { TaskenCoreClient, TaskenCoreClientError } from "../src/main/mcp/taskenCoreClient.mjs";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
} from "../src/shared/contracts/core/public.mjs";

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
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { TaskenCoreHost } = await importBundled("src/main/infrastructure/http/taskenCoreHost.ts");
const { createTaskenCore } = await importBundled("src/main/infrastructure/sqlite/public.ts");
const { ApplicationCommandService } = await importBundled("src/main/services/applicationCommandService.ts");

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-content-proposal-"));
  fs.chmodSync(root, 0o700);
  return root;
}

function baseArgs(idempotencyKey) {
  return {
    idempotency_key: idempotencyKey,
    caller: "Fixture agent",
    source_session: "fixture-session",
    source_app: "fixture-provider",
    repository_context: {
      repository_context_id: "repo-1",
      provider: "github",
      repository_slug: "mryk814/tasuken",
      branch: "codex/412-content-proposal",
    },
  };
}

async function connectMcp(root) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: {
      ...process.env,
      TASKEN_USER_DATA_DIR: root,
      TASKEN_MCP_INBOX_PATH: path.join(root, "legacy-inbox-must-not-exist"),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-content-proposal-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function callProposal(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal("inbox_path" in result.structuredContent, false);
  return result.structuredContent;
}

function command(name, payload, commandId, expectedVersions) {
  return {
    commandId,
    name,
    payload,
    actor: { kind: "user", id: "fixture-user" },
    source: "main_ui",
    expectedVersions,
    issuedAt: "2026-08-21T00:00:00.000Z",
  };
}

test("five content tools persist exact canonical proposals over actual stdio/Core and survive restart", async () => {
  const root = fixtureRoot();
  const dbPath = path.join(root, "workspace.sqlite3");
  let database = new WorkspaceDatabase(dbPath);
  database.save("note", { id: "note-existing", title: "Old", body_markdown: "Old body", project_id: "" });
  let host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(database) });
  await host.start();
  let client = await connectMcp(root);
  try {
    const calls = [
      ["tasken.propose_note", { ...baseArgs("note-create-1"), title: "New note", body: "Body", theme: "Theme", note_type: "report", reason: "Evidence" }],
      ["tasken.propose_note_edit", { ...baseArgs("note-edit-1"), note_id: "note-existing", base_version: 1, title: "Edited", body: "Replacement", reason: "Correction" }],
      ["tasken.propose_knowledge", { ...baseArgs("knowledge-1"), title: "Claim", body: "Evidence-backed", node_type: "claim", theme: "Theme", confidence: "high", reason: "Capture" }],
      ["tasken.propose_sketch", { ...baseArgs("sketch-1"), title: "Diagram", svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>', theme: "Theme", reason: "Explain" }],
      ["tasken.propose_artifact", { ...baseArgs("artifact-1"), title: "Result", file_name: "result.json", media_type: "application/json", content: '{"ok":true}', theme: "Theme", reason: "Attach" }],
    ];
    const results = [];
    for (const [name, args] of calls) results.push(await callProposal(client, name, args));
    assert.deepEqual(results.map((entry) => entry.payload_type), ["notes", "notes", "knowledge_nodes", "sketches", "artifacts"]);
    assert.equal(fs.existsSync(path.join(root, "legacy-inbox-must-not-exist")), false);

    const proposals = results.map((entry) => database.get("ai_proposal", entry.proposal_id));
    assert.deepEqual(proposals[0].payload, { notes: [{ action: "create", title: "New note", body: "Body", theme: "Theme", note_type: "report", reason: "Evidence" }] });
    assert.deepEqual(proposals[1].payload, { notes: [{ action: "merge", target_id: "note-existing", base_version: 1, title: "Edited", body: "Replacement", reason: "Correction" }] });
    assert.deepEqual(proposals[1].request.target, { type: "note", id: "note-existing", base_version: 1 });
    assert.deepEqual(proposals[2].payload.knowledge_nodes[0], { action: "create", title: "Claim", body: "Evidence-backed", node_type: "claim", theme: "Theme", confidence: "high", reason: "Capture" });
    assert.equal(proposals[3].payload.sketches[0].svg.includes("<rect"), true);
    assert.deepEqual(proposals[4].payload.artifacts[0], { action: "create", title: "Result", file_name: "result.json", media_type: "application/json", content: '{"ok":true}', theme: "Theme", reason: "Attach" });
    for (const proposal of proposals) {
      assert.equal(proposal.source, "mcp");
      assert.equal(proposal.status, "pending");
      assert.equal(proposal.request.caller, "Fixture agent");
      assert.deepEqual(proposal.request.actor, { kind: "ai_agent" });
      assert.equal(proposal.request.source, "mcp");
      assert.equal(proposal.request.source_session, "fixture-session");
      assert.match(proposal.request.payload_digest, /^[0-9a-f]{64}$/);
    }

    const legacyArgs = { title: "Legacy note", body: "No identity fields" };
    const legacyFirst = await callProposal(client, "tasken.propose_note", legacyArgs);
    const legacySecond = await callProposal(client, "tasken.propose_note", legacyArgs);
    assert.equal(legacyFirst.status, "queued");
    assert.equal(legacySecond.status, "queued");
    assert.notEqual(legacyFirst.proposal_id, legacySecond.proposal_id);
    assert.equal(database.get("ai_proposal", legacyFirst.proposal_id).request.caller, "mcp-client");
    assert.equal(database.get("ai_proposal", legacySecond.proposal_id).request.caller, "mcp-client");

    await client.close();
    await host.stop();
    database.db.close();
    database = new WorkspaceDatabase(dbPath);
    host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(database) });
    await host.start();
    client = await connectMcp(root);
    const duplicate = await callProposal(client, "tasken.propose_note", calls[0][1]);
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.proposal_id, results[0].proposal_id);
    const conflict = await client.callTool({
      name: "tasken.propose_note",
      arguments: { ...calls[0][1], title: "Different" },
    });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error.code, "IDEMPOTENCY_CONFLICT");
    const contextConflict = await client.callTool({
      name: "tasken.propose_note",
      arguments: {
        ...calls[0][1],
        repository_context: { ...calls[0][1].repository_context, branch: "different-branch" },
      },
    });
    assert.equal(contextConflict.isError, true);
    assert.equal(contextConflict.structuredContent.error.code, "IDEMPOTENCY_CONFLICT");

    const legacySeed = await callProposal(client, "tasken.propose_note", {
      ...baseArgs("legacy-row-retry"),
      repository_context: undefined,
      title: "Legacy stored row",
      body: "Same payload",
    });
    const legacyRow = database.get("ai_proposal", legacySeed.proposal_id);
    database.save("ai_proposal", {
      ...legacyRow,
      request: {
        tool: "tasken.propose_note",
        idempotency_key: "legacy-row-retry",
        payload_digest: createHash("sha256").update(JSON.stringify(legacyRow.payload)).digest("hex"),
      },
    });
    const legacyRetry = await callProposal(client, "tasken.propose_note", {
      ...baseArgs("legacy-row-retry"),
      repository_context: undefined,
      title: "Legacy stored row",
      body: "Same payload",
    });
    assert.equal(legacyRetry.status, "duplicate");
    assert.equal(legacyRetry.proposal_id, legacySeed.proposal_id);

    const service = new ApplicationCommandService(database);
    const candidates = [
      { type: "note", entity: { id: "accepted-note", title: "New note", body_markdown: "Body", project_id: "" } },
      { type: "note", entity: { ...database.get("note", "note-existing"), title: "Edited", body_markdown: "Replacement" } },
      { type: "knowledge_node", entity: { id: "accepted-knowledge", node_type: "claim", title: "Claim", body_markdown: "Evidence-backed" } },
      { type: "sketch", entity: {
        id: "accepted-sketch",
        title: "Diagram",
        svg: proposals[3].payload.sketches[0].svg,
        project_id: "",
        document: { schema_version: 1, mode: "page", pages: [{ id: "page-1", width: 1200, height: 800, objects: [] }] },
      } },
      { type: "artifact", entity: {
        id: "accepted-artifact",
        title: "Result",
        filename: "result.json",
        source_type: "ai_proposal",
        source_id: proposals[4].id,
        storage_mode: "managed",
        stored_path: "Artifacts/result.json",
      } },
    ];
    for (let index = 0; index < proposals.length; index += 1) {
      const proposal = database.get("ai_proposal", proposals[index].id);
      const expectedVersions = [{ type: "ai_proposal", id: proposal.id, version: proposal.version }];
      if (index === 1) expectedVersions.push({ type: "note", id: "note-existing", version: 1 });
      const receipt = service.execute(command("ApplyAiProposal", {
        proposal: { ...proposal, status: "accepted" },
        candidates: [candidates[index]],
      }, `accept-content-${index}`, expectedVersions));
      assert.equal(receipt.status, "applied");
      assert.equal(database.get("ai_proposal", proposal.id).status, "accepted");
    }
  } finally {
    await client?.close().catch(() => {});
    await host?.stop().catch(() => {});
    try { database?.db.close(); } catch { /* already closed during restart */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("content proposal transport enforces 64KiB by actual UTF-8 bytes and media safety", async () => {
  const root = fixtureRoot();
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  const host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(database) });
  await host.start();
  try {
    const discovery = JSON.parse(fs.readFileSync(path.join(root, "tasken-core.json"), "utf8"));
    const headers = { authorization: `Bearer ${discovery.token}`, "content-type": "application/json" };
    const bodyAt = (targetBytes) => {
      const prefix = '{"padding":"';
      const suffix = '"}';
      const remaining = targetBytes - Buffer.byteLength(prefix + suffix);
      const body = `${prefix}${"é".repeat(Math.floor(remaining / 2))}${remaining % 2 ? "x" : ""}${suffix}`;
      assert.equal(Buffer.byteLength(body), targetBytes);
      return body;
    };
    const atLimit = await fetch(`${discovery.origin}/v1/commands/propose-content`, { method: "POST", headers, body: bodyAt(64 * 1024) });
    assert.equal(atLimit.status, 400);
    assert.equal((await atLimit.json()).error.code, "VALIDATION_FAILED");
    const overLimit = await fetch(`${discovery.origin}/v1/commands/propose-content`, { method: "POST", headers, body: bodyAt(64 * 1024 + 1) });
    assert.equal(overLimit.status, 413);
    assert.equal((await overLimit.json()).error.code, "BODY_TOO_LARGE");

    const client = new TaskenCoreClient({ userDataPath: root });
    const identity = { ...baseArgs("unsafe-svg"), actor: { kind: "ai_agent" }, source: "mcp" };
    await assert.rejects(
      client.proposeContent({ ...identity, kind: "sketch_create", title: "Unsafe", svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }),
      (error) => error instanceof TaskenCoreClientError && error.code === "VALIDATION_FAILED",
    );
    await assert.rejects(
      client.proposeContent({ ...identity, idempotency_key: "path-artifact", kind: "artifact_create", title: "Unsafe", file_name: "../secret.json", media_type: "application/json", content: "{}" }),
      (error) => error instanceof TaskenCoreClientError && error.code === "VALIDATION_FAILED",
    );
    await assert.rejects(
      client.proposeContent({ ...identity, idempotency_key: "mismatch-artifact", kind: "artifact_create", title: "Mismatch", file_name: "result.txt", media_type: "application/json", content: "{}" }),
      (error) => error instanceof TaskenCoreClientError && error.code === "VALIDATION_FAILED",
    );
    await assert.rejects(
      client.proposeContent({ ...identity, idempotency_key: "reserved-artifact", kind: "artifact_create", title: "Reserved", file_name: "CON.json", media_type: "application/json", content: "{}" }),
      (error) => error instanceof TaskenCoreClientError && error.code === "VALIDATION_FAILED" && /予約名/.test(error.message),
    );
    const secretFragment = "super-secret-fragment";
    await assert.rejects(
      client.proposeContent({ ...identity, idempotency_key: "invalid-json-artifact", kind: "artifact_create", title: "Invalid", file_name: "result.json", media_type: "application/json", content: `{\"token\":\"${secretFragment}\"` }),
      (error) => error instanceof TaskenCoreClientError
        && error.code === "VALIDATION_FAILED"
        && error.message === "Artifact JSONが不正です。JSON構文を確認してください。"
        && !error.message.includes(secretFragment),
    );
  } finally {
    try {
      await host.stop();
    } finally {
      try {
        database.db.close();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test("content proposal client requires its named capability and rejects additive response fields", async () => {
  const root = fixtureRoot();
  const discoveryPath = path.join(root, "tasken-core.json");
  const discovery = {
    schema_version: 1,
    api_version: TASKEN_CORE_API_VERSION,
    origin: "http://127.0.0.1:12345",
    token: Buffer.alloc(32, 7).toString("base64url"),
    capabilities: [],
    pid: process.pid,
    started_at: "2026-08-21T00:00:00.000Z",
  };
  fs.writeFileSync(discoveryPath, JSON.stringify(discovery), { mode: 0o600 });
  try {
    const noCapability = new TaskenCoreClient({ discoveryPath, fetch: async () => { throw new Error("must not fetch"); } });
    await assert.rejects(
      noCapability.proposeContent({}),
      (error) => error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE",
    );
    fs.writeFileSync(discoveryPath, JSON.stringify({ ...discovery, capabilities: [TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY] }), { mode: 0o600 });
    const invalidResponse = new TaskenCoreClient({
      discoveryPath,
      fetch: async () => new Response(JSON.stringify({
        proposal_id: "8d07d96a-73a6-5cd5-8f56-6d7ca0704631",
        status: "queued",
        payload_type: "notes",
        message: "queued",
        private_path: "C:/private/inbox",
      }), { status: 200, headers: { "content-type": "application/json", "x-tasken-core-version": TASKEN_CORE_API_VERSION } }),
    });
    await assert.rejects(
      invalidResponse.proposeContent({}),
      (error) => error instanceof TaskenCoreClientError && error.code === "INVALID_RESPONSE" && error.details.operation === "propose-content",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
