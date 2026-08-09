import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
