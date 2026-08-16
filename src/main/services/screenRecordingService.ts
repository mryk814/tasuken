import type { DesktopCapturerSource } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  SCREEN_RECORDING_LIMITS,
  SCREEN_RECORDING_MIME_CANDIDATES,
  parseScreenRecordingRegionSelection,
  type ScreenRecordingArmRequest,
  type ScreenRecordingSourceProjection,
  type ScreenRecordingRegionSelection,
} from "../../shared/screenRecording.mjs";
import { IPC } from "../../shared/ipc/contracts";
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
  region?: ScreenRecordingRegionSelection;
}

type DesktopSourceProvider = (types: Array<"screen" | "window">) => Promise<DesktopCapturerSource[]>;

export class ScreenRecordingService {
  private readonly registry: ScreenRecordingGrantRegistry;
  private readonly platform: NodeJS.Platform;
  private readonly getSources: DesktopSourceProvider;
  private regionSelectionActive = false;
  private regionIndicatorWindow: Electron.BrowserWindow | null = null;
  private regionIndicatorKey = "";

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

  async applyRegionIndicator(value: unknown): Promise<boolean> {
    const { BrowserWindow, screen } = await import("electron");
    if (value === null || value === undefined) {
      this.closeRegionIndicator();
      return false;
    }
    const region = parseScreenRecordingRegionSelection(value);
    const display = screen.getDisplayNearestPoint({ x: region.rectDip.x, y: region.rectDip.y });
    if (!display) throw new Error("録画範囲を表示する画面が見つかりません。");
    const bounds = display.bounds;
    const left = region.rectDip.x - bounds.x;
    const top = region.rectDip.y - bounds.y;
    if (left < 0 || top < 0 || left + region.rectDip.width > bounds.width || top + region.rectDip.height > bounds.height) {
      throw new Error("録画範囲を表示する画面の情報が変わりました。範囲を選び直してください。");
    }
    const key = [String(display.id), left, top, region.rectDip.width, region.rectDip.height].join(":");
    if (this.regionIndicatorWindow && !this.regionIndicatorWindow.isDestroyed() && this.regionIndicatorKey === key) return true;
    this.closeRegionIndicator();
    const indicator = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      hasShadow: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    indicator.setContentProtection(true);
    indicator.setIgnoreMouseEvents(true);
    indicator.setAlwaysOnTop(true, "screen-saver");
    this.regionIndicatorWindow = indicator;
    this.regionIndicatorKey = key;
    indicator.once("closed", () => {
      if (this.regionIndicatorWindow === indicator) {
        this.regionIndicatorWindow = null;
        this.regionIndicatorKey = "";
      }
    });
    const query = new URLSearchParams({
      mode: "indicator",
      left: String(left),
      top: String(top),
      width: String(region.rectDip.width),
      height: String(region.rectDip.height),
    });
    const target = process.env.ELECTRON_RENDERER_URL
      ? `${process.env.ELECTRON_RENDERER_URL}/region-selector.html?${query.toString()}`
      : path.join(__dirname, "../renderer/region-selector.html");
    if (process.env.ELECTRON_RENDERER_URL) await indicator.loadURL(target);
    else await indicator.loadFile(target, { query: Object.fromEntries(query) });
    if (!indicator.isDestroyed()) indicator.showInactive();
    return true;
  }

  async selectRegion(request: unknown, context: ScreenRecordingRequestContext): Promise<ScreenRecordingRegionSelection | null> {
    const { BrowserWindow, ipcMain, screen } = await import("electron");
    if (this.regionSelectionActive) throw new Error("録画範囲の選択が既に開いています。先に完了してください。");
    if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some((key) => key !== "sourceToken")) {
      throw new Error("録画範囲の選択requestが不正です。");
    }
    const sourceToken = (request as { sourceToken?: unknown }).sourceToken;
    const resolved = this.registry.resolveRegionSource(sourceToken, context);
    const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === resolved.displayId);
    if (!display) throw new Error("選択した画面の表示情報を確認できません。録画対象を更新してください。");
    if (display.rotation !== 0) throw new Error("回転した画面では範囲録画を利用できません。画面全体を選択してください。");
    const bounds = display.bounds;
    const selector = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, "../preload/regionSelector.mjs"),
      },
    });
    selector.setBounds(bounds, false);
    selector.setContentProtection(true);
    selector.setAlwaysOnTop(true, "screen-saver");
    this.regionSelectionActive = true;
    try {
      const result = await new Promise<{ cancelled: boolean; start?: { x: number; y: number }; end?: { x: number; y: number } }>((resolve, reject) => {
        let settled = false;
        const finish = (value: { cancelled: boolean; start?: { x: number; y: number }; end?: { x: number; y: number } }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ipcMain.removeListener(IPC.screenRecordingRegionResult, onResult);
          resolve(value);
        };
        const onResult = (event: Electron.IpcMainEvent, value: unknown) => {
          if (event.sender.id !== selector.webContents.id) return;
          if (!value || typeof value !== "object" || Array.isArray(value)) return finish({ cancelled: true });
          const input = value as Record<string, unknown>;
          if (input.cancelled === true) return finish({ cancelled: true });
          const normalizePoint = (candidate: unknown) => {
            if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
            const { x, y } = candidate as Record<string, unknown>;
            if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
            return { x: Number(x), y: Number(y) };
          };
          const start = normalizePoint(input.start);
          const end = normalizePoint(input.end);
          finish(start && end ? { cancelled: false, start, end } : { cancelled: true });
        };
        const timer = setTimeout(() => finish({ cancelled: true }), 120_000);
        ipcMain.on(IPC.screenRecordingRegionResult, onResult);
        selector.once("closed", () => finish({ cancelled: true }));
        const target = process.env.ELECTRON_RENDERER_URL
          ? `${process.env.ELECTRON_RENDERER_URL}/region-selector.html`
          : path.join(__dirname, "../renderer/region-selector.html");
        const loading = process.env.ELECTRON_RENDERER_URL ? selector.loadURL(target) : selector.loadFile(target);
        loading.then(
          () => {
            if (selector.isDestroyed()) return;
            selector.setIgnoreMouseEvents(false);
            selector.show();
            selector.focus();
            selector.webContents.focus();
          },
          (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            ipcMain.removeListener(IPC.screenRecordingRegionResult, onResult);
            reject(error);
          },
        );
      });
      if (result.cancelled || !result.start || !result.end) return null;
      const left = Math.min(result.start.x, result.end.x);
      const top = Math.min(result.start.y, result.end.y);
      const right = Math.max(result.start.x, result.end.x);
      const bottom = Math.max(result.start.y, result.end.y);
      const width = right - left;
      const height = bottom - top;
      if (width < 64 || height < 64) throw new Error("録画範囲は64×64以上で選択してください。");
      if (left < 0 || top < 0 || right > bounds.width || bottom > bounds.height) throw new Error("録画範囲を1つの画面内に収めてください。");
      const frameSizePx = {
        width: Math.round(bounds.width * display.scaleFactor),
        height: Math.round(bounds.height * display.scaleFactor),
      };
      const cropPx = {
        x: Math.floor(left * display.scaleFactor),
        y: Math.floor(top * display.scaleFactor),
        width: Math.ceil(right * display.scaleFactor) - Math.floor(left * display.scaleFactor),
        height: Math.ceil(bottom * display.scaleFactor) - Math.floor(top * display.scaleFactor),
      };
      return this.registry.bindRegionSelection(sourceToken, Object.freeze({
        rectDip: { x: bounds.x + left, y: bounds.y + top, width, height },
        cropPx,
        frameSizePx,
      }), context);
    } finally {
      this.regionSelectionActive = false;
      if (!selector.isDestroyed()) selector.close();
    }
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
      ...(grant.region ? { region: grant.region } : {}),
    });
  }

  clearSender(senderWebContentsId: number): void {
    this.registry.clearSender(senderWebContentsId);
  }

  private closeRegionIndicator(): void {
    const indicator = this.regionIndicatorWindow;
    this.regionIndicatorWindow = null;
    this.regionIndicatorKey = "";
    if (indicator && !indicator.isDestroyed()) indicator.close();
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
      displayId: kind === "screen" ? (source.display_id || null) : null,
      kind,
      label: source.name,
      thumbnailDataUrl,
    };
  }
}
