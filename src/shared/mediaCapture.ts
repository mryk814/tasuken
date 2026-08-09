import type { CommandReceipt } from "./applicationCommand";
import type { MediaAvailability } from "./mediaArtifact.mjs";
import { PERSONAL_DEFAULT_THEME_ID } from "./themeRef.mjs";

export interface AudioCapturePrepareRequest {
  themeId?: string | null;
}

export interface AudioCapturePrepared {
  sessionId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  mediaUrl: string;
  status: "ready" | "recovery_required";
  availability: MediaAvailability;
  recoveryReason?: "manifest_invalid" | "media_missing" | "media_changed" | "unsafe_source" | "unsupported_codec" | "commit_failed" | "recovery_pending";
  durationMs?: number;
  canCommit: boolean;
  canRetry: boolean;
  canDiscard: boolean;
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

/** Main内部だけで扱う。Rendererへは返さない。 */
export interface InternalAudioCaptureCommitResult {
  publicResult: AudioCaptureCommitResult;
  receipt: CommandReceipt;
}
