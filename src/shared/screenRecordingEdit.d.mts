export const SCREEN_RECORDING_EDIT_SCHEMA_VERSION: 1;
export const SCREEN_RECORDING_MIN_REGION_DIP: 64;
export const SCREEN_RECORDING_MAX_DURATION_MS: number;
export const SCREEN_RECORDING_MAX_ARTIFACT_VERSION: 1_000_000;

export const SCREEN_RECORDING_EDIT_ERROR_CODES: readonly [
  "INVALID_REQUEST",
  "DISPLAY_TOPOLOGY_MISMATCH",
  "DISPLAY_TOPOLOGY_AMBIGUOUS",
  "CROSS_DISPLAY_REGION",
  "REGION_TOO_SMALL",
  "DISPLAY_ROTATION_UNSUPPORTED",
  "PIXEL_MAPPING_OUT_OF_BOUNDS",
  "CAPABILITY_UNAVAILABLE",
  "CAPTURE_SURFACE_NOT_EXCLUDED",
  "SOURCE_BINDING_MISMATCH",
  "SOURCE_REVISION_MISMATCH",
  "INVALID_TRIM_RANGE",
  "SOURCE_OVERWRITE_FORBIDDEN",
  "NO_TRIM_APPLIED",
];

export type ScreenRecordingEditErrorCode = typeof SCREEN_RECORDING_EDIT_ERROR_CODES[number];

export class ScreenRecordingEditError extends Error {
  readonly code: ScreenRecordingEditErrorCode;
  constructor(code: ScreenRecordingEditErrorCode);
}

export type PointDip = Readonly<{ x: number; y: number }>;
export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type Size = Readonly<{ width: number; height: number }>;

export type DisplayBinding = Readonly<{
  displayId: string;
  topologyRevision: string;
  boundsDip: Rect;
  scaleFactor: number;
  frameSizePx: Size;
  rotationDeg: 0 | 90 | 180 | 270;
}>;

export type FullDisplayCaptureArea = Readonly<{
  schemaVersion: 1;
  kind: "full_display";
  sourceRevision: string;
  display: DisplayBinding;
}>;

export type WindowCaptureArea = Readonly<{
  schemaVersion: 1;
  kind: "window";
  sourceRevision: string;
}>;

export type RegionCaptureArea = Readonly<{
  schemaVersion: 1;
  kind: "region";
  sourceRevision: string;
  display: DisplayBinding;
  rectDip: Rect;
  cropPx: Rect;
}>;

export type CaptureArea = FullDisplayCaptureArea | WindowCaptureArea | RegionCaptureArea;

export type GrantedSourceRevisionBinding = Readonly<{
  sourceToken: string;
  sourceKind: "screen" | "window";
  sourceRevision: string;
  listSnapshotRevision: string;
  topologyRevision: string | null;
}>;

export function createGrantedSourceRevisionBinding(input: GrantedSourceRevisionBinding): GrantedSourceRevisionBinding;

export function createDisplayCaptureArea(input: {
  display: DisplayBinding;
  sourceRevision: string;
}): FullDisplayCaptureArea;

export function createWindowCaptureArea(input: {
  sourceRevision: string;
}): WindowCaptureArea;

export function createRegionCaptureArea(input: {
  topologyRevision: string;
  sourceRevision: string;
  displays: readonly DisplayBinding[];
  dragStartDip: PointDip;
  dragEndDip: PointDip;
}): RegionCaptureArea;

export type ScreenRecordingAreaRequest =
  | Readonly<{
    kind: "window";
    sourceToken: string;
    sourceRevision: string;
  }>
  | Readonly<{
    kind: "full_display";
    sourceToken: string;
    sourceRevision: string;
    topologyRevision: string;
  }>
  | Readonly<{
    kind: "region";
    sourceToken: string;
    sourceRevision: string;
    topologyRevision: string;
    rectDip: Rect;
  }>;

export type ScreenRecordingStartRequest = Readonly<{
  area: ScreenRecordingAreaRequest;
  audioMode: "off" | "microphone" | "system";
  includePointer: boolean;
}>;

export type ScreenRecordingCurrentPreflight = Readonly<{
  sourceBinding: GrantedSourceRevisionBinding;
  area: CaptureArea;
  capabilities: Readonly<{
    microphone: boolean;
    systemAudio: boolean;
    regionCrop: boolean;
    ownWindowExclusion: boolean;
    pointerCapture: boolean;
  }>;
  exclusionProof: Readonly<{
    selectionOverlay: "hidden";
    controlDock: "excluded";
    sourceRevision: string;
    topologyRevision: string | null;
  }>;
}>;

export type ScreenRecordingStartPlan = Readonly<{
  schemaVersion: 1;
  kind: "screen_recording_start";
  area: CaptureArea;
  sourceBinding: GrantedSourceRevisionBinding;
  settings: Readonly<{ audioMode: "off" | "microphone" | "system"; includePointer: boolean }>;
  exclusionProof: Readonly<{
    selectionOverlay: "hidden";
    controlDock: "excluded";
    sourceRevision: string;
    topologyRevision: string | null;
  }>;
}>;

export function parseScreenRecordingStartRequest(value: unknown): ScreenRecordingStartRequest;
export function createScreenRecordingStartPlan(
  request: ScreenRecordingStartRequest,
  currentPreflight: ScreenRecordingCurrentPreflight,
): ScreenRecordingStartPlan;

export type VideoSourceRevision = Readonly<{
  artifactId: string;
  artifactVersion: number;
  contentHash: string;
  durationMs: number;
  widthPx: number;
  heightPx: number;
}>;

export type TrimPlan = Readonly<{
  schemaVersion: 1;
  kind: "non_destructive_trim";
  source: VideoSourceRevision;
  startMs: number;
  endMs: number;
}>;

export function createTrimPlan(input: {
  source: VideoSourceRevision;
  startMs: number;
  endMs: number;
}): TrimPlan;

export function resetTrimPlan(source: VideoSourceRevision): TrimPlan;
declare const mainOwnedCurrentVideoSourceBrand: unique symbol;
export type MainOwnedCurrentVideoSource = VideoSourceRevision & Readonly<{
  [mainOwnedCurrentVideoSourceBrand]: true;
}>;
export function createMainOwnedCurrentVideoSource(value: unknown): MainOwnedCurrentVideoSource;
export function assertTrimPlanCurrent(plan: TrimPlan, currentSource: MainOwnedCurrentVideoSource): TrimPlan;

export type TrimExportRequest = Readonly<{
  operationId: string;
  destinationArtifactId: string;
  trimPlan: TrimPlan;
}>;

export function parseTrimExportRequest(value: unknown): TrimExportRequest;

export type TrimExportPlan = Readonly<{
  schemaVersion: 1;
  kind: "trim_export";
  operationId: string;
  source: VideoSourceRevision;
  trim: Readonly<{ startMs: number; endMs: number }>;
  destination: Readonly<{
    artifactId: string;
    storageMode: "managed";
    mediaKind: "video";
    relation: "derived_from";
  }>;
}>;

export function createTrimExportPlan(
  request: TrimExportRequest,
  currentSource: MainOwnedCurrentVideoSource,
): TrimExportPlan;
