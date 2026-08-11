/**
 * Screen recording の Renderer / Main 間で共有する pure contract。
 *
 * Electron の DesktopCapturerSource.id / display_id は OS 側の一時識別子であり、
 * Renderer や永続化へ渡さない。Renderer は Main が発行する短命 token だけを扱う。
 */

export const SCREEN_RECORDING_SOURCE_KINDS = Object.freeze(["screen", "window"]);
export const SCREEN_RECORDING_AUDIO_MODES = Object.freeze(["off", "microphone", "system"]);
export const SCREEN_RECORDING_STATES = Object.freeze([
  "idle",
  "arming",
  "recording",
  "paused",
  "stopping",
  "prepared",
  "failed",
]);

export const SCREEN_RECORDING_LIMITS = Object.freeze({
  // 対象を見比べて音声・pointerまで決める時間。人が選ぶ前提の窓。
  sourceTokenTtlMs: 300_000,
  // armからgetDisplayMediaまでの窓。ここは機械的に連続するので短く保つ。
  armTtlMs: 30_000,
  maxSources: 100,
  maxLabelChars: 120,
  maxThumbnailChars: 512 * 1024,
});

// MP4(H.264/AAC)を先に試す。録ったものをPowerPoint等へそのまま持ち出せる形式を既定にする（#388）。
export const SCREEN_RECORDING_MIME_CANDIDATES = Object.freeze([
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
]);

/**
 * 画面キャプチャは動きが少ないので、1080pでも2 Mbpsで文字が読める。
 * 30分でおよそ450MBに収まり、既定の容量上限（512MB）に当たらない（#388）。
 */
export const SCREEN_RECORDING_BITRATES = Object.freeze({
  videoBitsPerSecond: 2_000_000,
  audioBitsPerSecond: 48_000,
});

/** 録画形式からMain契約のmimeType（container）を決める。 */
export function screenRecordingContainerOf(recorderMimeType) {
  return typeof recorderMimeType === "string" && recorderMimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

function requireExactObject(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}が不正です。画面を再読み込みしてください。`);
  }
  const input = value;
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    throw new Error(`${label}に未定義fieldがあります。`);
  }
  return input;
}

function requireUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label}が不正です。画面を再読み込みしてください。`);
  }
  return value;
}

function requireSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label}が不正です。画面を再読み込みしてください。`);
  }
  return value;
}

export function normalizeScreenRecordingSecurityOrigin(value) {
  if (typeof value !== "string" || !value || value.length > 2048) {
    throw new Error("画面録画のoriginが不正です。");
  }
  if (value === "file://") return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("画面録画のoriginが不正です。");
  }
  const localDevelopmentOrigin = (
    (parsed.protocol === "http:" || parsed.protocol === "https:")
    && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
  );
  // Chromiumは末尾スラッシュ付きのserialized originを渡すことがあるので、そこだけ許して正規化する。
  const serialized = value === `${parsed.origin}/` ? parsed.origin : value;
  if (!localDevelopmentOrigin || !parsed.origin || parsed.username || parsed.password || serialized !== parsed.origin) {
    throw new Error("画面録画のoriginが不正です。");
  }
  return parsed.origin;
}

/**
 * display media requestのsecurity originとframeのoriginを突き合わせる。
 * Chromiumは "http://localhost:5173/" のように末尾スラッシュ付きで渡すため、
 * 生の文字列比較にするとdev serverでは必ず不一致になる。
 */
export function screenRecordingOriginsMatch(requestOrigin, frameOrigin) {
  if (typeof requestOrigin !== "string" || typeof frameOrigin !== "string" || !requestOrigin || !frameOrigin) return false;
  const request = requestOrigin === "file://" ? requestOrigin : requestOrigin.replace(/\/+$/, "");
  // file:のframeはopaque origin（"null"）で届くことがある。
  if (frameOrigin === "file://") return request === "file://" || request === "null";
  return request === frameOrigin;
}

export function sanitizeScreenRecordingSourceLabel(value, kind) {
  if (!SCREEN_RECORDING_SOURCE_KINDS.includes(kind)) {
    throw new Error("画面録画source kindが不正です。");
  }
  const fallback = kind === "screen" ? "画面" : "ウィンドウ";
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\r\n\t]+/g, " ").trim();
  if (!normalized || CONTROL_PATTERN.test(normalized)) return fallback;
  return normalized.slice(0, SCREEN_RECORDING_LIMITS.maxLabelChars);
}

export function validateScreenRecordingSourceProjection(value) {
  const input = requireExactObject(
    value,
    ["sourceToken", "kind", "label", "thumbnailDataUrl", "expiresAt"],
    "画面録画source",
  );
  if (!SCREEN_RECORDING_SOURCE_KINDS.includes(input.kind)) {
    throw new Error("画面録画source kindが不正です。");
  }
  const label = sanitizeScreenRecordingSourceLabel(input.label, input.kind);
  if (label !== input.label) throw new Error("画面録画source labelが正規化されていません。");
  if (
    typeof input.thumbnailDataUrl !== "string"
    || input.thumbnailDataUrl.length > SCREEN_RECORDING_LIMITS.maxThumbnailChars
    || !PNG_DATA_URL_PATTERN.test(input.thumbnailDataUrl)
  ) {
    throw new Error("画面録画source thumbnailが不正です。");
  }
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new Error("画面録画source期限が不正です。");
  return Object.freeze({
    sourceToken: requireUuid(input.sourceToken, "画面録画source token"),
    kind: input.kind,
    label,
    thumbnailDataUrl: input.thumbnailDataUrl,
    expiresAt: new Date(expiresAt).toISOString(),
  });
}

export function parseScreenRecordingArmRequest(value) {
  const input = requireExactObject(value, ["sourceToken", "audioMode", "includePointer", "region"], "画面録画arm request");
  if (!SCREEN_RECORDING_AUDIO_MODES.includes(input.audioMode)) {
    throw new Error("画面録画のaudio modeが不正です。");
  }
  if (typeof input.includePointer !== "boolean") {
    throw new Error("画面録画のpointer設定が不正です。");
  }
  let region = null;
  if (input.region !== undefined && input.region !== null) {
    const value = requireExactObject(input.region, ["rectDip", "cropPx", "frameSizePx"], "画面録画region");
    const normalizeRect = (candidate, label, allowOffset, allowNegativeOffset = false) => {
      const rect = requireExactObject(candidate, allowOffset ? ["x", "y", "width", "height"] : ["width", "height"], label);
      const width = requireSafeInteger(rect.width, `${label} width`, 1);
      const height = requireSafeInteger(rect.height, `${label} height`, 1);
      return allowOffset
        ? { x: requireSafeInteger(rect.x, `${label} x`, allowNegativeOffset ? -1_000_000 : 0), y: requireSafeInteger(rect.y, `${label} y`, allowNegativeOffset ? -1_000_000 : 0), width, height }
        : { width, height };
    };
    const rectDip = normalizeRect(value.rectDip, "画面録画region DIP", true, true);
    if (rectDip.width < 64 || rectDip.height < 64) throw new Error("録画範囲は64×64以上で選択してください。");
    region = Object.freeze({
      rectDip,
      cropPx: normalizeRect(value.cropPx, "画面録画region pixel", true),
      frameSizePx: normalizeRect(value.frameSizePx, "画面録画frame", false),
    });
  }
  return Object.freeze({
    sourceToken: requireUuid(input.sourceToken, "画面録画source token"),
    audioMode: input.audioMode,
    includePointer: input.includePointer,
    ...(region ? { region } : {}),
  });
}

export function buildScreenRecordingCapabilities(input) {
  const value = requireExactObject(
    input,
    ["platform", "microphoneAvailable", "systemAudioAvailable", "supportedMimeTypes"],
    "画面録画capability",
  );
  if (!["win32", "darwin", "linux"].includes(value.platform)) {
    throw new Error("画面録画のplatformが不正です。");
  }
  if (typeof value.microphoneAvailable !== "boolean" || typeof value.systemAudioAvailable !== "boolean") {
    throw new Error("画面録画のaudio capabilityが不正です。");
  }
  if (!Array.isArray(value.supportedMimeTypes) || value.supportedMimeTypes.some((mime) => typeof mime !== "string")) {
    throw new Error("画面録画のMIME capabilityが不正です。");
  }
  const supported = new Set(value.supportedMimeTypes);
  const recorderMimeType = SCREEN_RECORDING_MIME_CANDIDATES.find((mime) => supported.has(mime)) || null;
  return Object.freeze({
    screen: true,
    window: true,
    microphone: value.microphoneAvailable,
    systemAudio: value.platform === "win32" && value.systemAudioAvailable,
    recorderMimeType,
  });
}

export function parseScreenRecordingGrantContext(value) {
  const input = requireExactObject(
    value,
    ["sourceToken", "senderWebContentsId", "frameTreeNodeId", "securityOrigin", "expiresAtMs", "consumed", "audioMode"],
    "画面録画grant context",
  );
  if (!SCREEN_RECORDING_AUDIO_MODES.includes(input.audioMode)) {
    throw new Error("画面録画grantのaudio modeが不正です。");
  }
  if (typeof input.consumed !== "boolean") throw new Error("画面録画grant stateが不正です。");
  return Object.freeze({
    sourceToken: requireUuid(input.sourceToken, "画面録画source token"),
    senderWebContentsId: requireSafeInteger(input.senderWebContentsId, "画面録画sender ID", 1),
    frameTreeNodeId: requireSafeInteger(input.frameTreeNodeId, "画面録画frame ID", 1),
    securityOrigin: normalizeScreenRecordingSecurityOrigin(input.securityOrigin),
    expiresAtMs: requireSafeInteger(input.expiresAtMs, "画面録画grant期限", 1),
    consumed: input.consumed,
    audioMode: input.audioMode,
  });
}

export function authorizeScreenRecordingGrant(contextValue, requestValue, nowMs) {
  const context = parseScreenRecordingGrantContext(contextValue);
  const request = requireExactObject(
    requestValue,
    ["senderWebContentsId", "frameTreeNodeId", "frameIsMain", "frameDetached", "securityOrigin", "userGesture", "videoRequested", "audioRequested"],
    "画面録画grant request",
  );
  const currentTime = requireSafeInteger(nowMs, "画面録画grant時刻");
  if (context.consumed) throw new Error("画面録画の選択は使用済みです。もう一度選択してください。");
  if (currentTime > context.expiresAtMs) throw new Error("画面録画の選択期限が切れました。もう一度選択してください。");
  if (requireSafeInteger(request.senderWebContentsId, "画面録画sender ID", 1) !== context.senderWebContentsId) {
    throw new Error("画面録画の要求元が一致しません。");
  }
  if (requireSafeInteger(request.frameTreeNodeId, "画面録画frame ID", 1) !== context.frameTreeNodeId) {
    throw new Error("画面録画のframeが一致しません。もう一度選択してください。");
  }
  if (request.frameIsMain !== true || request.frameDetached !== false) {
    throw new Error("画面録画は現在のMain frameから開始してください。");
  }
  if (normalizeScreenRecordingSecurityOrigin(request.securityOrigin) !== context.securityOrigin) {
    throw new Error("画面録画のoriginが一致しません。");
  }
  if (request.userGesture !== true || request.videoRequested !== true) {
    throw new Error("画面録画は画面上の明示操作から開始してください。");
  }
  const expectsDisplayAudio = context.audioMode === "system";
  if (request.audioRequested !== expectsDisplayAudio) {
    throw new Error("画面録画のaudio要求が選択内容と一致しません。");
  }
  return Object.freeze({
    sourceToken: context.sourceToken,
    displayAudio: expectsDisplayAudio ? "loopback" : null,
    microphoneRequired: context.audioMode === "microphone",
  });
}
