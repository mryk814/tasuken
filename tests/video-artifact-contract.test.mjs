import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  videoMimeTypeOf,
  validateVideoArtifactMetadata,
} from "../src/shared/mediaArtifact.mjs";
import {
  parseMediaArtifactOpenRequest,
  parseVideoImportCommitRequest,
  parseVideoImportPrepareRequest,
} from "../src/shared/mediaCapture.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const HASH = `sha256:${"a".repeat(64)}`;

function video(overrides = {}) {
  return {
    filename: "evidence.mp4",
    media_kind: "video",
    mime_type: "video/mp4",
    file_size: 1024,
    duration_ms: 12_345,
    width_px: 1920,
    height_px: 1080,
    content_hash: HASH,
    ...overrides,
  };
}

test("video MIME is strict for mp4/m4v/mov/webm and never falls back", () => {
  assert.equal(videoMimeTypeOf("clip.mp4"), "video/mp4");
  assert.equal(videoMimeTypeOf("clip.M4V"), "video/mp4");
  assert.equal(videoMimeTypeOf("clip.mov"), "video/quicktime");
  assert.equal(videoMimeTypeOf("clip.webm"), "video/webm");
  assert.equal(videoMimeTypeOf("clip.avi"), null);
});

test("video metadata enforces safe practical bounds", () => {
  assert.equal(validateVideoArtifactMetadata(video()).media_kind, "video");
  assert.equal(Object.hasOwn(validateVideoArtifactMetadata(video()), "capture_method"), false);
  assert.equal(validateVideoArtifactMetadata(video({ capture_method: "screen_recording" })).capture_method, "screen_recording");
  for (const invalid of [
    { mime_type: "application/octet-stream" },
    { media_kind: "audio" },
    { file_size: 2 ** 53 },
    { duration_ms: Number.POSITIVE_INFINITY },
    { duration_ms: 8 * 24 * 60 * 60 * 1000 },
    { width_px: 0 },
    { height_px: 0 },
    { width_px: 16385 },
    { height_px: 16385 },
    { content_hash: "sha256:bad" },
    { capture_method: "microphone" },
  ]) assert.throws(() => validateVideoArtifactMetadata(video(invalid)));
});

test("video IPC requests accept exact ID-only metadata envelopes", () => {
  assert.deepEqual(parseVideoImportPrepareRequest({
    storageMode: "managed", sourceType: "task", sourceId: "task-1",
  }), { storageMode: "managed", sourceType: "task", sourceId: "task-1" });
  assert.throws(() => parseVideoImportPrepareRequest({ storageMode: "copy", sourceType: "task", sourceId: ID }));
  assert.throws(() => parseVideoImportPrepareRequest({ storageMode: "linked", sourceType: "theme", sourceId: ID }));
  assert.throws(() => parseVideoImportPrepareRequest({ storageMode: "linked", sourceType: "note", sourceId: ID, path: "C:\\secret.mp4" }));
  assert.throws(() => parseVideoImportPrepareRequest({ storageMode: "linked", sourceType: "task", sourceId: "task-1", themeId: ID }));
  // 紐づけ先は保存時に決める。未指定はInbox（CaptureEntry）行き（#383）。
  assert.deepEqual(parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 2, heightPx: 2 }), {
    sessionId: ID, durationMs: 100, widthPx: 2, heightPx: 2, sourceType: null, sourceId: null,
  });
  assert.deepEqual(parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 2, heightPx: 2, sourceType: "task", sourceId: "task-1" }), {
    sessionId: ID, durationMs: 100, widthPx: 2, heightPx: 2, sourceType: "task", sourceId: "task-1",
  });
  // 片方だけの指定は受け付けない。
  assert.throws(() => parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 2, heightPx: 2, sourceType: "task", sourceId: null }), /中途半端/);
  assert.throws(() => parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 0, heightPx: 2 }));
  assert.throws(() => parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 2 ** 53, heightPx: 2 }));
  assert.throws(() => parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 16_385, heightPx: 2 }));
  assert.deepEqual(parseMediaArtifactOpenRequest({ artifactId: ID }), { artifactId: ID });
  assert.throws(() => parseMediaArtifactOpenRequest({ artifactId: ID, path: "C:\\secret.mp4" }));
});

test("紐づけ先未選択の画面録画はCaptureEntryごとInboxへ確定する（#383）", () => {
  const captureId = "7a1e4567-e89b-42d3-a456-426614174999";
  const artifact = {
    id: "8b2e4567-e89b-42d3-a456-426614174998",
    media_kind: "video",
    storage_mode: "managed",
    source_type: "capture_entry",
    source_id: captureId,
  };
  const capture = {
    id: captureId,
    content_type: "video",
    kind: "screen_capture",
    capture_method: "screen_recording",
    media_status: "ready",
  };
  // commit contractの必須項目。どれかが欠けたらInboxに置き場のない動画が生まれる。
  assert.equal(artifact.source_type, "capture_entry");
  assert.equal(artifact.source_id, capture.id);
  assert.equal(capture.content_type, "video");
  assert.equal(capture.kind, "screen_capture");
  assert.equal(capture.capture_method, "screen_recording");
});

test("紐づけ先未選択の画面録画はCaptureEntryごとInboxへ確定する（#383）", () => {
  const service = readFileSync("src/main/services/mediaCaptureService.ts", "utf8");
  const commands = readFileSync("src/main/services/applicationCommandService.ts", "utf8");
  // 録画開始はownerを取らず、commitで決める。未選択ならCaptureEntryを作る。
  assert.match(service, /private resolveVideoCommitOwner\([\s\S]*?sourceType: "capture_entry",[\s\S]*?pendingCaptureEntry: true/);
  assert.match(service, /manifest\.pendingCaptureEntry \? \{[\s\S]*?kind: "screen_capture",[\s\S]*?content_type: "video",[\s\S]*?capture_method: "screen_recording"/);
  assert.match(service, /payload: capture \? \{ capture, artifact \} : \{ artifact \}/);
  // まだrepositoryに無いCaptureEntryをownerとして扱えるようにする。
  assert.match(service, /manifest\.pendingCaptureEntry\) return;/);
  // Command側はcaptureとartifactを同じtransactionで確定する。
  assert.match(commands, /const \{ capture = null, artifact \} = command\.payload/);
  assert.match(commands, /capture\.kind !== "screen_capture"[\s\S]*?INVALID_PAYLOAD/);
  assert.match(commands, /capture \? \["capture_entry", "artifact"\] : \["artifact"\]/);
});
