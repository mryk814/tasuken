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

const { MediaCaptureService, MICROPHONE_CHUNK_MAX_BYTES, MICROPHONE_RECORDING_MAX_CHUNKS } = await importBundled("src/main/services/mediaCaptureService.ts");

const IDS = [
  "123e4567-e89b-42d3-a456-426614174000",
  "223e4567-e89b-42d3-a456-426614174000",
  "323e4567-e89b-42d3-a456-426614174000",
  "423e4567-e89b-42d3-a456-426614174000",
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-microphone-recording-"));
  const userDataPath = path.join(root, "user-data");
  const managedDirectory = path.join(root, "managed");
  fs.mkdirSync(userDataPath, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, userDataPath, managedDirectory };
}

function createService(paths, { commands, now, repository } = {}) {
  let idIndex = 0;
  return new MediaCaptureService({
    userDataPath: paths.userDataPath,
    repository: repository || { get: () => null },
    commands: commands || { executeMediaCapture: (command) => ({ status: "applied", commandId: command.commandId, changes: [], events: [] }) },
    resolveManagedDirectory: () => ({ kind: "ok", directory: paths.managedDirectory }),
    idFactory: () => IDS[idIndex++],
    now,
  });
}

function webmBytes(text = "tasken-audio") {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(text)]);
}

function asArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test("recording sessionはsequence、重複、欠落、bounded chunkをfile書込み前に検証する", (t) => {
  const paths = fixture(t);
  const service = createService(paths);
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const first = webmBytes();

  assert.equal(started.mediaKind, "audio");
  assert.equal(started.maxChunkBytes, MICROPHONE_CHUNK_MAX_BYTES);
  assert.deepEqual(service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(first) }), {
    sessionId: started.sessionId,
    nextSequence: 1,
    fileSize: first.length,
    state: "recording",
  });
  assert.throws(() => service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(first) }), /同じ録音chunk/);
  assert.throws(() => service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 2, chunk: asArrayBuffer(first) }), /欠落/);
  assert.throws(() => service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 1, chunk: new ArrayBuffer(MICROPHONE_CHUNK_MAX_BYTES + 1) }), /以下/);

  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  assert.deepEqual(fs.readdirSync(sessionDirectory).sort(), ["chunk-00000000.part", "session.json"]);
});

test("pause/resume/stopは録音chunkをprepared原音へまとめ既存CommitAudioCaptureへ確定する", (t) => {
  const paths = fixture(t);
  let currentNow = "2026-08-09T00:00:00.000Z";
  let appliedCommand;
  const service = createService(paths, {
    now: () => currentNow,
    commands: {
      executeMediaCapture(command) {
        appliedCommand = command;
        return { status: "applied", commandId: command.commandId, changes: [], events: [] };
      },
    },
  });
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const first = webmBytes("first");
  const second = Buffer.from("second");
  service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(first) });
  currentNow = "2026-08-09T00:00:02.000Z";
  assert.equal(service.pauseRecording(started.sessionId).state, "paused");
  currentNow = "2026-08-09T00:00:12.000Z";
  assert.equal(service.resumeRecording(started.sessionId).state, "recording");
  currentNow = "2026-08-09T00:00:13.500Z";
  service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 1, chunk: asArrayBuffer(second) });
  const prepared = service.stopRecording(started.sessionId);

  assert.equal(prepared.status, "ready");
  assert.equal(prepared.durationMs, 3500);
  assert.equal(prepared.fileSize, first.length + second.length);
  assert.equal(JSON.stringify(prepared).includes(paths.root), false);
  const committed = service.commit({ sessionId: started.sessionId, durationMs: prepared.durationMs });
  assert.equal(committed.publicResult.status, "applied");
  assert.equal(appliedCommand.name, "CommitAudioCapture");
  assert.equal(appliedCommand.payload.capture.capture_method, "microphone");
  assert.equal(appliedCommand.payload.capture.content_type, "audio");
  assert.equal(appliedCommand.payload.artifact.media_kind, "audio");
  assert.equal(appliedCommand.payload.artifact.file_size, first.length + second.length);
});

test("pause後に遅着したMediaRecorder tail chunkはpausedのまま連番保存し録音時間を増やさない", (t) => {
  const paths = fixture(t);
  let currentNow = "2026-08-09T00:00:00.000Z";
  const service = createService(paths, { now: () => currentNow });
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const tail = webmBytes("tail-after-pause");

  currentNow = "2026-08-09T00:00:02.000Z";
  assert.equal(service.pauseRecording(started.sessionId).state, "paused");
  currentNow = "2026-08-09T00:00:12.000Z";
  assert.deepEqual(service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(tail) }), {
    sessionId: started.sessionId,
    nextSequence: 1,
    fileSize: tail.length,
    state: "paused",
  });
  currentNow = "2026-08-09T00:00:13.000Z";
  assert.equal(service.resumeRecording(started.sessionId).state, "recording");
  const prepared = service.stopRecording(started.sessionId);
  assert.equal(prepared.durationMs, 2000);
  assert.throws(
    () => service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 1, chunk: asArrayBuffer(tail) }),
    /録音中ではありません/,
  );
});

test("再起動後の未確定録音は自動commitせず復旧または破棄できる", (t) => {
  const paths = fixture(t);
  const first = createService(paths);
  const started = first.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  first.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(webmBytes("recover")) });

  const reopened = createService(paths);
  const interrupted = reopened.listPreparedAudio().find((entry) => entry.sessionId === started.sessionId);
  assert.equal(interrupted?.recoveryReason, "recording_interrupted");
  assert.equal(interrupted?.canRecoverRecording, true);
  assert.equal(interrupted?.canCommit, false);
  const recovered = reopened.stopRecording(started.sessionId);
  assert.equal(recovered.status, "ready");
  assert.equal(reopened.cancel(started.sessionId), true);
  assert.equal(fs.existsSync(path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId)), false);
});

test("同じMain processでもRenderer停止後の無通信時間を録音durationへ加算しない", (t) => {
  const paths = fixture(t);
  let currentNow = "2026-08-09T00:00:00.000Z";
  const service = createService(paths, { now: () => currentNow });
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  currentNow = "2026-08-09T00:00:01.000Z";
  service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(webmBytes("final-before-crash")) });
  currentNow = "2026-08-09T01:00:01.000Z";

  const recovered = service.stopRecording(started.sessionId);
  assert.equal(recovered.durationMs, 1000);
});

test("appendはMain clockの録音時間上限をfile書込み前に拒否する", (t) => {
  const paths = fixture(t);
  let currentNow = "2026-08-09T00:00:00.000Z";
  const service = createService(paths, { now: () => currentNow });
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  currentNow = "2026-08-09T04:00:00.001Z";
  assert.throws(
    () => service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(webmBytes("late")) }),
    /録音時間の上限/,
  );
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  assert.deepEqual(fs.readdirSync(sessionDirectory), ["session.json"]);
});

test("pause/resumeは4時間境界をmanifest変更前に拒否する", (t) => {
  const paths = fixture(t);
  let currentNow = "2026-08-09T00:00:00.000Z";
  const service = createService(paths, { now: () => currentNow });
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const manifestPath = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId, "session.json");
  const beforePause = fs.readFileSync(manifestPath, "utf8");
  currentNow = "2026-08-09T04:00:00.001Z";
  assert.throws(() => service.pauseRecording(started.sessionId), /録音時間の上限を超えた/);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), beforePause);

  const second = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const secondManifestPath = path.join(paths.userDataPath, "media-recovery", "sessions", second.sessionId, "session.json");
  currentNow = "2026-08-09T08:00:00.001Z";
  const paused = service.pauseRecording(second.sessionId);
  assert.equal(paused.state, "paused");
  const beforeResume = fs.readFileSync(secondManifestPath, "utf8");
  assert.throws(() => service.resumeRecording(second.sessionId), /録音時間の上限に達している/);
  assert.equal(fs.readFileSync(secondManifestPath, "utf8"), beforeResume);
});

test("crash retryの既存chunk競合はmanifestを進めない", (t) => {
  const paths = fixture(t);
  const service = createService(paths);
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const original = webmBytes("crash-retry-original");
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  const chunkPath = path.join(sessionDirectory, "chunk-00000000.part");
  const retainedPath = path.join(sessionDirectory, "retained-crash-retry.part");
  fs.writeFileSync(chunkPath, original);

  const realOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function patchedOpen(candidate, flags, mode) {
    const descriptor = realOpen.call(fs, candidate, flags, mode);
    if (!swapped && path.resolve(String(candidate)) === path.resolve(chunkPath) && (Number(flags) & fs.constants.O_RDONLY) === fs.constants.O_RDONLY) {
      swapped = true;
      fs.renameSync(chunkPath, retainedPath);
      fs.writeFileSync(chunkPath, webmBytes("untrusted-replacement"));
    }
    return descriptor;
  };
  try {
    assert.throws(
      () => service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(original) }),
      /差し替え|別内容/,
    );
  } finally {
    fs.openSync = realOpen;
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(sessionDirectory, "session.json"), "utf8"));
  assert.equal(swapped, true);
  assert.equal(manifest.fileSize, 0);
  assert.equal(manifest.recordingNextSequence, 0);
  assert.equal(manifest.recordingChunkHashes, "");
});

test("4時間とpause余裕分のchunk hashは1 MiB manifest内へ固定長格納し件数上限をfile前に拒否する", (t) => {
  const paths = fixture(t);
  const service = createService(paths);
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const manifestPath = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId, "session.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok(MICROPHONE_RECORDING_MAX_CHUNKS > 4 * 60 * 60);
  manifest.recordingNextSequence = MICROPHONE_RECORDING_MAX_CHUNKS;
  manifest.recordingChunkHashes = "a".repeat(MICROPHONE_RECORDING_MAX_CHUNKS * 64);
  manifest.fileSize = MICROPHONE_RECORDING_MAX_CHUNKS;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.ok(fs.statSync(manifestPath).size < 1024 * 1024);
  const interrupted = createService(paths).listPreparedAudio().find((entry) => entry.sessionId === started.sessionId);
  assert.equal(interrupted?.recoveryReason, "recording_interrupted");
  assert.throws(
    () => service.appendRecordingChunk({ sessionId: started.sessionId, sequence: MICROPHONE_RECORDING_MAX_CHUNKS, chunk: asArrayBuffer(webmBytes("overflow")) }),
    /件数上限/,
  );
  assert.equal(fs.existsSync(path.join(path.dirname(manifestPath), `chunk-${String(MICROPHONE_RECORDING_MAX_CHUNKS).padStart(8, "0")}.part`)), false);

  manifest.recordingChunkHashes = manifest.recordingChunkHashes.slice(0, -1);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const invalid = createService(paths).listPreparedAudio().find((entry) => entry.sessionId === started.sessionId);
  assert.equal(invalid?.recoveryReason, "manifest_invalid");
});

test("manifest path差替えは同じdescriptorのidentity再検証で拒否しchunkを書かない", (t) => {
  const paths = fixture(t);
  const service = createService(paths);
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  const manifestPath = path.join(sessionDirectory, "session.json");
  const retainedPath = path.join(sessionDirectory, "retained-session.json");
  const originalManifest = fs.readFileSync(manifestPath);
  const realOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function patchedOpen(candidate, flags, mode) {
    const descriptor = realOpen.call(fs, candidate, flags, mode);
    if (!swapped && path.resolve(String(candidate)) === path.resolve(manifestPath) && (Number(flags) & fs.constants.O_RDONLY) === fs.constants.O_RDONLY) {
      swapped = true;
      fs.renameSync(manifestPath, retainedPath);
      fs.writeFileSync(manifestPath, originalManifest);
    }
    return descriptor;
  };
  try {
    assert.throws(
      () => service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(webmBytes("blocked")) }),
      /差し替え/,
    );
  } finally {
    fs.openSync = realOpen;
  }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(path.join(sessionDirectory, "chunk-00000000.part")), false);
});

test("append中のsession directory差替えはmanifest更新前に拒否する", (t) => {
  const paths = fixture(t);
  const service = createService(paths);
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  const retainedDirectory = `${sessionDirectory}-retained`;
  const manifestBytes = fs.readFileSync(path.join(sessionDirectory, "session.json"));
  const chunkPath = path.join(sessionDirectory, "chunk-00000000.part");
  const realOpen = fs.openSync;
  const realClose = fs.closeSync;
  let chunkDescriptor = null;
  let swapped = false;
  fs.openSync = function patchedOpen(candidate, flags, mode) {
    const descriptor = realOpen.call(fs, candidate, flags, mode);
    if (path.resolve(String(candidate)) === path.resolve(chunkPath)) chunkDescriptor = descriptor;
    return descriptor;
  };
  fs.closeSync = function patchedClose(descriptor) {
    realClose.call(fs, descriptor);
    if (!swapped && descriptor === chunkDescriptor) {
      swapped = true;
      fs.renameSync(sessionDirectory, retainedDirectory);
      fs.mkdirSync(sessionDirectory);
      fs.writeFileSync(path.join(sessionDirectory, "session.json"), manifestBytes);
    }
  };
  try {
    assert.throws(
      () => service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(webmBytes("directory-swap")) }),
      /session.*差し替え/,
    );
  } finally {
    fs.openSync = realOpen;
    fs.closeSync = realClose;
  }
  const replacementManifest = JSON.parse(fs.readFileSync(path.join(sessionDirectory, "session.json"), "utf8"));
  assert.equal(swapped, true);
  assert.equal(replacementManifest.recordingNextSequence, 0);
  assert.equal(fs.existsSync(path.join(sessionDirectory, "chunk-00000000.part")), false);
});

test("discard中のsession directory差替えはreplacementを削除しない", (t) => {
  const paths = fixture(t);
  const service = createService(paths);
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  const retainedDirectory = `${sessionDirectory}-retained`;
  const manifestBytes = fs.readFileSync(path.join(sessionDirectory, "session.json"));
  const realReadDirectory = fs.readdirSync;
  let swapped = false;
  fs.readdirSync = function patchedReadDirectory(candidate, options) {
    const entries = realReadDirectory.call(fs, candidate, options);
    if (!swapped && path.resolve(String(candidate)) === path.resolve(sessionDirectory)) {
      swapped = true;
      fs.renameSync(sessionDirectory, retainedDirectory);
      fs.mkdirSync(sessionDirectory);
      fs.writeFileSync(path.join(sessionDirectory, "session.json"), manifestBytes);
    }
    return entries;
  };
  try {
    assert.throws(() => service.cancel(started.sessionId), /session.*差し替え/);
  } finally {
    fs.readdirSync = realReadDirectory;
  }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(path.join(sessionDirectory, "session.json")), true);
  assert.equal(fs.existsSync(path.join(retainedDirectory, "session.json")), true);
});

test("preparedとcommitted録音の残留chunkは読込時にidempotent cleanupする", (t) => {
  const paths = fixture(t);
  const service = createService(paths);
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(webmBytes("cleanup")) });
  const prepared = service.stopRecording(started.sessionId);
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  const chunkPath = path.join(sessionDirectory, "chunk-00000000.part");
  fs.writeFileSync(chunkPath, webmBytes("prepared-leftover"));
  service.listPreparedAudio();
  assert.equal(fs.existsSync(chunkPath), false);

  service.commit({ sessionId: started.sessionId, durationMs: prepared.durationMs });
  fs.writeFileSync(chunkPath, webmBytes("committed-leftover"));
  service.recoverPending();
  assert.equal(fs.existsSync(chunkPath), false);
});

test("preparedとcommitted画面録画の残留chunkも読込時にidempotent cleanupする", (t) => {
  const paths = fixture(t);
  const ownerId = "523e4567-e89b-42d3-a456-426614174000";
  let appliedCommand;
  const service = createService(paths, {
    repository: {
      get(type, id) {
        return type === "task" && id === ownerId
          ? { id: ownerId, deleted_at: null, project_id: null }
          : null;
      },
    },
    commands: {
      executeMediaCapture(command) {
        appliedCommand = command;
        return { status: "applied", commandId: command.commandId, changes: [], events: [] };
      },
    },
  });
  const started = service.startRecording({
    mediaKind: "video",
    mimeType: "video/webm",
    sourceType: "task",
    sourceId: ownerId,
  });
  service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(webmBytes("screen-cleanup")) });
  const prepared = service.stopRecording(started.sessionId);
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  const chunkPath = path.join(sessionDirectory, "chunk-00000000.part");

  fs.writeFileSync(chunkPath, webmBytes("prepared-screen-leftover"));
  service.listPreparedVideo();
  service.listPreparedVideo();
  assert.equal(fs.existsSync(chunkPath), false);

  service.commitVideo({ sessionId: started.sessionId, durationMs: prepared.durationMs, widthPx: 1280, heightPx: 720, sourceType: "task", sourceId: ownerId });
  fs.writeFileSync(chunkPath, webmBytes("committed-screen-leftover"));
  service.listPreparedVideo();
  service.listPreparedVideo();
  assert.equal(fs.existsSync(chunkPath), false);
  assert.equal(appliedCommand.name, "CommitVideoArtifact");
  assert.equal(appliedCommand.payload.artifact.media_kind, "video");
  assert.match(appliedCommand.payload.artifact.filename, /^screen-recording-/);
});

test("画面録画stop失敗後も同じsessionを再試行してpreparedとVideo Artifactを一度だけ確定できる", (t) => {
  const paths = fixture(t);
  const ownerId = "523e4567-e89b-42d3-a456-426614174000";
  const appliedCommands = [];
  const service = createService(paths, {
    repository: {
      get(type, id) {
        return type === "task" && id === ownerId
          ? { id: ownerId, deleted_at: null, project_id: null }
          : null;
      },
    },
    commands: {
      executeMediaCapture(command) {
        appliedCommands.push(command);
        return { status: "applied", commandId: command.commandId, changes: [], events: [] };
      },
    },
  });
  const started = service.startRecording({ mediaKind: "video", mimeType: "video/webm" });
  service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(webmBytes("screen-stop-retry")) });
  const chunkPath = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId, "chunk-00000000.part");
  const realOpen = fs.openSync;
  let failedOnce = false;
  fs.openSync = function patchedOpen(candidate, flags, mode) {
    if (!failedOnce && path.resolve(String(candidate)) === path.resolve(chunkPath) && (Number(flags) & fs.constants.O_RDONLY) === fs.constants.O_RDONLY) {
      failedOnce = true;
      throw new Error("synthetic screen finalize failure");
    }
    return realOpen.call(fs, candidate, flags, mode);
  };
  try {
    assert.throws(() => service.stopRecording(started.sessionId), /synthetic screen finalize failure/);
  } finally {
    fs.openSync = realOpen;
  }

  const interrupted = service.listPreparedVideo().filter((entry) => entry.sessionId === started.sessionId);
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].canRecoverRecording, true);
  const prepared = service.stopRecording(started.sessionId);
  assert.equal(prepared.sessionId, started.sessionId);
  assert.equal(prepared.status, "ready");
  assert.equal(service.listPreparedVideo().filter((entry) => entry.sessionId === started.sessionId).length, 1);
  const committed = service.commitVideo({ sessionId: started.sessionId, durationMs: prepared.durationMs, widthPx: 1280, heightPx: 720, sourceType: "task", sourceId: ownerId });
  assert.equal(committed.publicResult.status, "applied");
  assert.equal(appliedCommands.length, 1);
  assert.equal(appliedCommands[0].name, "CommitVideoArtifact");
});

test("zero-byte画面録画はstop不能でも破棄でき、cancel失敗時は同じsessionを保持する", (t) => {
  const paths = fixture(t);
  const ownerId = "523e4567-e89b-42d3-a456-426614174000";
  const service = createService(paths, {
    repository: {
      get(type, id) {
        return type === "task" && id === ownerId
          ? { id: ownerId, deleted_at: null, project_id: null }
          : null;
      },
    },
  });
  const started = service.startRecording({ mediaKind: "video", mimeType: "video/webm" });
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  assert.throws(() => service.stopRecording(started.sessionId), /録音データがありません/);

  const realReadDirectory = fs.readdirSync;
  let failedOnce = false;
  fs.readdirSync = function patchedReadDirectory(candidate, options) {
    if (!failedOnce && path.resolve(String(candidate)) === path.resolve(sessionDirectory)) {
      failedOnce = true;
      throw new Error("synthetic screen cancel failure");
    }
    return realReadDirectory.call(fs, candidate, options);
  };
  try {
    assert.throws(() => service.cancel(started.sessionId), /synthetic screen cancel failure/);
  } finally {
    fs.readdirSync = realReadDirectory;
  }
  assert.equal(fs.existsSync(path.join(sessionDirectory, "session.json")), true);
  assert.equal(service.cancel(started.sessionId), true);
  assert.equal(fs.existsSync(sessionDirectory), false);
});

test("画面録画ownerはtask/note/report/capture_entryを同じmanaged bindingで検証する", (t) => {
  const ownerId = "523e4567-e89b-42d3-a456-426614174000";
  for (const sourceType of ["task", "note", "report", "capture_entry"]) {
    const paths = fixture(t);
    const repositoryType = sourceType === "report" ? "note" : sourceType;
    const service = createService(paths, {
      repository: {
        get(type, id) {
          return type === repositoryType && id === ownerId
            ? { id: ownerId, deleted_at: null, project_id: null }
            : null;
        },
      },
    });
    const started = service.startRecording({ mediaKind: "video", mimeType: "video/webm" });
    assert.equal(started.mediaKind, "video");
    assert.equal(service.cancel(started.sessionId), true);
  }
});

test("stopはchunk path差替えを同じdescriptorのidentity再検証で拒否し未検証bytesを組み立てない", (t) => {
  const paths = fixture(t);
  const service = createService(paths);
  const started = service.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const original = webmBytes("verified-original");
  service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(original) });
  const sessionDirectory = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId);
  const chunkPath = path.join(sessionDirectory, "chunk-00000000.part");
  const retainedPath = path.join(sessionDirectory, "retained-original.part");
  const realOpen = fs.openSync;
  const realRead = fs.readSync;
  let chunkDescriptor = null;
  let swapped = false;
  fs.openSync = function patchedOpen(candidate, flags, mode) {
    const descriptor = realOpen.call(fs, candidate, flags, mode);
    if (!swapped && path.resolve(String(candidate)) === path.resolve(chunkPath) && (Number(flags) & fs.constants.O_RDONLY) === fs.constants.O_RDONLY) {
      chunkDescriptor = descriptor;
    }
    return descriptor;
  };
  fs.readSync = function patchedRead(fd, buffer, offset, length, position) {
    const bytesRead = realRead.call(fs, fd, buffer, offset, length, position);
    if (!swapped && fd === chunkDescriptor) {
      swapped = true;
      fs.renameSync(chunkPath, retainedPath);
      fs.writeFileSync(chunkPath, webmBytes("unverified-attacker"));
    }
    return bytesRead;
  };
  try {
    assert.throws(() => service.stopRecording(started.sessionId), /差し替え/);
  } finally {
    fs.openSync = realOpen;
    fs.readSync = realRead;
  }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(path.join(sessionDirectory, "original.webm")), false);
  assert.deepEqual(fs.readFileSync(chunkPath), webmBytes("unverified-attacker"));
});

test("再起動後に同sizeへ変更されたchunkもmanifest hashで拒否する", (t) => {
  const paths = fixture(t);
  const first = createService(paths);
  const started = first.startRecording({ mediaKind: "audio", mimeType: "audio/webm", themeId: null });
  const original = webmBytes("original-content");
  first.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(original) });
  const chunkPath = path.join(paths.userDataPath, "media-recovery", "sessions", started.sessionId, "chunk-00000000.part");
  const changed = Buffer.from(original);
  changed[changed.length - 1] ^= 0xff;
  fs.writeFileSync(chunkPath, changed);
  assert.throws(() => createService(paths).stopRecording(started.sessionId), /hashが一致/);
  assert.equal(fs.existsSync(path.join(path.dirname(chunkPath), "original.webm")), false);
});

test("紐づけ先未選択の画面録画はCaptureEntryごとInboxへ確定する（#383）", (t) => {
  const paths = fixture(t);
  const appliedCommands = [];
  const service = createService(paths, {
    repository: { get() { return null; } },
    commands: {
      executeMediaCapture(command) {
        appliedCommands.push(command);
        return { status: "applied", commandId: command.commandId, changes: [], events: [] };
      },
    },
  });
  const started = service.startRecording({ mediaKind: "video", mimeType: "video/webm" });
  service.appendRecordingChunk({ sessionId: started.sessionId, sequence: 0, chunk: asArrayBuffer(webmBytes("inbox-screen-recording")) });
  const prepared = service.stopRecording(started.sessionId);
  assert.equal(prepared.status, "ready");
  // ownerを渡さない。Inboxへ落ちる経路はsmokeが通らないのでここで担保する。
  const committed = service.commitVideo({ sessionId: started.sessionId, durationMs: 1000, widthPx: 1280, heightPx: 720 });
  assert.equal(committed.publicResult.status, "applied");
  assert.equal(appliedCommands.length, 1);
  const command = appliedCommands[0];
  assert.equal(command.name, "CommitVideoArtifact");
  assert.equal(command.payload.capture.kind, "screen_capture");
  assert.equal(command.payload.capture.content_type, "video");
  assert.equal(command.payload.capture.capture_method, "screen_recording");
  assert.equal(command.payload.capture.state, "untriaged");
  assert.equal(command.payload.artifact.source_type, "capture_entry");
  assert.equal(command.payload.artifact.source_id, command.payload.capture.id);
});
