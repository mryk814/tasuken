import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const result = await build({
  entryPoints: [path.resolve("src/shared/mediaCapture.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const parsers = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const THEME_ID = "8ecf07e4-1491-4e52-b39c-30a65991e78b";

test("audio prepare IPC accepts only the exact optional themeId envelope", () => {
  assert.deepEqual(parsers.parseAudioCapturePrepareRequest({}), {});
  assert.deepEqual(parsers.parseAudioCapturePrepareRequest({ themeId: THEME_ID }), { themeId: THEME_ID });
  assert.deepEqual(parsers.parseAudioCapturePrepareRequest({ themeId: "theme-personal-default" }), { themeId: "theme-personal-default" });
  assert.throws(() => parsers.parseAudioCapturePrepareRequest(null), /requestが不正/);
  assert.throws(() => parsers.parseAudioCapturePrepareRequest({ themeId: THEME_ID, sourcePath: "C:\\private.wav" }), /未定義field/);
  assert.throws(() => parsers.parseAudioCapturePrepareRequest({ themeId: " theme " }), /Theme ID/);
});

test("audio commit IPC requires an exact UUID sessionId and non-negative integer duration", () => {
  assert.deepEqual(parsers.parseAudioCaptureCommitRequest({ sessionId: SESSION_ID, durationMs: 1250 }), {
    sessionId: SESSION_ID,
    durationMs: 1250,
  });
  assert.throws(() => parsers.parseAudioCaptureCommitRequest({ sessionId: SESSION_ID }), /必要なfield/);
  assert.throws(() => parsers.parseAudioCaptureCommitRequest({ sessionId: SESSION_ID, durationMs: 10, stored_path: "C:\\private.wav" }), /未定義field/);
  assert.throws(() => parsers.parseAudioCaptureCommitRequest({ sessionId: "../escape", durationMs: 10 }), /session ID/);
  assert.throws(() => parsers.parseAudioCaptureCommitRequest({ sessionId: SESSION_ID, durationMs: 1.25 }), /duration/);
  assert.throws(() => parsers.parseAudioCaptureCommitRequest({ sessionId: SESSION_ID, durationMs: -1 }), /duration/);
});

test("audio cancel IPC accepts only an exact session envelope", () => {
  assert.deepEqual(parsers.parseAudioCaptureCancelRequest({ sessionId: SESSION_ID }), { sessionId: SESSION_ID });
  assert.throws(() => parsers.parseAudioCaptureCancelRequest(SESSION_ID), /requestが不正/);
  assert.throws(() => parsers.parseAudioCaptureCancelRequest({ sessionId: SESSION_ID, force: true }), /未定義field/);
  assert.throws(() => parsers.parseAudioCaptureCancelRequest({ sessionId: "not-a-uuid" }), /session ID/);
});

test("media recording IPC is mediaKind-discriminated and accepts only ArrayBuffer chunks", () => {
  assert.deepEqual(parsers.parseMediaRecordingStartRequest({ mediaKind: "audio", themeId: THEME_ID, mimeType: "audio/webm" }), {
    mediaKind: "audio",
    themeId: THEME_ID,
    mimeType: "audio/webm",
  });
  assert.throws(() => parsers.parseMediaRecordingStartRequest({ mediaKind: "video", mimeType: "video/webm" }), /まだ対応/);
  assert.throws(() => parsers.parseMediaRecordingStartRequest({ mediaKind: "audio", mimeType: "audio/wav" }), /対応していない録音形式/);
  const chunk = new ArrayBuffer(16);
  assert.deepEqual(parsers.parseMediaRecordingAppendRequest({ sessionId: SESSION_ID, sequence: 0, chunk }), { sessionId: SESSION_ID, sequence: 0, chunk });
  assert.throws(() => parsers.parseMediaRecordingAppendRequest({ sessionId: SESSION_ID, sequence: 1, chunk: new Uint8Array(16) }), /録音chunkが不正/);
  assert.throws(() => parsers.parseMediaRecordingAppendRequest({ sessionId: SESSION_ID, sequence: -1, chunk }), /順序/);
  assert.deepEqual(parsers.parseMediaRecordingControlRequest({ sessionId: SESSION_ID }), { sessionId: SESSION_ID });
  assert.throws(() => parsers.parseMediaRecordingControlRequest({ sessionId: SESSION_ID, force: true }), /未定義field/);
});

test("preload and Main keep prepared list/cancel behind typed narrow IPC", () => {
  const preload = readFileSync("src/preload/index.ts", "utf8");
  const register = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
  assert.match(preload, /cancelAudio: \(request\) => ipcRenderer\.invoke\(IPC\.audioCaptureCancel, request\)/);
  assert.match(register, /if \(args\.length > 0\) throw new Error\("保存待ち音声の一覧requestに引数は指定できません。"\)/);
  assert.match(register, /parseAudioCaptureCancelRequest\(request\)/);
  assert.match(register, /parseAudioCaptureCommitRequest\(request\)/);
  assert.match(preload, /startRecording: \(request\) => ipcRenderer\.invoke\(IPC\.mediaRecordingStart, request\)/);
  assert.match(register, /requireAudioCaptureThemeId\(repository, \{ themeId: parsed\.themeId \}\)/);
  assert.match(register, /parseMediaRecordingAppendRequest\(request\)/);
});
