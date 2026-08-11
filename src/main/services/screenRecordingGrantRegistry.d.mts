import type {
  ScreenRecordingArmRequest,
  ScreenRecordingAudioMode,
  ScreenRecordingSourceKind,
  ScreenRecordingSourceProjection,
  ScreenRecordingRegionSelection,
} from "../../shared/screenRecording.mjs";

export interface InternalScreenRecordingSource {
  internalSourceId: string;
  kind: ScreenRecordingSourceKind;
  label: string;
  thumbnailDataUrl: string;
  displayId?: string | null;
}

export interface ScreenRecordingRequestContext {
  senderWebContentsId: number;
  frameTreeNodeId: number;
  securityOrigin: string;
  isMainFrame: boolean;
  detached: boolean;
}

export interface ArmedScreenRecording {
  armed: true;
  kind: ScreenRecordingSourceKind;
  label: string;
  audioMode: ScreenRecordingAudioMode;
  includePointer: boolean;
  expiresAt: string;
  region?: ScreenRecordingRegionSelection;
}

export interface ConsumedScreenRecordingGrant {
  internalSourceId: string;
  kind: ScreenRecordingSourceKind;
  label: string;
  includePointer: boolean;
  displayAudio: "loopback" | null;
  microphoneRequired: boolean;
  region?: ScreenRecordingRegionSelection;
}

export class ScreenRecordingGrantRegistry {
  constructor(options: { idFactory: () => string; getCapabilities: () => { microphone: boolean; systemAudio: boolean }; nowMs?: () => number; platform?: NodeJS.Platform });
  issueSources(sources: InternalScreenRecordingSource[], context: ScreenRecordingRequestContext): readonly Readonly<ScreenRecordingSourceProjection>[];
  arm(request: ScreenRecordingArmRequest, context: ScreenRecordingRequestContext): Readonly<ArmedScreenRecording>;
  resolveRegionSource(sourceToken: unknown, context: ScreenRecordingRequestContext): Readonly<{ displayId: string; sourceToken: string }>;
  bindRegionSelection(sourceToken: unknown, region: ScreenRecordingRegionSelection, context: ScreenRecordingRequestContext): Readonly<ScreenRecordingRegionSelection>;
  consumeDisplayRequest(request: {
    senderWebContentsId: number;
    frameTreeNodeId: number;
    frameIsMain: boolean;
    frameDetached: boolean;
    securityOrigin: string;
    userGesture: boolean;
    videoRequested: boolean;
    audioRequested: boolean;
  }): Readonly<ConsumedScreenRecordingGrant>;
  clearSender(senderWebContentsId: number): void;
  prune(nowMs?: number): void;
}
