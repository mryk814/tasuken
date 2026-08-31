import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";
import {
  canonicalMarkdownBindingFromProperties,
  markdownSignature,
} from "../src/shared/canonicalMarkdown.mjs";
import { stableProposalEntityId } from "../src/shared/proposalAcceptance.mjs";
import { PERSONAL_DEFAULT_THEME_ID } from "../src/shared/themeRef.mjs";

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

async function importWorkspaceService() {
  const outputDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "tasken-ai-acceptance-service-bundle-"),
  );
  const outputFile = path.join(outputDirectory, "workspaceService.mjs");
  test.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  const mock = {
    name: "workspace-service-dependencies",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^electron$/ }, () => ({
        path: "electron-mock",
        namespace: "acceptance-mock",
      }));
      buildApi.onLoad({ filter: /^electron-mock$/, namespace: "acceptance-mock" }, () => ({
        contents:
          'export const app={getPath:()=>""}; export class BrowserWindow{}; export const clipboard={}; export const dialog={}; export const nativeImage={}; export const shell={};',
        loader: "js",
      }));
      buildApi.onResolve({ filter: /^adm-zip$/ }, () => ({
        path: "adm-zip-mock",
        namespace: "acceptance-mock",
      }));
      buildApi.onLoad({ filter: /^adm-zip-mock$/, namespace: "acceptance-mock" }, () => ({
        contents: "export default class AdmZip { constructor() { throw new Error('unused'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /^better-sqlite3$/ }, () => ({
        path: "better-sqlite3-mock",
        namespace: "acceptance-mock",
      }));
      buildApi.onLoad({ filter: /^better-sqlite3-mock$/, namespace: "acceptance-mock" }, () => ({
        contents: "export default class Database { constructor() { throw new Error('unused'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /workspaceRepository\.mjs$/ }, () => ({
        path: "workspace-repository-mock",
        namespace: "acceptance-mock",
      }));
      buildApi.onLoad(
        { filter: /^workspace-repository-mock$/, namespace: "acceptance-mock" },
        () => ({
          contents: "export const workspaceEntityTypes=[]; export const workspaceSchemaVersion=1;",
          loader: "js",
        }),
      );
    },
  };
  await build({
    entryPoints: [path.resolve("src/main/services/workspaceService.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    logLevel: "silent",
    plugins: [mock],
  });
  return import(pathToFileURL(outputFile).href);
}

const repositoryModule = "../src/main/repositories/" + "workspaceRepository.mjs";
const { WorkspaceDatabase } = await import(repositoryModule);
const { ApplicationCommandService, commandFingerprint } = await importBundled(
  "src/main/services/applicationCommandService.ts",
);
const { AiProposalAcceptanceService } = await importBundled(
  "src/main/services/aiProposalAcceptanceService.ts",
);
const { ContentDetailQueryService } = await importBundled(
  "src/main/core/services/contentDetailQueryService.ts",
);
const { WorkspaceService } = await importWorkspaceService();
const { buildPreview, buildCandidateOperations, stabilizeProposalOperations } = await importBundled(
  "src/renderer/src/features/workspace/components/AiProposalPanel.tsx",
);

function root() {
  return fs.mkdtempSync(path.join(process.cwd(), ".tasken-ai-acceptance-"));
}

function envelope(
  proposal,
  candidates,
  decisions = candidates.map((candidate, entryIndex) => ({
    entryIndex,
    type: candidate.type,
    action: "accept",
  })),
) {
  return {
    commandId: `${proposal.id}:accept:v${proposal.version}`,
    name: "ApplyAiProposal",
    payload: {
      proposal: { ...proposal, status: "accepted" },
      decision: "accept",
      decisions,
      candidates,
    },
    actor: { kind: "user" },
    source: "main_ui",
    expectedVersions: [
      { type: "ai_proposal", id: proposal.id, version: proposal.version },
      ...candidates
        .filter((candidate) => Number(candidate.entity.version || 0) > 0)
        .map((candidate) => ({
          type: candidate.type,
          id: candidate.entity.id,
          version: Number(candidate.entity.version),
        })),
    ],
    issuedAt: proposal.received_at,
  };
}

function noteCandidates(proposal, notes) {
  const preview = buildPreview(proposal, { data: { notes }, themes: [], items: [] });
  return stabilizeProposalOperations(proposal.id, buildCandidateOperations(preview.candidates)).map(
    (operation) => ({ type: operation.type, entity: operation.entity }),
  );
}

test("preview candidates commit entities, relation, Activity events and exactly-once receipt through ApplyAiProposal", () => {
  const directory = root();
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite3"));
  try {
    const proposal = database.save("ai_proposal", {
      id: "proposal-preview-path",
      source: "mcp",
      source_app: "fixture",
      payload_type: "knowledge_nodes",
      payload: {
        knowledge_nodes: [
          { action: "create", temp_id: "claim", title: "Claim", body: "C", node_type: "claim" },
          {
            action: "create",
            temp_id: "evidence",
            title: "Evidence",
            body: "E",
            node_type: "evidence",
          },
        ],
        knowledge_edges: [
          {
            action: "create",
            source_temp_id: "evidence",
            target_temp_id: "claim",
            relation_type: "supports",
          },
        ],
      },
      request: { tool: "tasken.propose_knowledge" },
      status: "pending",
      received_at: "2026-08-21T00:00:00.000Z",
    });
    const preview = buildPreview(proposal, {
      data: { knowledge_nodes: [], knowledge_edges: [] },
      themes: [],
      items: [],
    });
    const firstOperations = stabilizeProposalOperations(
      proposal.id,
      buildCandidateOperations(preview.candidates),
    );
    const secondOperations = stabilizeProposalOperations(
      proposal.id,
      buildCandidateOperations(preview.candidates),
    );
    assert.deepEqual(
      firstOperations.map((operation) => operation.entity.id),
      secondOperations.map((operation) => operation.entity.id),
    );
    assert.equal(firstOperations[2].entity.source_node_id, firstOperations[1].entity.id);
    assert.equal(firstOperations[2].entity.target_node_id, firstOperations[0].entity.id);
    const candidates = firstOperations.map((operation) => ({
      type: operation.type,
      entity:
        operation.type === "knowledge_node"
          ? { ...operation.entity, title: "Renderer forged title", body: "Renderer forged body" }
          : operation.entity,
    }));
    const commands = new ApplicationCommandService(database);
    const acceptance = new AiProposalAcceptanceService(
      commands,
      {
        materializeArtifactProposal() {
          throw new Error("unexpected artifact");
        },
        rollbackMaterializedArtifactProposal() {},
      },
      database,
    );
    const command = envelope(proposal, candidates);
    const first = acceptance.execute(command);
    const counts = {
      nodes: database.list("knowledge_node").length,
      edges: database.list("knowledge_edge").length,
      events: database.list("change_event").length,
    };
    assert.equal(first.status, "applied");
    assert.equal(counts.nodes, 2);
    assert.deepEqual(
      database
        .list("knowledge_node")
        .map((entry) => entry.title)
        .sort(),
      ["Claim", "Evidence"],
    );
    assert.equal(counts.edges, 1);
    assert.equal(database.get("ai_proposal", proposal.id).status, "accepted");
    assert.equal(counts.events, 4);
    assert.equal(first.events.length, 4);
    const eventVersionsBeforeReplay = first.events.map(
      (id) => database.get("change_event", id, true).version,
    );
    const retry = acceptance.execute(command);
    assert.equal(retry.status, first.status);
    assert.deepEqual(retry.events, first.events);
    assert.deepEqual(retry.saved, first.saved);
    assert.deepEqual(
      first.events.map((id) => database.get("change_event", id, true).version),
      eventVersionsBeforeReplay,
    );
    assert.deepEqual(
      {
        nodes: database.list("knowledge_node").length,
        edges: database.list("knowledge_edge").length,
        events: database.list("change_event").length,
      },
      counts,
    );
    const reused = (mutate) => {
      const changed = structuredClone(command);
      mutate(changed);
      assert.throws(
        () => acceptance.execute(changed),
        (error) => error?.code === "COMMAND_ID_REUSED",
      );
    };
    reused((changed) => {
      changed.actor = { kind: "user", id: "different-user" };
    });
    reused((changed) => {
      changed.source = "mcp";
    });
    reused((changed) => {
      changed.sessionId = "different-session";
    });
    reused((changed) => {
      changed.windowId = "different-window";
    });
    reused((changed) => {
      changed.expectedVersions = [];
    });
    reused((changed) => {
      changed.issuedAt = "2026-08-21T00:00:01.000Z";
    });
    reused((changed) => {
      changed.payload.proposal.status = "rejected";
    });
    reused((changed) => {
      changed.payload.decision = "reject";
    });
    reused((changed) => {
      changed.payload.proposal.status = "partially_accepted";
      changed.payload.decisions[0].action = "ignore";
      changed.payload.candidates = changed.payload.candidates.slice(1);
    });
    reused((changed) => {
      changed.payload.candidates[0].entity.id = "different-candidate";
    });
    reused((changed) => {
      changed.payload.candidates[0].type = "artifact";
    });

    const event = database
      .list("change_event", true)
      .find((entry) => entry.command_id === command.commandId);
    const originalReceiptJson = event.receipt_json;
    const originalReceipt = JSON.parse(originalReceiptJson);
    const nestedReceiptMutations = [
      (receipt) => {
        receipt.status = "no_change";
      },
      (receipt) => {
        receipt.events = receipt.events.slice(1);
      },
      (receipt) => {
        receipt.saved[0].version += 1;
      },
      (receipt) => {
        receipt.revisions[0].version += 1;
      },
      (receipt) => {
        receipt.changes[0].entity.title = "tampered nested entity";
      },
    ];
    for (const mutate of nestedReceiptMutations) {
      const tampered = structuredClone(originalReceipt);
      mutate(tampered);
      database.save("change_event", {
        ...database.get("change_event", event.id, true),
        receipt_json: JSON.stringify(tampered),
      });
      assert.throws(
        () => acceptance.execute(command),
        (error) => error?.code === "COMMAND_ID_REUSED",
      );
      database.save("change_event", {
        ...database.get("change_event", event.id, true),
        receipt_json: originalReceiptJson,
      });
    }

    const eventWithoutIntegrity = database.get("change_event", event.id, true);
    const legacyMetadata = { ...eventWithoutIntegrity.metadata };
    delete legacyMetadata.content_proposal_receipt_integrity;
    database.save("change_event", { ...eventWithoutIntegrity, metadata: legacyMetadata });
    const restartedAcceptance = new AiProposalAcceptanceService(
      new ApplicationCommandService(database),
      {
        materializeArtifactProposal() {
          throw new Error("unexpected artifact");
        },
        rollbackMaterializedArtifactProposal() {},
      },
      database,
    );
    assert.deepEqual(restartedAcceptance.execute(command).events, first.events);
    const legacyTamperedEvent = database.get("change_event", event.id, true);
    const legacyTamperedMetadata = { ...legacyTamperedEvent.metadata };
    delete legacyTamperedMetadata.content_proposal_receipt_integrity;
    const legacyTamperedReceipt = structuredClone(originalReceipt);
    legacyTamperedReceipt.changes[0].entity.title = "legacy tampered nested entity";
    database.save("change_event", {
      ...legacyTamperedEvent,
      metadata: legacyTamperedMetadata,
      receipt_json: JSON.stringify(legacyTamperedReceipt),
    });
    assert.throws(
      () => restartedAcceptance.execute(command),
      (error) => error?.code === "COMMAND_ID_REUSED",
    );
    database.save("change_event", {
      ...database.get("change_event", event.id, true),
      receipt_json: originalReceiptJson,
    });
    restartedAcceptance.execute(command);

    database.save("change_event", { ...event, command_name: "UpdateTask" });
    assert.throws(
      () => acceptance.execute(command),
      (error) => error?.code === "COMMAND_ID_REUSED",
    );
    let restoredEvent = database.save("change_event", {
      ...database.get("change_event", event.id, true),
      command_name: event.command_name,
    });
    database.save("change_event", {
      ...restoredEvent,
      command_fingerprint: "different-fingerprint",
    });
    assert.throws(
      () => acceptance.execute(command),
      (error) => error?.code === "COMMAND_ID_REUSED",
    );
    restoredEvent = database.save("change_event", {
      ...database.get("change_event", event.id, true),
      command_fingerprint: event.command_fingerprint,
    });
    const storedReceipt = JSON.parse(restoredEvent.receipt_json);
    database.save("change_event", {
      ...restoredEvent,
      receipt_json: JSON.stringify({ ...storedReceipt, commandId: "different-command" }),
    });
    assert.throws(
      () => acceptance.execute(command),
      (error) => error?.code === "COMMAND_ID_REUSED",
    );
    restoredEvent = database.save("change_event", {
      ...database.get("change_event", event.id, true),
      receipt_json: restoredEvent.receipt_json,
    });
    database.save("change_event", {
      ...restoredEvent,
      receipt_json: JSON.stringify({ ...storedReceipt, name: "UpdateTask" }),
    });
    assert.throws(
      () => acceptance.execute(command),
      (error) => error?.code === "COMMAND_ID_REUSED",
    );
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("artifact acceptance rebuilds content from DB, compensates DB failure, and retry creates no duplicate file", () => {
  const directory = root();
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite3"));
  const files = new Map();
  const removed = [];
  const materializer = {
    materializeArtifactProposal(request) {
      assert.equal(request.content, '{"from":"database"}');
      const storedPath = path.join(directory, `${request.materializationKey}.json`);
      const created = !files.has(storedPath);
      if (created) files.set(storedPath, request.content);
      return {
        status: "ok",
        directory,
        created,
        file: {
          filename: "result.json",
          fileType: "json",
          mimeType: "application/json",
          fileSize: request.content.length,
          storedPath,
          originalPath: "",
          copiedAt: "2026-08-21T00:00:00.000Z",
          storageMode: "managed",
        },
      };
    },
    rollbackMaterializedArtifactProposal(storedPath) {
      removed.push(storedPath);
      files.delete(storedPath);
    },
  };
  try {
    const proposal = database.save("ai_proposal", {
      id: "proposal-artifact-path",
      source: "mcp",
      source_app: "fixture",
      payload_type: "artifacts",
      payload: {
        artifacts: [
          {
            action: "create",
            title: "Result",
            file_name: "result.json",
            media_type: "application/json",
            content: '{"from":"database"}',
            reason: "proof",
          },
        ],
      },
      request: { tool: "tasken.propose_artifact" },
      status: "pending",
      received_at: "2026-08-21T00:00:00.000Z",
    });
    const commands = new ApplicationCommandService(database);
    const acceptance = new AiProposalAcceptanceService(commands, materializer, database);
    const artifactId = stableProposalEntityId(proposal.id, "artifact", 0);
    const candidate = {
      type: "artifact",
      entity: {
        id: artifactId,
        title: "Renderer title",
        source_type: "ai_proposal",
        source_id: proposal.id,
        proposal_materialization: { entryIndex: 0, themeId: null },
        stored_path: "C:/untrusted/path",
      },
    };
    const invalid = envelope(proposal, [candidate]);
    invalid.expectedVersions[0].version = 999;
    assert.throws(() => acceptance.execute(invalid), /更新済み|expected/i);
    assert.equal(files.size, 0);
    assert.equal(removed.length, 1);
    assert.equal(database.get("artifact", artifactId), null);
    const valid = envelope(proposal, [candidate]);
    const first = acceptance.execute(valid);
    assert.equal(first.status, "applied");
    assert.equal(files.size, 1);
    assert.equal(database.list("artifact").length, 1);
    assert.notEqual(database.get("artifact", artifactId).stored_path, "C:/untrusted/path");
    const eventCount = database.list("change_event").length;
    const retry = acceptance.execute(valid);
    assert.equal(retry.status, first.status);
    assert.deepEqual(retry.events, first.events);
    assert.deepEqual(retry.saved, first.saved);
    assert.equal(files.size, 1);
    assert.equal(database.list("artifact").length, 1);
    assert.equal(database.list("change_event").length, eventCount);
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("WorkspaceService atomically publishes deterministic Artifact files, cleans failed staging, and reuses only identical finals", () => {
  const directory = root();
  const managed = path.join(directory, "managed");
  fs.mkdirSync(managed);
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite3"));
  database.setPreference("artifactDirectory", managed);
  const service = new WorkspaceService(database, directory, () => "2026-08-21T00:00:00.000Z");
  try {
    const request = {
      title: "Stable",
      fileName: "stable.json",
      mediaType: "application/json",
      content: '{"stable":true}',
      themeId: null,
      materializationKey: "stable-candidate",
    };
    const first = service.materializeArtifactProposal(request);
    const expectedTemp = `${first.file.storedPath}.tasken-tmp`;
    fs.rmSync(first.file.storedPath);
    fs.writeFileSync(expectedTemp, "partial crash bytes");
    const recovered = service.materializeArtifactProposal(request);
    const retry = service.materializeArtifactProposal(request);
    assert.equal(first.status, "ok");
    assert.equal(recovered.status, "ok");
    assert.equal(retry.status, "ok");
    assert.equal(first.created, true);
    assert.equal(recovered.created, true);
    assert.equal(retry.created, false);
    assert.equal(retry.file.storedPath, first.file.storedPath);
    assert.equal(fs.readdirSync(path.dirname(first.file.storedPath)).length, 1);
    assert.equal(fs.existsSync(expectedTemp), false);
    assert.throws(
      () => service.materializeArtifactProposal({ ...request, content: '{"stable":false}' }),
      /競合/,
    );
    assert.equal(fs.readFileSync(first.file.storedPath, "utf8"), request.content);

    const failingRequest = {
      ...request,
      fileName: "failure.json",
      content: '{"failure":true}',
      materializationKey: "failure-candidate",
    };
    const failingSuffix = createHash("sha256")
      .update(failingRequest.materializationKey)
      .digest("hex")
      .slice(0, 12);
    const failingPath = path.join(
      path.dirname(first.file.storedPath),
      `failure-${failingSuffix}.json`,
    );
    const failingTemp = `${failingPath}.tasken-tmp`;
    const originalWriteSync = fs.writeSync;
    let injected = false;
    fs.writeSync = (...args) => {
      if (!injected) {
        injected = true;
        originalWriteSync(args[0], args[1], args[2], Math.min(3, args[3]));
        throw new Error("injected partial staging failure");
      }
      return originalWriteSync(...args);
    };
    try {
      assert.throws(
        () => service.materializeArtifactProposal(failingRequest),
        /Artifactを確定できませんでした/,
      );
    } finally {
      fs.writeSync = originalWriteSync;
    }
    assert.equal(fs.existsSync(failingPath), false);
    assert.equal(fs.existsSync(failingTemp), false);
    assert.equal(service.materializeArtifactProposal(failingRequest).status, "ok");
    assert.equal(fs.readFileSync(failingPath, "utf8"), failingRequest.content);
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("sketch acceptance rebuilds SVG and nested IDs from the DB proposal", () => {
  const directory = root();
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite3"));
  try {
    const proposal = database.save("ai_proposal", {
      id: "proposal-sketch-path",
      source: "mcp",
      source_app: "fixture",
      payload_type: "sketches",
      payload: {
        sketches: [
          {
            action: "create",
            title: "Canonical sketch",
            svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
            reason: "proof",
          },
        ],
      },
      request: { tool: "tasken.propose_sketch" },
      status: "pending",
      received_at: "2026-08-21T00:15:00.000Z",
    });
    const preview = buildPreview(proposal, { data: {}, themes: [], items: [] });
    const candidates = stabilizeProposalOperations(
      proposal.id,
      buildCandidateOperations(preview.candidates),
    ).map((operation) => ({
      type: operation.type,
      entity: { ...operation.entity, title: "Renderer forged sketch", document: { forged: true } },
    }));
    const acceptance = new AiProposalAcceptanceService(
      new ApplicationCommandService(database),
      {
        materializeArtifactProposal() {
          throw new Error("unexpected artifact");
        },
        rollbackMaterializedArtifactProposal() {},
      },
      database,
    );
    const command = envelope(proposal, candidates);
    const first = acceptance.execute(command);
    const sketch = database.list("sketch")[0];
    assert.equal(sketch.title, "Canonical sketch");
    assert.equal(
      sketch.document.pages[0].id,
      stableProposalEntityId(proposal.id, "sketch_page", 0),
    );
    assert.equal(
      sketch.document.pages[0].objects[0].id,
      stableProposalEntityId(proposal.id, "sketch_object", 0),
    );
    assert.match(sketch.document.pages[0].objects[0].data_url, /%3Csvg/);
    const eventCount = database.list("change_event").length;
    assert.deepEqual(acceptance.execute(command).events, first.events);
    assert.equal(database.list("sketch").length, 1);
    assert.equal(database.list("change_event").length, eventCount);
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Note create and edit acceptance keep canonical Markdown, DB, Proposal, receipt and retry exactly-once", () => {
  const directory = root();
  const managed = path.join(directory, "managed");
  fs.mkdirSync(managed);
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite3"));
  database.loadWorkspace();
  database.setPreference("artifactDirectory", managed);
  const workspace = new WorkspaceService(database, directory, () => "2026-08-21T01:00:00.000Z");
  const acceptance = new AiProposalAcceptanceService(
    new ApplicationCommandService(database),
    workspace,
    database,
  );
  const details = new ContentDetailQueryService({
    list: database.list.bind(database),
    workspaceAiVisibilityDefault: () => ["coding_agent"],
  });
  try {
    const verifyLegacyNoteReplay = (command, receipt) => {
      const originalEvent = database.get("change_event", receipt.events[0], true);
      const originalReceiptJson = originalEvent.receipt_json;
      const storedReceipt = JSON.parse(originalReceiptJson);
      assert.equal(originalEvent.record_type || originalEvent.entity_type, "note");
      assert.deepEqual(
        database
          .list("change_event", true)
          .filter((event) => event.command_id === command.commandId)
          .map((event) => event.id),
        receipt.events,
      );
      assert.deepEqual(storedReceipt.changes[0], {
        type: "note",
        entity: JSON.parse(originalEvent.after_json),
      });
      assert.deepEqual(storedReceipt.changes[1], {
        type: "ai_proposal",
        entity: database.get("ai_proposal", command.payload.proposal.id, true),
      });
      const legacyMetadata = { ...originalEvent.metadata };
      delete legacyMetadata.content_proposal_receipt_integrity;
      const legacyEvent = database.save("change_event", {
        ...originalEvent,
        metadata: legacyMetadata,
      });
      assert.equal(legacyEvent.command_fingerprint, commandFingerprint(command));
      assert.deepEqual(storedReceipt.events, [legacyEvent.id]);
      assert.deepEqual(
        storedReceipt.saved,
        storedReceipt.changes.map(({ type, entity }) => ({
          type,
          id: entity.id,
          version: entity.version,
        })),
      );
      assert.deepEqual(storedReceipt.revisions, storedReceipt.saved);
      const restartedWorkspace = new WorkspaceService(
        database,
        directory,
        () => "2026-08-21T01:00:00.000Z",
      );
      const restartedAcceptance = new AiProposalAcceptanceService(
        new ApplicationCommandService(database),
        restartedWorkspace,
        database,
      );
      assert.deepEqual(restartedAcceptance.execute(command).events, receipt.events);
      const sealedEvent = database.get("change_event", receipt.events[0], true);
      assert.equal(
        sealedEvent.metadata.content_proposal_receipt_integrity.schema,
        "tasken-content-proposal-receipt/v1",
      );
      const sealedVersion = sealedEvent.version;
      restartedAcceptance.execute(command);
      assert.equal(database.get("change_event", receipt.events[0], true).version, sealedVersion);

      const tamperedReceipt = JSON.parse(originalReceiptJson);
      tamperedReceipt.changes[0].entity.body_markdown = "legacy nested tamper";
      const tamperedMetadata = { ...sealedEvent.metadata };
      delete tamperedMetadata.content_proposal_receipt_integrity;
      database.save("change_event", {
        ...sealedEvent,
        metadata: tamperedMetadata,
        receipt_json: JSON.stringify(tamperedReceipt),
      });
      assert.throws(
        () => restartedAcceptance.execute(command),
        (error) => error?.code === "COMMAND_ID_REUSED",
      );
      const tamperedEvent = database.get("change_event", receipt.events[0], true);
      database.save("change_event", {
        ...tamperedEvent,
        metadata: tamperedMetadata,
        receipt_json: originalReceiptJson,
      });
      restartedAcceptance.execute(command);
    };

    const createProposal = database.save("ai_proposal", {
      id: "proposal-note-create",
      source: "mcp",
      source_app: "fixture",
      payload_type: "notes",
      payload: {
        notes: [
          {
            action: "create",
            title: "Canonical create",
            body: "created body",
            note_type: "report",
            report_date: "2026-08-31",
            reason: "test",
          },
        ],
      },
      request: { tool: "tasken.propose_note" },
      status: "pending",
      received_at: "2026-08-21T00:00:00.000Z",
    });
    const createCommand = envelope(createProposal, noteCandidates(createProposal, []));
    createCommand.payload.candidates[0].entity.body_markdown = "Renderer forged body";
    const createReceipt = acceptance.execute(createCommand);
    const created = database.list("note")[0];
    const createBinding = canonicalMarkdownBindingFromProperties(created.properties_json, {
      noteId: created.id,
    });
    assert.equal(created.body_markdown, "created body");
    assert.equal(created.note_type, "report");
    assert.deepEqual(created.properties_json.daily_report, { date: "2026-08-31" });
    assert.equal(created.project_id, PERSONAL_DEFAULT_THEME_ID);
    assert.equal(details.getNote({ note_id: created.id }).note.note_type, "report");
    assert.equal(database.get("ai_proposal", createProposal.id).status, "accepted");
    assert.equal(createReceipt.changes.length, 2);
    assert.equal(createReceipt.events.length, 1);
    assert.equal(fs.existsSync(createBinding.canonical_path), true);
    assert.match(fs.readFileSync(createBinding.canonical_path, "utf8"), /created body/);
    const createCounts = {
      notes: database.list("note").length,
      events: database.list("change_event").length,
    };
    assert.deepEqual(acceptance.execute(createCommand).events, createReceipt.events);
    assert.deepEqual(
      { notes: database.list("note").length, events: database.list("change_event").length },
      createCounts,
    );
    verifyLegacyNoteReplay(createCommand, createReceipt);

    const editProposal = database.save("ai_proposal", {
      id: "proposal-note-edit",
      source: "mcp",
      source_app: "fixture",
      payload_type: "notes",
      payload: {
        notes: [
          {
            action: "merge",
            target_id: created.id,
            base_version: created.version,
            title: created.title,
            body: "edited body",
            reason: "test",
          },
        ],
      },
      request: {
        tool: "tasken.propose_note_edit",
        target: { type: "note", id: created.id, base_version: created.version },
      },
      status: "pending",
      received_at: "2026-08-21T00:10:00.000Z",
    });
    const editCommand = envelope(editProposal, noteCandidates(editProposal, [created]), [
      {
        entryIndex: 0,
        type: "note",
        action: "accept",
        acceptedHunks: [0],
        beforeSignature: markdownSignature(created.body_markdown),
      },
    ]);
    const editReceipt = acceptance.execute(editCommand);
    const edited = database.get("note", created.id);
    const editBinding = canonicalMarkdownBindingFromProperties(edited.properties_json, {
      noteId: edited.id,
    });
    assert.equal(edited.body_markdown, "edited body");
    assert.equal(editBinding.canonical_path, createBinding.canonical_path);
    assert.equal(database.get("ai_proposal", editProposal.id).status, "accepted");
    assert.match(fs.readFileSync(editBinding.canonical_path, "utf8"), /edited body/);
    const editCounts = {
      notes: database.list("note").length,
      events: database.list("change_event").length,
    };
    assert.deepEqual(acceptance.execute(editCommand).events, editReceipt.events);
    assert.deepEqual(
      { notes: database.list("note").length, events: database.list("change_event").length },
      editCounts,
    );
    verifyLegacyNoteReplay(editCommand, editReceipt);

    const promptProposal = database.save("ai_proposal", {
      id: "proposal-note-prompt",
      source: "mcp",
      source_app: "fixture",
      payload_type: "notes",
      payload: {
        notes: [
          {
            action: "create",
            title: "Prompt",
            body: "prompt body",
            note_type: "prompt",
            reason: "test",
          },
        ],
      },
      request: { tool: "tasken.propose_note" },
      status: "pending",
      received_at: "2026-08-21T00:30:00.000Z",
    });
    acceptance.execute(envelope(promptProposal, noteCandidates(promptProposal, [])));
    const prompt = database.list("note").find((note) => note.title === "Prompt");
    assert.equal(prompt.note_type, "prompt");
    assert.equal(details.getNote({ note_id: prompt.id }).note.note_type, "prompt");

    const unknownPreview = buildPreview(
      {
        id: "proposal-note-unknown",
        payload_type: "notes",
        payload: {
          notes: [{ action: "create", title: "Unknown", body: "body", note_type: "protocol" }],
        },
      },
      { data: { notes: [] }, themes: [], items: [] },
    );
    assert.equal(unknownPreview.candidates[0].action, "ignore");
    assert.deepEqual(unknownPreview.candidates[0].issues, ["note_typeが不正です"]);
    assert.deepEqual(buildCandidateOperations(unknownPreview.candidates), []);
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("canonical Note create recovers file-first DB failure and restart retry writes one receipt", () => {
  const directory = root();
  const managed = path.join(directory, "managed");
  fs.mkdirSync(managed);
  const databasePath = path.join(directory, "workspace.sqlite3");
  const database = new WorkspaceDatabase(databasePath);
  database.loadWorkspace();
  database.setPreference("artifactDirectory", managed);
  let closed = false;
  let recovered = null;
  try {
    const proposal = database.save("ai_proposal", {
      id: "proposal-note-create-recovery",
      source: "mcp",
      source_app: "fixture",
      payload_type: "notes",
      payload: {
        notes: [
          {
            action: "create",
            title: "Recovered create",
            body: "recovered body",
            note_type: "memo",
            reason: "test",
          },
        ],
      },
      request: { tool: "tasken.propose_note" },
      status: "pending",
      received_at: "2026-08-21T00:20:00.000Z",
    });
    const command = envelope(proposal, noteCandidates(proposal, []));
    const failingRepository = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "saveMany")
          return () => {
            throw new Error("injected create transaction failure");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    const failingWorkspace = new WorkspaceService(
      failingRepository,
      directory,
      () => "2026-08-21T01:00:00.000Z",
    );
    const failingAcceptance = new AiProposalAcceptanceService(
      new ApplicationCommandService(database),
      failingWorkspace,
      database,
    );
    assert.throws(() => failingAcceptance.execute(command), /Tasken内部への保存に失敗/);
    assert.equal(database.list("note").length, 0);
    assert.equal(database.get("ai_proposal", proposal.id).status, "pending");
    assert.equal(
      fs.readdirSync(managed, { recursive: true }).filter((entry) => String(entry).endsWith(".md"))
        .length,
      1,
    );

    database.db.close();
    closed = true;
    recovered = new WorkspaceDatabase(databasePath);
    const recoveredWorkspace = new WorkspaceService(
      recovered,
      directory,
      () => "2026-08-21T01:00:00.000Z",
    );
    recoveredWorkspace.loadWorkspace();
    const recoveredNote = recovered.list("note")[0];
    assert.equal(recoveredNote.body_markdown, "recovered body");
    assert.equal(recoveredNote.note_type, "memo");
    const recoveredDetails = new ContentDetailQueryService({
      list: recovered.list.bind(recovered),
      workspaceAiVisibilityDefault: () => ["coding_agent"],
    });
    assert.equal(recoveredDetails.getNote({ note_id: recoveredNote.id }).note.note_type, "memo");
    assert.equal(recovered.get("ai_proposal", proposal.id).status, "accepted");
    const retry = new AiProposalAcceptanceService(
      new ApplicationCommandService(recovered),
      recoveredWorkspace,
      recovered,
    ).execute(command);
    assert.equal(retry.status, "applied");
    assert.equal(recovered.list("note").length, 1);
    assert.equal(recovered.list("change_event").length, 1);
    const event = recovered.get("change_event", retry.events[0], true);
    assert.equal(JSON.parse(event.receipt_json).commandId, command.commandId);
    assert.equal(
      fs.readdirSync(managed, { recursive: true }).filter((entry) => String(entry).endsWith(".md"))
        .length,
      1,
    );
  } finally {
    if (recovered) recovered.db.close();
    if (!closed) database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("AiProposalPanel accepts through ApplyAiProposal without direct saveEntities or materialize API", () => {
  const source = fs.readFileSync(
    "src/renderer/src/features/workspace/components/AiProposalPanel.tsx",
    "utf8",
  );
  const acceptStart = source.indexOf("async function acceptProposal");
  const acceptBlock = source.slice(acceptStart, source.indexOf("  return (", acceptStart));
  assert.match(acceptBlock, /name: "ApplyAiProposal"/);
  assert.doesNotMatch(acceptBlock, /saveEntities\(/);
  assert.doesNotMatch(acceptBlock, /materializeArtifactProposal/);
  const rejectStart = source.indexOf("async function rejectProposal");
  const rejectBlock = source.slice(
    rejectStart,
    source.indexOf("async function quarantineProposal", rejectStart),
  );
  assert.match(rejectBlock, /name: "ApplyAiProposal"/);
  assert.doesNotMatch(rejectBlock, /saveEntities\(/);
});

test("AI Inbox applies Agent Session start and finish while keeping original intent immutable", () => {
  const directory = root();
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite3"));
  try {
    database.save("repository_context", {
      id: "repo-agent-session",
      label: "Tasuken",
      provider: "github",
      repository_slug: "mryk814/tasuken",
      remote_url: "https://github.com/mryk814/tasuken.git",
    });
    const sessionId = "91d9c5e6-17c8-5e3a-8a90-2fc4dfe8f4da";
    const startProposal = database.save("ai_proposal", {
      id: "proposal-agent-session-start",
      source: "mcp",
      source_app: "codex",
      payload_type: "agent_sessions",
      payload: {
        agent_sessions: [
          {
            action: "start",
            session: {
              id: sessionId,
              started_at: "2026-08-25T10:00:00.000Z",
              status: "active",
              client_kind: "codex",
              client_label: "Codex Desktop",
              source_session_id: "thread-498",
              intent: {
                summary: "Implement Issue #498",
                requested_outcome: null,
                boundary: "Proposal only",
              },
              source: "ai_proposal",
            },
            references: [
              {
                id: "ref-agent-session-repo",
                source_type: "agent_session",
                source_id: sessionId,
                target_type: "repository_context",
                target_id: "repo-agent-session",
                relation_type: "worked_on",
                layer: "provenance",
                status: "asserted",
                origin: "ai_suggested",
                metadata: { accepted_from_proposal_id: "proposal-agent-session-start" },
              },
            ],
          },
        ],
      },
      request: { tool: "tasken.start_agent_session" },
      status: "pending",
      received_at: "2026-08-25T10:00:01.000Z",
    });
    const startPreview = buildPreview(startProposal, {
      data: { agent_sessions: [] },
      themes: [],
      items: [],
    });
    const startCandidates = buildCandidateOperations(startPreview.candidates).map((operation) => ({
      type: operation.type,
      entity: operation.entity,
    }));
    const commands = new ApplicationCommandService(database);
    commands.execute({
      commandId: "proposal-agent-session-start:accept",
      name: "ApplyAiProposal",
      payload: { proposal: { ...startProposal, status: "accepted" }, candidates: startCandidates },
      actor: { kind: "user" },
      source: "main_ui",
      expectedVersions: [
        { type: "ai_proposal", id: startProposal.id, version: startProposal.version },
      ],
      issuedAt: startProposal.received_at,
    });
    const active = database.get("agent_session", sessionId);
    assert.equal(active.status, "active");
    assert.equal(active.intent.summary, "Implement Issue #498");
    assert.equal(database.get("reference", "ref-agent-session-repo").source_id, sessionId);

    const finishProposal = database.save("ai_proposal", {
      id: "proposal-agent-session-finish",
      source: "mcp",
      source_app: "codex",
      payload_type: "agent_sessions",
      payload: {
        agent_sessions: [
          {
            action: "finish",
            session: {
              ...active,
              ended_at: "2026-08-25T11:00:00.000Z",
              status: "completed",
              outcome: {
                summary: "Implemented",
                decisions: [],
                changed_items: [],
                verification: ["tests"],
                remaining_work: [],
                next_suggested_action: null,
              },
            },
            references: [],
          },
        ],
      },
      request: { tool: "tasken.finish_agent_session" },
      status: "pending",
      received_at: "2026-08-25T11:00:01.000Z",
    });
    const finishPreview = buildPreview(finishProposal, {
      data: { agent_sessions: [active] },
      themes: [],
      items: [],
    });
    const finishCandidates = buildCandidateOperations(finishPreview.candidates).map(
      (operation) => ({ type: operation.type, entity: operation.entity }),
    );
    const finishCommand = {
      commandId: "proposal-agent-session-finish:accept",
      name: "ApplyAiProposal",
      payload: {
        proposal: { ...finishProposal, status: "accepted" },
        candidates: finishCandidates,
      },
      actor: { kind: "user" },
      source: "main_ui",
      expectedVersions: [
        { type: "ai_proposal", id: finishProposal.id, version: finishProposal.version },
        { type: "agent_session", id: sessionId, version: active.version },
      ],
      issuedAt: finishProposal.received_at,
    };
    assert.throws(
      () =>
        commands.execute({
          ...finishCommand,
          commandId: "proposal-agent-session-finish:tampered",
          payload: {
            ...finishCommand.payload,
            candidates: finishCandidates.map((candidate) =>
              candidate.type === "agent_session"
                ? {
                    ...candidate,
                    entity: {
                      ...candidate.entity,
                      intent: { ...candidate.entity.intent, summary: "Forged intent" },
                    },
                  }
                : candidate,
            ),
          },
        }),
      /intent/,
    );
    commands.execute(finishCommand);
    const completed = database.get("agent_session", sessionId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.intent.summary, "Implement Issue #498");
    assert.equal(completed.outcome.summary, "Implemented");

    const capturedSessionId = "8c731737-b6a2-5bf7-a9dd-50ddd53495c1";
    const captureProposal = database.save("ai_proposal", {
      id: "proposal-agent-session-capture",
      source: "mcp",
      source_app: "tasken-session-hook:codex",
      payload_type: "agent_sessions",
      payload: {
        agent_sessions: [
          {
            action: "capture",
            session: {
              id: capturedSessionId,
              started_at: "2026-08-25T12:00:00.000Z",
              ended_at: "2026-08-25T12:20:00.000Z",
              status: "completed",
              client_kind: "codex",
              source_session_id: "thread-captured",
              intent: {
                summary: "Collect a complete lifecycle",
                requested_outcome: null,
                boundary: null,
              },
              outcome: {
                summary: "Captured automatically",
                decisions: [],
                changed_items: [],
                verification: ["SessionEnd"],
                remaining_work: [],
                next_suggested_action: null,
              },
              source: "ai_proposal",
            },
            references: [],
          },
        ],
      },
      request: { tool: "tasken.submit_agent_session_record" },
      status: "pending",
      received_at: "2026-08-25T12:20:01.000Z",
    });
    const capturePreview = buildPreview(captureProposal, {
      data: { agent_sessions: [active, completed] },
      themes: [],
      items: [],
    });
    const captureCandidates = buildCandidateOperations(capturePreview.candidates).map(
      (operation) => ({ type: operation.type, entity: operation.entity }),
    );
    commands.execute({
      commandId: "proposal-agent-session-capture:accept",
      name: "ApplyAiProposal",
      payload: {
        proposal: { ...captureProposal, status: "accepted" },
        candidates: captureCandidates,
      },
      actor: { kind: "user" },
      source: "main_ui",
      expectedVersions: [
        { type: "ai_proposal", id: captureProposal.id, version: captureProposal.version },
      ],
      issuedAt: captureProposal.received_at,
    });
    const captured = database.get("agent_session", capturedSessionId);
    assert.equal(captured.status, "completed");
    assert.equal(captured.intent.summary, "Collect a complete lifecycle");
    assert.equal(captured.outcome.summary, "Captured automatically");
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("typed decisions preserve partial and rejected states with exactly-once receipts", () => {
  const directory = root();
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite3"));
  const acceptance = new AiProposalAcceptanceService(
    new ApplicationCommandService(database),
    {
      materializeArtifactProposal() {
        throw new Error("unexpected artifact");
      },
      rollbackMaterializedArtifactProposal() {},
    },
    database,
  );
  try {
    const partialProposal = database.save("ai_proposal", {
      id: "proposal-partial-decisions",
      source: "mcp",
      source_app: "fixture",
      payload_type: "knowledge_nodes",
      payload: {
        knowledge_nodes: [
          { action: "create", title: "Accepted", body: "A", node_type: "insight" },
          { action: "create", title: "Ignored", body: "B", node_type: "insight" },
        ],
      },
      request: { tool: "tasken.propose_knowledge" },
      status: "pending",
      received_at: "2026-08-21T02:00:00.000Z",
    });
    const acceptedCandidate = {
      type: "knowledge_node",
      entity: { id: stableProposalEntityId(partialProposal.id, "knowledge_node", 0) },
    };
    const partialCommand = envelope(
      partialProposal,
      [acceptedCandidate],
      [
        { entryIndex: 0, type: "knowledge_node", action: "accept" },
        { entryIndex: 1, type: "knowledge_node", action: "ignore" },
      ],
    );
    partialCommand.payload.proposal.status = "partially_accepted";
    const partialReceipt = acceptance.execute(partialCommand);
    assert.equal(database.get("ai_proposal", partialProposal.id).status, "partially_accepted");
    assert.deepEqual(
      database.list("knowledge_node").map((entry) => entry.title),
      ["Accepted"],
    );
    const partialEvents = database.list("change_event").length;
    assert.deepEqual(acceptance.execute(partialCommand).events, partialReceipt.events);
    assert.equal(database.list("change_event").length, partialEvents);

    const rejectedProposal = database.save("ai_proposal", {
      id: "proposal-rejected-decisions",
      source: "mcp",
      source_app: "fixture",
      payload_type: "knowledge_nodes",
      payload: {
        knowledge_nodes: [{ action: "create", title: "Reject me", body: "", node_type: "insight" }],
      },
      request: { tool: "tasken.propose_knowledge" },
      status: "pending",
      received_at: "2026-08-21T02:10:00.000Z",
    });
    const rejectCommand = envelope(
      rejectedProposal,
      [],
      [{ entryIndex: 0, type: "knowledge_node", action: "ignore" }],
    );
    rejectCommand.payload.decision = "reject";
    rejectCommand.payload.proposal.status = "rejected";
    const rejectReceipt = acceptance.execute(rejectCommand);
    assert.equal(database.get("ai_proposal", rejectedProposal.id).status, "rejected");
    assert.equal(database.list("knowledge_node").length, 1);
    const rejectEvents = database.list("change_event").length;
    assert.deepEqual(acceptance.execute(rejectCommand).events, rejectReceipt.events);
    assert.equal(database.list("change_event").length, rejectEvents);
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("content boundary rejects empty-artifact injection, extra/missing/mixed candidates, and version fallback bypass", () => {
  const directory = root();
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite3"));
  let materialized = 0;
  const acceptance = new AiProposalAcceptanceService(
    new ApplicationCommandService(database),
    {
      materializeArtifactProposal() {
        materialized += 1;
        throw new Error("must not materialize");
      },
      rollbackMaterializedArtifactProposal() {},
    },
    database,
  );
  try {
    const emptyArtifact = database.save("ai_proposal", {
      id: "proposal-empty-artifact",
      source: "mcp",
      source_app: "fixture",
      payload_type: "artifacts",
      payload: { artifacts: [] },
      request: { tool: "tasken.propose_artifact" },
      status: "pending",
      received_at: "2026-08-21T03:00:00.000Z",
    });
    const injected = envelope(
      emptyArtifact,
      [{ type: "note", entity: { id: "arbitrary-note", title: "Injected" } }],
      [],
    );
    assert.throws(() => acceptance.execute(injected), /件数|一致/);
    assert.equal(database.get("note", "arbitrary-note"), null);
    assert.equal(materialized, 0);

    const proposal = database.save("ai_proposal", {
      id: "proposal-candidate-shape",
      source: "mcp",
      source_app: "fixture",
      payload_type: "knowledge_nodes",
      payload: {
        knowledge_nodes: [{ action: "create", title: "Only", body: "", node_type: "insight" }],
      },
      request: { tool: "tasken.propose_knowledge" },
      status: "pending",
      received_at: "2026-08-21T03:10:00.000Z",
    });
    const correct = {
      type: "knowledge_node",
      entity: { id: stableProposalEntityId(proposal.id, "knowledge_node", 0) },
    };
    const decision = [{ entryIndex: 0, type: "knowledge_node", action: "accept" }];
    assert.throws(() => acceptance.execute(envelope(proposal, [], decision)), /件数/);
    assert.throws(
      () =>
        acceptance.execute(
          envelope(proposal, [correct, { type: "artifact", entity: { id: "mixed" } }], decision),
        ),
      /件数/,
    );
    assert.throws(
      () =>
        acceptance.execute(
          envelope(proposal, [{ type: "artifact", entity: { id: correct.entity.id } }], decision),
        ),
      /type\/id\/index/,
    );

    const bypass = envelope(
      { ...proposal, version: Number(proposal.version) + 99 },
      [{ type: "artifact", entity: { id: "bypass" } }],
      decision,
    );
    bypass.expectedVersions = [{ type: "ai_proposal", id: proposal.id, version: proposal.version }];
    assert.throws(() => acceptance.execute(bypass), /更新済み/);
    const typeBypass = envelope(
      proposal,
      [{ type: "repository_context", entity: { id: "bypass-context" } }],
      decision,
    );
    typeBypass.payload.proposal.payload_type = "repository_contexts";
    assert.throws(() => acceptance.execute(typeBypass), /typeが正本と一致/);
    assert.equal(database.list("knowledge_node").length, 0);
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Note edit verifies target/base version and applies only signed accepted hunks in Main", () => {
  const directory = root();
  const managed = path.join(directory, "managed");
  fs.mkdirSync(managed);
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite3"));
  database.loadWorkspace();
  database.setPreference("artifactDirectory", managed);
  const workspace = new WorkspaceService(database, directory, () => "2026-08-21T04:00:00.000Z");
  try {
    const initial = workspace.saveCanonicalNote({
      entity: { id: "note-hunks", title: "Hunks", body_markdown: "a\nold1\nsame\nold2" },
      snapshot: {
        owner: { recordType: "note", entityId: "note-hunks" },
        body: "a\nold1\nsame\nold2",
        expectedRevision: 0,
      },
    });
    const stale = database.save("ai_proposal", {
      id: "proposal-stale-note",
      source: "mcp",
      source_app: "fixture",
      payload_type: "notes",
      payload: {
        notes: [
          {
            action: "merge",
            target_id: initial.id,
            base_version: Number(initial.version) - 1,
            title: "Hunks",
            body: "a\nnew1\nsame\nnew2",
          },
        ],
      },
      request: {
        tool: "tasken.propose_note_edit",
        target: { type: "note", id: initial.id, base_version: Number(initial.version) - 1 },
      },
      status: "pending",
      received_at: "2026-08-21T04:10:00.000Z",
    });
    const candidate = { type: "note", entity: { id: initial.id, version: initial.version } };
    const signedDecision = [
      {
        entryIndex: 0,
        type: "note",
        action: "accept",
        acceptedHunks: [1],
        beforeSignature: markdownSignature(initial.body_markdown),
      },
    ];
    const staleCommand = envelope(stale, [candidate], signedDecision);
    assert.throws(
      () =>
        new AiProposalAcceptanceService(
          new ApplicationCommandService(database),
          workspace,
          database,
        ).execute(staleCommand),
      /base_version|更新済み/,
    );

    const valid = database.save("ai_proposal", {
      id: "proposal-partial-note",
      source: "mcp",
      source_app: "fixture",
      payload_type: "notes",
      payload: {
        notes: [
          {
            action: "merge",
            target_id: initial.id,
            base_version: initial.version,
            title: "Hunks",
            body: "a\nnew1\nsame\nnew2",
          },
        ],
      },
      request: {
        tool: "tasken.propose_note_edit",
        target: { type: "note", id: initial.id, base_version: initial.version },
      },
      status: "pending",
      received_at: "2026-08-21T04:20:00.000Z",
    });
    const validCommand = envelope(valid, [candidate], signedDecision);
    const acceptance = new AiProposalAcceptanceService(
      new ApplicationCommandService(database),
      workspace,
      database,
    );
    acceptance.execute(validCommand);
    assert.equal(database.get("note", initial.id).body_markdown, "a\nold1\nsame\nnew2");
    const changedHunks = structuredClone(validCommand);
    changedHunks.payload.decisions[0].acceptedHunks = [0];
    assert.throws(
      () => acceptance.execute(changedHunks),
      (error) => error?.code === "COMMAND_ID_REUSED",
    );
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
