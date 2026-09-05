import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";

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
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { TaskenCoreHost } = await importBundled("src/main/infrastructure/http/taskenCoreHost.ts");
const { createTaskenCore } = await importBundled("src/main/infrastructure/sqlite/public.ts");
const { createNoteProposalImagePort } = await importBundled(
  "src/main/services/proposalMarkdownImages.ts",
);
const { ApplicationCommandService } = await importBundled(
  "src/main/services/applicationCommandService.ts",
);

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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function validPng(seed) {
  const width = 256;
  const height = 256;
  const raw = Buffer.alloc(height * (1 + width * 4));
  let random = seed >>> 0;
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (1 + width * 4);
    raw[rowStart] = 0;
    for (let column = 0; column < width * 4; column += 1) {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      raw[rowStart + 1 + column] = random & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
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
  database.save("note", {
    id: "note-existing",
    title: "Old",
    body_markdown: "Old body",
    project_id: "",
  });
  let host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(database) });
  await host.start();
  let client = await connectMcp(root);
  try {
    const listed = await client.listTools();
    const noteTool = listed.tools.find((tool) => tool.name === "tasken.propose_note");
    const noteEditTool = listed.tools.find((tool) => tool.name === "tasken.propose_note_edit");
    assert.match(client.getInstructions() || "", /Proposal ID, not a Note ID/);
    assert.match(client.getInstructions() || "", /Theme, not a Task or Reference relation/);
    assert.ok(noteTool);
    assert.ok(noteEditTool);
    assert.match(noteTool.description || "", /Note display type is `note`; Report is `report`/);
    assert.match(noteTool.description || "", /does not create a Task or Reference relation/);
    assert.match(noteTool.inputSchema.properties.body.description || "", /Markdown body/);
    assert.match(noteEditTool.inputSchema.properties.body.description || "", /Markdown body/);
    const calls = [
      [
        "tasken.propose_note",
        {
          ...baseArgs("note-create-1"),
          title: "New note",
          body: "Body",
          theme: "Theme",
          note_type: "note",
          reason: "Evidence",
        },
      ],
      [
        "tasken.propose_note_edit",
        {
          ...baseArgs("note-edit-1"),
          note_id: "note-existing",
          base_version: 1,
          title: "Edited",
          body: "Replacement",
          reason: "Correction",
        },
      ],
      [
        "tasken.propose_knowledge",
        {
          ...baseArgs("knowledge-1"),
          title: "Claim",
          body: "Evidence-backed",
          node_type: "claim",
          theme: "Theme",
          confidence: "high",
          reason: "Capture",
        },
      ],
      [
        "tasken.propose_sketch",
        {
          ...baseArgs("sketch-1"),
          title: "Diagram",
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
          theme: "Theme",
          reason: "Explain",
        },
      ],
      [
        "tasken.propose_artifact",
        {
          ...baseArgs("artifact-1"),
          title: "Result",
          file_name: "result.json",
          media_type: "application/json",
          content: '{"ok":true}',
          theme: "Theme",
          reason: "Attach",
        },
      ],
    ];
    const results = [];
    for (const [name, args] of calls) results.push(await callProposal(client, name, args));
    assert.deepEqual(
      results.map((entry) => entry.payload_type),
      ["notes", "notes", "knowledge_nodes", "sketches", "artifacts"],
    );
    assert.equal(fs.existsSync(path.join(root, "legacy-inbox-must-not-exist")), false);

    const proposals = results.map((entry) => database.get("ai_proposal", entry.proposal_id));
    assert.deepEqual(proposals[0].payload, {
      notes: [
        {
          action: "create",
          title: "New note",
          body: "Body",
          theme: "Theme",
          note_type: "memo",
          reason: "Evidence",
        },
      ],
    });
    for (const noteType of ["report", "prompt"]) {
      const proposal = await callProposal(client, "tasken.propose_note", {
        ...baseArgs(`note-${noteType}`),
        title: `New ${noteType}`,
        body: "Body",
        note_type: noteType,
        ...(noteType === "report" ? { report_date: "2026-08-31" } : {}),
      });
      const entry = database.get("ai_proposal", proposal.proposal_id).payload.notes[0];
      assert.equal(entry.note_type, noteType);
      assert.equal(entry.report_date, noteType === "report" ? "2026-08-31" : undefined);
    }
    assert.deepEqual(proposals[1].payload, {
      notes: [
        {
          action: "merge",
          target_id: "note-existing",
          base_version: 1,
          title: "Edited",
          body: "Replacement",
          reason: "Correction",
        },
      ],
    });
    assert.deepEqual(proposals[1].request.target, {
      type: "note",
      id: "note-existing",
      base_version: 1,
    });
    assert.deepEqual(proposals[2].payload.knowledge_nodes[0], {
      action: "create",
      title: "Claim",
      body: "Evidence-backed",
      node_type: "claim",
      theme: "Theme",
      confidence: "high",
      reason: "Capture",
    });
    assert.equal(proposals[3].payload.sketches[0].svg.includes("<rect"), true);
    assert.deepEqual(proposals[4].payload.artifacts[0], {
      action: "create",
      title: "Result",
      file_name: "result.json",
      media_type: "application/json",
      content: '{"ok":true}',
      theme: "Theme",
      reason: "Attach",
    });
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
    assert.equal(
      database.get("ai_proposal", legacySecond.proposal_id).request.caller,
      "mcp-client",
    );

    const literalUploadBody = [
      "The placeholder syntax is tasken-upload://figure.",
      "```md",
      "![example](tasken-upload://figure)",
      "```",
    ].join("\n");
    const literalUpload = await callProposal(client, "tasken.propose_note", {
      ...baseArgs("note-literal-upload-uri"),
      title: "Literal upload syntax",
      body: literalUploadBody,
      note_type: "note",
    });
    assert.deepEqual(database.get("ai_proposal", literalUpload.proposal_id).payload, {
      notes: [
        {
          action: "create",
          title: "Literal upload syntax",
          body: literalUploadBody,
          theme: "",
          note_type: "memo",
          reason: "",
        },
      ],
    });

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

    const invalidNoteType = await client.callTool({
      name: "tasken.propose_note",
      arguments: { ...calls[0][1], idempotency_key: "note-invalid-type", note_type: "memo" },
    });
    assert.equal(invalidNoteType.isError, true);
    assert.match(JSON.stringify(invalidNoteType), /note.*report.*prompt/);
    const invalidReportDate = await client.callTool({
      name: "tasken.propose_note",
      arguments: {
        ...baseArgs("note-invalid-report-date"),
        title: "Prompt cannot carry a report date",
        body: "Body",
        note_type: "prompt",
        report_date: "2026-08-31",
      },
    });
    assert.equal(invalidReportDate.isError, true);
    assert.match(JSON.stringify(invalidReportDate), /report_date.*report/);

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
        payload_digest: createHash("sha256")
          .update(JSON.stringify(legacyRow.payload))
          .digest("hex"),
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
      {
        type: "note",
        entity: { id: "accepted-note", title: "New note", body_markdown: "Body", project_id: "" },
      },
      {
        type: "note",
        entity: {
          ...database.get("note", "note-existing"),
          title: "Edited",
          body_markdown: "Replacement",
        },
      },
      {
        type: "knowledge_node",
        entity: {
          id: "accepted-knowledge",
          node_type: "claim",
          title: "Claim",
          body_markdown: "Evidence-backed",
        },
      },
      {
        type: "sketch",
        entity: {
          id: "accepted-sketch",
          title: "Diagram",
          svg: proposals[3].payload.sketches[0].svg,
          project_id: "",
          document: {
            schema_version: 1,
            mode: "page",
            pages: [{ id: "page-1", width: 1200, height: 800, objects: [] }],
          },
        },
      },
      {
        type: "artifact",
        entity: {
          id: "accepted-artifact",
          title: "Result",
          filename: "result.json",
          source_type: "ai_proposal",
          source_id: proposals[4].id,
          storage_mode: "managed",
          stored_path: "Artifacts/result.json",
        },
      },
    ];
    for (let index = 0; index < proposals.length; index += 1) {
      const proposal = database.get("ai_proposal", proposals[index].id);
      const expectedVersions = [
        { type: "ai_proposal", id: proposal.id, version: proposal.version },
      ];
      if (index === 1) expectedVersions.push({ type: "note", id: "note-existing", version: 1 });
      const receipt = service.execute(
        command(
          "ApplyAiProposal",
          {
            proposal: { ...proposal, status: "accepted" },
            candidates: [candidates[index]],
          },
          `accept-content-${index}`,
          expectedVersions,
        ),
      );
      assert.equal(receipt.status, "applied");
      assert.equal(database.get("ai_proposal", proposal.id).status, "accepted");
    }
  } finally {
    await client?.close().catch(() => {});
    await host?.stop().catch(() => {});
    try {
      database?.db.close();
    } catch {
      /* already closed during restart */
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("propose_note carries embedded image bytes through stdio/Core without persisting the bytes", async () => {
  const root = fixtureRoot();
  const dbPath = path.join(root, "workspace.sqlite3");
  const imageBytes = validPng(1);
  const changedBytes = validPng(2);
  assert.ok(imageBytes.length > 64 * 1024);
  const validImageHashes = new Set(
    [imageBytes, changedBytes].map((bytes) => createHash("sha256").update(bytes).digest("hex")),
  );
  const decodeFixtureImage = (bytes, mimeType) =>
    mimeType === "image/png" &&
    validImageHashes.has(createHash("sha256").update(bytes).digest("hex"))
      ? { width: 256, height: 256 }
      : null;
  const args = {
    ...baseArgs("note-with-image-1"),
    title: "Recipe result",
    body: "完成形です。\n\n![完成写真](tasken-upload://finished-dish)",
    images: [
      {
        reference_id: "finished-dish",
        file_name: "finished-dish.png",
        media_type: "image/png",
        data_base64: imageBytes.toString("base64"),
      },
    ],
    note_type: "report",
    report_date: "2026-09-01",
  };
  let database = new WorkspaceDatabase(dbPath);
  let host = new TaskenCoreHost({
    userDataPath: root,
    ...createTaskenCore(database, {
      noteProposalImagePort: createNoteProposalImagePort(root, decodeFixtureImage),
    }),
  });
  await host.start();
  let client = await connectMcp(root);
  try {
    const listed = await client.listTools();
    const noteTool = listed.tools.find((tool) => tool.name === "tasken.propose_note");
    assert.ok(noteTool?.inputSchema.properties.images);
    assert.match(noteTool.description || "", /tasken-upload:\/\//);

    const largeInvalidImage = await client.callTool({
      name: "tasken.propose_note",
      arguments: {
        ...baseArgs("note-with-large-invalid-image"),
        title: "Large invalid image",
        body: "![invalid](tasken-upload://large-invalid)",
        images: [
          {
            reference_id: "large-invalid",
            file_name: "large-invalid.png",
            media_type: "image/png",
            data_base64: "A".repeat(11 * 1024 * 1024),
          },
        ],
      },
    });
    assert.equal(largeInvalidImage.isError, true);
    assert.equal(largeInvalidImage.structuredContent.error.code, "VALIDATION_FAILED");
    assert.match(largeInvalidImage.structuredContent.error.message, /画像形式/);

    const { idempotency_key: _idempotencyKey, ...withoutIdempotencyKey } = args;
    const missingIdempotencyKey = await client.callTool({
      name: "tasken.propose_note",
      arguments: withoutIdempotencyKey,
    });
    assert.equal(missingIdempotencyKey.isError, true);
    assert.equal(missingIdempotencyKey.structuredContent.error.code, "VALIDATION_FAILED");
    assert.match(missingIdempotencyKey.structuredContent.error.message, /idempotency_key/);
    assert.equal(fs.existsSync(path.join(root, "attachments", "markdown-images")), false);

    const queued = await callProposal(client, "tasken.propose_note", args);
    const stored = database.get("ai_proposal", queued.proposal_id);
    assert.equal(queued.status, "queued");
    assert.match(stored.payload.notes[0].body, /tasken-attachment:\/\/local\//);
    assert.doesNotMatch(stored.payload.notes[0].body, /tasken-upload:\/\//);
    assert.deepEqual(Object.keys(stored.payload.note_images[0]).sort(), [
      "file_name",
      "mime_type",
      "reference_id",
      "sha256",
      "size",
      "url",
    ]);
    assert.equal(stored.payload.note_images[0].reference_id, "finished-dish");
    assert.equal(stored.payload.note_images[0].mime_type, "image/png");
    assert.equal(stored.payload.note_images[0].size, imageBytes.length);
    assert.equal(JSON.stringify(stored).includes(args.images[0].data_base64), false);
    assert.equal(JSON.stringify(stored).includes("data_base64"), false);
    assert.equal(JSON.stringify(stored).includes("source_path"), false);
    const storedImagePath = path.join(
      root,
      "attachments",
      "markdown-images",
      stored.payload.note_images[0].file_name,
    );
    assert.equal(fs.existsSync(storedImagePath), true);

    await client.close();
    await host.stop();
    database.db.close();
    database = new WorkspaceDatabase(dbPath);
    host = new TaskenCoreHost({
      userDataPath: root,
      ...createTaskenCore(database, {
        noteProposalImagePort: createNoteProposalImagePort(root, decodeFixtureImage),
      }),
    });
    await host.start();
    client = await connectMcp(root);
    fs.rmSync(storedImagePath);
    const duplicate = await callProposal(client, "tasken.propose_note", args);
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.proposal_id, queued.proposal_id);
    assert.equal(fs.existsSync(storedImagePath), true);
    assert.deepEqual(fs.readFileSync(storedImagePath), imageBytes);

    fs.writeFileSync(storedImagePath, Buffer.from("tampered"));
    const tamperedRetry = await client.callTool({
      name: "tasken.propose_note",
      arguments: args,
    });
    assert.equal(tamperedRetry.isError, true);
    assert.match(tamperedRetry.structuredContent.error.message, /内容が変更されています/);
    assert.deepEqual(fs.readFileSync(storedImagePath), Buffer.from("tampered"));
    fs.writeFileSync(storedImagePath, imageBytes);

    const conflict = await client.callTool({
      name: "tasken.propose_note",
      arguments: {
        ...args,
        images: [{ ...args.images[0], data_base64: changedBytes.toString("base64") }],
      },
    });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error.code, "IDEMPOTENCY_CONFLICT");
    assert.deepEqual(fs.readFileSync(storedImagePath), imageBytes);

    const rejected = database.save("ai_proposal", {
      ...database.get("ai_proposal", queued.proposal_id),
      status: "rejected",
    });
    fs.rmSync(storedImagePath);
    const terminalDuplicate = await callProposal(client, "tasken.propose_note", args);
    assert.equal(terminalDuplicate.status, "duplicate");
    assert.equal(fs.existsSync(storedImagePath), false);
    assert.equal(database.get("ai_proposal", queued.proposal_id).version, rejected.version);

    const invalidImage = await client.callTool({
      name: "tasken.propose_note",
      arguments: {
        ...baseArgs("note-with-invalid-image"),
        title: "Invalid image",
        body: "![broken](tasken-upload://broken)",
        images: [
          {
            reference_id: "broken",
            file_name: "broken.png",
            media_type: "image/png",
            data_base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
              "base64",
            ),
          },
        ],
        note_type: "note",
      },
    });
    assert.equal(invalidImage.isError, true);
    assert.equal(invalidImage.structuredContent.error.code, "VALIDATION_FAILED");
    assert.match(invalidImage.structuredContent.error.message, /画像形式とファイル内容が一致/);
  } finally {
    await client?.close();
    await host?.stop();
    try {
      database?.db.close();
    } catch {
      /* already closed during restart */
    }
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
    const headers = {
      authorization: `Bearer ${discovery.token}`,
      "content-type": "application/json",
    };
    const bodyAt = (targetBytes) => {
      const prefix = '{"padding":"';
      const suffix = '"}';
      const remaining = targetBytes - Buffer.byteLength(prefix + suffix);
      const body = `${prefix}${"é".repeat(Math.floor(remaining / 2))}${remaining % 2 ? "x" : ""}${suffix}`;
      assert.equal(Buffer.byteLength(body), targetBytes);
      return body;
    };
    const atLimit = await fetch(`${discovery.origin}/v1/commands/propose-content`, {
      method: "POST",
      headers,
      body: bodyAt(64 * 1024),
    });
    assert.equal(atLimit.status, 400);
    assert.equal((await atLimit.json()).error.code, "VALIDATION_FAILED");
    const overLimit = await fetch(`${discovery.origin}/v1/commands/propose-content`, {
      method: "POST",
      headers,
      body: bodyAt(64 * 1024 + 1),
    });
    assert.equal(overLimit.status, 413);
    assert.equal((await overLimit.json()).error.code, "BODY_TOO_LARGE");

    const client = new TaskenCoreClient({ userDataPath: root });
    const identity = { ...baseArgs("unsafe-svg"), actor: { kind: "ai_agent" }, source: "mcp" };
    await assert.rejects(
      client.proposeContent({
        ...identity,
        kind: "sketch_create",
        title: "Unsafe",
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      }),
      (error) => error instanceof TaskenCoreClientError && error.code === "VALIDATION_FAILED",
    );
    await assert.rejects(
      client.proposeContent({
        ...identity,
        idempotency_key: "path-artifact",
        kind: "artifact_create",
        title: "Unsafe",
        file_name: "../secret.json",
        media_type: "application/json",
        content: "{}",
      }),
      (error) => error instanceof TaskenCoreClientError && error.code === "VALIDATION_FAILED",
    );
    await assert.rejects(
      client.proposeContent({
        ...identity,
        idempotency_key: "mismatch-artifact",
        kind: "artifact_create",
        title: "Mismatch",
        file_name: "result.txt",
        media_type: "application/json",
        content: "{}",
      }),
      (error) => error instanceof TaskenCoreClientError && error.code === "VALIDATION_FAILED",
    );
    await assert.rejects(
      client.proposeContent({
        ...identity,
        idempotency_key: "reserved-artifact",
        kind: "artifact_create",
        title: "Reserved",
        file_name: "CON.json",
        media_type: "application/json",
        content: "{}",
      }),
      (error) =>
        error instanceof TaskenCoreClientError &&
        error.code === "VALIDATION_FAILED" &&
        /予約名/.test(error.message),
    );
    const secretFragment = "super-secret-fragment";
    await assert.rejects(
      client.proposeContent({
        ...identity,
        idempotency_key: "invalid-json-artifact",
        kind: "artifact_create",
        title: "Invalid",
        file_name: "result.json",
        media_type: "application/json",
        content: `{\"token\":\"${secretFragment}\"`,
      }),
      (error) =>
        error instanceof TaskenCoreClientError &&
        error.code === "VALIDATION_FAILED" &&
        error.message === "Artifact JSONが不正です。JSON構文を確認してください。" &&
        !error.message.includes(secretFragment),
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
    const noCapability = new TaskenCoreClient({
      discoveryPath,
      fetch: async () => {
        throw new Error("must not fetch");
      },
    });
    await assert.rejects(
      noCapability.proposeContent({}),
      (error) => error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE",
    );
    fs.writeFileSync(
      discoveryPath,
      JSON.stringify({ ...discovery, capabilities: [TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY] }),
      { mode: 0o600 },
    );
    const invalidResponse = new TaskenCoreClient({
      discoveryPath,
      fetch: async () =>
        new Response(
          JSON.stringify({
            proposal_id: "8d07d96a-73a6-5cd5-8f56-6d7ca0704631",
            status: "queued",
            payload_type: "notes",
            message: "queued",
            private_path: "C:/private/inbox",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-tasken-core-version": TASKEN_CORE_API_VERSION,
            },
          },
        ),
    });
    await assert.rejects(
      invalidResponse.proposeContent({}),
      (error) =>
        error instanceof TaskenCoreClientError &&
        error.code === "INVALID_RESPONSE" &&
        error.details.operation === "propose-content",
    );

    const delayedImageResponse = new TaskenCoreClient({
      discoveryPath,
      timeoutMs: 5,
      fetch: async (_url, options) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(options.signal.aborted, false);
        assert.equal(options.headers["x-tasken-proposal-images"], "1");
        return new Response(
          JSON.stringify({
            proposal_id: "8d07d96a-73a6-5cd5-8f56-6d7ca0704632",
            status: "queued",
            payload_type: "notes",
            message: "queued",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-tasken-core-version": TASKEN_CORE_API_VERSION,
            },
          },
        );
      },
    });
    const delayed = await delayedImageResponse.proposeContent({ images: [{}] });
    assert.equal(delayed.status, "queued");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
