import type { DesktopCapturerSource } from "electron";
import { randomUUID } from "node:crypto";

import {
  SCREEN_RECORDING_LIMITS,
  SCREEN_RECORDING_MIME_CANDIDATES,
  type ScreenRecordingArmRequest,
  type ScreenRecordingSourceProjection,
} from "../../shared/screenRecording.mjs";
import {
  ScreenRecordingGrantRegistry,
  type ScreenRecordingRequestContext,
} from "./screenRecordingGrantRegistry.mjs";

// Taskenはhardware accelerationを無効化しているため、WGCを起動するsource thumbnailは要求しない。
// Electron公式契約の幅0で列挙だけを行い、window iconまたはbounded placeholderを投影する。
const THUMBNAIL_SIZE = Object.freeze({ width: 0, height: 135 });
const EMPTY_THUMBNAIL_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XK4PPwAAAABJRU5ErkJggg==";

export interface ScreenRecordingEnvironment {
  screen: true;
  window: true;
  microphone: true;
  systemAudio: boolean;
  systemAudioReason: string | null;
  mimeCandidates: readonly string[];
}

export interface ScreenRecordingPermissionRequest {
  senderWebContentsId: number;
  frameTreeNodeId: number;
  frameIsMain: boolean;
  frameDetached: boolean;
  securityOrigin: string;
  userGesture: boolean;
  videoRequested: boolean;
  audioRequested: boolean;
}

export interface ResolvedScreenRecordingGrant {
  source: DesktopCapturerSource;
  includePointer: boolean;
  displayAudio: "loopback" | null;
  microphoneRequired: boolean;
}

type DesktopSourceProvider = (types: Array<"screen" | "window">) => Promise<DesktopCapturerSource[]>;

export class ScreenRecordingService {
  private readonly registry: ScreenRecordingGrantRegistry;
  private readonly platform: NodeJS.Platform;
  private readonly getSources: DesktopSourceProvider;

  constructor(options: {
    idFactory?: () => string;
    nowMs?: () => number;
    platform?: NodeJS.Platform;
    getSources?: DesktopSourceProvider;
  } = {}) {
    this.platform = options.platform || process.platform;
    this.getSources = options.getSources || (async (types) => {
      const { desktopCapturer } = await import("electron");
      return desktopCapturer.getSources({
        types,
        thumbnailSize: THUMBNAIL_SIZE,
        fetchWindowIcons: true,
      });
    });
    this.registry = new ScreenRecordingGrantRegistry({
      idFactory: options.idFactory || randomUUID,
      nowMs: options.nowMs,
      platform: this.platform,
      getCapabilities: () => ({ microphone: true, systemAudio: this.platform === "win32" }),
    });
  }

  capabilities(): Readonly<ScreenRecordingEnvironment> {
    const systemAudio = this.platform === "win32";
    return Object.freeze({
      screen: true,
      window: true,
      microphone: true,
      systemAudio,
      systemAudioReason: systemAudio ? null : "システム音声はWindows版Taskenでのみ利用できます。",
      mimeCandidates: SCREEN_RECORDING_MIME_CANDIDATES,
    });
  }

  async listSources(context: ScreenRecordingRequestContext): Promise<readonly Readonly<ScreenRecordingSourceProjection>[]> {
    // Windows Graphics Captureを同時に複数起動するとsource列挙自体が失敗し得るため、
    // display topologyはscreen/windowを一度のElectron呼び出しでsnapshotする。
    const sources = await this.getSources(["screen", "window"]);
    const internal = sources
      .map((source) => this.toInternalSource(source, this.sourceKind(source)))
      .slice(0, SCREEN_RECORDING_LIMITS.maxSources);
    return this.registry.issueSources(internal, context);
  }

  arm(request: ScreenRecordingArmRequest, context: ScreenRecordingRequestContext) {
    return this.registry.arm(request, context);
  }

  async consumePermissionRequest(request: ScreenRecordingPermissionRequest): Promise<ResolvedScreenRecordingGrant> {
    const grant = this.registry.consumeDisplayRequest(request);
    const sources = await this.getSources(["screen", "window"]);
    const source = sources.find((candidate) => candidate.id === grant.internalSourceId);
    if (!source || this.sourceKind(source) !== grant.kind) throw new Error("選択した録画対象が閉じられました。もう一度選択してください。");
    return Object.freeze({
      source,
      includePointer: grant.includePointer,
      displayAudio: grant.displayAudio,
      microphoneRequired: grant.microphoneRequired,
    });
  }

  clearSender(senderWebContentsId: number): void {
    this.registry.clearSender(senderWebContentsId);
  }

  private sourceKind(source: DesktopCapturerSource): "screen" | "window" {
    if (source.id.startsWith("screen:")) return "screen";
    if (source.id.startsWith("window:")) return "window";
    throw new Error("画面録画source kindを確認できませんでした。");
  }

  private toInternalSource(source: DesktopCapturerSource, kind: "screen" | "window") {
    const projectedImage = source.thumbnail.isEmpty() && source.appIcon && !source.appIcon.isEmpty()
      ? source.appIcon
      : source.thumbnail;
    let thumbnailDataUrl = projectedImage.isEmpty() ? EMPTY_THUMBNAIL_DATA_URL : projectedImage.toDataURL();
    if (thumbnailDataUrl.length > SCREEN_RECORDING_LIMITS.maxThumbnailChars) {
      thumbnailDataUrl = projectedImage.resize({ width: 160, height: 90, quality: "good" }).toDataURL();
    }
    if (thumbnailDataUrl.length > SCREEN_RECORDING_LIMITS.maxThumbnailChars) {
      thumbnailDataUrl = EMPTY_THUMBNAIL_DATA_URL;
    }
    return {
      internalSourceId: source.id,
      kind,
      label: source.name,
      thumbnailDataUrl,
    };
  }
}
