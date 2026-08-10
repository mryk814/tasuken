export const SCREEN_RECORDING_SOURCE_KINDS: readonly ["screen", "window"];
export type ScreenRecordingSourceKind = (typeof SCREEN_RECORDING_SOURCE_KINDS)[number];
export const SCREEN_RECORDING_AUDIO_MODES: readonly ["off", "microphone", "system"];
export type ScreenRecordingAudioMode = (typeof SCREEN_RECORDING_AUDIO_MODES)[number];
export const SCREEN_RECORDING_STATES: readonly ["idle", "arming", "recording", "paused", "stopping", "prepared", "failed"];
export type ScreenRecordingState = (typeof SCREEN_RECORDING_STATES)[number];
export const SCREEN_RECORDING_LIMITS: Readonly<{
  sourceTokenTtlMs: number;
  armTtlMs: number;
  maxSources: number;
  maxLabelChars: number;
  maxThumbnailChars: number;
}>;
export const SCREEN_RECORDING_MIME_CANDIDATES: readonly string[];
export const SCREEN_RECORDING_BITRATES: Readonly<{ videoBitsPerSecond: number; audioBitsPerSecond: number }>;
export function screenRecordingContainerOf(recorderMimeType: unknown): "video/mp4" | "video/webm";

export interface ScreenRecordingSourceProjection {
  sourceToken: string;
  kind: ScreenRecordingSourceKind;
  label: string;
  thumbnailDataUrl: string;
  expiresAt: string;
}

export interface ScreenRecordingArmRequest {
  sourceToken: string;
  audioMode: ScreenRecordingAudioMode;
  includePointer: boolean;
}

export interface ScreenRecordingCapabilities {
  screen: true;
  window: true;
  microphone: boolean;
  systemAudio: boolean;
  recorderMimeType: string | null;
}

export interface ScreenRecordingEnvironment {
  screen: true;
  window: true;
  microphone: true;
  systemAudio: boolean;
  systemAudioReason: string | null;
  mimeCandidates: readonly string[];
  availableRecordingBytes: number;
  maxRecordingBytes: number;
}

export interface ArmedScreenRecordingProjection {
  armed: true;
  kind: ScreenRecordingSourceKind;
  label: string;
  audioMode: ScreenRecordingAudioMode;
  includePointer: boolean;
  expiresAt: string;
}

export interface ScreenRecordingGrantContext {
  sourceToken: string;
  senderWebContentsId: number;
  frameTreeNodeId: number;
  securityOrigin: string;
  expiresAtMs: number;
  consumed: boolean;
  audioMode: ScreenRecordingAudioMode;
}

export interface ScreenRecordingGrantRequest {
  senderWebContentsId: number;
  frameTreeNodeId: number;
  frameIsMain: boolean;
  frameDetached: boolean;
  securityOrigin: string;
  userGesture: boolean;
  videoRequested: boolean;
  audioRequested: boolean;
}

export interface AuthorizedScreenRecordingGrant {
  sourceToken: string;
  displayAudio: "loopback" | null;
  microphoneRequired: boolean;
}

export function sanitizeScreenRecordingSourceLabel(value: unknown, kind: ScreenRecordingSourceKind): string;
export function normalizeScreenRecordingSecurityOrigin(value: unknown): string;
export function screenRecordingOriginsMatch(requestOrigin: unknown, frameOrigin: unknown): boolean;
export function validateScreenRecordingSourceProjection(value: unknown): Readonly<ScreenRecordingSourceProjection>;
export function parseScreenRecordingArmRequest(value: unknown): Readonly<ScreenRecordingArmRequest>;
export function buildScreenRecordingCapabilities(value: unknown): Readonly<ScreenRecordingCapabilities>;
export function parseScreenRecordingGrantContext(value: unknown): Readonly<ScreenRecordingGrantContext>;
export function authorizeScreenRecordingGrant(
  context: unknown,
  request: unknown,
  nowMs: unknown,
): Readonly<AuthorizedScreenRecordingGrant>;
