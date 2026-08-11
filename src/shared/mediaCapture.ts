import type { CommandReceipt } from "./applicationCommand";
import type { MediaAvailability } from "./mediaArtifact.mjs";
import { PERSONAL_DEFAULT_THEME_ID } from "./themeRef.mjs";

export interface AudioCapturePrepareRequest {
  themeId?: string | null;
}

export const MICROPHONE_RECORDING_MIME_TYPES = ["audio/webm"] as const;
export type MicrophoneRecordingMimeType = (typeof MICROPHONE_RECORDING_MIME_TYPES)[number];
/**
 * 画面録画はMP4(H.264/AAC)を既定にする。WebMは保存効率が良い一方で
 * PowerPoint等での扱いが悪く、「録ったものを他所で使う」導線が切れるため。
 * 変換は挟まず、録画時点でMP4を選ぶ（#388）。
 */
export const SCREEN_RECORDING_MIME_TYPES = ["video/mp4", "video/webm"] as const;
export type ScreenRecordingMimeType = (typeof SCREEN_RECORDING_MIME_TYPES)[number];

/** 保存ファイルの拡張子は録画形式から決める。webm固定にしない。 */
export const MEDIA_RECORDING_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "video/webm": "webm",
  "video/mp4": "mp4",
};

export interface MicrophoneRecordingStartRequest {
  mediaKind: "audio";
  themeId?: string | null;
  mimeType: MicrophoneRecordingMimeType;
}

/**
 * 録画開始時にownerを決めない（#383）。
 * 「録るために先に何かを作る」順序を避け、紐づけ先は保存時に選ぶ。
 */
export interface ScreenRecordingStartRequest {
  mediaKind: "video";
  mimeType: ScreenRecordingMimeType;
  themeId?: string | null;
}

export type MediaRecordingStartRequest = MicrophoneRecordingStartRequest | ScreenRecordingStartRequest;

export interface MediaRecordingStarted {
  sessionId: string;
  mediaKind: "audio" | "video";
  mimeType: MicrophoneRecordingMimeType | ScreenRecordingMimeType;
  maxChunkBytes: number;
  maxRecordingBytes: number;
  maxDurationMs: number;
}

export interface MediaRecordingAppendRequest {
  sessionId: string;
  sequence: number;
  chunk: ArrayBuffer;
}

export interface MediaRecordingControlRequest {
  sessionId: string;
}

export interface MediaRecordingProgress {
  sessionId: string;
  nextSequence: number;
  fileSize: number;
  state: "recording" | "paused";
}

export interface AudioCapturePrepared {
  sessionId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  mediaUrl: string;
  status: "ready" | "recovery_required";
  availability: MediaAvailability;
  recoveryReason?: "manifest_invalid" | "media_missing" | "media_changed" | "unsafe_source" | "unsupported_codec" | "commit_failed" | "recovery_pending" | "recording_interrupted";
  durationMs?: number;
  canCommit: boolean;
  canRetry: boolean;
  canDiscard: boolean;
  canRecoverRecording?: boolean;
}

export const VIDEO_ARTIFACT_SOURCE_TYPES = ["task", "note", "report", "capture_entry"] as const;
export type VideoArtifactSourceType = (typeof VIDEO_ARTIFACT_SOURCE_TYPES)[number];
export type VideoStorageMode = "managed" | "linked";

export interface VideoImportPrepareRequest {
  storageMode: VideoStorageMode;
  sourceType: VideoArtifactSourceType;
  sourceId: string;
}

export interface VideoImportPrepared extends AudioCapturePrepared {
  /** manifest_invalid診断ではowner/storageを推測せず省略する。 */
  storageMode?: VideoStorageMode;
  sourceType?: VideoArtifactSourceType;
  sourceId?: string;
  durationMs?: number;
  widthPx?: number;
  heightPx?: number;
}

export type VideoImportPrepareResult =
  | { canceled: true }
  | ({ canceled: false } & VideoImportPrepared);

export interface VideoImportCommitRequest {
  sessionId: string;
  durationMs: number;
  widthPx: number;
  heightPx: number;
  /** 未指定ならInbox（CaptureEntry）へ落とす。指定時はそのEntityへ添付する（#383）。 */
  sourceType?: VideoArtifactSourceType | null;
  sourceId?: string | null;
}

export interface VideoImportCommitResult {
  status: "applied" | "no_change";
  commandId: string;
  artifactId: string;
  sourceType: VideoArtifactSourceType;
  sourceId: string;
}

export interface VideoTrimSourceRevision {
  artifactId: string;
  artifactVersion: number;
  contentHash: string;
  durationMs: number;
  widthPx: number;
  heightPx: number;
}

export interface VideoTrimExportRequest {
  operationId: string;
  destinationArtifactId: string;
  trimPlan: {
    schemaVersion: 1;
    kind: "non_destructive_trim";
    source: VideoTrimSourceRevision;
    startMs: number;
    endMs: number;
  };
}

export interface VideoTrimExportResult {
  status: "applied" | "no_change";
  commandId: string;
  artifactId: string;
  sourceArtifactId: string;
}

export interface MediaArtifactOpenRequest {
  artifactId: string;
}

export interface MediaArtifactInspection {
  availability: MediaAvailability;
  mimeType?: string;
  fileSize?: number;
}

export type AudioCapturePrepareResult =
  | { canceled: true }
  | ({ canceled: false } & AudioCapturePrepared);

export interface AudioCaptureCommitRequest {
  sessionId: string;
  durationMs: number;
}

export interface AudioCaptureCommitResult {
  status: "applied" | "no_change";
  commandId: string;
  captureId: string;
  artifactId: string;
}

export interface AudioCaptureCancelRequest {
  sessionId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireExactObject(value: unknown, allowedKeys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} requestが不正です。画面を再読み込みして、もう一度試してください。`);
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    throw new Error(`${label} requestに未定義fieldがあります。`);
  }
  return input;
}

function requireSessionId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("音声Captureのsession IDが不正です。保存待ち音声を読み直してください。");
  }
  return value;
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label}が不正です。画面を再読み込みしてください。`);
  }
  return value;
}

function requireSourceId(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 200) {
    throw new Error("動画Importの添付先IDが不正です。画面を再読み込みしてください。");
  }
  return value;
}

export function parseAudioCapturePrepareRequest(value: unknown): AudioCapturePrepareRequest {
  const input = requireExactObject(value, ["themeId"], "音声Capture prepare");
  if (input.themeId === undefined || input.themeId === null || input.themeId === "") return {};
  if (
    typeof input.themeId !== "string"
    || input.themeId !== input.themeId.trim()
    || (!UUID_PATTERN.test(input.themeId) && input.themeId !== PERSONAL_DEFAULT_THEME_ID)
  ) {
    throw new Error("音声CaptureのTheme IDが不正です。");
  }
  return { themeId: input.themeId };
}

export function parseMediaRecordingStartRequest(value: unknown): MediaRecordingStartRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("media recording start requestが不正です。画面を再読み込みして、もう一度試してください。");
  }
  const mediaKind = (value as Record<string, unknown>).mediaKind;
  if (mediaKind === "audio") {
    const input = requireExactObject(value, ["mediaKind", "themeId", "mimeType"], "media recording start");
    const theme = parseAudioCapturePrepareRequest({ themeId: input.themeId });
    if (typeof input.mimeType !== "string" || !MICROPHONE_RECORDING_MIME_TYPES.includes(input.mimeType as MicrophoneRecordingMimeType)) {
      throw new Error("対応していない録音形式です。アプリを再起動して、もう一度試してください。");
    }
    return { ...theme, mediaKind: "audio", mimeType: input.mimeType as MicrophoneRecordingMimeType };
  }
  if (mediaKind === "video") {
    const input = requireExactObject(value, ["mediaKind", "mimeType", "themeId"], "screen recording start");
    if (typeof input.mimeType !== "string" || !SCREEN_RECORDING_MIME_TYPES.includes(input.mimeType as ScreenRecordingMimeType)) {
      throw new Error("対応していない画面録画形式です。Windows版Taskenを再起動してください。");
    }
    const theme = parseAudioCapturePrepareRequest({ themeId: input.themeId });
    return { ...theme, mediaKind: "video", mimeType: input.mimeType as ScreenRecordingMimeType };
  }
  throw new Error("この録音種別には対応していません。");
}

export function parseMediaRecordingAppendRequest(value: unknown): MediaRecordingAppendRequest {
  const input = requireExactObject(value, ["sessionId", "sequence", "chunk"], "microphone recording append");
  if (!Number.isSafeInteger(input.sequence) || Number(input.sequence) < 0) {
    throw new Error("録音chunkの順序が不正です。録音を停止し、保存待ち音声を確認してください。");
  }
  if (!(input.chunk instanceof ArrayBuffer)) {
    throw new Error("録音chunkが不正です。録音を停止し、もう一度試してください。");
  }
  return { sessionId: requireSessionId(input.sessionId), sequence: Number(input.sequence), chunk: input.chunk };
}

export function parseMediaRecordingControlRequest(value: unknown): MediaRecordingControlRequest {
  const input = requireExactObject(value, ["sessionId"], "microphone recording control");
  return { sessionId: requireSessionId(input.sessionId) };
}

export function parseAudioCaptureCommitRequest(value: unknown): AudioCaptureCommitRequest {
  const input = requireExactObject(value, ["sessionId", "durationMs"], "音声Capture commit");
  if (!Object.hasOwn(input, "sessionId") || !Object.hasOwn(input, "durationMs")) {
    throw new Error("音声Capture commit requestに必要なfieldがありません。");
  }
  if (!Number.isSafeInteger(input.durationMs) || (input.durationMs as number) < 0) {
    throw new Error("音声Captureのdurationが不正です。音声を読み直してください。");
  }
  return { sessionId: requireSessionId(input.sessionId), durationMs: input.durationMs as number };
}

export function parseAudioCaptureCancelRequest(value: unknown): AudioCaptureCancelRequest {
  const input = requireExactObject(value, ["sessionId"], "音声Capture cancel");
  if (!Object.hasOwn(input, "sessionId")) {
    throw new Error("音声Capture cancel requestにsessionIdがありません。");
  }
  return { sessionId: requireSessionId(input.sessionId) };
}

export function parseVideoImportPrepareRequest(value: unknown): VideoImportPrepareRequest {
  const input = requireExactObject(value, ["storageMode", "sourceType", "sourceId"], "動画Import prepare");
  if (input.storageMode !== "managed" && input.storageMode !== "linked") {
    throw new Error("動画Importのstorage modeが不正です。");
  }
  if (typeof input.sourceType !== "string" || !VIDEO_ARTIFACT_SOURCE_TYPES.includes(input.sourceType as VideoArtifactSourceType)) {
    throw new Error("動画Importの添付先種別が不正です。");
  }
  return {
    storageMode: input.storageMode,
    sourceType: input.sourceType as VideoArtifactSourceType,
    sourceId: requireSourceId(input.sourceId),
  };
}

export function parseVideoImportCommitRequest(value: unknown): VideoImportCommitRequest {
  const input = requireExactObject(value, ["sessionId", "durationMs", "widthPx", "heightPx", "sourceType", "sourceId"], "動画Import commit");
  for (const field of ["durationMs", "widthPx", "heightPx"] as const) {
    const maximum = field === "durationMs" ? 7 * 24 * 60 * 60 * 1000 : 16_384;
    if (!Number.isSafeInteger(input[field]) || Number(input[field]) < 0 || Number(input[field]) > maximum || (field !== "durationMs" && Number(input[field]) === 0)) {
      throw new Error(`動画Importの${field}が不正です。動画を読み直してください。`);
    }
  }
  // ownerは保存時に決める。両方nullならInbox（CaptureEntry）へ落とす（#383）。
  const hasOwner = input.sourceType !== null && input.sourceType !== undefined;
  if (hasOwner !== (input.sourceId !== null && input.sourceId !== undefined)) {
    throw new Error("動画の紐づけ先が中途半端です。保存先を選び直してください。");
  }
  const owner = hasOwner
    ? parseVideoImportPrepareRequest({ storageMode: "managed", sourceType: input.sourceType, sourceId: input.sourceId })
    : null;
  return {
    sessionId: requireSessionId(input.sessionId),
    durationMs: Number(input.durationMs),
    widthPx: Number(input.widthPx),
    heightPx: Number(input.heightPx),
    sourceType: owner ? owner.sourceType : null,
    sourceId: owner ? owner.sourceId : null,
  };
}

export function parseMediaArtifactOpenRequest(value: unknown): MediaArtifactOpenRequest {
  const input = requireExactObject(value, ["artifactId"], "Media外部open");
  return { artifactId: requireUuid(input.artifactId, "Media Artifact ID") };
}

export function parseVideoTrimSourceRequest(value: unknown): MediaArtifactOpenRequest {
  return parseMediaArtifactOpenRequest(value);
}

export function parseVideoTrimExportRequest(value: unknown): VideoTrimExportRequest {
  const input = requireExactObject(value, ["operationId", "destinationArtifactId", "trimPlan"], "動画trim export");
  // 詳細なrevision・範囲検証はscreenRecordingEditの共有契約をMainでも再実行する。
  return input as unknown as VideoTrimExportRequest;
}

/** Main内部だけで扱う。Rendererへは返さない。 */
export interface InternalAudioCaptureCommitResult {
  publicResult: AudioCaptureCommitResult;
  receipt: CommandReceipt;
}

/** Main内部だけで扱う。Rendererへは返さない。 */
export interface InternalVideoImportCommitResult {
  publicResult: VideoImportCommitResult;
  receipt: CommandReceipt;
}
