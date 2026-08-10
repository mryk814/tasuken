import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { build } from "esbuild";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { projectContextGraph } from "../src/shared/contextGraph.mjs";
import { buildEntityLineage } from "../src/shared/conversationLineage.mjs";

async function importBundled(relativePath) {
  const result = await build({ entryPoints: [path.resolve(relativePath)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { ApplicationCommandService } = await importBundled("src/main/services/applicationCommandService.ts");
const { MediaCaptureService } = await importBundled("src/main/services/mediaCaptureService.ts");
const { projectWorkspaceForRenderer } = await importBundled("src/main/rendererMediaProjection.ts");

function tinyPcmWav() {
  const samples = 800;
  const dataBytes = samples * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + dataBytes, 4); bytes.write("WAVE", 8);
  bytes.write("fmt ", 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

function tinyWebm(label = "tasken-video") {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(label)]);
}

function asArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test("real SQLite recovery is idempotent and projects one owner edge/backlink after reopen", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-media-sqlite-"));
  const dbPath = path.join(root, "workspace.sqlite");
  const userDataPath = path.join(root, "user-data");
  const managedDirectory = path.join(root, "managed");
  const sourcePath = path.join(root, "tiny.wav");
  fs.writeFileSync(sourcePath, tinyPcmWav());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const firstDb = new WorkspaceDatabase(dbPath);
  firstDb.db.exec(`CREATE TRIGGER fail_audio_capture BEFORE INSERT ON entities
    WHEN NEW.entity_type = 'capture_entry' BEGIN SELECT RAISE(ABORT, 'injected media DB failure'); END;`);
  const firstCommands = new ApplicationCommandService(firstDb);
  const firstMedia = new MediaCaptureService({
    userDataPath,
    repository: firstDb,
    commands: { executeMediaCapture: (command) => firstCommands.executeMediaCapture(command) },
    resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
  });
  const prepared = firstMedia.prepareFile(sourcePath);
  assert.throws(() => firstMedia.commit({ sessionId: prepared.sessionId, durationMs: 100 }), /injected media DB failure/);
  assert.equal(firstDb.list("capture_entry").length, 0);
  firstDb.db.close();

  const reopenedDb = new WorkspaceDatabase(dbPath);
  reopenedDb.db.exec("DROP TRIGGER fail_audio_capture");
  const reopenedCommands = new ApplicationCommandService(reopenedDb);
  const reopenedMedia = new MediaCaptureService({
    userDataPath,
    repository: reopenedDb,
    commands: { executeMediaCapture: (command) => reopenedCommands.executeMediaCapture(command) },
    resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
  });
  assert.deepEqual(reopenedMedia.recoverPending(), { recovered: 1, pending: 0 });
  const workspace = reopenedDb.loadWorkspace();
  assert.equal(workspace.capture_entrys.length, 1);
  assert.equal(workspace.artifacts.length, 1);
  assert.equal(workspace.change_events.length, 1);
  assert.equal(workspace.references.length, 0);
  const capture = workspace.capture_entrys[0];
  const artifact = workspace.artifacts[0];
  assert.equal(artifact.source_type, "capture_entry");
  assert.equal(artifact.source_id, capture.id);
  assert.deepEqual(fs.readFileSync(artifact.stored_path), tinyPcmWav());
  assert.ok(JSON.parse(workspace.change_events[0].receipt_json).changes.some((change) => change.type === "artifact"));

  const ownerEdges = projectContextGraph(workspace).edges.filter((edge) =>
    edge.source.type === "artifact" && edge.source.id === artifact.id
      && edge.target.type === "capture_entry" && edge.target.id === capture.id
      && edge.predicate === "derived_from" && edge.origin === "artifact.source");
  assert.equal(ownerEdges.length, 1);
  const lineage = buildEntityLineage(workspace, { type: "artifact", id: artifact.id }, { maxDepth: 1 });
  assert.equal(lineage.ancestors.filter((item) => item.ref.type === "capture_entry" && item.ref.id === capture.id).length, 1);

  assert.deepEqual(reopenedMedia.recoverPending(), { recovered: 0, pending: 0 });
  assert.equal(reopenedDb.list("capture_entry").length, 1);
  assert.equal(reopenedDb.list("artifact").length, 1);
  assert.equal(reopenedDb.list("change_event").length, 1);
  reopenedDb.db.close();
});

test("video imports persist once for Task, Note, Capture, and active Focus Note owners with zero References", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-video-owner-sqlite-"));
  const dbPath = path.join(root, "workspace.sqlite");
  const userDataPath = path.join(root, "user-data");
  const managedDirectory = path.join(root, "managed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = new WorkspaceDatabase(dbPath);
  const owners = [
    { label: "Task", sourceType: "task", id: "task-1", entityType: "task", entity: { id: "task-1", title: "Legacy Task", state: "todo", project_id: null } },
    { label: "Note", sourceType: "note", id: "note-1", entityType: "note", entity: { id: "note-1", title: "Evidence Note", body_markdown: "", project_id: null } },
    { label: "Capture", sourceType: "capture_entry", id: "capture-1", entityType: "capture_entry", entity: { id: "capture-1", text: "Captured evidence", captured_at: "2026-08-09T00:00:00.000Z", state: "untriaged", project_id: null } },
    { label: "Focus", sourceType: "note", id: "focus-note-1", entityType: "note", entity: { id: "focus-note-1", title: "Focus session", body_markdown: "", project_id: null, properties_json: JSON.stringify({ document_role: "focus_session", task_id: "task-1", session_state: "active" }) } },
  ];
  for (const owner of owners) db.save(owner.entityType, owner.entity);
  const commands = new ApplicationCommandService(db);
  const media = new MediaCaptureService({
    userDataPath,
    repository: db,
    commands: { executeMediaCapture: (command) => commands.executeMediaCapture(command) },
    resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
  });
  const committed = [];
  for (const [ownerIndex, owner] of owners.entries()) {
    for (const [storageIndex, storageMode] of ["managed", "linked"].entries()) {
      const sourcePath = path.join(root, `owner-${ownerIndex}-${storageMode}.webm`);
      fs.writeFileSync(sourcePath, Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(`tasken-${owner.label}-${storageMode}`)]));
      const prepared = media.prepareVideoFile(sourcePath, { storageMode, sourceType: owner.sourceType, sourceId: owner.id });
      committed.push({ owner, storageMode, sourcePath, prepared, result: media.commitVideo({ sessionId: prepared.sessionId, durationMs: 1000 + ownerIndex * 2 + storageIndex, widthPx: 640, heightPx: 360 }) });
    }
  }
  assert.equal(db.list("artifact").length, 8);
  assert.equal(db.list("change_event").length, 8);
  assert.equal(db.list("reference").length, 0);
  db.db.close();

  const reopened = new WorkspaceDatabase(dbPath);
  const workspace = reopened.loadWorkspace();
  assert.equal(workspace.artifacts.length, 8);
  assert.equal(workspace.references.length, 0);
  const rendererWorkspace = projectWorkspaceForRenderer(workspace);
  const graph = projectContextGraph(workspace);
  for (const { owner, storageMode, sourcePath, result } of committed) {
    assert.equal("captureId" in result.publicResult, false);
    assert.equal(result.publicResult.sourceType, owner.sourceType);
    assert.equal(result.publicResult.sourceId, owner.id);
    const artifact = workspace.artifacts.find((entry) => entry.id === result.publicResult.artifactId);
    assert.ok(artifact, owner.label);
    assert.equal(artifact.storage_mode, storageMode);
    assert.equal(Object.hasOwn(artifact, "capture_method"), false);
    if (storageMode === "linked") assert.equal(artifact.target, sourcePath);
    const projected = rendererWorkspace.artifacts.find((entry) => entry.id === artifact.id);
    assert.ok(projected, `${owner.label}-${storageMode}`);
    assert.equal(Object.hasOwn(projected, "target"), false);
    assert.equal(Object.hasOwn(projected, "stored_path"), false);
    assert.equal(Object.hasOwn(projected, "linked_source_real_path"), false);
    assert.equal(graph.edges.filter((edge) => (
      edge.source.type === "artifact" && edge.source.id === artifact.id
      && edge.target.type === owner.entityType && edge.target.id === owner.id
      && edge.predicate === "derived_from" && edge.origin === "artifact.source"
    )).length, 1, owner.label);
    const lineage = buildEntityLineage(workspace, { type: "artifact", id: artifact.id }, { maxDepth: 1 });
    assert.equal(lineage.ancestors.filter((item) => item.ref.type === owner.entityType && item.ref.id === owner.id).length, 1, owner.label);
  }
  assert.equal(workspace.references.length, 0);
  reopened.db.close();
});

test("screen recording provenance persists on only its Video Artifact after SQLite reopen", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-screen-recording-sqlite-"));
  const dbPath = path.join(root, "workspace.sqlite");
  const userDataPath = path.join(root, "user-data");
  const managedDirectory = path.join(root, "managed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let currentNow = "2026-08-09T00:00:00.000Z";
  const db = new WorkspaceDatabase(dbPath);
  db.save("task", { id: "task-1", title: "Screen owner", state: "todo", project_id: null });
  const commands = new ApplicationCommandService(db);
  const media = new MediaCaptureService({
    userDataPath,
    repository: db,
    commands: { executeMediaCapture: (command) => commands.executeMediaCapture(command) },
    resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
    now: () => currentNow,
  });
  const started = media.startRecording({ mediaKind: "video", mimeType: "video/webm" });
  currentNow = "2026-08-09T00:00:01.000Z";
  media.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(tinyWebm("screen-provenance")) });
  const prepared = media.stopRecording(started.sessionId);
  const committed = media.commitVideo({ sessionId: prepared.sessionId, durationMs: prepared.durationMs, widthPx: 1280, heightPx: 720, sourceType: "task", sourceId: "task-1" });
  db.db.close();

  const reopened = new WorkspaceDatabase(dbPath);
  const artifact = reopened.get("artifact", committed.publicResult.artifactId);
  assert.equal(artifact?.media_kind, "video");
  assert.equal(artifact?.capture_method, "screen_recording");
  assert.equal(artifact?.source_type, "task");
  assert.equal(artifact?.source_id, "task-1");
  assert.equal(reopened.list("artifact").length, 1);
  reopened.db.close();
});

test("managed and linked video DB failures recover idempotently in real SQLite", (t) => {
  for (const storageMode of ["managed", "linked"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `tasken-video-${storageMode}-retry-`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dbPath = path.join(root, "workspace.sqlite");
    const userDataPath = path.join(root, "user-data");
    const managedDirectory = path.join(root, "managed");
    const sourcePath = path.join(root, `retry-${storageMode}.webm`);
    fs.writeFileSync(sourcePath, tinyWebm(storageMode));

    const firstDb = new WorkspaceDatabase(dbPath);
    firstDb.save("task", { id: "task-1", title: "Retry owner", state: "todo", project_id: null });
    firstDb.db.exec(`CREATE TRIGGER fail_video_artifact BEFORE INSERT ON entities
      WHEN NEW.entity_type = 'artifact' BEGIN SELECT RAISE(ABORT, 'injected video DB failure'); END;`);
    const firstCommands = new ApplicationCommandService(firstDb);
    const firstMedia = new MediaCaptureService({
      userDataPath,
      repository: firstDb,
      commands: { executeMediaCapture: (command) => firstCommands.executeMediaCapture(command) },
      resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
    });
    const prepared = firstMedia.prepareVideoFile(sourcePath, { storageMode, sourceType: "task", sourceId: "task-1" });
    assert.throws(() => firstMedia.commitVideo({ sessionId: prepared.sessionId, durationMs: 900, widthPx: 320, heightPx: 180 }), /injected video DB failure/);
    assert.equal(firstDb.list("artifact").length, 0);
    assert.equal(firstDb.list("change_event").length, 0);
    firstDb.db.close();

    const reopenedDb = new WorkspaceDatabase(dbPath);
    reopenedDb.db.exec("DROP TRIGGER fail_video_artifact");
    const reopenedCommands = new ApplicationCommandService(reopenedDb);
    const reopenedMedia = new MediaCaptureService({
      userDataPath,
      repository: reopenedDb,
      commands: { executeMediaCapture: (command) => reopenedCommands.executeMediaCapture(command) },
      resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
    });
    assert.deepEqual(reopenedMedia.recoverPending(), { recovered: 1, pending: 0 }, storageMode);
    assert.equal(reopenedDb.list("artifact").length, 1, storageMode);
    assert.equal(reopenedDb.list("change_event").length, 1, storageMode);
    assert.equal(reopenedDb.list("reference").length, 0, storageMode);
    assert.deepEqual(reopenedMedia.recoverPending(), { recovered: 0, pending: 0 }, storageMode);
    assert.equal(reopenedDb.list("artifact").length, 1, storageMode);
    assert.equal(reopenedDb.list("change_event").length, 1, storageMode);
    reopenedDb.db.close();
  }
});

test("Capture to Task transfer preserves managed video storage identity and owner edge after reopen", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-video-capture-transfer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, "workspace.sqlite");
  const userDataPath = path.join(root, "user-data");
  const managedDirectory = path.join(root, "managed");
  const sourcePath = path.join(root, "capture.webm");
  const bytes = tinyWebm("capture-transfer");
  fs.writeFileSync(sourcePath, bytes);

  const db = new WorkspaceDatabase(dbPath);
  db.save("project", { id: "theme-personal-default", name: "Personal", state: "active" });
  db.save("theme", { id: "theme-personal-default", name: "Personal" });
  const capture = db.save("capture_entry", { id: "capture-1", text: "Video capture", captured_at: "2026-08-09T00:00:00.000Z", state: "untriaged", project_id: "theme-personal-default" });
  const commands = new ApplicationCommandService(db);
  const media = new MediaCaptureService({
    userDataPath,
    repository: db,
    commands: { executeMediaCapture: (command) => commands.executeMediaCapture(command) },
    resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
  });
  const prepared = media.prepareVideoFile(sourcePath, { storageMode: "managed", sourceType: "capture_entry", sourceId: capture.id });
  const committed = media.commitVideo({ sessionId: prepared.sessionId, durationMs: 1200, widthPx: 640, heightPx: 360 });
  const artifactBefore = db.get("artifact", committed.publicResult.artifactId);
  const taskId = randomUUID();
  commands.execute({
    commandId: randomUUID(),
    name: "CreateTaskFromCapture",
    payload: {
      task: { id: taskId, title: "Converted video", state: "todo", project_id: "" },
      captureId: capture.id,
      captureVersion: capture.version,
      transition: "triage_to_task",
      artifactIds: [artifactBefore.id],
    },
    expectedVersions: [
      { type: "capture_entry", id: capture.id, version: capture.version },
      { type: "artifact", id: artifactBefore.id, version: artifactBefore.version },
    ],
    actor: { kind: "user" },
    source: "inbox",
    issuedAt: "2026-08-09T00:01:00.000Z",
  });
  const transferred = db.get("artifact", artifactBefore.id);
  assert.equal(transferred.source_type, "task");
  assert.equal(transferred.source_id, taskId);
  assert.equal(transferred.theme_id, artifactBefore.theme_id);
  assert.equal(transferred.stored_path, artifactBefore.stored_path);
  db.db.close();

  const reopened = new WorkspaceDatabase(dbPath);
  const reopenedCommands = new ApplicationCommandService(reopened);
  const reopenedMedia = new MediaCaptureService({
    userDataPath,
    repository: reopened,
    commands: { executeMediaCapture: (command) => reopenedCommands.executeMediaCapture(command) },
    resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
  });
  const resolution = reopenedMedia.resolveArtifactMedia(artifactBefore.id);
  assert.equal(resolution.availability, "available");
  assert.deepEqual(fs.readFileSync(resolution.fileDescriptor), bytes);
  fs.closeSync(resolution.fileDescriptor);
  const workspace = reopened.loadWorkspace();
  const graph = projectContextGraph(workspace);
  assert.equal(graph.edges.filter((edge) => edge.source.type === "artifact" && edge.source.id === artifactBefore.id
    && edge.target.type === "task" && edge.target.id === taskId && edge.predicate === "derived_from").length, 1);
  assert.equal(graph.edges.filter((edge) => edge.source.type === "artifact" && edge.source.id === artifactBefore.id
    && edge.target.type === "capture_entry" && edge.target.id === capture.id).length, 0);
  assert.equal(workspace.references.length, 0);
  reopened.db.close();
});

test("紐づけ先未選択の画面録画は実DBでCaptureEntryごと確定しInboxへ残る（#383）", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-screen-inbox-sqlite-"));
  const dbPath = path.join(root, "workspace.sqlite");
  const userDataPath = path.join(root, "user-data");
  const managedDirectory = path.join(root, "managed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let currentNow = "2026-08-09T00:00:00.000Z";
  const db = new WorkspaceDatabase(dbPath);
  const commands = new ApplicationCommandService(db);
  const media = new MediaCaptureService({
    userDataPath,
    repository: db,
    commands: { executeMediaCapture: (command) => commands.executeMediaCapture(command) },
    resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
    now: () => currentNow,
  });
  const started = media.startRecording({ mediaKind: "video", mimeType: "video/webm" });
  currentNow = "2026-08-09T00:00:01.000Z";
  media.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(tinyWebm("screen-inbox")) });
  const prepared = media.stopRecording(started.sessionId);
  // ownerを渡さない。既定のInbox行きが実Command経由で通ることを確かめる。
  const committed = media.commitVideo({ sessionId: prepared.sessionId, durationMs: prepared.durationMs, widthPx: 1280, heightPx: 720 });
  db.db.close();

  const reopened = new WorkspaceDatabase(dbPath);
  const artifact = reopened.get("artifact", committed.publicResult.artifactId);
  assert.equal(artifact?.media_kind, "video");
  assert.equal(artifact?.source_type, "capture_entry");
  const capture = reopened.get("capture_entry", artifact.source_id);
  assert.equal(capture?.kind, "screen_capture");
  assert.equal(capture?.content_type, "video");
  assert.equal(capture?.state, "untriaged");
  reopened.db.close();
});
