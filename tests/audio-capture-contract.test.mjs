import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  audioMimeTypeOf,
  formatMediaDuration,
  MEDIA_AVAILABILITY_LABELS,
  TRANSCRIPTION_STATUS_LABELS,
  isSupportedAudioFileName,
  validateAudioArtifactMetadata,
  validateAudioCaptureEntry,
} from "../src/shared/mediaArtifact.mjs";
import { artifactMimeTypeOf } from "../src/main/services/artifactStorage.mjs";
import { validateEntity } from "../src/main/repositories/domain.mjs";

const HASH = `sha256:${"a".repeat(64)}`;

function audioArtifact(overrides = {}) {
  return {
    id: "artifact-audio",
    title: "Voice memo",
    filename: "voice.mp3",
    file_type: "mp3",
    mime_type: "audio/mpeg",
    file_size: 1024,
    stored_path: "C:/Tasken/Inbox/voice.mp3",
    storage_mode: "managed",
    source_type: "capture_entry",
    source_id: "capture-audio",
    media_kind: "audio",
    duration_ms: 12_345,
    content_hash: HASH,
    container: "mp3",
    ...overrides,
  };
}

function voiceCapture(overrides = {}) {
  return {
    id: "capture-audio",
    title: "Voice memo",
    text: "voice.mp3",
    kind: "voice_memo",
    content_type: "audio",
    capture_method: "audio_import",
    media_status: "ready",
    transcription_status: "not_requested",
    captured_at: "2026-08-09T00:00:00.000Z",
    state: "untriaged",
    ai_visibility: [],
    ...overrides,
  };
}

test("audio MIMEは対応拡張子からstrictに決まりoctet-streamへ潰れない", () => {
  assert.equal(audioMimeTypeOf("memo.MP3"), "audio/mpeg");
  assert.equal(audioMimeTypeOf("memo.wav"), "audio/wav");
  assert.equal(audioMimeTypeOf("memo.webm"), "audio/webm");
  assert.equal(audioMimeTypeOf("memo.m4a"), "audio/mp4");
  assert.equal(audioMimeTypeOf("memo.exe"), null);
  assert.equal(isSupportedAudioFileName("memo.ogg"), true);
  assert.equal(isSupportedAudioFileName("memo.txt"), false);
  assert.equal(artifactMimeTypeOf("memo.mp3"), "audio/mpeg");
  assert.equal(artifactMimeTypeOf("memo.unknown"), "application/octet-stream");
});

test("audio Artifactはmedia kind、MIME、size、duration、content hashを検証する", () => {
  assert.equal(validateAudioArtifactMetadata(audioArtifact()).media_kind, "audio");
  assert.equal(validateEntity("artifact", audioArtifact()).content_hash, HASH);
  assert.throws(() => validateEntity("artifact", audioArtifact({ mime_type: "application/octet-stream" })), /mime_type/);
  assert.throws(() => validateEntity("artifact", audioArtifact({ duration_ms: -1 })), /duration_ms/);
  assert.throws(() => validateEntity("artifact", audioArtifact({ content_hash: "sha256:bad" })), /content_hash/);
  assert.throws(() => validateEntity("artifact", audioArtifact({ filename: "voice.flac", file_type: "flac", mime_type: "audio\/flac" })), /対応していない音声形式/);
});

test("Voice Captureはaudio importと処理状態を通常file Captureから区別する", () => {
  assert.equal(validateAudioCaptureEntry(voiceCapture()).capture_method, "audio_import");
  assert.equal(validateEntity("capture_entry", voiceCapture()).content_type, "audio");
  assert.throws(() => validateEntity("capture_entry", voiceCapture({ content_type: "file" })), /content_type/);
  assert.throws(() => validateEntity("capture_entry", voiceCapture({ media_status: "saved" })), /media_status/);
  assert.throws(() => validateEntity("capture_entry", voiceCapture({ transcription_status: "unknown" })), /transcription_status/);
});

test("durationはcompactな時刻へ整形する", () => {
  assert.equal(formatMediaDuration(0), "0:00");
  assert.equal(formatMediaDuration(65_000), "1:05");
  assert.equal(formatMediaDuration(3_661_000), "1:01:01");
  assert.equal(formatMediaDuration(undefined), "");
});

test("保存済みVoice Captureは未整理・整理済みの両方でduration、size、statusをcompact表示する", () => {
  assert.equal(TRANSCRIPTION_STATUS_LABELS.not_requested, "未文字起こし");
  assert.equal(MEDIA_AVAILABILITY_LABELS.available, "保存済み");
  const inbox = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
  assert.equal((inbox.match(/<CapturedArtifactButton key=/g) || []).length, 2);
  assert.match(inbox, /formatMediaDuration\(artifact\.duration_ms\)/);
  assert.match(inbox, /formatArtifactFileSize\(artifact\.file_size\)/);
  assert.match(inbox, /TRANSCRIPTION_STATUS_LABELS\[transcription\]/);
  assert.match(inbox, /MEDIA_AVAILABILITY_LABELS\[availability\]/);
});
