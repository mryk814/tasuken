import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";

import { build } from "esbuild";

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

const { MediaCaptureService } = await importBundled("src/main/services/mediaCaptureService.ts");
const { createTrimPlan } = await importBundled("src/shared/screenRecordingEdit.mjs");

const IDS = [
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
  "00000000-0000-4000-8000-000000000103",
  "00000000-0000-4000-8000-000000000104",
  "00000000-0000-4000-8000-000000000105",
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-video-import-"));
  const userDataPath = path.join(root, "user-data");
  const managedDirectory = path.join(root, "managed");
  const sourcePath = path.join(root, "evidence.mp4");
  fs.mkdirSync(userDataPath, { recursive: true });
  const bytes = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisomtasken-video")]);
  fs.writeFileSync(sourcePath, bytes);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, userDataPath, managedDirectory, sourcePath, bytes };
}

function harness(paths, { fail = false, ownerThemeId = null, missingTheme = false, legacyTheme = false } = {}) {
  let index = 0;
  const commands = {
    calls: [],
    executeMediaCapture(command) {
      this.calls.push(command);
      if (fail) throw new Error("injected DB failure");
      return { status: "applied", commandId: command.commandId, changes: [], events: [] };
    },
  };
  const media = new MediaCaptureService({
    userDataPath: paths.userDataPath,
    repository: {
      get(type, id) {
        if (type === "artifact") return null;
        if (type === "task" && id === "task-1") return { id, state: "todo", project_id: ownerThemeId };
        if (type === "project" && id === ownerThemeId && !missingTheme && !legacyTheme) return { id, name: "Owner Theme" };
        if (type === "theme" && id === ownerThemeId && !missingTheme && legacyTheme) return { id, name: "Legacy Owner Theme" };
        return null;
      },
    },
    commands,
    resolveManagedDirectory: () => ({ kind: "ok", directory: paths.managedDirectory }),
    idFactory: () => IDS[index++],
    now: () => "2026-08-09T00:00:00.000Z",
  });
  return { media, commands };
}

const request = { storageMode: "managed", sourceType: "task", sourceId: "task-1" };
const metadata = { durationMs: 1000, widthPx: 640, heightPx: 360 };

test("managed video stages exact bytes and commits one strict ID-owned Artifact command", (t) => {
  const paths = fixture(t);
  const { media, commands } = harness(paths);
  const prepared = media.prepareVideoFile(paths.sourcePath, request);
  assert.equal(prepared.mediaUrl, `tasken-media://session/${prepared.sessionId}`);
  assert.equal(JSON.stringify(prepared).includes(paths.root), false);
  const result = media.commitVideo({ sessionId: prepared.sessionId, ...metadata });
  assert.equal(result.publicResult.status, "applied");
  assert.equal(commands.calls.length, 1);
  const command = commands.calls[0];
  assert.equal(command.name, "CommitVideoArtifact");
  assert.equal(command.payload.artifact.source_id, "task-1");
  assert.equal(command.payload.artifact.media_kind, "video");
  assert.equal(command.payload.artifact.width_px, 640);
  assert.deepEqual(fs.readFileSync(command.payload.artifact.stored_path), paths.bytes);
  assert.equal(media.listPreparedVideo().length, 0);
});

test("trim export keeps the original bytes and commits a separate derived Artifact", async (t) => {
  const paths = fixture(t);
  const ffmpegPath = path.resolve("node_modules", "ffmpeg-static", "ffmpeg.exe");
  const generated = spawnSync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", paths.sourcePath,
  ], { windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr?.toString("utf8"));
  const originalBytes = fs.readFileSync(paths.sourcePath);
  const records = new Map([["task:task-1", { id: "task-1", state: "todo", project_id: null }]]);
  let index = 0;
  const calls = [];
  const media = new MediaCaptureService({
    userDataPath: paths.userDataPath,
    repository: { get(type, id) { return records.get(`${type}:${id}`) || null; } },
    commands: {
      executeMediaCapture(command) {
        calls.push(command);
        if (command.payload.artifact) records.set(`artifact:${command.payload.artifact.id}`, { ...command.payload.artifact, version: 1 });
        if (command.payload.reference) records.set(`reference:${command.payload.reference.id}`, { ...command.payload.reference, version: 1 });
        return { status: "applied", commandId: command.commandId, changes: [], events: [] };
      },
    },
    resolveManagedDirectory: () => ({ kind: "ok", directory: paths.managedDirectory }),
    idFactory: () => IDS[index++],
    now: () => "2026-08-09T00:00:00.000Z",
    ffmpegPath,
  });
  const prepared = media.prepareVideoFile(paths.sourcePath, request);
  const committed = media.commitVideo({ sessionId: prepared.sessionId, durationMs: 2000, widthPx: 320, heightPx: 180 });
  const source = media.getVideoTrimSource(committed.publicResult.artifactId);
  const originalArtifact = records.get(`artifact:${source.artifactId}`);
  const result = await media.exportTrimmedVideo({
    operationId: "00000000-0000-4000-8000-000000000201",
    destinationArtifactId: "00000000-0000-4000-8000-000000000202",
    trimPlan: createTrimPlan({ source, startMs: 500, endMs: 1500 }),
  });
  assert.equal(result.publicResult.sourceArtifactId, source.artifactId);
  assert.deepEqual(fs.readFileSync(originalArtifact.stored_path), originalBytes);
  const command = calls.at(-1);
  assert.equal(command.name, "CommitTrimmedVideoArtifact");
  assert.equal(command.payload.artifact.id, "00000000-0000-4000-8000-000000000202");
  assert.equal(command.payload.artifact.duration_ms, 1000);
  assert.equal(command.payload.artifact.mime_type, "video/mp4");
  assert.notEqual(command.payload.artifact.stored_path, originalArtifact.stored_path);
  assert.equal(fs.existsSync(command.payload.artifact.stored_path), true);
  assert.equal(command.payload.reference.source_id, command.payload.artifact.id);
  assert.equal(command.payload.reference.target_id, source.artifactId);
  assert.equal(command.payload.reference.relation_type, "derived_from");
});

test("video theme authority is derived from the saved owner before bytes are staged", (t) => {
  const paths = fixture(t);
  const ownerThemeId = "00000000-0000-4000-8000-000000000201";
  const { media, commands } = harness(paths, { ownerThemeId });
  const prepared = media.prepareVideoFile(paths.sourcePath, request);
  media.commitVideo({ sessionId: prepared.sessionId, ...metadata });
  assert.equal(commands.calls[0].payload.artifact.theme_id, ownerThemeId);

  const legacyPaths = fixture(t);
  const legacyThemeId = "legacy-theme";
  const legacy = harness(legacyPaths, { ownerThemeId: legacyThemeId, legacyTheme: true });
  const legacyPrepared = legacy.media.prepareVideoFile(legacyPaths.sourcePath, request);
  legacy.media.commitVideo({ sessionId: legacyPrepared.sessionId, ...metadata });
  assert.equal(legacy.commands.calls[0].payload.artifact.theme_id, legacyThemeId);

  const sessionsPath = path.join(paths.userDataPath, "media-recovery", "sessions");
  const sessionsBeforeRejectedAttempt = fs.readdirSync(sessionsPath);
  const missing = harness(paths, { ownerThemeId, missingTheme: true }).media;
  assert.throws(() => missing.prepareVideoFile(paths.sourcePath, request), /添付先Themeが見つかりません/);
  assert.deepEqual(fs.readdirSync(sessionsPath), sessionsBeforeRejectedAttempt);
});

test("prepared video remains discardable when its owner is deleted or changes Theme before commit", (t) => {
  for (const mutation of ["deleted", "theme_changed"]) {
    const paths = fixture(t);
    const themeA = "00000000-0000-4000-8000-000000000201";
    const themeB = "00000000-0000-4000-8000-000000000202";
    let owner = { id: "task-1", state: "todo", project_id: themeA };
    let index = 0;
    const calls = [];
    const media = new MediaCaptureService({
      userDataPath: paths.userDataPath,
      repository: {
        get(type, id) {
          if (type === "task" && id === "task-1") return owner;
          if (type === "project" && (id === themeA || id === themeB)) return { id };
          return null;
        },
      },
      commands: { executeMediaCapture(command) { calls.push(command); return { status: "applied", commandId: command.commandId, changes: [], events: [] }; } },
      resolveManagedDirectory: () => ({ kind: "ok", directory: paths.managedDirectory }),
      idFactory: () => IDS[index++],
      now: () => "2026-08-09T00:00:00.000Z",
    });
    const prepared = media.prepareVideoFile(paths.sourcePath, request);
    owner = mutation === "deleted" ? null : { id: "task-1", state: "todo", project_id: themeB };
    assert.throws(() => media.commitVideo({ sessionId: prepared.sessionId, ...metadata }), /破棄して/);
    assert.equal(calls.length, 0);
    const pending = media.listPreparedVideo();
    assert.equal(pending[0].status, "ready");
    assert.equal(pending[0].canDiscard, true);
    assert.equal(media.cancel(prepared.sessionId), true);
  }
});

test("owner change at the finalizing boundary rolls the session back to prepared with no publish or command", (t) => {
  const paths = fixture(t);
  const themeA = "00000000-0000-4000-8000-000000000201";
  const themeB = "00000000-0000-4000-8000-000000000202";
  let taskReads = 0;
  let index = 0;
  const calls = [];
  const media = new MediaCaptureService({
    userDataPath: paths.userDataPath,
    repository: {
      get(type, id) {
        if (type === "task" && id === "task-1") {
          taskReads += 1;
          return { id, state: "todo", project_id: taskReads >= 4 ? themeB : themeA };
        }
        if (type === "project" && (id === themeA || id === themeB)) return { id };
        return null;
      },
    },
    commands: { executeMediaCapture(command) { calls.push(command); return { status: "applied", commandId: command.commandId, changes: [], events: [] }; } },
    resolveManagedDirectory: () => ({ kind: "ok", directory: paths.managedDirectory }),
    idFactory: () => IDS[index++],
    now: () => "2026-08-09T00:00:00.000Z",
  });
  const prepared = media.prepareVideoFile(paths.sourcePath, request);
  assert.throws(() => media.commitVideo({ sessionId: prepared.sessionId, ...metadata }), /Themeが変更/);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(paths.managedDirectory)
    ? fs.readdirSync(paths.managedDirectory).filter((name) => name.endsWith(".mp4")).length
    : 0, 0);
  const pending = media.listPreparedVideo()[0];
  assert.equal(pending.status, "ready");
  assert.equal(pending.canDiscard, true);
});

test("linked video revalidates original on retry and never returns its path", (t) => {
  const paths = fixture(t);
  const first = harness(paths, { fail: true });
  const prepared = first.media.prepareVideoFile(paths.sourcePath, { ...request, storageMode: "linked" });
  assert.throws(() => first.media.commitVideo({ sessionId: prepared.sessionId, ...metadata }), /injected DB failure/);
  assert.equal(JSON.stringify(first.media.listPreparedVideo()).includes(paths.root), false);
  fs.writeFileSync(paths.sourcePath, Buffer.from("changed"));
  const retry = harness(paths);
  const changed = retry.media.listPreparedVideo();
  assert.equal(changed[0].availability, "changed");
  assert.equal(changed[0].canRetry, false);
  assert.deepEqual(retry.media.recoverPending(), { recovered: 0, pending: 1 });
  assert.equal(retry.commands.calls.length, 0);
  fs.writeFileSync(paths.sourcePath, paths.bytes);
  const restored = retry.media.listPreparedVideo();
  assert.equal(restored[0].availability, "available");
  assert.equal(restored[0].canRetry, true);
  assert.deepEqual(retry.media.recoverPending(), { recovered: 1, pending: 0 });
  assert.equal(retry.commands.calls[0].payload.artifact.storage_mode, "linked");
  assert.equal(retry.commands.calls[0].payload.artifact.target, paths.sourcePath);
});

test("linked video rejects a same-bytes replacement inode until the original identity is restored", (t) => {
  const paths = fixture(t);
  const first = harness(paths, { fail: true });
  const prepared = first.media.prepareVideoFile(paths.sourcePath, { ...request, storageMode: "linked" });
  assert.throws(() => first.media.commitVideo({ sessionId: prepared.sessionId, ...metadata }), /injected DB failure/);
  const originalPath = path.join(paths.root, "original-evidence.mp4");
  fs.renameSync(paths.sourcePath, originalPath);
  fs.writeFileSync(paths.sourcePath, paths.bytes);

  const retry = harness(paths);
  assert.equal(retry.media.listPreparedVideo()[0].availability, "changed");
  assert.deepEqual(retry.media.recoverPending(), { recovered: 0, pending: 1 });
  assert.equal(retry.commands.calls.length, 0);

  fs.rmSync(paths.sourcePath);
  fs.renameSync(originalPath, paths.sourcePath);
  assert.equal(retry.media.listPreparedVideo()[0].availability, "available");
  assert.deepEqual(retry.media.recoverPending(), { recovered: 1, pending: 0 });
  assert.equal(retry.commands.calls.length, 1);
});

test("video signature mismatch is rejected before a durable session exists", (t) => {
  const paths = fixture(t);
  fs.writeFileSync(paths.sourcePath, Buffer.from("not-an-mp4"));
  const { media } = harness(paths);
  assert.throws(() => media.prepareVideoFile(paths.sourcePath, request), /内容と拡張子/);
  const sessions = path.join(paths.userDataPath, "media-recovery", "sessions");
  assert.deepEqual(fs.readdirSync(sessions), []);
});

for (const [label, storageMode, tamper] of [
  ["managed sourcePath", "managed", (manifest, paths) => { manifest.sourcePath = paths.sourcePath; }],
  ["linked managed root", "linked", (manifest, paths) => {
    manifest.managedRootPath = paths.managedDirectory;
    manifest.managedRootRealPath = paths.managedDirectory;
    manifest.managedRootDevice = "1";
    manifest.managedRootInode = "1";
  }],
  ["linked source identity", "linked", (manifest) => { manifest.sourceDevice = `${manifest.sourceDevice}-tampered`; }],
]) test(`tampered ${label} manifest remains pending with zero retry DB writes`, (t) => {
  const paths = fixture(t);
  const first = harness(paths, { fail: true });
  const prepared = first.media.prepareVideoFile(paths.sourcePath, { ...request, storageMode });
  assert.throws(() => first.media.commitVideo({ sessionId: prepared.sessionId, ...metadata }), /injected DB failure/);
  const manifestPath = path.join(paths.userDataPath, "media-recovery", "sessions", prepared.sessionId, "session.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  tamper(manifest, paths);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const retry = harness(paths);
  assert.deepEqual(retry.media.recoverPending(), { recovered: 0, pending: 1 });
  assert.equal(retry.commands.calls.length, 0);
  const diagnostics = retry.media.listPreparedVideo();
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].recoveryReason, "manifest_invalid");
  assert.equal(diagnostics[0].sourceId, undefined);
});
