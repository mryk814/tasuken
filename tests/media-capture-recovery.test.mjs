import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";

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

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-media-recovery-"));
  const userDataPath = path.join(root, "user-data");
  const managedDirectory = path.join(root, "managed");
  const sourcePath = path.join(root, "voice.wav");
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(sourcePath, Buffer.from("RIFF\x10\x00\x00\x00WAVEfmt tasken-audio-original", "binary"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, userDataPath, managedDirectory, sourcePath };
}

function commandExecutor({ fail = true } = {}) {
  return {
    calls: 0,
    executeMediaCapture(command) {
      this.calls += 1;
      if (fail) throw new Error("injected DB failure");
      return { status: "applied", commandId: command.commandId, changes: [], events: [] };
    },
  };
}

function service(paths, commands, managedDirectory = paths.managedDirectory) {
  return new MediaCaptureService({
    userDataPath: paths.userDataPath,
    repository: { get: () => null },
    commands,
    resolveManagedDirectory: () => ({ kind: "ok", directory: managedDirectory }),
  });
}

function finalizedAfterDbFailure(t) {
  const paths = fixture(t);
  const firstExecutor = commandExecutor();
  const first = service(paths, firstExecutor);
  const prepared = first.prepareFile(paths.sourcePath);
  assert.throws(() => first.commit({ sessionId: prepared.sessionId, durationMs: 1200 }), /injected DB failure/);
  assert.equal(firstExecutor.calls, 1);
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", prepared.sessionId);
  const manifestPath = path.join(sessionDirectory, "session.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.state, "finalized");
  assert.ok(fs.existsSync(manifest.finalPath));
  return { paths, prepared, sessionDirectory, manifestPath, manifest };
}

test("finalized recovery does not delete or commit a different existing final file", (t) => {
  const state = finalizedAfterDbFailure(t);
  const conflictingBytes = Buffer.from("unrelated-existing-file-must-survive");
  fs.writeFileSync(state.manifest.finalPath, conflictingBytes);
  const retryExecutor = commandExecutor({ fail: false });

  const result = service(state.paths, retryExecutor).recoverPending();

  assert.deepEqual(result, { recovered: 0, pending: 1 });
  assert.equal(retryExecutor.calls, 0);
  assert.deepEqual(fs.readFileSync(state.manifest.finalPath), conflictingBytes);
});

test("finalized recovery revalidates managed root identity before any DB write", (t) => {
  const state = finalizedAfterDbFailure(t);
  state.manifest.managedRootInode = `${state.manifest.managedRootInode}-tampered`;
  fs.writeFileSync(state.manifestPath, `${JSON.stringify(state.manifest, null, 2)}\n`);
  const retryExecutor = commandExecutor({ fail: false });

  const result = service(state.paths, retryExecutor).recoverPending();

  assert.deepEqual(result, { recovered: 0, pending: 1 });
  assert.equal(retryExecutor.calls, 0);
});

test("finalized recovery does not recreate a deleted final file or write DB", (t) => {
  const state = finalizedAfterDbFailure(t);
  fs.rmSync(state.manifest.finalPath);
  const retryExecutor = commandExecutor({ fail: false });

  const result = service(state.paths, retryExecutor).recoverPending();

  assert.deepEqual(result, { recovered: 0, pending: 1 });
  assert.equal(retryExecutor.calls, 0);
  assert.equal(fs.existsSync(state.manifest.finalPath), false);
});

test("finalized recovery revalidates staged original before any DB write", (t) => {
  const state = finalizedAfterDbFailure(t);
  fs.writeFileSync(path.join(state.sessionDirectory, state.manifest.stagedFileName), "changed-staged-file");
  const retryExecutor = commandExecutor({ fail: false });

  const result = service(state.paths, retryExecutor).recoverPending();

  assert.deepEqual(result, { recovered: 0, pending: 1 });
  assert.equal(retryExecutor.calls, 0);
});

test("recovery root rejects an existing symlink or junction ancestor before mkdir", (t) => {
  const paths = fixture(t);
  const outside = path.join(paths.root, "outside");
  const linkedRecovery = path.join(paths.userDataPath, "media-recovery");
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, linkedRecovery, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code === "EPERM") return t.skip("junction creation is unavailable in this environment");
    throw error;
  }

  assert.throws(() => service(paths, commandExecutor()), /symlink\/junction/);
  assert.equal(fs.existsSync(path.join(outside, "sessions")), false);
});

test("managed directory rejects a symlink or junction before creating or committing files", (t) => {
  const paths = fixture(t);
  const outside = path.join(paths.root, "outside-managed");
  const linkedManaged = path.join(paths.root, "linked-managed");
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, linkedManaged, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code === "EPERM") return t.skip("junction creation is unavailable in this environment");
    throw error;
  }
  const executor = commandExecutor({ fail: false });
  const capture = service(paths, executor, linkedManaged);
  const prepared = capture.prepareFile(paths.sourcePath);

  assert.throws(() => capture.commit({ sessionId: prepared.sessionId, durationMs: 1200 }), /symlink\/junction/);
  assert.equal(executor.calls, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("Theme media finalize writes and verifies the ID marker before DB commit", (t) => {
  const paths = fixture(t);
  const themeId = "8ecf07e4-1491-4e52-b39c-30a65991e78b";
  const themeFolder = path.join(paths.managedDirectory, "Themes", "OLD");
  const artifactDirectory = path.join(themeFolder, "Artifacts");
  const commands = commandExecutor();
  const capture = new MediaCaptureService({
    userDataPath: paths.userDataPath,
    repository: { get: () => null },
    commands,
    resolveManagedDirectory: () => ({ kind: "ok", directory: artifactDirectory, themeMarker: { directory: themeFolder, themeId, displayName: "Renamed Theme" } }),
  });
  const prepared = capture.prepareFile(paths.sourcePath, themeId);
  assert.throws(() => capture.commit({ sessionId: prepared.sessionId, durationMs: 1200 }), /injected DB failure/);
  const marker = JSON.parse(fs.readFileSync(path.join(themeFolder, ".tasken-theme.json"), "utf8"));
  assert.equal(marker.themeId, themeId);

  const other = fixture(t);
  const otherFolder = path.join(other.managedDirectory, "Themes", "CONFLICT");
  fs.mkdirSync(path.join(otherFolder, "Artifacts"), { recursive: true });
  fs.writeFileSync(path.join(otherFolder, ".tasken-theme.json"), JSON.stringify({ schema: "tasken-theme-folder/v1", themeId: "00000000-0000-4000-8000-000000000000" }));
  const rejected = new MediaCaptureService({
    userDataPath: other.userDataPath,
    repository: { get: () => null },
    commands: commandExecutor({ fail: false }),
    resolveManagedDirectory: () => ({ kind: "ok", directory: path.join(otherFolder, "Artifacts"), themeMarker: { directory: otherFolder, themeId, displayName: "Theme" } }),
  });
  const otherPrepared = rejected.prepareFile(other.sourcePath, themeId);
  assert.throws(() => rejected.commit({ sessionId: otherPrepared.sessionId, durationMs: 1200 }), /marker/);
});

test("prepared crash is listed without a source path and remains user-discardable after restart", (t) => {
  const paths = fixture(t);
  const prepared = service(paths, commandExecutor()).prepareFile(paths.sourcePath);
  const restarted = service(paths, commandExecutor());

  const pending = restarted.listPreparedAudio();

  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0], prepared);
  assert.doesNotMatch(JSON.stringify(pending), /sourcePath|stored_path|original_path|voice\.wav.*voice\.wav/);
  assert.equal(restarted.cancel(prepared.sessionId), true);
  assert.deepEqual(restarted.listPreparedAudio(), []);
});

test("corrupt manifest remains visible as a safe diagnostic and cannot be discarded without a proven prepared state", (t) => {
  const paths = fixture(t);
  const capture = service(paths, commandExecutor());
  const prepared = capture.prepareFile(paths.sourcePath);
  const manifestPath = path.join(paths.userDataPath, "media-recovery", "sessions", prepared.sessionId, "session.json");
  fs.writeFileSync(manifestPath, "{corrupt-json");

  const pending = service(paths, commandExecutor()).listPreparedAudio();

  assert.deepEqual(pending, [{
    sessionId: prepared.sessionId,
    filename: "復旧が必要な音声",
    mimeType: "不明",
    fileSize: 0,
    mediaUrl: "",
    status: "recovery_required",
    availability: "missing",
    recoveryReason: "manifest_invalid",
    canCommit: false,
    canRetry: false,
    canDiscard: false,
  }]);
  assert.doesNotMatch(JSON.stringify(pending), /user-data|media-recovery|session\.json|sourcePath|stored_path/);
  assert.throws(() => capture.cancel(prepared.sessionId));
  assert.equal(capture.listPreparedAudio().length, 1);
});

test("failed finalized recovery stays visible and retryable instead of becoming an orphan", (t) => {
  const state = finalizedAfterDbFailure(t);
  const restarted = service(state.paths, commandExecutor({ fail: false }));

  const pending = restarted.listPreparedAudio();

  assert.equal(pending.length, 1);
  assert.equal(pending[0].sessionId, state.prepared.sessionId);
  assert.equal(pending[0].status, "recovery_required");
  assert.equal(pending[0].recoveryReason, "commit_failed");
  assert.equal(pending[0].canRetry, true);
  assert.equal(pending[0].canDiscard, false);
  assert.equal(pending[0].mediaUrl, "");
  assert.doesNotMatch(JSON.stringify(pending), /managed|user-data|stored_path|finalPath/);
});

test("prepared list is deterministic: valid createdAt desc then sessionId, invalid sessionId", (t) => {
  const paths = fixture(t);
  const ids = [
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ];
  let idIndex = 0;
  let nowIndex = 0;
  const times = ["2026-08-09T00:00:00.000Z", "2026-08-09T00:00:02.000Z", "2026-08-09T00:00:02.000Z"];
  const capture = new MediaCaptureService({
    userDataPath: paths.userDataPath,
    repository: { get: () => null },
    commands: commandExecutor(),
    resolveManagedDirectory: () => ({ kind: "ok", directory: paths.managedDirectory }),
    idFactory: () => ids[idIndex++],
    now: () => times[nowIndex++] || times.at(-1),
  });
  const entries = [capture.prepareFile(paths.sourcePath), capture.prepareFile(paths.sourcePath), capture.prepareFile(paths.sourcePath)];
  fs.writeFileSync(path.join(paths.userDataPath, "media-recovery", "sessions", entries[0].sessionId, "session.json"), "bad");

  assert.deepEqual(capture.listPreparedAudio().map((entry) => entry.sessionId), [ids[1], ids[2], ids[0]]);
});

test("source path swap after open is rejected before reading bytes or committing", (t) => {
  const paths = fixture(t);
  const replacement = path.join(paths.root, "replacement.wav");
  const originalMoved = path.join(paths.root, "voice-original.wav");
  fs.writeFileSync(replacement, Buffer.from("RIFF-unverified-replacement"));
  const executor = commandExecutor({ fail: false });
  const capture = service(paths, executor);
  const realOpen = fs.openSync;
  const realRead = fs.readSync;
  let sourceDescriptor = null;
  let sourceReads = 0;
  fs.openSync = function patchedOpen(candidate, flags, mode) {
    const descriptor = realOpen.call(fs, candidate, flags, mode);
    if (path.resolve(String(candidate)) === path.resolve(paths.sourcePath) && sourceDescriptor === null) {
      sourceDescriptor = descriptor;
      fs.renameSync(paths.sourcePath, originalMoved);
      fs.renameSync(replacement, paths.sourcePath);
    }
    return descriptor;
  };
  fs.readSync = function patchedRead(descriptor, ...args) {
    if (descriptor === sourceDescriptor) sourceReads += 1;
    return realRead.call(fs, descriptor, ...args);
  };
  try {
    assert.throws(() => capture.prepareFile(paths.sourcePath), /差し替え/);
  } finally {
    fs.openSync = realOpen;
    fs.readSync = realRead;
  }
  assert.equal(sourceReads, 0);
  assert.equal(executor.calls, 0);
});

test("audio container signature is verified before a durable prepared session is created", (t) => {
  const paths = fixture(t);
  const capture = service(paths, commandExecutor());
  fs.writeFileSync(paths.sourcePath, Buffer.from("OggS-not-a-wave"));
  assert.throws(() => capture.prepareFile(paths.sourcePath), /内容と拡張子/);
  assert.deepEqual(capture.listPreparedAudio(), []);
});

test("supported audio signatures are accepted on the same verified source descriptor", (t) => {
  const paths = fixture(t);
  const capture = service(paths, commandExecutor());
  const cases = [
    ["voice.wav", Buffer.from("RIFF\x10\x00\x00\x00WAVEfmt payload", "binary")],
    ["voice.ogg", Buffer.from("OggS\x00payload", "binary")],
    ["voice.webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02])],
    ["voice.mp3", Buffer.from("ID3payload")],
    ["voice.m4a", Buffer.from("\x00\x00\x00\x18ftypM4A payload", "binary")],
  ];
  for (const [name, bytes] of cases) {
    const source = path.join(paths.root, name);
    fs.writeFileSync(source, bytes);
    const prepared = capture.prepareFile(source);
    assert.equal(prepared.status, "ready");
    capture.cancel(prepared.sessionId);
  }
});

test("finalizing session remains explicitly retryable while root is unavailable and commits after the same root returns", (t) => {
  const state = finalizedAfterDbFailure(t);
  const manifest = JSON.parse(fs.readFileSync(state.manifestPath, "utf8"));
  manifest.state = "finalizing";
  delete manifest.recoveryError;
  fs.writeFileSync(state.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.rmSync(manifest.finalPath);
  const unavailable = `${state.paths.managedDirectory}-offline`;
  fs.renameSync(state.paths.managedDirectory, unavailable);
  const retryExecutor = commandExecutor({ fail: false });
  const restarted = service(state.paths, retryExecutor);
  const pending = restarted.listPreparedAudio();
  assert.equal(pending[0].canRetry, true);
  assert.equal(pending[0].canDiscard, false);
  fs.renameSync(unavailable, state.paths.managedDirectory);
  const result = restarted.commit({ sessionId: state.prepared.sessionId, durationMs: 1200 });
  assert.equal(result.publicResult.status, "applied");
  assert.equal(retryExecutor.calls, 1);
});

const COMMAND_TAMPERS = [
  ["capture.title", "tampered"], ["capture.text", "other.wav"], ["capture.kind", "file_capture"],
  ["capture.content_type", "file"], ["capture.capture_method", "microphone"], ["capture.media_status", "failed"],
  ["capture.transcription_status", "completed"], ["capture.captured_at", "2020-01-01T00:00:00.000Z"],
  ["capture.state", "triaged"], ["capture.project_id", "00000000-0000-4000-8000-000000000099"],
  ["capture.ai_visibility", ["coding_agent"]], ["artifact.title", "tampered"], ["artifact.filename", "other.wav"],
  ["artifact.file_type", "mp3"], ["artifact.mime_type", "audio/mpeg"], ["artifact.file_size", 1],
  ["artifact.stored_path", "C:/private/injected.wav"], ["artifact.original_path", "C:/private/source.wav"],
  ["artifact.storage_mode", "linked"], ["artifact.copied_at", "2020-01-01T00:00:00.000Z"],
  ["artifact.source_type", "task"], ["artifact.source_id", "00000000-0000-4000-8000-000000000099"],
  ["artifact.theme_id", "00000000-0000-4000-8000-000000000099"], ["artifact.media_kind", "video"],
  ["artifact.duration_ms", 9999], ["artifact.container", "mp3"],
  ["artifact.content_hash", `sha256:${"b".repeat(64)}`], ["artifact.media_availability", "changed"],
  ["artifact.ai_visibility", ["coding_agent"]], ["command.issuedAt", "2020-01-01T00:00:00.000Z"],
];

for (const [field, replacement] of COMMAND_TAMPERS) {
  test(`durable command tamper ${field} performs zero DB writes`, (t) => {
    const state = finalizedAfterDbFailure(t);
    const manifest = JSON.parse(fs.readFileSync(state.manifestPath, "utf8"));
    const [scope, key] = field.split(".");
    if (scope === "capture") manifest.command.payload.capture[key] = replacement;
    else if (scope === "artifact") manifest.command.payload.artifact[key] = replacement;
    else manifest.command[key] = replacement;
    fs.writeFileSync(state.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const executor = commandExecutor({ fail: false });

    assert.deepEqual(service(state.paths, executor).recoverPending(), { recovered: 0, pending: 1 });
    assert.equal(executor.calls, 0);
  });
}

test("manifest themeId must be null or UUID before any DB write", (t) => {
  const paths = fixture(t);
  const executor = commandExecutor({ fail: false });
  const capture = service(paths, executor);
  const prepared = capture.prepareFile(paths.sourcePath);
  const manifestPath = path.join(paths.userDataPath, "media-recovery", "sessions", prepared.sessionId, "session.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.themeId = "legacy-theme-id";
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.throws(() => capture.commit({ sessionId: prepared.sessionId, durationMs: 100 }), /Theme ID/);
  assert.equal(executor.calls, 0);
});
