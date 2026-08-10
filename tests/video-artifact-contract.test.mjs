import assert from "node:assert/strict";
import test from "node:test";

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
  assert.deepEqual(parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 2, heightPx: 2 }), {
    sessionId: ID, durationMs: 100, widthPx: 2, heightPx: 2,
  });
  assert.throws(() => parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 0, heightPx: 2 }));
  assert.throws(() => parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 2 ** 53, heightPx: 2 }));
  assert.throws(() => parseVideoImportCommitRequest({ sessionId: ID, durationMs: 100, widthPx: 16_385, heightPx: 2 }));
  assert.deepEqual(parseMediaArtifactOpenRequest({ artifactId: ID }), { artifactId: ID });
  assert.throws(() => parseMediaArtifactOpenRequest({ artifactId: ID, path: "C:\\secret.mp4" }));
});
