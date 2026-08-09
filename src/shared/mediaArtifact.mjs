/**
 * Media Artifact の保存契約。
 *
 * audio / video は同じ Media Artifact field と安全な再生境界を使う。
 * 拡張子と MIME の対応をここだけで固定し、未検証形式は受理しない。
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

export const VIDEO_MEDIA_TYPES = Object.freeze({
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
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

export function videoMimeTypeOf(fileName) {
  return VIDEO_MEDIA_TYPES[mediaExtensionOf(fileName)] || null;
}

export function isSupportedVideoFileName(fileName) {
  return Boolean(videoMimeTypeOf(fileName));
}

function requireFiniteNonNegativeInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > maximum) {
    throw new Error(`${field}は0以上${maximum}以下の安全な整数で指定してください。`);
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

/** video Artifact の media field だけを strict に検証する。 */
export function validateVideoArtifactMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("video Artifactのmetadataが不正です。");
  }
  if (input.media_kind !== "video") throw new Error("artifact.media_kindはvideoである必要があります。");
  const expectedMime = videoMimeTypeOf(input.filename);
  if (!expectedMime) throw new Error("対応していない動画形式です。MP4、M4V、MOV、WebMを選択してください。");
  if (input.mime_type !== expectedMime) {
    throw new Error(`artifact.mime_typeが拡張子と一致しません（expected: ${expectedMime}）。`);
  }
  requireFiniteNonNegativeInteger(input.file_size, "artifact.file_size", 1024 * 1024 * 1024 * 1024);
  requireFiniteNonNegativeInteger(input.duration_ms, "artifact.duration_ms", 7 * 24 * 60 * 60 * 1000);
  const width = requireFiniteNonNegativeInteger(input.width_px, "artifact.width_px", 16384);
  const height = requireFiniteNonNegativeInteger(input.height_px, "artifact.height_px", 16384);
  if (width === 0 || height === 0) throw new Error("artifactの動画dimensionsは1px以上で指定してください。");
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
