/**
 * Media Artifact の保存契約。
 *
 * Phase 0 では audio だけを有効化する。video は #352 が同じ共通fieldへ
 * 追加できるが、未検証形式を先回りして受理しない。
 */

export const AUDIO_MEDIA_TYPES = Object.freeze({
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
});

export const AUDIO_CAPTURE_METHODS = Object.freeze([
  "audio_import",
  "microphone",
  "external_dictation",
  "transcript_import",
]);

export const AUDIO_MEDIA_STATUSES = Object.freeze([
  "preparing",
  "ready",
  "failed",
]);

export const TRANSCRIPTION_STATUSES = Object.freeze([
  "not_requested",
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const MEDIA_AVAILABILITIES = Object.freeze([
  "available",
  "missing",
  "changed",
  "unsafe_source",
  "unsupported_codec",
]);

export const TRANSCRIPTION_STATUS_LABELS = Object.freeze({
  not_requested: "未文字起こし",
  queued: "文字起こし待ち",
  processing: "文字起こし中",
  completed: "文字起こし済み",
  failed: "文字起こし失敗",
});

export const MEDIA_AVAILABILITY_LABELS = Object.freeze({
  available: "保存済み",
  missing: "ファイルなし",
  changed: "内容変更",
  unsafe_source: "安全確認が必要",
  unsupported_codec: "未対応形式",
});

export function mediaExtensionOf(fileName) {
  const match = String(fileName || "").trim().match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

export function audioMimeTypeOf(fileName) {
  return AUDIO_MEDIA_TYPES[mediaExtensionOf(fileName)] || null;
}

export function isSupportedAudioFileName(fileName) {
  return Boolean(audioMimeTypeOf(fileName));
}

function requireFiniteNonNegativeInteger(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`${field}は0以上の整数で指定してください。`);
  }
  return numeric;
}

/** audio Artifact のmedia fieldだけをstrictに検証する。 */
export function validateAudioArtifactMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("audio Artifactのmetadataが不正です。");
  }
  if (input.media_kind !== "audio") throw new Error("artifact.media_kindはaudioである必要があります。");
  const expectedMime = audioMimeTypeOf(input.filename);
  if (!expectedMime) throw new Error("対応していない音声形式です。MP3、WAV、WebM、Ogg/Opus、M4A/MP4を選択してください。");
  if (input.mime_type !== expectedMime) {
    throw new Error(`artifact.mime_typeが拡張子と一致しません（expected: ${expectedMime}）。`);
  }
  requireFiniteNonNegativeInteger(input.file_size, "artifact.file_size");
  if (input.duration_ms != null) requireFiniteNonNegativeInteger(input.duration_ms, "artifact.duration_ms");
  if (typeof input.content_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(input.content_hash)) {
    throw new Error("artifact.content_hashはsha256形式で指定してください。");
  }
  if (input.container != null && (typeof input.container !== "string" || !input.container.trim())) {
    throw new Error("artifact.containerが不正です。");
  }
  if (input.codec != null && (typeof input.codec !== "string" || !input.codec.trim())) {
    throw new Error("artifact.codecが不正です。");
  }
  return input;
}

/** audio importで作るCaptureEntryの意味をstrictに固定する。 */
export function validateAudioCaptureEntry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Voice Captureの形式が不正です。");
  }
  if (input.content_type !== "audio") throw new Error("Voice Captureのcontent_typeはaudioである必要があります。");
  if (input.kind !== "voice_memo") throw new Error("Voice Captureのkindはvoice_memoである必要があります。");
  if (!AUDIO_CAPTURE_METHODS.includes(input.capture_method)) throw new Error("Voice Captureのcapture_methodが不正です。");
  if (!AUDIO_MEDIA_STATUSES.includes(input.media_status)) throw new Error("Voice Captureのmedia_statusが不正です。");
  if (!TRANSCRIPTION_STATUSES.includes(input.transcription_status)) throw new Error("Voice Captureのtranscription_statusが不正です。");
  return input;
}

export function formatMediaDuration(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) return "";
  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
