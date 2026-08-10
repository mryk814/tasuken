import type {
  ScreenRecordingArmRequest,
  ScreenRecordingAudioMode,
  ScreenRecordingSourceKind,
  ScreenRecordingSourceProjection,
} from "../../shared/screenRecording.mjs";

export interface InternalScreenRecordingSource {
  internalSourceId: string;
  kind: ScreenRecordingSourceKind;
  label: string;
  thumbnailDataUrl: string;
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
}

export interface ConsumedScreenRecordingGrant {
  internalSourceId: string;
  kind: ScreenRecordingSourceKind;
  label: string;
  includePointer: boolean;
  displayAudio: "loopback" | null;
  microphoneRequired: boolean;
}

export class ScreenRecordingGrantRegistry {
  constructor(options: { idFactory: () => string; getCapabilities: () => { microphone: boolean; systemAudio: boolean }; nowMs?: () => number; platform?: NodeJS.Platform });
  issueSources(sources: InternalScreenRecordingSource[], context: ScreenRecordingRequestContext): readonly Readonly<ScreenRecordingSourceProjection>[];
  arm(request: ScreenRecordingArmRequest, context: ScreenRecordingRequestContext): Readonly<ArmedScreenRecording>;
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
