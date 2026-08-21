import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TaskenCoreClient, TaskenCoreClientError } from "../src/main/mcp/taskenCoreClient.mjs";
import {
  McpProposalInboxService,
  queueMcpProposal,
  validateMcpProposalEnvelope,
} from "../src/main/mcp/proposalInbox.mjs";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
} from "../src/shared/contracts/core/public.mjs";

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function readEnvelopes(inboxPath) {
  return fs.readdirSync(inboxPath)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => validateMcpProposalEnvelope(JSON.parse(fs.readFileSync(path.join(inboxPath, name), "utf8"))));
}

function queueTool({ inboxPath, tool, payloadType, payload, sourceApp = "fixture-agent", idempotencyKey, request = {} }) {
  return queueMcpProposal({
    inboxPath,
    payloadType,
    payload,
    sourceApp,
    idempotencyKey,
    request: { tool, ...request },
  });
}

const repositoryContext = {
  repository_context_id: "repo-1",
  provider: "github",
  repository_slug: "mryk814/tasuken",
  branch: "codex/412-proposal-core",
};

const receiptFields = {
  executor_kind: "ai_agent",
  executor_label: "Codex",
  summary: "Implemented and verified the slice.",
  completed_items: ["implementation"],
  changed_or_created_items: ["src/example.ts"],
  verification: ["focused tests"],
  remaining_work: ["human review"],
  external_references: [{
    kind: "pull_request",
    provider: "github",
    display_label: "PR 1",
    url: "https://github.com/mryk814/tasuken/pull/1",
    external_id: "1",
  }],
  reported_at: "2026-08-21T00:00:00.000Z",
  repository_context: repositoryContext,
  runtime_metadata: { provider: "openai", model: "gpt-5" },
};

test("legacy Task-work inbox envelope remains a compatibility reference for acceptance semantics", () => {
  const root = tempRoot("tasken-proposal-task-work-char");
  const inboxPath = path.join(root, "mcp-inbox");
  try {
    const calls = [
      {
        tool: "tasken.start_task_work",
        action: "start",
        idempotencyKey: "start-1",
        extra: {
          executor_kind: "ai_agent",
          executor_identity: "Codex",
          started_at: "2026-08-21T00:00:00.000Z",
        },
      },
      { tool: "tasken.append_work_receipt", action: "append_receipt", idempotencyKey: "append-1", extra: receiptFields },
      { tool: "tasken.report_task_done", action: "report_done", idempotencyKey: "done-1", extra: receiptFields },
      {
        tool: "tasken.report_task_blocked",
        action: "report_blocked",
        idempotencyKey: "blocked-1",
        extra: {
          ...receiptFields,
          summary: "Credential is unavailable.",
          completed_items: ["inspected configuration"],
          changed_or_created_items: ["diagnostic.txt"],
          verification: [],
          remaining_work: ["provide credential"],
          runtime_metadata: { provider: "openai", model: "gpt-5", report_kind: "blocked" },
        },
      },
    ];
    for (const call of calls) {
      const entry = {
        action: call.action,
        task_id: "task-1",
        expected_version: 7,
        caller: "Codex",
        source_session: "session-1",
        repository_context: repositoryContext,
        ...call.extra,
      };
      const result = queueTool({
        inboxPath,
        tool: call.tool,
        payloadType: "task_work",
        payload: { task_work: [entry] },
        idempotencyKey: call.idempotencyKey,
        request: {
          expected_version: 7,
          idempotency_key: call.idempotencyKey,
          caller: "Codex",
          source_session: "session-1",
        },
      });
      assert.deepEqual({ status: result.status, payload_type: result.payload_type }, { status: "queued", payload_type: "task_work" });
      // KNOWN UNSAFE LEGACY RESPONSE: the tool response exposes the absolute
      // inbox path. Core transport should return only a stable proposal id.
      assert.equal(result.inbox_path, inboxPath);
      const duplicate = queueTool({
        inboxPath,
        tool: call.tool,
        payloadType: "task_work",
        payload: { task_work: [entry] },
        idempotencyKey: call.idempotencyKey,
        request: {
          expected_version: 7,
          idempotency_key: call.idempotencyKey,
          caller: "Codex",
          source_session: "session-1",
        },
      });
      assert.equal(duplicate.status, "duplicate");
      assert.equal(duplicate.proposal_id, result.proposal_id);
    }

    const envelopes = readEnvelopes(inboxPath);
    assert.equal(envelopes.length, 4);
    for (const envelope of envelopes) {
      assert.equal(envelope.source, "mcp");
      assert.equal(envelope.source_app, "fixture-agent");
      assert.equal(envelope.payload_type, "task_work");
      assert.equal(envelope.payload.task_work[0].expected_version, 7);
      assert.equal(envelope.payload.task_work[0].caller, "Codex");
      assert.equal(envelope.payload.task_work[0].source_session, "session-1");
      assert.equal(envelope.request.expected_version, 7);
      assert.equal(envelope.request.caller, "Codex");
      assert.equal(envelope.request.source_session, "session-1");
      assert.match(envelope.request.payload_digest, /^[0-9a-f]{64}$/);
      assert.equal("actor" in envelope, false);
    }
    const receiptActions = new Set(["append_receipt", "report_done", "report_blocked"]);
    for (const envelope of envelopes.filter((candidate) => receiptActions.has(candidate.payload.task_work[0].action))) {
      const receipt = envelope.payload.task_work[0];
      assert.equal(receipt.executor_kind, "ai_agent");
      assert.equal(receipt.executor_label, "Codex");
      assert.equal(receipt.external_references[0].url, "https://github.com/mryk814/tasuken/pull/1");
      assert.deepEqual(receipt.repository_context, repositoryContext);
    }

    const saved = [];
    const service = new McpProposalInboxService({
      get: () => null,
      save: (type, entity) => {
        saved.push({ type, entity });
        return { ...entity, version: 1 };
      },
    }, root);
    const imported = service.drain();
    assert.equal(imported.length, 4);
    assert.deepEqual([...new Set(saved.map((entry) => entry.type))], ["ai_proposal"]);
    assert.equal(saved.some((entry) => ["task", "work_receipt", "change_event", "reference"].includes(entry.type)), false);
    assert.equal(fs.readdirSync(inboxPath).filter((name) => name.endsWith(".json")).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("seven content proposal tools retain exact create/merge payloads and stay proposal-only", () => {
  const root = tempRoot("tasken-proposal-content-char");
  const inboxPath = path.join(root, "mcp-inbox");
  try {
    const over64KiB = "N".repeat(64 * 1024 + 1);
    const cases = [
      {
        tool: "tasken.propose_repository_context",
        payloadType: "repository_contexts",
        payload: { repository_contexts: [{
          action: "create",
          label: "Tasuken",
          provider: "github",
          remote_url: "https://github.com/mryk814/tasuken.git",
          local_path: null,
          web_url: "https://github.com/mryk814/tasuken",
          repository_slug: "mryk814/tasuken",
          subdirectory: "packages/core",
          default_branch: "main",
          reason: "Agent workspace",
        }] },
      },
      {
        tool: "tasken.propose_task",
        payloadType: "items",
        payload: { items: [{ action: "create", kind: "task", status: "todo", title: "Proposed task", description: "Description", theme: "Theme", priority: "high", planned_start: null, planned_end: null, reason: "Needed" }] },
      },
      {
        tool: "tasken.propose_note",
        payloadType: "notes",
        payload: { notes: [{ action: "create", title: "Large note", body: over64KiB, theme: "Theme", note_type: "report", reason: "Evidence" }] },
      },
      {
        tool: "tasken.propose_note_edit",
        payloadType: "notes",
        payload: { notes: [{ action: "merge", target_id: "note-1", base_version: 4, title: "Edited note", body: "Replacement", reason: "Correction" }] },
        request: { target: { type: "note", id: "note-1", base_version: 4 } },
      },
      {
        tool: "tasken.propose_knowledge",
        payloadType: "knowledge_nodes",
        payload: { knowledge_nodes: [{ action: "create", title: "Claim", body: "Evidence-backed claim", node_type: "claim", theme: "Theme", confidence: "high", reason: "Capture" }] },
      },
      {
        tool: "tasken.propose_sketch",
        payloadType: "sketches",
        payload: { sketches: [{ action: "create", title: "Diagram", svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>', theme: "Theme", reason: "Explain" }] },
      },
      {
        tool: "tasken.propose_artifact",
        payloadType: "artifacts",
        payload: { artifacts: [{ action: "create", title: "Result", file_name: "result.json", media_type: "application/json", content: '{"ok":true}', theme: "Theme", reason: "Attach" }] },
      },
    ];
    for (const fixture of cases) {
      const result = queueTool({ inboxPath, ...fixture, request: fixture.request });
      assert.equal(result.status, "queued");
      assert.equal(result.payload_type, fixture.payloadType);
    }
    const envelopes = readEnvelopes(inboxPath);
    assert.equal(envelopes.length, 7);
    const byTool = new Map(envelopes.map((envelope) => [envelope.request.tool, envelope]));
    for (const fixture of cases) {
      if (fixture.tool !== "tasken.propose_repository_context") {
        assert.deepEqual(byTool.get(fixture.tool).payload, fixture.payload);
      }
      assert.equal(byTool.get(fixture.tool).source, "mcp");
    }
    assert.deepEqual(byTool.get("tasken.propose_repository_context").payload, {
      repository_contexts: [{
        action: "create", label: "Tasuken", provider: "github",
        canonical_url: "https://github.com/mryk814/tasuken",
        canonical_identity: "github.com/mryk814/tasuken",
        repository_slug: "mryk814/tasuken", owner: "mryk814", name: "tasuken",
        web_url: "https://github.com/mryk814/tasuken",
        remote_aliases: ["https://github.com/mryk814/tasuken"],
        subdirectory: "packages/core", default_branch: "main", active: true, metadata: {},
        reason: "Agent workspace",
      }],
    });
    assert.equal(byTool.get("tasken.propose_note").payload.notes[0].body.length, 64 * 1024 + 1);
    // KNOWN LEGACY TRANSPORT GAP: direct inbox accepts a proposal larger than
    // Core HTTP's 64 KiB request cap. The replacement needs one explicit rule.
    assert.ok(Buffer.byteLength(JSON.stringify(byTool.get("tasken.propose_note")), "utf8") > 64 * 1024);
    assert.deepEqual(byTool.get("tasken.propose_note_edit").request.target, { type: "note", id: "note-1", base_version: 4 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("proposal validators enforce public bounds and reject private paths, credential URLs, and executable media", () => {
  const root = tempRoot("tasken-proposal-validation-char");
  const inboxPath = path.join(root, "mcp-inbox");
  const envelope = (payloadType, payload) => ({
    schema_version: 1,
    id: crypto.randomUUID(),
    created_at: "2026-08-21T00:00:00.000Z",
    source: "spoofed-source-is-normalized",
    source_app: "fixture-agent",
    payload_type: payloadType,
    payload,
  });
  try {
    assert.throws(() => queueTool({
      inboxPath,
      tool: "tasken.start_task_work",
      payloadType: "task_work",
      idempotencyKey: "bad-version",
      payload: { task_work: [{ action: "start", task_id: "task-1", expected_version: -1, caller: "Codex" }] },
    }), /expected_version/);
    assert.throws(() => queueTool({
      inboxPath,
      tool: "tasken.report_task_done",
      payloadType: "task_work",
      idempotencyKey: "bad-secret-context",
      payload: { task_work: [{ action: "report_done", task_id: "task-1", expected_version: 1, caller: "Codex", ...receiptFields, repository_context: { ...repositoryContext, cwd: "C:/private/tasuken" } }] },
    }), /非公開field/);
    assert.throws(() => queueTool({
      inboxPath,
      tool: "tasken.report_task_done",
      payloadType: "task_work",
      idempotencyKey: "bad-credential-url",
      payload: { task_work: [{ action: "report_done", task_id: "task-1", expected_version: 1, caller: "Codex", ...receiptFields, external_references: [{ kind: "pull_request", display_label: "private", url: "https://user:pass@example.com/pr/1" }] }] },
    }), /credential|URL|url/i);
    assert.throws(() => queueTool({
      inboxPath,
      tool: "tasken.propose_repository_context",
      payloadType: "repository_contexts",
      payload: { repository_contexts: [{ action: "create", label: "Private", provider: "local", local_path: "C:/private/repo" }] },
    }), /private path/);
    assert.throws(() => queueTool({
      inboxPath,
      tool: "tasken.propose_sketch",
      payloadType: "sketches",
      payload: { sketches: [{ action: "create", title: "Unsafe", svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }] },
    }), /実行可能|外部参照/);
    assert.throws(() => queueTool({
      inboxPath,
      tool: "tasken.propose_artifact",
      payloadType: "artifacts",
      payload: { artifacts: [{ action: "create", title: "Unsafe", file_name: "../secret.json", media_type: "application/json", content: "{}" }] },
    }), /パスを含まない/);
    assert.throws(() => queueTool({
      inboxPath,
      tool: "tasken.propose_artifact",
      payloadType: "artifacts",
      payload: { artifacts: [{ action: "create", title: "Mismatch", file_name: "result.txt", media_type: "application/json", content: "{}" }] },
    }), /拡張子とmedia_type/);
    assert.throws(() => queueTool({
      inboxPath,
      tool: "tasken.propose_artifact",
      payloadType: "artifacts",
      payload: { artifacts: [{ action: "create", title: "Invalid JSON", file_name: "result.json", media_type: "application/json", content: "secret-token" }] },
    }), /JSON|Unexpected|position/i);

    const oversized = envelope("notes", { notes: [{ action: "create", title: "Large", body: "x".repeat(1024 * 1024) }] });
    assert.throws(() => validateMcpProposalEnvelope(oversized), /1MB/);
    const normalized = validateMcpProposalEnvelope(envelope("notes", { notes: [{ action: "create", title: "Safe", body: "Body" }] }));
    assert.equal(normalized.source, "mcp");
    assert.equal(fs.existsSync(inboxPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("four Task-work tools use Core while seven content tools retain the legacy proposal owner", () => {
  const source = fs.readFileSync("src/main/mcp/server.mjs", "utf8");
  const names = [
    "tasken.start_task_work",
    "tasken.append_work_receipt",
    "tasken.report_task_done",
    "tasken.report_task_blocked",
    "tasken.propose_repository_context",
    "tasken.propose_task",
    "tasken.propose_note",
    "tasken.propose_note_edit",
    "tasken.propose_knowledge",
    "tasken.propose_sketch",
    "tasken.propose_artifact",
  ];
  for (const [index, name] of names.entries()) {
    const marker = `server.registerTool("${name}"`;
    assert.equal(source.split(marker).length - 1, 1, `${name} registration`);
    const block = source.slice(source.indexOf(marker), source.indexOf("server.registerTool(", source.indexOf(marker) + marker.length) === -1 ? source.length : source.indexOf("server.registerTool(", source.indexOf(marker) + marker.length));
    assert.match(block, /annotations: PROPOSAL_ANNOTATIONS/);
    assert.match(block, index < 4 ? /queueTaskWork/ : /queueMcpProposal/);
    if (index < 4) {
      assert.match(block, /withCoreClient/);
      assert.doesNotMatch(block, /queueMcpProposal/);
    } else {
      assert.doesNotMatch(block, /coreClient\.|withCoreClient|readContextProvider/);
    }
  }
  assert.match(source, /coreClient\.proposeTaskWork/);
  assert.match(source, /expected_version: z\.number\(\)\.int\(\)\.nonnegative\(\)/);
  assert.match(source, /idempotency_key: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\)/);
  assert.match(source, /source_session: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\)\.optional\(\)/);
  assert.match(source, /externalReferenceList = z\.array\(externalReferenceInput\)\.max\(100\)\.optional\(\)/);
  assert.match(source, /body: z\.string\(\)\.min\(1\)\.max\(200000\)/);
  assert.match(source, /svg: z\.string\(\)\.min\(1\)\.max\(500000\)/);
  assert.match(source, /content: z\.string\(\)\.min\(1\)\.max\(1000000\)/);
  assert.match(source, /base_version: z\.number\(\)\.int\(\)\.positive\(\)/);
});

test("Task-work Core client requires its named capability and rejects additive response fields", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-proposal-client-contract-"));
  fs.chmodSync(root, 0o700);
  const discoveryPath = path.join(root, "tasken-core.json");
  const writeDiscovery = (capabilities) => fs.writeFileSync(discoveryPath, JSON.stringify({
    schema_version: 1,
    api_version: TASKEN_CORE_API_VERSION,
    origin: "http://127.0.0.1:32123",
    token: Buffer.alloc(32, 7).toString("base64url"),
    capabilities,
    pid: process.pid,
    started_at: "2026-08-21T00:00:00.000Z",
  }), { mode: 0o600 });
  const request = {
    action: "start",
    task_id: "task-1",
    expected_version: 1,
    idempotency_key: "start-1",
    caller: "Codex",
    actor: { kind: "ai_agent" },
    source: "mcp",
  };
  try {
    writeDiscovery([]);
    let fetchCalls = 0;
    const unavailable = new TaskenCoreClient({ discoveryPath, fetch: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    } });
    await assert.rejects(
      unavailable.proposeTaskWork(request),
      (error) => error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE",
    );
    assert.equal(fetchCalls, 0);

    writeDiscovery([TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY]);
    const malformed = new TaskenCoreClient({
      discoveryPath,
      fetch: async () => new Response(JSON.stringify({
        proposal_id: crypto.randomUUID(),
        status: "queued",
        payload_type: "task_work",
        message: "queued",
        inbox_path: "C:/private/Tasken/mcp-inbox",
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-tasken-core-version": TASKEN_CORE_API_VERSION },
      }),
    });
    await assert.rejects(
      malformed.proposeTaskWork(request),
      (error) => error instanceof TaskenCoreClientError && error.code === "INVALID_RESPONSE",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
