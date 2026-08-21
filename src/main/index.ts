import { app, BrowserWindow, globalShortcut, ipcMain, Menu, net, safeStorage, session as electronSession, shell, webContents } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { registerIpc } from "./ipc/registerIpc";
import { registerAttachmentProtocol, registerAttachmentScheme } from "./attachmentProtocol";
import { registerMediaProtocol, registerMediaScheme } from "./mediaProtocol";
import { registerWebArtifactProtocol, registerWebArtifactScheme } from "./webArtifactProtocol";
import { getAppIconPath, migrateLegacyUserDataIfNeeded } from "./platformPaths";
import {
  createQuickCaptureController,
  type QuickCaptureController,
} from "./quickCaptureController";
import { createReminderController, type ReminderController } from "./reminderController";
import { createTodayMiniController, type TodayMiniController } from "./todayMiniController";
import { createSatelliteWindowRegistry, type SatelliteWindowRegistry } from "./satelliteWindowRegistry";
import { createMemoStickyController, type MemoStickyController } from "./memoStickyController";
import { createNoteWindowController, type NoteWindowController } from "./noteWindowController";
import { createTrayController, type TrayController } from "./trayController";
import { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { TaskenCoreRuntime } from "./composition/taskenCoreRuntime.ts";
import { TaskenCoreClient } from "./mcp/taskenCoreClient.mjs";
import { BatchTranscriptionRepository } from "./repositories/batchTranscriptionRepository.mjs";
import { WorkspaceService } from "./services/workspaceService";
import { AiProviderService } from "./services/aiProviderService";
import { BatchTranscriptionService } from "./services/batchTranscriptionService.mjs";
import { CalendarService } from "./services/calendarService";
import { SharedFolderSyncService } from "./services/sharedFolderSync.mjs";
import { AutomaticSnapshotBackupService } from "./services/automaticSnapshotBackup";
import { createSnapshot, readSnapshot } from "./services/snapshotService.mjs";
import { acquireSmokeClipboardLock } from "./smokeClipboardLock.mjs";
import type { Entity, EntityType } from "../shared/types/workspace";
import { validateMcpPackageSmokeRoot } from "../shared/taskenPaths.mjs";
import { ApplicationCommandService } from "./services/applicationCommandService";
import { MediaCaptureService } from "./services/mediaCaptureService";
import { ScreenRecordingService } from "./services/screenRecordingService";
import { commandNotificationPayloads } from "./rendererMediaProjection";
import { configureMainLog, logMain } from "./log";
import { createRecordingIndicatorController } from "./recordingIndicatorController";
import { createTaskenRootController, type TaskenRootController } from "./taskenRootController";
import { screenRecordingOriginsMatch } from "../shared/screenRecording.mjs";
import type { CommandReceipt } from "../shared/applicationCommand";
import { IPC, type RootOpenRequest, type SatelliteWindowStatePayload, type WorkspaceChangePayload } from "../shared/ipc/contracts";
import { resolveAiVisibility } from "../shared/aiMetadata.mjs";
import { DIRECT_SHORTCUT_DEFINITIONS } from "../shared/taskenRoot";

const isSmokeTest = process.argv.includes("--smoke-test");
const isMcpPackageSmoke = process.argv.includes("--mcp-package-smoke");
const isMcpPackageSmokeVerifyOnly = process.argv.includes("--mcp-package-smoke-verify-only");
const mcpPackageSmokeResultArgument = process.argv.find((argument) => argument.startsWith("--mcp-package-smoke-result-path="));
const mcpPackageSmokeResultPath = mcpPackageSmokeResultArgument?.slice("--mcp-package-smoke-result-path=".length) || "";
const mcpPackageSmokeProposalArgument = process.argv.find((argument) => argument.startsWith("--mcp-package-smoke-proposal-id="));
const mcpPackageSmokeProposalId = mcpPackageSmokeProposalArgument?.slice("--mcp-package-smoke-proposal-id=".length) || "";
const mcpPackageSmokeMarkerArgument = process.argv.find((argument) => argument.startsWith("--mcp-package-smoke-marker="));
const mcpPackageSmokeMarker = mcpPackageSmokeMarkerArgument?.slice("--mcp-package-smoke-marker=".length) || "";
const userDataArgument = process.argv.find((argument) => argument.startsWith("--user-data-dir="));
const requestedUserDataPath = userDataArgument?.slice("--user-data-dir=".length);
const smokeRunArgument = process.argv.find((argument) => argument.startsWith("--smoke-run-id="));
const smokeRunId = smokeRunArgument?.slice("--smoke-run-id=".length).replace(/[^a-zA-Z0-9_-]/g, "_") || String(process.pid);
const smokeResultArgument = process.argv.find((argument) => argument.startsWith("--smoke-result-path="));
const smokeResultPath = path.resolve(smokeResultArgument?.slice("--smoke-result-path=".length) || path.join(os.tmpdir(), `tasken-smoke-${smokeRunId}-result.json`));
const isSmokeRestartCheck = process.argv.includes("--smoke-restart-check");
const isPackagedSmokeRequired = process.argv.includes("--smoke-require-packaged");
const smokeMediaArtifactArgument = process.argv.find((argument) => argument.startsWith("--smoke-media-artifact-id="));
const smokeMediaArtifactId = smokeMediaArtifactArgument?.slice("--smoke-media-artifact-id=".length) || "";
const smokeMicrophoneArtifactArgument = process.argv.find((argument) => argument.startsWith("--smoke-microphone-artifact-id="));
const smokeMicrophoneArtifactId = smokeMicrophoneArtifactArgument?.slice("--smoke-microphone-artifact-id=".length) || "";
const smokeImportedVideoArtifactArgument = process.argv.find((argument) => argument.startsWith("--smoke-imported-video-artifact-id="));
const smokeImportedVideoArtifactId = smokeImportedVideoArtifactArgument?.slice("--smoke-imported-video-artifact-id=".length) || "";
const smokeScreenRecordingArtifactArgument = process.argv.find((argument) => argument.startsWith("--smoke-screen-recording-artifact-id="));
const smokeScreenRecordingArtifactId = smokeScreenRecordingArtifactArgument?.slice("--smoke-screen-recording-artifact-id=".length) || "";
const smokeVideoOwnerArgument = process.argv.find((argument) => argument.startsWith("--smoke-video-owner-id="));
const smokeVideoOwnerId = smokeVideoOwnerArgument?.slice("--smoke-video-owner-id=".length) || "";
const smokeScreenRecordingPausedResumed = process.argv.includes("--smoke-screen-recording-paused-resumed");
if (isSmokeTest && !isSmokeRestartCheck) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}
const APP_NAME = "Tasken";
const MAIN_WINDOW_DEFAULT_WIDTH = 1760;
const MAIN_WINDOW_DEFAULT_HEIGHT = 1024;
let workspaceRepository: InstanceType<typeof WorkspaceDatabase>;
let trayController: TrayController | null = null;
let quickCaptureController: QuickCaptureController | null = null;
let todayMiniController: TodayMiniController | null = null;
let reminderController: ReminderController | null = null;
let satelliteWindows: SatelliteWindowRegistry | null = null;
let memoStickyController: MemoStickyController | null = null;
let noteWindowController: NoteWindowController | null = null;
let taskenRootController: TaskenRootController | null = null;
let sharedFolderSyncService: SharedFolderSyncService | null = null;
let taskenCoreRuntime: TaskenCoreRuntime | null = null;
let smokeMediaCaptureService: MediaCaptureService | null = null;
let smokeVideoSourcePath = "";
let lastSmokeStage = "startup";
const smokeTrace: string[] = [];
const readyMainWindows = new WeakSet<BrowserWindow>();
let appQuitApproved = false;
let appFlushPending = false;
const pendingAppFlushes = new Map<string, {
  senderId: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (ok: boolean) => void;
}>();
registerAttachmentScheme();
registerMediaScheme();
registerWebArtifactScheme();

function requestRendererFlush(window: BrowserWindow, noteId?: string): Promise<boolean> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve(true);
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const pending = pendingAppFlushes.get(requestId);
      if (!pending) return;
      pendingAppFlushes.delete(requestId);
      resolve(false);
    }, 10_000);
    pendingAppFlushes.set(requestId, { senderId: window.webContents.id, timer, resolve });
    try {
      window.webContents.send(IPC.appFlushRequested, { requestId, noteId });
    } catch {
      pendingAppFlushes.delete(requestId);
      clearTimeout(timer);
      resolve(false);
    }
  });
}

ipcMain.handle(IPC.appFlushAck, (event, payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  if (typeof value.requestId !== "string" || typeof value.ok !== "boolean") return false;
  const pending = pendingAppFlushes.get(value.requestId);
  if (!pending || pending.senderId !== event.sender.id) return false;
  pendingAppFlushes.delete(value.requestId);
  clearTimeout(pending.timer);
  pending.resolve(value.ok);
  return true;
});

function openAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) return false;
    void shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

function showMainContextMenu(window: BrowserWindow, params: Electron.ContextMenuParams): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(quickCaptureController?.menuItems() || []),
  ];
  if (params.isEditable) {
    template.push(
      { type: "separator" },
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    );
  } else if (params.selectionText) {
    template.push(
      { type: "separator" },
      { role: "copy" },
    );
  }
  Menu.buildFromTemplate(template).popup({ window });
}

/**
 * 既定メニューの Ctrl+R（再読み込み）を外し、Markdown Editorの置換へ譲る（#286）。
 * 再読み込みは Ctrl+Shift+R、開発者ツールは F12 の開発者向け操作として残す。
 */
function applyApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "編集",
      submenu: [
        { role: "undo", label: "元に戻す" },
        { role: "redo", label: "やり直す" },
        { type: "separator" },
        { role: "cut", label: "切り取り" },
        { role: "copy", label: "コピー" },
        { role: "paste", label: "貼り付け" },
        { role: "selectAll", label: "すべて選択" },
      ],
    },
    {
      label: "表示",
      submenu: [
        { role: "forceReload", accelerator: "CmdOrCtrl+Shift+R", label: "再読み込み" },
        { role: "toggleDevTools", accelerator: "F12", label: "開発者ツール" },
        { type: "separator" },
        { role: "resetZoom", label: "拡大率をリセット" },
        { role: "zoomIn", label: "拡大" },
        { role: "zoomOut", label: "縮小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全画面表示" },
      ],
    },
  ]));
}

/**
 * 本体ウィンドウ以外の補助ウィンドウか。
 * 補助ウィンドウを増やすたびに各所の除外条件へ書き足すと漏れるので、判定はここだけに置く。
 * 切り離しウィンドウ（#290 / #298）は registry へ問い合わせる。
 */
function isAuxiliaryWindow(win: BrowserWindow): boolean {
  if (win === taskenRootController?.getWindow()) return true;
  if (win === quickCaptureController?.getWindow()) return true;
  if (win === todayMiniController?.getWindow()) return true;
  return satelliteWindows?.has(win) === true;
}

function isVisibleWindow(win: BrowserWindow | null): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible());
}

/** 開いている付箋の一覧を本体へ配る。本体側で「付箋表示中」を区別するために使う（#298）。 */
function notifyMemoStickyWindowsChanged(): void {
  const openMemoIds = memoStickyController?.visibleMemoIds() || [];
  const stickyMemoIds = memoStickyController?.stickyMemoIds() || [];
  const alwaysOnTopMemoIds = memoStickyController?.alwaysOnTopMemoIds() || [];
  const openNoteIds = noteWindowController?.openNoteIds() || [];
  const state: SatelliteWindowStatePayload = {
    todayOpen: isVisibleWindow(todayMiniController?.getWindow() || null),
    openMemoIds,
    stickyMemoIds,
    alwaysOnTopMemoIds,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (isAuxiliaryWindow(win) || win.isDestroyed() || win.webContents.isLoading()) continue;
    win.webContents.send(IPC.noteWindowOpenChanged, openNoteIds);
    win.webContents.send(IPC.satelliteWindowState, state);
  }
}

function notifyMainWindowRefresh(change?: WorkspaceChangePayload): void {
  const todayMiniWindow = todayMiniController?.getWindow();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!isAuxiliaryWindow(win) && !win.isDestroyed()) {
      win.webContents.send(IPC.workspaceChanged, change);
    }
  }
  // 切り離したウィンドウも同じ正本を見ているので、同じ変更を配る（#290）。
  satelliteWindows?.broadcast(IPC.workspaceChanged, change);
  if (todayMiniWindow && !todayMiniWindow.isDestroyed()) {
    todayMiniWindow.webContents.send(IPC.todayMiniRefresh);
  }
}

// 「今日やること」の一覧結果へ影響しうるEntity。ここに載らない種類では前面ウィンドウを更新しない。
const TODAY_MINI_ENTITY_TYPES = new Set<EntityType>(["task", "schedule", "theme", "project"]);

function notifyTodayMiniRefresh(types: EntityType[]): void {
  if (!types.some((type) => TODAY_MINI_ENTITY_TYPES.has(type))) return;
  const todayMiniWindow = todayMiniController?.getWindow();
  if (!todayMiniWindow || todayMiniWindow.isDestroyed()) return;
  if (todayMiniWindow.webContents.isLoading()) return;
  todayMiniWindow.webContents.send(IPC.todayMiniRefresh);
}

function notifyCommandApplied(input: CommandReceipt | CommandReceipt[], senderId: number, options: { senderReceivesAll?: boolean } = {}): void {
  const receipts = (Array.isArray(input) ? input : [input]).filter((receipt) => (
    receipt.status !== "no_change" && !(receipt as CommandReceipt & { replayed?: boolean }).replayed
  ));
  if (!receipts.length) return;
  const entityChanges = receipts.flatMap((receipt) => receipt.changes);
  const eventChanges = receipts.flatMap((receipt) => receipt.eventChanges || receipt.events
    .map((eventId) => workspaceRepository?.get("change_event", eventId, true))
    .filter((event): event is Entity => Boolean(event))
    .map((event) => ({ type: "change_event" as const, entity: event })));
  const payloads = commandNotificationPayloads(entityChanges, eventChanges, options.senderReceivesAll === true);
  const changes = payloads.other.entities;
  if (!changes.length) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || isAuxiliaryWindow(win)) continue;
    const delta = win.webContents.id === senderId ? payloads.sender.entities : payloads.other.entities;
    if (delta.length) win.webContents.send(IPC.workspaceChanged, { entities: delta });
  }
  // Satellite windows do not issue the main command IPC, so they can always
  // receive the delta.  The mini window refreshes its projection from the same
  // repository rather than applying a second delta.
  satelliteWindows?.broadcast(IPC.workspaceChanged, payloads.satellite);
  if (changes.some(({ type }) => TODAY_MINI_ENTITY_TYPES.has(type))) {
    const mini = todayMiniController?.getWindow();
    if (mini && !mini.isDestroyed() && mini.webContents.id !== senderId) mini.webContents.send(IPC.todayMiniRefresh);
  }
}

function findMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()
    .find((win) => !isAuxiliaryWindow(win) && !win.isDestroyed()) || null;
}

function rendererWindowsForAppFlush(): BrowserWindow[] {
  const windows: BrowserWindow[] = [];
  const main = findMainWindow();
  if (main) windows.push(main);
  for (const noteId of noteWindowController?.openNoteIds() || []) {
    const noteWindow = satelliteWindows?.get({ kind: "note", entityId: noteId });
    if (noteWindow && !windows.includes(noteWindow)) windows.push(noteWindow);
  }
  for (const memoId of memoStickyController?.windowMemoIds() || []) {
    const memoWindow = satelliteWindows?.get({ kind: "memo", entityId: memoId });
    if (memoWindow && !windows.includes(memoWindow)) windows.push(memoWindow);
  }
  return windows;
}

function showMainWindow(): BrowserWindow {
  const win = findMainWindow() || createWindow();
  const reveal = () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  if (readyMainWindows.has(win)) {
    reveal();
  } else {
    win.once("ready-to-show", reveal);
  }
  return win;
}

interface SmokeCreatedResult {
  title: string;
  rootReady: boolean;
  smokeTaskId: string;
  smokeTaskTitle: string;
  todayMiniWindowOpened: boolean;
  saved: boolean;
  markdownSaved: boolean;
  markdownPreviewRendered: boolean;
  markdownFrontmatterRendered: boolean;
  markdownMathRendered: boolean;
  markdownImageRendered: boolean;
  notesPanePreviewRendered: boolean;
  notesPaneMathRendered: boolean;
  notesLiveEditSaved: boolean;
  notesMarkdownPasteRendered: boolean;
  notesEditPreviewAligned: boolean;
  notesEditReopened: boolean;
  notesMermaidRenderedInEdit: boolean;
  notesCodeBlockFullWidth: boolean;
  notesFootnoteEditPreviewAligned: boolean;
  rawCopyNotified: boolean;
  themeMode: string;
  clipboardWritten: boolean;
  sketchClipboardWritten: boolean;
  sketchClipboardPasted: boolean;
  sketchCreatedAndOpened: boolean;
  /** AI共通metadata（#294）の保存・継承・検証。 */
  aiMetadataPersisted: boolean;
  aiThemeDefaultPersisted: boolean;
  aiMetadataRejectedInvalid: boolean;
  aiVisibilityDefaultSaved: string;
  stickyAutosaveSaved?: boolean;
  stickyImeSaved?: boolean;
  stickyResizePreserved?: boolean;
  stickyNativeCloseFlushed?: boolean;
  audioArtifactId?: string;
  audioMetadataLoaded?: boolean;
  audioRangeVerified?: boolean;
  batchTranscriptionPreview?: boolean;
  batchTranscriptionCompleted?: boolean;
  batchTranscriptionProvenance?: boolean;
  microphoneArtifactId?: string;
  microphoneRecorded?: boolean;
  microphonePlayback?: boolean;
  microphoneCaptureMethod?: boolean;
  microphoneRangeVerified?: boolean;
  importedVideoArtifactId?: string;
  importedVideoMetadataLoaded?: boolean;
  importedVideoCanPlay?: boolean;
  importedVideoSeeked?: boolean;
  importedVideoVolumePreserved?: boolean;
  importedVideoRangeVerified?: boolean;
  screenRecordingArtifactId?: string;
  screenRecordingMetadataLoaded?: boolean;
  screenRecordingCanPlay?: boolean;
  screenRecordingSeeked?: boolean;
  screenRecordingVolumePreserved?: boolean;
  screenRecordingRangeVerified?: boolean;
  screenRecordingPausedResumed?: boolean;
  appIsPackaged?: boolean;
}

interface SmokeReloadResult {
  persisted: boolean;
  markdownPersisted: boolean;
  markdownThemeLinked: boolean;
  markdownFrontmatterPersisted: boolean;
  markdownLiveEditPersisted: boolean;
  markdownPastePersisted: boolean;
  themeMode: string;
  aiVisibilityDefault: string;
  aiTaskMetadataPersisted: boolean;
  settingsReloadRestored: boolean;
}

interface SmokeMiniResult {
  todayMiniOpened: boolean;
  todayMiniAlwaysOnTop: boolean;
  todayMiniTaskVisible: boolean;
  todayMiniCompletionSaved: boolean;
  todayMiniOpenDetail: boolean;
  todayMiniToggleRestored: boolean;
  todayMiniResponsive: boolean;
  todayMiniThemeKeyboard: boolean;
  todayMiniThemeSaved: boolean;
  todayMiniFailurePreserved: boolean;
}

function recordSmoke(stage: string, details: Record<string, unknown> = {}): void {
  if (!isSmokeTest) return;
  lastSmokeStage = stage;
  smokeTrace.push(stage);
  if (smokeTrace.length > 40) smokeTrace.shift();
  fs.mkdirSync(path.dirname(smokeResultPath), { recursive: true });
  fs.writeFileSync(smokeResultPath, JSON.stringify({ stage, argv: process.argv, ...details }, null, 2));
}

function tinyPcmWav(): Buffer {
  const sampleCount = 800;
  const dataBytes = sampleCount * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + dataBytes, 4); bytes.write("WAVE", 8);
  bytes.write("fmt ", 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

function tinyVp8Webm(): Buffer {
  // 16x16 / 0.52sの無音VP8。smoke専用fixtureで、production IPCへraw bytes/pathは公開しない。
  return Buffer.from("GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJmEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggJQ7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNTkuMjcuMTAwV0GNTGF2ZjU5LjI3LjEwMESJiECCwAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYiPMq35J8Igz5yBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAX14QDgibCBELqBEJqBAhJUw2f9c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY1OS4yNy4xMDBzc9djwItjxYiPMq35J8Igz2fIoUWjh0VOQ09ERVJEh5RMYXZjNTkuMzcuMTAwIGxpYnZweGfIokWjiERVUkFUSU9ORIeUMDA6MDA6MDAuNjAwMDAwMDAwAAAfQ7Z1QKrngQCjo4EAAIAQAgCdASoQABAAAEcIhYWImYSIAgIADA1gAP7/q1CAo5iBAGQAsQEABRCsABgAMD/0DAAAAP72uQCjmIEAyACxAQAFEKwAGAAwP/QMAAAA/va5AKOYgQEsALEBAAUQrAAYADA/9AwAAAD+9rkAo5iBAZAAsQEABRCsABgAMD/0DAAAAP72uQCjmIEB9ACxAQAFEKwAGAAwP/QMAAAA/va5ABxTu2uRu4+zgQC3iveBAfGCAaDwgQM=", "base64");
}

async function verifySmokeMediaRange(artifactId: string): Promise<boolean> {
  const response = await net.fetch(`tasken-media://artifact/${encodeURIComponent(artifactId)}`, {
    headers: { Range: "bytes=0-43" },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return response.status === 206
    && response.headers.get("content-range")?.startsWith("bytes 0-43/") === true
    && bytes.length === 44
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WAVE";
}

async function verifySmokeVideoRange(artifactId: string): Promise<boolean> {
  const response = await net.fetch(`tasken-media://artifact/${encodeURIComponent(artifactId)}`, {
    headers: { Range: "bytes=0-31" },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  // WebMはEBML header、MP4はftyp box。画面録画はMP4既定になった（#388）。
  const isWebm = bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const isMp4 = bytes.subarray(4, 8).toString("ascii") === "ftyp";
  return response.status === 206
    && response.headers.get("content-range")?.startsWith("bytes 0-31/") === true
    && bytes.length === 32
    && (isWebm || isMp4);
}

app.disableHardwareAcceleration();
  if (process.platform === "win32") app.setAppUserModelId("jp.personal.tasken");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("in-process-gpu");
  // Chromium EditContext は Windows 日本語 IME の候補位置がずれる事例がある（CodeMirror 等でも無効化が定石）。
  // 従来の contenteditable キャレット基準に戻す。
  app.commandLine.appendSwitch("disable-blink-features", "EditContext");
  // Taskenはhardware accelerationを無効化しているため、D3D11前提のWGC capturerも無効化する。
  // Windows画面録画はChromiumのlegacy desktop capturerへ固定して列挙と録画を同じbackendに揃える。
  app.commandLine.appendSwitch("disable-features", "EditContext,AllowWgcScreenCapturer,AllowWgcWindowCapturer");

  if (isMcpPackageSmoke) {
    if (!app.isPackaged) throw new Error("MCP package smokeはpackaged Desktopでのみ使用できます。");
    app.setPath("userData", validateMcpPackageSmokeRoot({
      userDataPath: requestedUserDataPath,
      markerToken: mcpPackageSmokeMarker,
      environmentMarker: process.env.TASKEN_MCP_PACKAGE_SMOKE_MARKER,
    }));
  } else if (requestedUserDataPath) {
    app.setPath("userData", path.resolve(requestedUserDataPath));
  } else if (isSmokeTest) {
    const smokeUserDataPath = path.join(app.getPath("temp"), `tasken-smoke-${smokeRunId}-userData`);
    app.setPath("userData", smokeUserDataPath);
    recordSmoke("main-started");
    setTimeout(() => {
      const previousStage = lastSmokeStage;
      recordSmoke("timeout", { previousStage, trace: [...smokeTrace] });
      app.exit(1);
    }, 180000);
}

async function runSmokeTest(window: BrowserWindow): Promise<void> {
  recordSmoke("renderer-loaded");
  const testTitle = `デスクトップ動作確認 ${Date.now()}`;
  const markdownTitle = `Markdown動作確認 ${Date.now()}`;
  const footnoteTitle = `脚注動作確認 ${Date.now()}`;
  const smokeTaskTitle = `Todayミニ動作確認 ${Date.now()}`;
  const smokeTaskId = randomUUID();
  const smokeThemeId = `smoke-theme-${Date.now()}`;
  const todayMiniThemeMatrix = Array.from({ length: 20 }, (_, index) => ({
    id: `today-mini-theme-${Date.now()}-${index}`,
    name: index === 19 ? "とても長い日本語のTheme名を省略表示して全文をtooltipで確認する" : `Today Theme ${String(index + 1).padStart(2, "0")}`,
    color: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6", "theme-extra-1", "theme-extra-2", "theme-extra-3", "theme-extra-4"][index % 10],
  }));
  const markdownBody = `---
theme: smoke
type: report
---
# Markdown Preview
- 箇条書き
本文中の式 $a^2 + b^2 = c^2$ を確認します。

$$
E = mc^2
$$

![Smoke Image](__SMOKE_IMAGE_URL__)

\`\`\`
code block
\`\`\`

\`\`\`mermaid
flowchart LR
  Edit --> Preview
\`\`\``;
  const footnoteBody = `# Footnote Preview

本文の根拠[^smoke]。

[^smoke]: Smoke脚注本文。

## 続き

編集前の本文。`;
  recordSmoke("core-start");
  const created = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.__taskenSmokeDiagnostics = { rendererErrors: [] };
      window.addEventListener("error", (event) => {
        window.__taskenSmokeDiagnostics.rendererErrors.push({
          kind: "error",
          message: event.message,
          filename: event.filename,
          line: event.lineno,
          column: event.colno,
        });
      });
      window.addEventListener("unhandledrejection", (event) => {
        window.__taskenSmokeDiagnostics.rendererErrors.push({
          kind: "unhandledrejection",
          message: String(event.reason?.stack || event.reason || "unknown rejection"),
        });
      });
      const setInputValue = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const waitFor = async (finder, label, attempts = 50) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const target = finder();
          if (target) return target;
          await delay(100);
        }
        throw new Error(label + " が見つかりません。画面: " + document.body.innerText.slice(0, 1000));
      };
      const waitForButton = async (label) => waitFor(() => {
        return [...document.querySelectorAll("button")].find((button) => {
          const firstLabel = button.querySelector("span")?.textContent?.trim();
          return firstLabel === label || button.textContent.trim() === label;
        });
      }, label + " ボタン");
      // Notesの作成は一つのprimary actionへ集約した（#313）。filterの種別buttonと取り違えない。
      const clickCreateNote = async () => {
        const button = await waitFor(
          () => document.querySelector(".notes-page .note-create-primary"),
          "Note作成ボタン",
        );
        button.click();
      };
      const clickPaneButton = (pane, label) => {
        const button = [...pane.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
        if (!button) throw new Error(label + " ボタンがNotesパネル内に見つかりません。");
        button.click();
        return button;
      };
      const selectNoteRow = async (title) => {
        const row = await waitFor(
          () => [...document.querySelectorAll(".note-row-main")].find((button) => button.textContent.includes(title)),
          "Note行 " + title,
        );
        row.click();
        await delay(120);
        return row;
      };
      const setNoteBodyRaw = async (body) => {
        const notesPane = document.querySelector(".note-preview-panel");
        if (!notesPane) throw new Error("Notes中央パネルが見つかりません");
        clickPaneButton(notesPane, "Raw");
        await delay(80);
        const rawArea = notesPane.querySelector("textarea.note-main-editor-raw");
        if (!rawArea) throw new Error("Raw編集エリアが見つかりません");
        setInputValue(rawArea, body);
        await delay(40);
        return notesPane;
      };
      const mermaidDiagnostics = () => ({
        activeElement: document.activeElement?.outerHTML?.slice(0, 300) || "",
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        notePane: Boolean(document.querySelector(".note-preview-panel")),
        mermaidBlocks: [...document.querySelectorAll(".note-mermaid-code-block")].map((block) => ({
          className: block.className,
          text: block.textContent?.slice(0, 300) || "",
          svgCount: block.querySelectorAll(".md-mermaid-svg svg").length,
          errorText: block.querySelector(".md-mermaid-error")?.textContent || "",
          rect: (() => {
            const rect = block.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
          })(),
          html: block.innerHTML.slice(0, 1200),
        })),
        markdownBlocks: [...document.querySelectorAll("[data-mermaid='true']")].map((block) => ({
          className: block.className,
          text: block.textContent?.slice(0, 300) || "",
          svgCount: block.querySelectorAll(".md-mermaid-svg svg").length,
          errorText: block.querySelector(".md-mermaid-error")?.textContent || "",
        })),
        rendererErrors: window.__taskenSmokeDiagnostics.rendererErrors,
      });

      // Note 作成: ドロワーはタイトル等のメタのみ。本文は中央エリアが正本。
      (await waitForButton("Notes")).click();
      await waitFor(() => document.querySelector(".notes-page"), "Notes page");
      await clickCreateNote();
      await delay(100);

      const form = await waitFor(() => document.querySelector(".drawer-form"), "メモ入力フォーム");
      const title = form.querySelector('input[name="title"]');
      if (!title) throw new Error("メモ入力フォームにタイトル欄がありません");
      setInputValue(title, ${JSON.stringify(testTitle)});
      form.requestSubmit();
      await delay(200);

      await selectNoteRow(${JSON.stringify(testTitle)});
      await setNoteBodyRaw("Electron内で入力と保存を確認しました。");
      clickPaneButton(document.querySelector(".note-preview-panel"), "保存");
      await delay(200);

      await window.api.entities.save("theme", { id: ${JSON.stringify(smokeThemeId)}, name: "Smoke Theme", code: "SMOKE", status: "active" });
      for (const theme of ${JSON.stringify(todayMiniThemeMatrix)}) {
        await window.api.entities.save("theme", { ...theme, status: "active" });
      }
      const smokeImage = await window.api.attachments.saveMarkdownImage({
        fileName: "smoke.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
      });
      const markdownContent = ${JSON.stringify(markdownBody)}.replace("__SMOKE_IMAGE_URL__", smokeImage.url);

      // Markdown 確認用 Note を作成（本文は中央 Raw で投入）
      await clickCreateNote();
      await delay(100);
      const markdownForm = await waitFor(() => document.querySelector(".drawer-form"), "Markdown入力フォーム");
      const markdownTitleInput = markdownForm.querySelector('input[name="title"]');
      const markdownTheme = markdownForm.querySelector('input[name="theme_id"]');
      if (!markdownTitleInput || !markdownTheme) throw new Error("Markdown入力フォームの項目が見つかりません");
      setInputValue(markdownTitleInput, ${JSON.stringify(markdownTitle)});
      // Theme保存のworkspace change通知を待って、実際の共通ThemeSelectを操作する。
      // hidden inputへの直接fallbackはproduct pathを検証しないため持たない。
      const smokeThemeChip = await waitFor(
        () => [...markdownForm.querySelectorAll(".theme-chip")]
          .find((candidate) => candidate.textContent?.trim() === "Smoke Theme"),
        "Smoke Theme chip",
      );
      smokeThemeChip.click();
      markdownForm.requestSubmit();
      await delay(220);

      await selectNoteRow(${JSON.stringify(markdownTitle)});
      let notesPane = await setNoteBodyRaw(markdownContent);
      clickPaneButton(notesPane, "保存");
      await delay(200);

      // Preview で Markdown 描画を確認
      clickPaneButton(notesPane, "Preview");
      await delay(120);
      const preview = notesPane.querySelector(".note-main-preview.markdown-preview") || notesPane.querySelector(".markdown-preview");
      const markdownPreviewRendered = Boolean(
        preview?.querySelector("h1")?.textContent?.includes("Markdown Preview")
        && preview?.querySelector("li")?.textContent?.includes("箇条書き")
        && [...(preview?.querySelectorAll("code") || [])].some((code) => code.textContent?.includes("code block"))
      );
      const markdownFrontmatterRendered = Boolean(preview?.querySelector(".md-frontmatter")?.textContent?.includes("type: report"));
      const markdownMathRendered = Boolean(
        preview?.querySelector(".md-math-inline")?.textContent?.includes("a^2")
        && preview?.querySelector(".md-math-block")?.textContent?.includes("E = mc^2")
      );
      const smokePreviewImage = preview?.querySelector('.md-image img[alt="Smoke Image"]');
      if (smokePreviewImage && !smokePreviewImage.complete) {
        await new Promise((resolve) => {
          smokePreviewImage.addEventListener("load", resolve, { once: true });
          smokePreviewImage.addEventListener("error", resolve, { once: true });
          // 画面チャンクのアイドル先読み中でも、添付プロトコルの画像デコード完了を待つ。
          setTimeout(resolve, 2000);
        });
      }
      const markdownImageRendered = Boolean(
        smokePreviewImage?.getAttribute("src")?.startsWith("tasken-attachment://")
        && smokePreviewImage?.naturalWidth > 0
      );

      // Edit（Live Preview）面での追記・貼り付け
      clickPaneButton(notesPane, "Edit");
      const liveEditable = await waitFor(
        () => document.querySelector(".note-preview-panel .note-mdx-content[contenteditable='true']"),
        "Live Preview編集面",
        40,
      );
      notesPane = liveEditable.closest(".note-preview-panel");
      if (!notesPane) throw new Error("Live Preview編集面の親パネルが見つかりません。");
      const notesPanePreviewRendered = Boolean(
        notesPane?.querySelector("h2")?.textContent?.includes(${JSON.stringify(markdownTitle)})
        && (notesPane?.querySelector(".note-live-editor h1")?.textContent?.includes("Markdown Preview")
          || liveEditable?.querySelector("h1")?.textContent?.includes("Markdown Preview"))
        && notesPane?.querySelector(".document-publish-panel")
      );
      const notesPaneMathRendered = Boolean(
        notesPane?.querySelector(".note-editor-math-inline")
        && notesPane?.querySelector(".note-editor-math-block")
      );
      const mermaidPreviewTarget = notesPane?.querySelector(".note-mermaid-preview .md-mermaid-block")
        || notesPane?.querySelector(".note-mermaid-preview-frame");
      const scrollableAncestor = (() => {
        let current = mermaidPreviewTarget?.parentElement || null;
        while (current && current !== document.body) {
          const style = getComputedStyle(current);
          if (/(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) return current;
          current = current.parentElement;
        }
        return document.scrollingElement;
      })();
      if (mermaidPreviewTarget && scrollableAncestor && scrollableAncestor !== document.scrollingElement) {
        const targetRect = mermaidPreviewTarget.getBoundingClientRect();
        const ancestorRect = scrollableAncestor.getBoundingClientRect();
        scrollableAncestor.scrollTop += targetRect.top - ancestorRect.top - (scrollableAncestor.clientHeight - targetRect.height) / 2;
      }
      mermaidPreviewTarget?.scrollIntoView({ block: "center", inline: "nearest" });
      if (mermaidPreviewTarget instanceof HTMLElement) {
        mermaidPreviewTarget.tabIndex = -1;
        mermaidPreviewTarget.focus({ preventScroll: true });
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let mermaidPreviewInEdit;
      try {
        mermaidPreviewInEdit = await waitFor(
          () => notesPane?.querySelector(".note-mermaid-code-block.is-preview .md-mermaid-svg svg"),
          "Edit面のMermaid Preview",
          80,
        );
      } catch (error) {
        const diagnostics = mermaidDiagnostics();
        console.error("Mermaid smoke diagnostics: " + JSON.stringify(diagnostics));
        throw new Error(String(error) + " diagnostics=" + JSON.stringify(diagnostics));
      }
      const notesMermaidRenderedInEdit = Boolean(mermaidPreviewInEdit);
      mermaidPreviewInEdit.closest(".note-mermaid-preview-frame")?.click();
      const mermaidCodeEditor = await waitFor(
        () => notesPane?.querySelector(".note-mermaid-code-block.is-editing .cm-editor"),
        "Mermaidコード編集面",
        80,
      );
      const notesCodeBlockFullWidth = mermaidCodeEditor.getBoundingClientRect().width >= liveEditable.getBoundingClientRect().width * 0.8;

      liveEditable.focus();
      let liveTextNode = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const walker = document.createTreeWalker(liveEditable, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node.nodeValue?.includes("本文中")) {
            liveTextNode = node;
            break;
          }
          node = walker.nextNode();
        }
        if (liveTextNode) break;
        await delay(100);
      }
      if (!liveTextNode) throw new Error("Live Preview編集対象の本文が見つかりません。表示: " + liveEditable.textContent?.slice(0, 500));
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(liveTextNode, liveTextNode.nodeValue?.length || 0);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand("insertText", false, " Live edit smoke");
      await delay(80);
      const pasteData = new DataTransfer();
      pasteData.setData("text/plain", "\\n\\n## Pasted Markdown Heading\\n\\n**Pasted Bold Text**\\n");
      const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, "clipboardData", { value: pasteData });
      liveEditable.dispatchEvent(pasteEvent);
      await delay(200);
      const notesLiveEditRendered = Boolean(notesPane?.querySelector(".note-live-editor")?.textContent?.includes("Live edit smoke"));
      const notesMarkdownPasteRendered = Boolean(
        notesPane?.querySelector(".note-live-editor h2")?.textContent?.includes("Pasted Markdown Heading")
        && notesPane?.querySelector(".note-live-editor strong")?.textContent?.includes("Pasted Bold Text")
      );
      const editStructure = {
        h1: liveEditable.querySelector("h1")?.textContent?.trim() || "",
        h2: liveEditable.querySelector("h2")?.textContent?.trim() || "",
        strong: liveEditable.querySelector("strong")?.textContent?.trim() || "",
        list: liveEditable.querySelector("li")?.textContent?.trim() || "",
      };
      const saveDraftButton = [...(notesPane?.querySelectorAll(".note-preview-actions button") || [])].find((button) => button.textContent.trim() === "保存");
      saveDraftButton?.click();
      const savedNotesPane = await waitFor(
        () => {
          const currentNotesPane = document.querySelector(".note-preview-panel");
          return currentNotesPane?.querySelector(".note-draft-state")?.textContent?.includes("保存しました")
            ? currentNotesPane
            : null;
        },
        "Live Preview保存状態",
        40,
      );
      notesPane = savedNotesPane;
      const notesLiveEditSaved = notesLiveEditRendered && Boolean(savedNotesPane);
      clickPaneButton(notesPane, "Preview");
      await delay(180);
      const editedPreview = notesPane.querySelector(".note-main-preview.markdown-preview");
      const previewStructure = {
        h1: editedPreview?.querySelector("h1")?.textContent?.trim() || "",
        h2: editedPreview?.querySelector("h2")?.textContent?.trim() || "",
        strong: editedPreview?.querySelector("strong")?.textContent?.trim() || "",
        list: editedPreview?.querySelector("li")?.textContent?.trim() || "",
      };
      const notesEditPreviewAligned = Object.keys(editStructure).every((key) => editStructure[key] === previewStructure[key])
        && Boolean(editedPreview?.textContent?.includes("Live edit smoke"));
      clickPaneButton(notesPane, "Edit");
      await delay(180);
      const notesEditReopened = Boolean(notesPane.querySelector(".note-mdx-content[contenteditable='true']")?.textContent?.includes("Live edit smoke"));

      // 脚注MarkdownをEditで更新し、Previewへ切り替えて脚注表示と保存値を確認する。
      await clickCreateNote();
      await delay(100);
      const footnoteForm = await waitFor(() => document.querySelector(".drawer-form"), "脚注Note入力フォーム");
      const footnoteTitleInput = footnoteForm.querySelector('input[name="title"]');
      if (!footnoteTitleInput) throw new Error("脚注Note入力フォームにタイトル欄がありません");
      setInputValue(footnoteTitleInput, ${JSON.stringify(footnoteTitle)});
      footnoteForm.requestSubmit();
      await delay(220);
      await selectNoteRow(${JSON.stringify(footnoteTitle)});
      notesPane = await setNoteBodyRaw(${JSON.stringify(footnoteBody)});
      clickPaneButton(notesPane, "保存");
      await delay(180);
      clickPaneButton(notesPane, "Edit");
      await delay(160);
      const footnoteEditor = await waitFor(
        () => notesPane?.querySelector("textarea.note-editor-footnotes"),
        "脚注Markdown編集面",
      );
      setInputValue(footnoteEditor, ${JSON.stringify(footnoteBody)} + "\\n\\nEdit脚注入力確認。");
      await delay(100);
      clickPaneButton(notesPane, "保存");
      await delay(180);
      clickPaneButton(notesPane, "Preview");
      await delay(160);
      const footnotePreview = notesPane.querySelector(".note-main-preview");
      const notesFootnoteEditPreviewAligned = Boolean(
        footnotePreview?.querySelector(".md-footnote-ref")
        && footnotePreview?.querySelector(".md-footnotes")?.textContent?.includes("Smoke脚注本文")
        && footnotePreview?.textContent?.includes("Edit脚注入力確認")
      );
      await window.api.preferences.set("themeMode", "dark");
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      // AI共通metadata（#294）: 保存 → 再読込 → 公開範囲の継承まで正本データで確認する。
      await window.api.preferences.set("aiVisibilityDefault", ["coding_agent"]);
      const aiVisibilityDefaultSaved = await window.api.preferences.get("aiVisibilityDefault");
      await window.api.entities.save("theme", {
        id: ${JSON.stringify(smokeThemeId)},
        name: "Smoke Theme",
        code: "SMOKE",
        status: "active",
        default_ai_visibility: ["m365"]
      });
      const smokeTaskReceipt = await window.api.task.create({
        schemaVersion: 1, command_id: crypto.randomUUID(), name: "CreateTask",
        payload: { task: {
          id: ${JSON.stringify(smokeTaskId)},
          title: ${JSON.stringify(smokeTaskTitle)},
          project_id: ${JSON.stringify(smokeThemeId)},
          state: "todo",
          priority: "high",
          checklist_items: [{ id: "mini-1", title: "smoke", done: false, sort_order: 0 }],
          ai_summary: "Todayミニの動作確認",
          ai_summary_authority: "user_confirmed",
          ai_freshness: "current",
          ai_authority: "user_confirmed",
          ai_visibility: ["coding_agent"],
          ai_source_refs: [{ kind: "canonical_document", locator: "smoke.md", storage_root_id: "smoke-root" }]
        } },
        actor: { kind: "user", id: "electron-smoke" },
        source: "desktop",
        issued_at: new Date().toISOString(),
      });
      if (!smokeTaskReceipt.ok || !smokeTaskReceipt.value.task)
        throw new Error(smokeTaskReceipt.ok ? "Task capability returned no task" : smokeTaskReceipt.error.message);
      const smokeTaskVersion = smokeTaskReceipt.value.task.version;
      let aiMetadataRejectedInvalid = false;
      try {
        await window.api.commands.execute({
          commandId: crypto.randomUUID(),
          name: "UpdateTask",
          payload: { task: {
            id: ${JSON.stringify(smokeTaskId)},
            title: ${JSON.stringify(smokeTaskTitle)},
            state: "todo",
            ai_authority: "guessed"
          } },
          actor: { kind: "user", id: "electron-smoke" },
          source: "main_ui",
          expectedVersions: [{ type: "task", id: ${JSON.stringify(smokeTaskId)}, version: smokeTaskVersion }],
          issuedAt: new Date().toISOString(),
        });
      } catch {
        aiMetadataRejectedInvalid = true;
      }
      const reloadedWorkspace = await window.api.workspace.load();
      const reloadedSmokeTask = (reloadedWorkspace.tasks || []).find((task) => task.id === ${JSON.stringify(smokeTaskId)});
      const reloadedSmokeTheme = (reloadedWorkspace.themes || []).find((theme) => theme.id === ${JSON.stringify(smokeThemeId)});
      const aiMetadataPersisted = reloadedSmokeTask?.ai_summary === "Todayミニの動作確認"
        && reloadedSmokeTask?.ai_freshness === "current"
        && Array.isArray(reloadedSmokeTask?.ai_visibility)
        && reloadedSmokeTask.ai_visibility.join(",") === "coding_agent"
        && reloadedSmokeTask?.ai_source_refs?.[0]?.storage_root_id === "smoke-root";
      const aiThemeDefaultPersisted = reloadedSmokeTheme?.default_ai_visibility?.join(",") === "m365";
      await window.api.entities.save("schedule", {
        id: crypto.randomUUID(),
        owner_type: "task",
        owner_id: ${JSON.stringify(smokeTaskId)},
        start_date: today,
        end_date: today,
        date_kind: "point",
        confidence: "fixed",
        granularity: "day"
      }, { source: "smoke" });

      const todayMiniWindowOpened = await window.api.app.showTodayMiniWindow();
      const themeMode = await window.api.preferences.get("themeMode");
      const savedBeforeSettingsRoute = [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(testTitle)}));
      const markdownSavedBeforeSettingsRoute = [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(markdownTitle)}));

      // Sketchの作成は保存だけでなく、実在する編集routeへ到達して初めて成立する。
      location.hash = "sketch";
      const sketchLibrary = await waitFor(() => document.querySelector(".sketch-library-page"), "Sketch一覧");
      const createSketchButton = [...sketchLibrary.querySelectorAll("button")]
        .find((button) => button.textContent.trim().includes("新しいSketch"));
      if (!createSketchButton) throw new Error("新しいSketchボタンがありません");
      createSketchButton.click();
      const sketchEditor = await waitFor(() => document.querySelector(".sketch-page"), "作成したSketchの編集面");
      const sketchCreatedAndOpened = location.hash === "#sketch-editor"
        && Boolean(sketchEditor.querySelector(".sketch-canvas-area"));
      location.hash = "notes";
      await waitFor(() => document.querySelector(".note-preview-panel"), "Notesプレビューへの復帰");

      return {
        title: document.title,
        rootReady: Boolean(document.querySelector("#root > *")),
        smokeTaskId: ${JSON.stringify(smokeTaskId)},
        smokeTaskTitle: ${JSON.stringify(smokeTaskTitle)},
        todayMiniWindowOpened,
        saved: savedBeforeSettingsRoute,
        markdownSaved: markdownSavedBeforeSettingsRoute,
        markdownPreviewRendered,
        markdownFrontmatterRendered,
        markdownMathRendered,
        markdownImageRendered,
        notesPanePreviewRendered,
        notesPaneMathRendered,
        notesLiveEditSaved,
        notesMarkdownPasteRendered,
        notesEditPreviewAligned,
        notesEditReopened,
        notesMermaidRenderedInEdit,
        notesCodeBlockFullWidth,
        notesFootnoteEditPreviewAligned,
        rawCopyNotified: false,
        themeMode,
        clipboardWritten: false,
        sketchClipboardWritten: false,
        sketchCreatedAndOpened,
        aiMetadataPersisted,
        aiThemeDefaultPersisted,
        aiMetadataRejectedInvalid,
        aiVisibilityDefaultSaved: Array.isArray(aiVisibilityDefaultSaved)
          ? aiVisibilityDefaultSaved.join(",")
          : String(aiVisibilityDefaultSaved),
      };
    })()
  `) as SmokeCreatedResult;

  // #376: actual detached renderer -> preload -> IPC -> transaction -> native close handshake.
  if (!workspaceRepository || !memoStickyController || !satelliteWindows) {
    throw new Error("sticky memo smoke boundary is unavailable");
  }
  const stickySmokeId = randomUUID();
  workspaceRepository.save("capture_entry", {
    id: stickySmokeId,
    title: "Sticky smoke",
    text: "initial",
    kind: "micro_memo",
    content_type: "text",
    captured_at: new Date().toISOString(),
    state: "untriaged",
  }, { source: "smoke" });
  if (!memoStickyController.open(stickySmokeId)) throw new Error("sticky memo smoke window did not open");
  const stickyWindow = satelliteWindows.get({ kind: "memo", entityId: stickySmokeId });
  if (!stickyWindow) throw new Error("sticky memo smoke window was not registered");
  if (stickyWindow.webContents.isLoading()) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sticky memo smoke load timeout")), 10_000);
      stickyWindow.webContents.once("did-finish-load", () => { clearTimeout(timer); resolve(); });
    });
  }
  const stickyEdit = await stickyWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const textarea = document.querySelector("#text");
      if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("sticky textarea is unavailable");
      for (let attempt = 0; attempt < 50 && textarea.value !== "initial"; attempt += 1) await delay(50);
      textarea.focus();
      textarea.value = "first";
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "first" }));
      textarea.value += "\\n";
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLineBreak", data: null }));
      window.dispatchEvent(new Event("blur"));
      let afterEnter = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        afterEnter = await window.memoStickyApi.load();
        if (afterEnter?.text === "first\\n") break;
        await delay(50);
      }
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      textarea.value += "日本語";
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "日本語", isComposing: true }));
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }));
      let afterIme = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        afterIme = await window.memoStickyApi.load();
        if (afterIme?.text === "first\\n日本語") break;
        await delay(50);
      }
      return { enter: afterEnter?.text === "first\\n", ime: afterIme?.text === "first\\n日本語" };
    })()
  `) as { enter: boolean; ime: boolean };
  stickyWindow.setBounds({ ...stickyWindow.getBounds(), width: 340, height: 280 }, false);
  const stickyResizePreserved = await stickyWindow.webContents.executeJavaScript(`
    document.querySelector("#text")?.value === "first\\n日本語"
  `) as boolean;
  await stickyWindow.webContents.executeJavaScript(`
    (() => {
      const textarea = document.querySelector("#text");
      textarea.value += " close-flush";
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: " close-flush" }));
    })()
  `);
  stickyWindow.close();
  for (let attempt = 0; attempt < 100 && !stickyWindow.isDestroyed(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const stickyPersisted = workspaceRepository.get("capture_entry", stickySmokeId, true) as Entity | null;
  created.stickyAutosaveSaved = stickyEdit.enter;
  created.stickyImeSaved = stickyEdit.ime;
  created.stickyResizePreserved = stickyResizePreserved;
  created.stickyNativeCloseFlushed = stickyWindow.isDestroyed()
    && stickyPersisted?.text === "first\n日本語 close-flush";

  if (!smokeMediaCaptureService || !smokeVideoSourcePath) throw new Error("smoke video Main fixture is unavailable");
  smokeMediaCaptureService.prepareVideoFile(smokeVideoSourcePath, {
    storageMode: "managed",
    sourceType: "task",
    sourceId: smokeTaskId,
  });

  const videoSmoke = await window.webContents.executeJavaScript(`
    (async () => {
      const pending = await window.api.mediaCapture.listPreparedVideo();
      if (pending.length !== 1 || pending[0].status !== "ready") throw new Error("prepared video session was not listed");
      const prepared = pending[0];
      const readMetadata = (src) => new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const timer = setTimeout(() => reject(new Error("video metadata timeout")), 15000);
        video.preload = "metadata";
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve({ durationMs: Math.round(video.duration * 1000), widthPx: video.videoWidth, heightPx: video.videoHeight });
        };
        video.onerror = () => { clearTimeout(timer); reject(new Error("video metadata failed")); };
        video.src = src;
      });
      const metadata = await readMetadata(prepared.mediaUrl);
      const committed = await window.api.mediaCapture.commitVideo({ sessionId: prepared.sessionId, ...metadata });
      const artifact = await window.api.entities.get("artifact", committed.artifactId);
      if (!artifact || artifact.media_kind !== "video" || artifact.mime_type !== "video/webm"
        || Object.hasOwn(artifact, "capture_method")
        || artifact.duration_ms !== metadata.durationMs || artifact.width_px !== metadata.widthPx || artifact.height_px !== metadata.heightPx) {
        throw new Error("committed video Artifact metadata mismatch");
      }
      if (JSON.stringify(artifact).match(/stored_path|original_path|target|sourcePath/)) throw new Error("video Artifact leaked a path to Renderer");
      const playback = await new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const timer = setTimeout(() => reject(new Error("video canplay/seek timeout")), 15000);
        let canPlay = false;
        let seekRequested = false;
        const fail = () => { clearTimeout(timer); reject(new Error("video playback failed")); };
        video.muted = true;
        video.volume = 0.25;
        video.preload = "auto";
        video.oncanplay = async () => {
          if (seekRequested) return;
          seekRequested = true;
          try {
            await video.play();
            canPlay = !video.paused;
            video.pause();
            video.currentTime = Math.min(0.25, video.duration / 2);
          } catch (error) { fail(); }
        };
        video.onseeked = () => {
          clearTimeout(timer);
          resolve({ canPlay, seeked: video.currentTime > 0, volumePreserved: Math.abs(video.volume - 0.25) < 0.001 });
        };
        video.onerror = fail;
        video.src = "tasken-media://artifact/" + encodeURIComponent(artifact.id);
      });
      return {
        artifactId: committed.artifactId,
        metadataLoaded: metadata.durationMs >= 550 && metadata.durationMs <= 650 && metadata.widthPx === 16 && metadata.heightPx === 16,
        canPlay: playback.canPlay,
        seeked: playback.seeked,
        volumePreserved: playback.volumePreserved,
      };
    })()
  `) as { artifactId: string; metadataLoaded: boolean; canPlay: boolean; seeked: boolean; volumePreserved: boolean };
  created.importedVideoArtifactId = videoSmoke.artifactId;
  created.importedVideoMetadataLoaded = videoSmoke.metadataLoaded;
  created.importedVideoCanPlay = videoSmoke.canPlay;
  created.importedVideoSeeked = videoSmoke.seeked;
  created.importedVideoVolumePreserved = videoSmoke.volumePreserved;
  created.importedVideoRangeVerified = await verifySmokeVideoRange(videoSmoke.artifactId);
  created.appIsPackaged = app.isPackaged;
  if (!created.importedVideoRangeVerified) throw new Error("imported video range request failed");

  const screenRecordingSmoke = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const capabilities = await window.api.screenRecording.capabilities();
      if (!capabilities.screen || !capabilities.window || !capabilities.mimeCandidates.includes("video/webm")) {
        throw new Error("screen recording capability mismatch");
      }
      const sources = await window.api.screenRecording.listSources();
      const source = sources.find((candidate) => candidate.kind === "screen") || sources[0];
      if (!source || JSON.stringify(source).match(/desktopSourceId|display_id|screen:\\d|window:\\d/)) {
        throw new Error("screen recording source projection mismatch");
      }
      await window.api.screenRecording.arm({ sourceToken: source.sourceToken, audioMode: "off", includePointer: false });
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { cursor: "never" },
      });
      const mimeType = capabilities.mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error("screen recording MIME is unavailable");
      const container = mimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
      const started = await window.api.mediaCapture.startRecording({
        mediaKind: "video",
        mimeType: container,
      });
      const recorder = new MediaRecorder(stream, { mimeType });
      let sequence = 0;
      let appendChain = Promise.resolve();
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size <= 0) return;
        appendChain = appendChain.then(async () => {
          for (let offset = 0; offset < event.data.size; offset += started.maxChunkBytes) {
            const chunk = await event.data.slice(offset, Math.min(event.data.size, offset + started.maxChunkBytes)).arrayBuffer();
            const progress = await window.api.mediaCapture.appendRecording({ sessionId: started.sessionId, sequence, chunk });
            sequence = progress.nextSequence;
          }
        });
      });
      recorder.start(100);
      await delay(300);
      const recorderPaused = new Promise((resolve) => recorder.addEventListener("pause", resolve, { once: true }));
      recorder.pause();
      await recorderPaused;
      const pauseChunk = new Promise((resolve) => recorder.addEventListener("dataavailable", resolve, { once: true }));
      recorder.requestData();
      await pauseChunk;
      await appendChain;
      const paused = await window.api.mediaCapture.pauseRecording({ sessionId: started.sessionId });
      if (paused.state !== "paused") throw new Error("screen recording Main pause mismatch");
      await delay(100);
      const resumed = await window.api.mediaCapture.resumeRecording({ sessionId: started.sessionId });
      if (resumed.state !== "recording") throw new Error("screen recording Main resume mismatch");
      const recorderResumed = new Promise((resolve) => recorder.addEventListener("resume", resolve, { once: true }));
      recorder.resume();
      await recorderResumed;
      await delay(400);
      await new Promise((resolve) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.requestData();
        recorder.stop();
      });
      await appendChain;
      stream.getTracks().forEach((track) => track.stop());
      const prepared = await window.api.mediaCapture.stopRecording({ sessionId: started.sessionId });
      if (prepared.status !== "ready" || prepared.fileSize <= 0 || JSON.stringify(prepared).match(/stored_path|original_path|sourcePath|desktopSourceId/)) {
        throw new Error("prepared screen recording projection mismatch");
      }
      const metadata = await new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const timer = setTimeout(() => reject(new Error("screen recording metadata timeout")), 15000);
        const finish = () => {
          const durationMs = Math.round(video.duration * 1000);
          if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || !video.videoWidth || !video.videoHeight) return false;
          clearTimeout(timer);
          resolve({ durationMs, widthPx: video.videoWidth, heightPx: video.videoHeight });
          return true;
        };
        video.preload = "metadata";
        video.onloadedmetadata = () => {
          if (finish()) return;
          video.onseeked = () => {
            if (!finish()) reject(new Error("screen recording metadata invalid"));
          };
          video.currentTime = 7 * 24 * 60 * 60;
        };
        video.onerror = () => { clearTimeout(timer); reject(new Error("screen recording metadata failed")); };
        video.src = prepared.mediaUrl;
      });
      const committed = await window.api.mediaCapture.commitVideo({ sessionId: prepared.sessionId, ...metadata, sourceType: "task", sourceId: ${JSON.stringify(smokeTaskId)} });
      const artifact = await window.api.entities.get("artifact", committed.artifactId);
      if (!artifact || artifact.media_kind !== "video" || artifact.mime_type !== container
        || artifact.capture_method !== "screen_recording"
        || artifact.source_type !== "task" || artifact.source_id !== ${JSON.stringify(smokeTaskId)}
        || artifact.duration_ms !== metadata.durationMs || artifact.width_px !== metadata.widthPx || artifact.height_px !== metadata.heightPx) {
        throw new Error("screen recording Artifact mismatch");
      }
      if (JSON.stringify(artifact).match(/stored_path|original_path|target|sourcePath/)) throw new Error("screen recording Artifact leaked path");
      const playback = await new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const timer = setTimeout(() => reject(new Error("screen recording canplay/seek timeout")), 15000);
        let canPlay = false;
        let seekRequested = false;
        video.muted = true;
        video.volume = 0.25;
        video.preload = "auto";
        video.oncanplay = async () => {
          if (seekRequested) return;
          seekRequested = true;
          try {
            await video.play();
            canPlay = !video.paused;
            video.pause();
            video.currentTime = Math.min(0.25, video.duration / 2);
          } catch (error) { clearTimeout(timer); reject(error); }
        };
        video.onseeked = () => {
          clearTimeout(timer);
          resolve({ canPlay, seeked: video.currentTime > 0, volumePreserved: Math.abs(video.volume - 0.25) < 0.001 });
        };
        video.onerror = () => { clearTimeout(timer); reject(new Error("screen recording playback failed")); };
        video.src = "tasken-media://artifact/" + encodeURIComponent(artifact.id);
      });
      return {
        artifactId: artifact.id,
        metadataLoaded: metadata.durationMs > 0 && metadata.widthPx > 0 && metadata.heightPx > 0,
        canPlay: playback.canPlay,
        seeked: playback.seeked,
        volumePreserved: playback.volumePreserved,
        pausedResumed: true,
      };
    })()
  `, true) as { artifactId: string; metadataLoaded: boolean; canPlay: boolean; seeked: boolean; volumePreserved: boolean; pausedResumed: boolean };
  created.screenRecordingArtifactId = screenRecordingSmoke.artifactId;
  created.screenRecordingMetadataLoaded = screenRecordingSmoke.metadataLoaded;
  created.screenRecordingCanPlay = screenRecordingSmoke.canPlay;
  created.screenRecordingSeeked = screenRecordingSmoke.seeked;
  created.screenRecordingVolumePreserved = screenRecordingSmoke.volumePreserved;
  created.screenRecordingPausedResumed = screenRecordingSmoke.pausedResumed;
  created.screenRecordingRangeVerified = await verifySmokeVideoRange(screenRecordingSmoke.artifactId);

  const audioSmoke = await window.webContents.executeJavaScript(`
    (async () => {
      const pending = await window.api.mediaCapture.listPreparedAudio();
      if (pending.length !== 1 || pending[0].status !== "ready") throw new Error("prepared audio session was not listed");
      const prepared = pending[0];
      const durationMs = await new Promise((resolve, reject) => {
        const audio = new Audio();
        const timer = setTimeout(() => reject(new Error("audio metadata timeout")), 15000);
        audio.preload = "metadata";
        audio.onloadedmetadata = () => { clearTimeout(timer); resolve(Math.round(audio.duration * 1000)); };
        audio.onerror = () => { clearTimeout(timer); reject(new Error("audio metadata failed")); };
        audio.src = prepared.mediaUrl;
      });
      const committed = await window.api.mediaCapture.commitAudio({ sessionId: prepared.sessionId, durationMs });
      const artifact = await window.api.entities.get("artifact", committed.artifactId);
      if (!artifact || artifact.media_kind !== "audio" || artifact.mime_type !== "audio/wav" || artifact.duration_ms !== durationMs) {
        throw new Error("committed audio Artifact metadata mismatch");
      }
      const serialized = JSON.stringify(artifact);
      if (serialized.includes("stored_path") || serialized.includes("original_path") || serialized.includes("target")) {
        throw new Error("audio Artifact leaked a path to Renderer");
      }
      const transcriptionPreview = await window.api.batchTranscription.preview({ artifactId: committed.artifactId });
      if (!transcriptionPreview.available || transcriptionPreview.provider.processing_mode !== "local"
        || transcriptionPreview.provider.sends_audio_to_provider) throw new Error("fake batch transcription Preview mismatch");
      const transcription = await window.api.batchTranscription.run({
        artifactId: committed.artifactId,
        operationId: transcriptionPreview.operationId,
        confirmationToken: transcriptionPreview.confirmationToken,
      });
      const revision = transcription.revision;
      return {
        artifactId: committed.artifactId,
        metadataLoaded: durationMs >= 90 && durationMs <= 110,
        transcriptionPreview: true,
        transcriptionCompleted: revision.status === "completed" && revision.raw_text === "Tasken packaged fake transcript",
        transcriptionProvenance: revision.source_artifact_id === committed.artifactId
          && revision.provider_profile_id === "tasken-smoke-provider"
          && revision.model_id === "tasken-smoke-transcriber"
          && revision.processing_mode === "local"
          && revision.language === "ja",
      };
    })()
  `) as { artifactId: string; metadataLoaded: boolean; transcriptionPreview: boolean; transcriptionCompleted: boolean; transcriptionProvenance: boolean };
  created.audioArtifactId = audioSmoke.artifactId;
  created.audioMetadataLoaded = audioSmoke.metadataLoaded;
  created.audioRangeVerified = await verifySmokeMediaRange(audioSmoke.artifactId);
  created.batchTranscriptionPreview = audioSmoke.transcriptionPreview;
  created.batchTranscriptionCompleted = audioSmoke.transcriptionCompleted;
  created.batchTranscriptionProvenance = audioSmoke.transcriptionProvenance;

  const microphoneSmoke = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      if (!devices.length) throw new Error("fake microphone device was not listed");
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const started = await window.api.mediaCapture.startRecording({ mediaKind: "audio", mimeType: "audio/webm" });
      const recorder = new MediaRecorder(stream, { mimeType });
      let sequence = 0;
      let appendChain = Promise.resolve();
      let appendFailure = null;
      const queueBlob = (blob) => {
        appendChain = appendChain.then(async () => {
          if (appendFailure) return;
          for (let offset = 0; offset < blob.size; offset += started.maxChunkBytes) {
            const chunk = await blob.slice(offset, Math.min(blob.size, offset + started.maxChunkBytes)).arrayBuffer();
            const progress = await window.api.mediaCapture.appendRecording({ sessionId: started.sessionId, sequence, chunk });
            sequence = progress.nextSequence;
          }
        }).catch((error) => {
          appendFailure ||= error;
        });
      };
      const flushPausedRecorder = () => new Promise((resolve, reject) => {
        let quietTimer = null;
        const timeoutTimer = setTimeout(() => {
          recorder.removeEventListener("dataavailable", onDataAvailable);
          if (quietTimer !== null) clearTimeout(quietTimer);
          reject(new Error("microphone data flush timeout"));
        }, 3000);
        const onDataAvailable = () => {
          if (quietTimer !== null) clearTimeout(quietTimer);
          quietTimer = setTimeout(() => {
            clearTimeout(timeoutTimer);
            recorder.removeEventListener("dataavailable", onDataAvailable);
            resolve();
          }, 200);
        };
        recorder.addEventListener("dataavailable", onDataAvailable);
        recorder.requestData();
      });
      recorder.addEventListener("dataavailable", (event) => queueBlob(event.data));
      recorder.start(100);
      await delay(350);
      const recorderPaused = new Promise((resolve) => recorder.addEventListener("pause", resolve, { once: true }));
      recorder.pause();
      await recorderPaused;
      await flushPausedRecorder();
      await appendChain;
      if (appendFailure) throw appendFailure;
      await window.api.mediaCapture.pauseRecording({ sessionId: started.sessionId });
      await delay(100);
      await window.api.mediaCapture.resumeRecording({ sessionId: started.sessionId });
      recorder.resume();
      await delay(350);
      await new Promise((resolve) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.requestData();
        recorder.stop();
      });
      await appendChain;
      if (appendFailure) throw appendFailure;
      stream.getTracks().forEach((track) => track.stop());
      const prepared = await window.api.mediaCapture.stopRecording({ sessionId: started.sessionId });
      const projected = JSON.stringify(prepared);
      if (!prepared.durationMs || prepared.fileSize <= 0 || projected.includes("stored_path") || projected.includes("original_path") || projected.includes("sourcePath")) {
        throw new Error("recorded microphone projection mismatch");
      }
      const committed = await window.api.mediaCapture.commitAudio({ sessionId: prepared.sessionId, durationMs: prepared.durationMs });
      const artifact = await window.api.entities.get("artifact", committed.artifactId);
      const capture = await window.api.entities.get("capture_entry", committed.captureId);
      if (!artifact || artifact.mime_type !== "audio/webm" || artifact.media_kind !== "audio" || capture?.capture_method !== "microphone") {
        throw new Error("recorded microphone entities mismatch");
      }
      const playable = await new Promise((resolve, reject) => {
        const audio = new Audio();
        const timer = setTimeout(() => reject(new Error("recorded microphone playback timeout")), 15000);
        const done = async () => {
          try {
            audio.muted = true;
            await audio.play();
            audio.pause();
            clearTimeout(timer);
            resolve(audio.duration > 0);
          } catch (error) { clearTimeout(timer); reject(error); }
        };
        audio.oncanplay = done;
        audio.onerror = () => { clearTimeout(timer); reject(new Error("recorded microphone playback failed")); };
        audio.src = "tasken-media://artifact/" + encodeURIComponent(artifact.id);
      });
      return { artifactId: artifact.id, recorded: prepared.fileSize > 0 && prepared.durationMs > 0, playable, captureMethod: capture.capture_method === "microphone" };
    })()
  `) as { artifactId: string; recorded: boolean; playable: boolean; captureMethod: boolean };
  created.microphoneArtifactId = microphoneSmoke.artifactId;
  created.microphoneRangeVerified = await verifySmokeVideoRange(microphoneSmoke.artifactId);
  created.microphoneRecorded = microphoneSmoke.recorded;
  created.microphonePlayback = microphoneSmoke.playable;
  created.microphoneCaptureMethod = microphoneSmoke.captureMethod;

  const releaseSmokeClipboardLock = await acquireSmokeClipboardLock({ runId: smokeRunId });
  try {
    recordSmoke("clipboard-start");
    const clipboardPhase = await window.webContents.executeJavaScript(`
      (async () => {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const notesPane = document.querySelector(".note-preview-panel");
        const documentMenu = [...(notesPane?.querySelectorAll("button") || [])]
          .find((button) => button.textContent.trim() === "この文書");
        if (!documentMenu) throw new Error("この文書 menuボタンがNotesパネル内に見つかりません。");
        documentMenu.click();
        await delay(160);
        const copyBodyItem = [...(notesPane?.querySelectorAll(".toolbar-menu-list button") || [])]
          .find((button) => button.textContent.trim() === "本文をすべてコピー");
        if (!copyBodyItem) throw new Error("本文をすべてコピー が「この文書」menuに見つかりません。");
        copyBodyItem.click();
        await delay(160);
        const rawCopyNotified = document.body.innerText.includes("本文をコピーしました。");
        const clipboardWritten = await window.api.clipboard.writeText("Tasken smoke test");
        const canvas = document.createElement("canvas");
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Sketch clipboard smoke canvas is unavailable.");
        context.fillStyle = "#8a2f3b";
        context.fillRect(0, 0, 8, 8);
        const sketchClipboardWritten = await window.api.clipboard.writeImage({ dataUrl: canvas.toDataURL("image/png") });
        const target = document.createElement("div");
        target.id = "sketch-clipboard-smoke-target";
        target.contentEditable = "true";
        target.style.position = "fixed";
        target.style.left = "-10000px";
        document.body.append(target);
        target.focus();
        return { rawCopyNotified, clipboardWritten, sketchClipboardWritten };
      })()
    `) as { rawCopyNotified: boolean; clipboardWritten: boolean; sketchClipboardWritten: boolean };
    created.rawCopyNotified = clipboardPhase.rawCopyNotified;
    created.clipboardWritten = clipboardPhase.clipboardWritten;
    created.sketchClipboardWritten = clipboardPhase.sketchClipboardWritten;
    window.webContents.paste();
    await new Promise((resolve) => setTimeout(resolve, 100));
    created.sketchClipboardPasted = await window.webContents.executeJavaScript(`
      (() => {
        const target = document.querySelector("#sketch-clipboard-smoke-target");
        const pasted = Boolean(target?.querySelector("img"));
        target?.remove();
        return pasted;
      })()
    `) as boolean;
    recordSmoke("clipboard-complete", {
      sketchClipboardWritten: created.sketchClipboardWritten,
      sketchClipboardPasted: created.sketchClipboardPasted,
    });
  } finally {
    releaseSmokeClipboardLock();
  }

  let mini: SmokeMiniResult = {
    todayMiniOpened: false,
    todayMiniAlwaysOnTop: false,
    todayMiniTaskVisible: false,
    todayMiniCompletionSaved: false,
    todayMiniOpenDetail: false,
    todayMiniToggleRestored: false,
    todayMiniResponsive: false,
    todayMiniThemeKeyboard: false,
    todayMiniThemeSaved: false,
    todayMiniFailurePreserved: false,
  };
  const todayMiniWindow = todayMiniController?.getWindow();
  const todayMini = todayMiniWindow && !todayMiniWindow.isDestroyed() ? todayMiniWindow : null;
  if (todayMini) {
    if (todayMini.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        todayMini.webContents.once("did-finish-load", () => resolve());
        setTimeout(resolve, 1200);
      });
    }
    mini.todayMiniOpened = created.todayMiniWindowOpened && todayMini.isVisible();
    mini.todayMiniAlwaysOnTop = todayMini.isAlwaysOnTop();
    const initialMiniId = todayMini.webContents.id;
    const initialMiniBounds = todayMini.getBounds();
    const toggleResult = await window.webContents.executeJavaScript(`
      (async () => {
        const hidden = await window.api.app.toggleTodayMiniWindow();
        const shown = await window.api.app.toggleTodayMiniWindow();
        return { hidden, shown };
      })()
    `) as { hidden: boolean; shown: boolean };
    mini.todayMiniToggleRestored = toggleResult.hidden === false
      && toggleResult.shown === true
      && todayMini.isVisible()
      && todayMini.webContents.id === initialMiniId
      && todayMini.getBounds().x === initialMiniBounds.x
      && todayMini.getBounds().y === initialMiniBounds.y
      && todayMini.getBounds().width === initialMiniBounds.width
      && todayMini.getBounds().height === initialMiniBounds.height;
    const longTheme = todayMiniThemeMatrix.at(-1)!;
    await todayMini.webContents.executeJavaScript(`
      (() => {
        const trigger = document.querySelector(".theme-picker-trigger");
        trigger?.click();
        [...document.querySelectorAll(".theme-picker-option")]
          .find((candidate) => candidate.getAttribute("title") === ${JSON.stringify(longTheme.name)})?.click();
      })()
    `);
    const responsiveResults: boolean[] = [];
    for (const width of [300, 320, 360, 420]) {
      todayMini.setSize(width, Math.max(360, initialMiniBounds.height), false);
      await new Promise((resolve) => setTimeout(resolve, 40));
      responsiveResults.push(await todayMini.webContents.executeJavaScript(`
        (() => {
          const doc = document.scrollingElement;
          const form = document.querySelector(".add-task-bar");
          const submit = document.querySelector("#add-task-submit");
          // Pickerはclickのたびにtrigger/menuを作り直すので、開いた後のnodeを測る。
          document.querySelector(".theme-picker-trigger")?.click();
          const trigger = document.querySelector(".theme-picker-trigger");
          const menu = document.querySelector(".theme-picker-menu");
          const menuRect = menu?.getBoundingClientRect();
          const triggerRect = trigger?.getBoundingClientRect();
          const result = Boolean(doc && form && trigger && submit && menu && menuRect
            && menu.hidden === false
            && menuRect.width > 0
            && menuRect.height > 0
            && triggerRect && triggerRect.width > 0
            && trigger.getAttribute("title") === ${JSON.stringify(longTheme.name)}
            && doc.scrollWidth <= doc.clientWidth + 1
            && form.scrollWidth <= form.clientWidth + 1
            && trigger.getBoundingClientRect().right <= innerWidth + 1
            && submit.getBoundingClientRect().right <= innerWidth + 1
            && menu.querySelectorAll(".theme-picker-option").length >= 21
            && menu.scrollWidth <= menu.clientWidth + 1
            && menu.scrollHeight > menu.clientHeight
            && menuRect.left >= -1
            && menuRect.right <= innerWidth + 1
            && menuRect.top >= -1
            && menuRect.bottom <= innerHeight + 1);
          trigger?.click();
          return result;
        })()
      `) as boolean);
    }
    todayMini.setBounds(initialMiniBounds, false);
    mini.todayMiniResponsive = responsiveResults.every(Boolean);
    const miniInteraction = await todayMini.webContents.executeJavaScript(`
      (async () => {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (document.body.innerText.includes(${JSON.stringify(smokeTaskTitle)})) break;
          await delay(100);
        }
        const todayMiniTaskVisible = document.body.innerText.includes(${JSON.stringify(smokeTaskTitle)});
        await window.todayMiniApi.toggle(${JSON.stringify(smokeTaskId)});
        await delay(140);
        const afterToggle = await window.todayMiniApi.list();
        const todayMiniCompletionSaved = !afterToggle.some((task) => task.id === ${JSON.stringify(smokeTaskId)});
        const todayMiniOpenDetail = await window.todayMiniApi.openTask(${JSON.stringify(smokeTaskId)});
        return { todayMiniTaskVisible, todayMiniCompletionSaved, todayMiniOpenDetail };
      })()
    `) as Pick<SmokeMiniResult, "todayMiniTaskVisible" | "todayMiniCompletionSaved" | "todayMiniOpenDetail">;
    mini = { ...mini, ...miniInteraction };

    // 合成キーはwebContentsがfocusされるまで捨てられるので、キー送出前に前面へ出す。
    todayMini.focus();
    todayMini.webContents.focus();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await todayMini.webContents.executeJavaScript(`
      (() => {
        const trigger = document.querySelector(".theme-picker-trigger");
        trigger?.focus();
      })()
    `);
    await new Promise((resolve) => setTimeout(resolve, 80));
    // 最初の合成キーはwebContentsのactivationに吸われることがあるので、開くまで押し直す。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      todayMini.webContents.sendInputEvent({ type: "keyDown", keyCode: "Down" });
      todayMini.webContents.sendInputEvent({ type: "keyUp", keyCode: "Down" });
      await new Promise((resolve) => setTimeout(resolve, 60));
      const opened = await todayMini.webContents.executeJavaScript(`
        document.querySelector(".theme-picker-menu")?.hidden === false
          && document.activeElement?.classList.contains("theme-picker-option") === true
      `) as boolean;
      if (opened) break;
    }
    // 開いた直後は選択中（長いTheme名）にfocusが当たる。Upで一つ前のSmoke Themeへ移る。
    for (const keyCode of ["Up"]) {
      todayMini.webContents.sendInputEvent({ type: "keyDown", keyCode });
      todayMini.webContents.sendInputEvent({ type: "keyUp", keyCode });
    }
    // ChromiumはkeyDownだけではbutton/formを実行しない。char eventまで送って実操作と同じにする。
    todayMini.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
    todayMini.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    todayMini.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    mini.todayMiniThemeKeyboard = await todayMini.webContents.executeJavaScript(`
      document.querySelector(".theme-picker-trigger")?.getAttribute("title") === "Smoke Theme"
        && document.activeElement === document.querySelector(".theme-picker-trigger")
    `) as boolean;
    const miniAddedTitle = `Today追加動作確認 ${Date.now()}`;
    await todayMini.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector("#add-task-input");
        input.value = ${JSON.stringify(miniAddedTitle)};
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      })()
    `);
    todayMini.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
    todayMini.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    todayMini.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
    const enterAdded = await todayMini.webContents.executeJavaScript(`
      (async () => {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const input = document.querySelector("#add-task-input");
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (document.body.innerText.includes(${JSON.stringify(miniAddedTitle)})) break;
          await delay(100);
        }
        const added = (await window.todayMiniApi.list()).find((task) => task.title === ${JSON.stringify(miniAddedTitle)});
        return Boolean(added?.themeName === "Smoke Theme" && input.value === "" && document.querySelector(".theme-picker-trigger")?.getAttribute("title") === "Smoke Theme");
      })()
    `) as boolean;
    const enterSavedTask = (workspaceRepository.list("task") as Entity[])
      .find((task) => task.title === miniAddedTitle);
    const miniButtonTitle = `Today＋動作確認 ${Date.now()}`;
    const submitPoint = await todayMini.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector("#add-task-input");
        input.value = ${JSON.stringify(miniButtonTitle)};
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const rect = document.querySelector("#add-task-submit")?.getBoundingClientRect();
        return rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null;
      })()
    `) as { x: number; y: number } | null;
    if (submitPoint) {
      todayMini.webContents.sendInputEvent({ type: "mouseDown", x: submitPoint.x, y: submitPoint.y, button: "left", clickCount: 1 });
      todayMini.webContents.sendInputEvent({ type: "mouseUp", x: submitPoint.x, y: submitPoint.y, button: "left", clickCount: 1 });
    }
    const buttonAdded = await todayMini.webContents.executeJavaScript(`
      (async () => {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (document.body.innerText.includes(${JSON.stringify(miniButtonTitle)})) break;
          await delay(100);
        }
        return Boolean(document.body.innerText.includes(${JSON.stringify(miniButtonTitle)})
          && document.querySelector("#add-task-input")?.value === "");
      })()
    `) as boolean;
    const buttonSavedTask = (workspaceRepository.list("task") as Entity[])
      .find((task) => task.title === miniButtonTitle);
    mini.todayMiniThemeSaved = enterAdded
      && enterSavedTask?.project_id === smokeThemeId
      && buttonAdded
      && buttonSavedTask?.project_id === smokeThemeId;

    const failedTheme = todayMiniThemeMatrix.at(-1)!;
    await todayMini.webContents.executeJavaScript(`
      (() => {
        const trigger = document.querySelector(".theme-picker-trigger");
        trigger?.click();
        [...document.querySelectorAll(".theme-picker-option")]
          .find((candidate) => candidate.getAttribute("title") === ${JSON.stringify(failedTheme.name)})?.click();
        const input = document.querySelector("#add-task-input");
        input.value = "失敗しても残る入力";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `);
    workspaceRepository.remove("theme", failedTheme.id);
    todayMini.webContents.send(IPC.todayMiniRefresh);
    mini.todayMiniFailurePreserved = await todayMini.webContents.executeJavaScript(`
      (async () => {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (document.querySelector(".theme-picker-trigger")?.dataset.unavailable === "true") break;
          await delay(50);
        }
        document.querySelector("#add-task-form")?.requestSubmit();
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (document.querySelector(".state.is-error")) break;
          await delay(100);
        }
        return document.querySelector("#add-task-input")?.value === "失敗しても残る入力"
          && document.querySelector(".theme-picker-trigger")?.getAttribute("title") === ${JSON.stringify(`${todayMiniThemeMatrix.at(-1)!.name}（利用不可）`)}
          && document.querySelector(".theme-picker-trigger")?.dataset.unavailable === "true"
          && document.querySelector(".theme-picker-trigger .theme-picker-color")?.style.getPropertyValue("--theme-picker-color") === "var(--color-border-strong)"
          && !document.querySelector("#add-task-submit")?.disabled;
      })()
    `) as boolean;
  }
  const detailOpened = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const drawer = document.querySelector(".drawer-form");
        const title = drawer?.querySelector('input[name="title"]');
        if (title?.value === ${JSON.stringify(smokeTaskTitle)}) return true;
        await delay(100);
      }
      return false;
    })()
  `) as boolean;
  mini.todayMiniOpenDetail = mini.todayMiniOpenDetail && detailOpened;
  recordSmoke("markdown-edit-complete");

  window.show();
  window.focus();
  window.webContents.focus();
  const settingsNavigation = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (finder, label, attempts = 50) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const target = finder();
          if (target) return target;
          await delay(100);
        }
        throw new Error(label + " が見つかりません。画面: " + document.body.innerText.slice(0, 1000));
      };
      const activeCategory = (label) => [...document.querySelectorAll(".settings-category-nav button")]
        .find((button) => button.getAttribute("aria-current") === "page" && button.querySelector("strong")?.textContent?.trim() === label);
      const storageIsActive = () => window.location.hash === "#settings/storage" && Boolean(activeCategory("Storage & Files"));
      window.location.hash = "settings/storage";
      await waitFor(storageIsActive, "Settings Storage deep link");
      const appearanceButton = [...document.querySelectorAll(".settings-category-nav button")]
        .find((button) => button.querySelector("strong")?.textContent?.trim() === "Appearance");
      if (!appearanceButton) throw new Error("Appearance category button が見つかりません。");
      appearanceButton.focus();
      return {
        storageDeepLink: storageIsActive(),
        categoryButtonFocused: document.activeElement === appearanceButton,
      };
    })()
  `) as {
    storageDeepLink: boolean;
    categoryButtonFocused: boolean;
  };
  const nativeFocusBeforeKey = await window.webContents.executeJavaScript(`
    (() => {
      const target = [...document.querySelectorAll(".settings-category-nav button")]
        .find((button) => button.querySelector("strong")?.textContent?.trim() === "Appearance");
      window.__taskenSmokeInputTrusted = false;
      window.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.isTrusted) window.__taskenSmokeInputTrusted = true;
      });
      target?.focus();
      return { focused: document.activeElement === target };
    })()
  `) as {
    focused: boolean;
  };
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
  window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
  const settingsKeyboard = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const appearanceIsActive = () => window.location.hash === "#settings/appearance"
        && Boolean([...document.querySelectorAll(".settings-category-nav button")]
          .find((button) => button.getAttribute("aria-current") === "page" && button.querySelector("strong")?.textContent?.trim() === "Appearance"));
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (appearanceIsActive()) break;
        await delay(100);
      }
      return {
        appearanceIsActive: appearanceIsActive(),
        inputTrusted: Boolean(window.__taskenSmokeInputTrusted),
      };
    })()
  `) as {
    appearanceIsActive: boolean;
    inputTrusted: boolean;
  };
  const settingsHistory = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (finder, label, attempts = 50) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const target = finder();
          if (target) return target;
          await delay(100);
        }
        throw new Error(label + " が見つかりません。画面: " + document.body.innerText.slice(0, 1000));
      };
      const storageIsActive = () => window.location.hash === "#settings/storage"
        && Boolean([...document.querySelectorAll(".settings-category-nav button")]
          .find((button) => button.getAttribute("aria-current") === "page" && button.querySelector("strong")?.textContent?.trim() === "Storage & Files"));
      history.back();
      await waitFor(storageIsActive, "Settings history.back Storage restore");
      return { storageRestored: storageIsActive() };
    })()
  `) as { storageRestored: boolean };
  recordSmoke("settings-complete");
  const settingsStorageBeforeReload = settingsHistory.storageRestored;

  window.webContents.once("did-finish-load", async () => {
    try {
      const afterReload = await window.webContents.executeJavaScript(`
        Promise.all([
          window.api.entities.list("note"),
          window.api.preferences.get("themeMode"),
          window.api.preferences.get("aiVisibilityDefault"),
          window.api.entities.list("task"),
        ]).then(async ([notes, themeMode, aiVisibilityDefault, tasks]) => {
          const markdown = notes.find((note) => note.title === ${JSON.stringify(markdownTitle)});
          const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const settingsReloadRestored = await (async () => {
            for (let attempt = 0; attempt < 50; attempt += 1) {
              const restored = window.location.hash === "#settings/storage"
                && [...document.querySelectorAll(".settings-category-nav button")]
                  .some((button) => button.getAttribute("aria-current") === "page" && button.querySelector("strong")?.textContent?.trim() === "Storage & Files");
              if (restored) return true;
              await delay(100);
            }
            return false;
          })();
          return ({
          persisted: notes.some((note) => note.title === ${JSON.stringify(testTitle)}),
          markdownPersisted: Boolean(markdown?.body_markdown?.includes("Markdown Preview")),
          // Smoke Theme chipの選択値がcanonical Noteへ届くことを厳密に確認する。
          markdownThemeLinked: markdown?.project_id === ${JSON.stringify(smokeThemeId)},
          markdownFrontmatterPersisted: Boolean(markdown?.body_markdown?.includes("type: report")),
          markdownLiveEditPersisted: Boolean(markdown?.body_markdown?.includes("Live edit smoke")),
          markdownPastePersisted: Boolean(markdown?.body_markdown?.includes("## Pasted Markdown Heading") && markdown?.body_markdown?.includes("**Pasted Bold Text**")),
          themeMode,
          aiVisibilityDefault: Array.isArray(aiVisibilityDefault) ? aiVisibilityDefault.join(",") : String(aiVisibilityDefault),
          aiTaskMetadataPersisted: Boolean(
            tasks.find((task) => task.id === ${JSON.stringify(smokeTaskId)})?.ai_summary === "Todayミニの動作確認"
          ),
          settingsReloadRestored,
        });
        })
      `) as SmokeReloadResult;
      const result = {
        ...created,
        persistedAfterReload: afterReload.persisted,
        markdownPersistedAfterReload: afterReload.markdownPersisted,
        markdownThemeLinkedAfterReload: afterReload.markdownThemeLinked,
        markdownFrontmatterPersistedAfterReload: afterReload.markdownFrontmatterPersisted,
        markdownLiveEditPersistedAfterReload: afterReload.markdownLiveEditPersisted,
        markdownPastePersistedAfterReload: afterReload.markdownPastePersisted,
        themeModeAfterReload: afterReload.themeMode,
        aiVisibilityDefaultAfterReload: afterReload.aiVisibilityDefault,
        aiMetadataPersistedAfterReload: afterReload.aiTaskMetadataPersisted,
        settingsDeepLink: settingsNavigation.storageDeepLink,
        settingsKeyboardFocus: settingsNavigation.categoryButtonFocused && nativeFocusBeforeKey.focused,
        settingsKeyboardTransition: settingsKeyboard.appearanceIsActive,
        settingsHistoryBackRestored: settingsHistory.storageRestored,
        settingsReloadRestored: afterReload.settingsReloadRestored,
        settingsKeyboardInputTrusted: settingsKeyboard.inputTrusted,
        settingsStorageBeforeReload,
        ...mini,
      };
      console.log(JSON.stringify(result));
      const passed = Boolean(
        result.persistedAfterReload
        && result.markdownPersistedAfterReload
        && result.markdownThemeLinkedAfterReload
        && result.markdownFrontmatterPersistedAfterReload
        && result.markdownLiveEditPersistedAfterReload
        && result.markdownPastePersistedAfterReload
        && result.saved
        && result.markdownSaved
        && result.markdownPreviewRendered
        && result.markdownFrontmatterRendered
        && result.markdownMathRendered
        && result.markdownImageRendered
        && result.notesPanePreviewRendered
        && result.notesPaneMathRendered
        && result.notesLiveEditSaved
        && result.notesMarkdownPasteRendered
        && result.notesEditPreviewAligned
        && result.notesEditReopened
        && result.notesMermaidRenderedInEdit
        && result.notesCodeBlockFullWidth
        && result.notesFootnoteEditPreviewAligned
        && result.rawCopyNotified
        && result.rootReady
        && result.todayMiniOpened
        && result.todayMiniAlwaysOnTop
        && result.todayMiniTaskVisible
        && result.todayMiniCompletionSaved
        && result.todayMiniOpenDetail
        && result.todayMiniToggleRestored
        && result.todayMiniResponsive
        && result.todayMiniThemeKeyboard
        && result.todayMiniThemeSaved
        && result.todayMiniFailurePreserved
        && result.clipboardWritten
        && result.sketchClipboardWritten
        && result.sketchClipboardPasted
        && result.sketchCreatedAndOpened
        && result.stickyAutosaveSaved
        && result.stickyImeSaved
        && result.stickyResizePreserved
        && result.stickyNativeCloseFlushed
        && result.themeMode === "dark"
        && result.themeModeAfterReload === "dark"
        && result.aiMetadataPersisted
        && result.aiThemeDefaultPersisted
        && result.aiMetadataRejectedInvalid
        && result.aiVisibilityDefaultSaved === "coding_agent"
        && result.aiMetadataPersistedAfterReload
        && result.aiVisibilityDefaultAfterReload === "coding_agent"
        && result.settingsDeepLink
        && result.settingsKeyboardFocus
        && result.settingsKeyboardInputTrusted
        && result.settingsKeyboardTransition
        && result.settingsHistoryBackRestored
        && result.settingsStorageBeforeReload
        && result.settingsReloadRestored
        && result.audioMetadataLoaded
        && result.audioRangeVerified
        && result.batchTranscriptionPreview
        && result.batchTranscriptionCompleted
        && result.batchTranscriptionProvenance
        && result.microphoneRecorded
        && result.microphonePlayback
        && result.microphoneCaptureMethod
        && result.microphoneRangeVerified
        && result.importedVideoMetadataLoaded
        && result.importedVideoCanPlay
        && result.importedVideoSeeked
        && result.importedVideoVolumePreserved
        && result.importedVideoRangeVerified
        && result.screenRecordingMetadataLoaded
        && result.screenRecordingCanPlay
        && result.screenRecordingSeeked
        && result.screenRecordingVolumePreserved
        && result.screenRecordingRangeVerified
        && result.screenRecordingPausedResumed
        && (!isPackagedSmokeRequired || result.appIsPackaged)
      );
      recordSmoke(passed ? "restart-ready" : "failed", result);
      app.exit(passed ? 0 : 1);
    } catch (error) {
      console.error(error);
      recordSmoke("reload-check-failed", { error: String(error) });
      app.exit(1);
    }
  });
  recordSmoke("reload-start");
  window.reload();
}

async function runSmokeRestartTest(window: BrowserWindow): Promise<void> {
  recordSmoke("restart-renderer-loaded", { audioArtifactId: smokeMediaArtifactId, microphoneArtifactId: smokeMicrophoneArtifactId, importedVideoArtifactId: smokeImportedVideoArtifactId, screenRecordingArtifactId: smokeScreenRecordingArtifactId, screenRecordingPausedResumed: smokeScreenRecordingPausedResumed, smokeTaskId: smokeVideoOwnerId, appIsPackaged: app.isPackaged });
  const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!idPattern.test(smokeMediaArtifactId) || !idPattern.test(smokeMicrophoneArtifactId) || !idPattern.test(smokeImportedVideoArtifactId) || !idPattern.test(smokeScreenRecordingArtifactId) || !idPattern.test(smokeVideoOwnerId) || !smokeScreenRecordingPausedResumed) {
    throw new Error("restart Media Artifact IDs are invalid");
  }
  const renderer = await window.webContents.executeJavaScript(`
    (async () => {
      const artifact = await window.api.entities.get("artifact", ${JSON.stringify(smokeMediaArtifactId)});
      if (!artifact || artifact.media_kind !== "audio" || artifact.mime_type !== "audio/wav") throw new Error("restarted imported audio Artifact missing");
      if (JSON.stringify(artifact).includes("stored_path")) throw new Error("restarted audio Artifact leaked path");
      const transcription = await window.api.batchTranscription.history({ artifactId: artifact.id });
      const revision = transcription.revisions.at(-1);
      const transcriptionRestarted = transcription.revisions.length === 1
        && revision?.status === "completed"
        && revision.raw_text === "Tasken packaged fake transcript"
        && revision.source_artifact_id === artifact.id
        && revision.provider_profile_id === "tasken-smoke-provider"
        && revision.model_id === "tasken-smoke-transcriber"
        && revision.processing_mode === "local";
      const playable = await new Promise((resolve, reject) => {
        const audio = new Audio();
        const timer = setTimeout(() => reject(new Error("restart audio playback timeout")), 15000);
        const done = () => {
          if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
          clearTimeout(timer);
          resolve(audio.duration > 0);
        };
        audio.preload = "auto";
        audio.onloadedmetadata = done;
        audio.oncanplay = done;
        audio.onerror = () => { clearTimeout(timer); reject(new Error("restart audio playback failed")); };
        audio.src = "tasken-media://artifact/" + encodeURIComponent(artifact.id);
      });
      const microphoneArtifact = await window.api.entities.get("artifact", ${JSON.stringify(smokeMicrophoneArtifactId)});
      if (!microphoneArtifact || microphoneArtifact.media_kind !== "audio" || microphoneArtifact.mime_type !== "audio/webm") throw new Error("restarted recorded audio Artifact missing");
      if (JSON.stringify(microphoneArtifact).includes("stored_path")) throw new Error("restarted microphone Artifact leaked path");
      const microphonePlayable = await new Promise((resolve, reject) => {
        const audio = new Audio();
        const timer = setTimeout(() => reject(new Error("restart microphone playback timeout")), 15000);
        const done = () => {
          if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
          clearTimeout(timer);
          resolve(audio.duration > 0);
        };
        audio.preload = "auto";
        audio.onloadedmetadata = done;
        audio.oncanplay = done;
        audio.onerror = () => { clearTimeout(timer); reject(new Error("restart microphone playback failed")); };
        audio.src = "tasken-media://artifact/" + encodeURIComponent(microphoneArtifact.id);
      });
      const videoOwner = await window.api.entities.get("task", ${JSON.stringify(smokeVideoOwnerId)});
      if (!videoOwner || videoOwner.id !== ${JSON.stringify(smokeVideoOwnerId)}) throw new Error("restarted video owner missing");
      const verifyVideo = async (artifactId, label, expectedCaptureMethod, allowedMimeTypes) => {
        const videoArtifact = await window.api.entities.get("artifact", artifactId);
        if (!videoArtifact || videoArtifact.media_kind !== "video" || !allowedMimeTypes.includes(videoArtifact.mime_type)) throw new Error("restarted " + label + " Artifact missing");
        if (expectedCaptureMethod === null ? Object.hasOwn(videoArtifact, "capture_method") : videoArtifact.capture_method !== expectedCaptureMethod) {
          throw new Error("restarted " + label + " provenance mismatch");
        }
        if (JSON.stringify(videoArtifact).match(/stored_path|original_path|target|sourcePath/)) throw new Error("restarted " + label + " Artifact leaked path");
        if (videoArtifact.source_type !== "task" || videoArtifact.source_id !== ${JSON.stringify(smokeVideoOwnerId)} || videoOwner.id !== videoArtifact.source_id) {
          throw new Error("restarted " + label + " owner backlink mismatch");
        }
        const playback = await new Promise((resolve, reject) => {
          const video = document.createElement("video");
          const timer = setTimeout(() => reject(new Error("restart " + label + " playback timeout")), 15000);
          let canPlay = false;
          let seekRequested = false;
          video.muted = true;
          video.preload = "auto";
          video.oncanplay = async () => {
            if (seekRequested) return;
            seekRequested = true;
            try {
              await video.play();
              canPlay = !video.paused;
              video.pause();
              video.currentTime = Math.min(0.25, video.duration / 2);
            } catch (error) { clearTimeout(timer); reject(error); }
          };
          video.onseeked = () => { clearTimeout(timer); resolve({ canPlay, seeked: video.currentTime > 0, metadata: video.videoWidth > 0 && video.videoHeight > 0 }); };
          video.onerror = () => { clearTimeout(timer); reject(new Error("restart " + label + " playback failed")); };
          video.src = "tasken-media://artifact/" + encodeURIComponent(videoArtifact.id);
        });
        return { artifactId: videoArtifact.id, ownerLinked: true, ...playback };
      };
      const importedVideo = await verifyVideo(${JSON.stringify(smokeImportedVideoArtifactId)}, "imported video", null, ["video/webm"]);
      const screenRecording = await verifyVideo(${JSON.stringify(smokeScreenRecordingArtifactId)}, "screen recording", "screen_recording", ["video/mp4", "video/webm"]);
      return { artifactId: artifact.id, playable, transcriptionRestarted, microphoneArtifactId: microphoneArtifact.id, microphonePlayable, importedVideo, screenRecording };
    })()
  `) as { artifactId: string; playable: boolean; transcriptionRestarted: boolean; microphoneArtifactId: string; microphonePlayable: boolean; importedVideo: { artifactId: string; ownerLinked: boolean; canPlay: boolean; seeked: boolean; metadata: boolean }; screenRecording: { artifactId: string; ownerLinked: boolean; canPlay: boolean; seeked: boolean; metadata: boolean } };
  const rangeVerified = await verifySmokeMediaRange(renderer.artifactId);
  const microphoneRangeVerified = await verifySmokeVideoRange(renderer.microphoneArtifactId);
  const importedVideoRangeVerified = await verifySmokeVideoRange(renderer.importedVideo.artifactId);
  const screenRecordingRangeVerified = await verifySmokeVideoRange(renderer.screenRecording.artifactId);
  const passed = renderer.playable && rangeVerified && renderer.transcriptionRestarted && renderer.microphonePlayable && microphoneRangeVerified
    && renderer.importedVideo.canPlay && renderer.importedVideo.seeked && renderer.importedVideo.metadata && renderer.importedVideo.ownerLinked && importedVideoRangeVerified
    && renderer.screenRecording.canPlay && renderer.screenRecording.seeked && renderer.screenRecording.metadata && renderer.screenRecording.ownerLinked && screenRecordingRangeVerified
    && smokeScreenRecordingPausedResumed
    && (!isPackagedSmokeRequired || app.isPackaged);
  recordSmoke(passed ? "passed" : "failed", {
    audioArtifactId: renderer.artifactId,
    playable: renderer.playable,
    rangeVerified,
    batchTranscriptionRestarted: renderer.transcriptionRestarted,
    microphoneArtifactId: renderer.microphoneArtifactId,
    microphonePlayable: renderer.microphonePlayable,
    microphoneRangeVerified,
    importedVideoArtifactId: renderer.importedVideo.artifactId,
    importedVideoCanPlay: renderer.importedVideo.canPlay,
    importedVideoSeeked: renderer.importedVideo.seeked,
    importedVideoMetadataLoaded: renderer.importedVideo.metadata,
    importedVideoRangeVerified,
    importedVideoOwnerLinked: renderer.importedVideo.ownerLinked,
    screenRecordingArtifactId: renderer.screenRecording.artifactId,
    screenRecordingCanPlay: renderer.screenRecording.canPlay,
    screenRecordingSeeked: renderer.screenRecording.seeked,
    screenRecordingMetadataLoaded: renderer.screenRecording.metadata,
    screenRecordingRangeVerified,
    screenRecordingOwnerLinked: renderer.screenRecording.ownerLinked,
    screenRecordingPausedResumed: smokeScreenRecordingPausedResumed,
    smokeTaskId: smokeVideoOwnerId,
    appIsPackaged: app.isPackaged,
  });
  app.exit(passed ? 0 : 1);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#F4EEEC",
    title: APP_NAME,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#FBF8F6",
      symbolColor: "#3D3532",
      height: 40,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 範囲録画はRendererのcanvasで切り抜く。録画中に本体を最小化しても
      // frame生成を止めず、MediaRecorderへ映像を渡し続ける。
      backgroundThrottling: false,
      // TODO: sandbox:true currently prevents window.api/window.researchDesk from being exposed.
      // Keep the verified contextIsolation/nodeIntegration boundary until the preload bridge is migrated.
      sandbox: false,
      preload: path.join(__dirname, "../preload/index.mjs"),
    },
  });

  if (isSmokeTest) {
    // Show the smoke-only window before the renderer starts so IntersectionObserver
    // observes the same visible lazy path as production without stealing focus.
    window.setOpacity(0);
    window.showInactive();
  }

  window.once("ready-to-show", () => {
    readyMainWindows.add(window);
    if (!isSmokeTest) window.show();
  });
  window.webContents.once("did-finish-load", () => {
    if (isSmokeTest) {
      const smokeRun = isSmokeRestartCheck ? runSmokeRestartTest(window) : runSmokeTest(window);
      smokeRun.catch(async (error: unknown) => {
        let diagnostics: unknown = null;
        try {
          diagnostics = await window.webContents.executeJavaScript(`
            (() => ({
              url: location.href,
              title: document.title,
              notePane: Boolean(document.querySelector(".note-preview-panel")),
              mermaidBlocks: [...document.querySelectorAll(".note-mermaid-code-block")].map((block) => ({
                className: block.className,
                text: block.textContent?.slice(0, 300) || "",
                svgCount: block.querySelectorAll(".md-mermaid-svg svg").length,
                errorText: block.querySelector(".md-mermaid-error")?.textContent || "",
                html: block.innerHTML.slice(0, 1200),
              })),
              rendererErrors: window.__taskenSmokeDiagnostics?.rendererErrors || [],
            }))()
          `);
        } catch (diagnosticError) {
          diagnostics = { captureError: String(diagnosticError) };
        }
        const failure = { error: String(error), diagnostics };
        console.error("Electron smoke failure: " + JSON.stringify(failure));
        recordSmoke("failed", failure);
        app.exit(1);
      });
    }
  });
  window.webContents.on("console-message", ({ level, message, lineNumber: line, sourceId }) => {
    if (!isSmokeTest) return;
    if (level !== "warning" && level !== "error" && !/mermaid|markdown|unhandled|exception/i.test(message)) return;
    const entry = { level, message, line, sourceId };
    recordSmoke("renderer-console", entry);
    console.error("Renderer console: " + JSON.stringify(entry));
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    recordSmoke("load-failed", { code, description });
    if (isSmokeTest) app.exit(1);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    recordSmoke("renderer-gone", { ...details });
    if (isSmokeTest) app.exit(1);
  });
  window.webContents.on("context-menu", (_event, params) => {
    showMainContextMenu(window, params);
  });
  let closeFlushPending = false;
  let closeApproved = false;
  window.on("close", (event) => {
    if (closeApproved || appQuitApproved) return;
    event.preventDefault();
    if (closeFlushPending) return;
    closeFlushPending = true;
    void requestRendererFlush(window).then((ok) => {
      closeFlushPending = false;
      if (!ok) {
        console.warn("Main windowの終了前flushが完了しなかったため、ウィンドウを開いたままにします。");
        return;
      }
      closeApproved = true;
      if (!window.isDestroyed()) window.close();
    });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!openAllowedExternalUrl(url)) {
      console.warn(`Blocked external URL: ${url}`);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      if (!openAllowedExternalUrl(url)) {
        console.warn(`Blocked navigation URL: ${url}`);
      }
    }
  });
  return window;
}

/**
 * 拒否はvideo無しのcallbackで表す。Electronは内部でこれをgetDisplayMediaのrejectへ
 * 変換する際にTypeErrorを投げ、握られないままunhandled rejectionとして残るため、
 * 拒否経路をここへ集約して捕まえる。
 */
function denyDisplayMediaRequest(callback: (streams: Electron.Streams) => void): void {
  try {
    callback({});
  } catch (error) {
    logMain("warn", "screen-recording:display-request", "拒否callbackが失敗した", error);
  }
}

function installScreenRecordingDisplayHandler(screenRecording: ScreenRecordingService): void {
  electronSession.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const frame = request.frame;
    if (!frame || frame.detached) {
      denyDisplayMediaRequest(callback);
      return;
    }
    try {
      const sender = webContents.fromFrame(frame);
      if (!sender) throw new Error("画面録画の要求元が閉じられました。もう一度選択してください。");
      const parsedFrameUrl = new URL(frame.url);
      const frameOrigin = parsedFrameUrl.protocol === "file:" ? "file://" : parsedFrameUrl.origin;
      // Chromiumはsecurity originを "http://localhost:5173/" のように末尾スラッシュ付きで渡す。
      // 生の文字列比較にすると、dev serverで動かしたときだけ必ず不一致になる。
      if (!screenRecordingOriginsMatch(request.securityOrigin, frameOrigin)) {
        throw new Error(`画面録画のoriginが一致しません。画面を再読み込みしてください。(request=${request.securityOrigin} frame=${frameOrigin})`);
      }
      const grant = await screenRecording.consumePermissionRequest({
        senderWebContentsId: sender.id,
        frameTreeNodeId: frame.frameTreeNodeId,
        frameIsMain: sender.mainFrame === frame,
        frameDetached: frame.detached,
        securityOrigin: frameOrigin,
        userGesture: request.userGesture,
        videoRequested: request.videoRequested,
        audioRequested: request.audioRequested,
      });
      callback({
        video: grant.source,
        ...(grant.displayAudio ? { audio: grant.displayAudio } : {}),
      });
    } catch (error) {
      // 拒否理由はRendererへ渡さない。ただしMainのログには残す。
      // ここを名前だけにすると、録画が始まらない理由へ誰も到達できない。
      logMain("warn", "screen-recording:display-request", "permission grantを拒否した", error);
      denyDisplayMediaRequest(callback);
    }
  }, { useSystemPicker: false });
}

async function startDesktopApp(): Promise<void> {
  await app.whenReady();
  migrateLegacyUserDataIfNeeded();
  configureMainLog(app.getPath("userData"));
  registerAttachmentProtocol();
  workspaceRepository = new WorkspaceDatabase(path.join(app.getPath("userData"), "research-desk.sqlite"));
  if (isMcpPackageSmoke) {
    workspaceRepository.ensureMcpPackageSmokeFixture();
    if (mcpPackageSmokeProposalId) {
      if (!/^[0-9a-f-]{36}$/i.test(mcpPackageSmokeProposalId)) throw new Error("MCP package smoke Proposal IDが不正です。");
      const verification = workspaceRepository.verifyMcpPackageSmokeProposal(mcpPackageSmokeProposalId);
      if (mcpPackageSmokeResultPath) {
        fs.writeFileSync(path.resolve(mcpPackageSmokeResultPath), JSON.stringify(verification), { flag: "w" });
      }
    }
    if (isMcpPackageSmokeVerifyOnly) {
      workspaceRepository.db.close();
      app.exit(0);
      return;
    }
  }
  taskenCoreRuntime = new TaskenCoreRuntime(app.getPath("userData"), workspaceRepository);
  await taskenCoreRuntime.start();
  let smokeAudioSourcePath = "";
  if (isSmokeTest && !isSmokeRestartCheck) {
    const managedDirectory = path.join(app.getPath("userData"), "smoke-managed-artifacts");
    workspaceRepository.setPreference("artifactDirectory", managedDirectory);
    smokeAudioSourcePath = path.join(app.getPath("userData"), "smoke-audio.wav");
    fs.writeFileSync(smokeAudioSourcePath, tinyPcmWav(), { flag: "wx" });
    smokeVideoSourcePath = path.join(app.getPath("userData"), "smoke-video.webm");
    fs.writeFileSync(smokeVideoSourcePath, tinyVp8Webm(), { flag: "wx" });
  }
  const applicationCommands = new ApplicationCommandService(workspaceRepository);
  const workspaceService = new WorkspaceService(
    workspaceRepository,
    app.getPath("userData"),
    undefined,
    new TaskenCoreClient({ userDataPath: app.getPath("userData") }),
  );
  const automaticSnapshotBackup = new AutomaticSnapshotBackupService({
    repository: workspaceRepository,
    defaultDirectory: path.join(app.getPath("userData"), "Backups"),
    enabled: workspaceRepository.getPreference("automaticSnapshotBackupEnabled") !== false,
    directory: String(workspaceRepository.getPreference("automaticSnapshotBackupDirectory") || ""),
    generations: Number(workspaceRepository.getPreference("automaticSnapshotBackupGenerations")),
    writeSnapshot: (workspace, filePath) => createSnapshot(workspace).writeZip(filePath),
    verifySnapshot: (filePath) => readSnapshot(filePath).workspace,
    log: (level, message, error) => logMain(level, "automatic-snapshot", message, error),
  });
  registerWebArtifactProtocol(workspaceService);
  const mediaCapture = new MediaCaptureService({
    userDataPath: app.getPath("userData"),
    repository: workspaceRepository,
    commands: applicationCommands,
    resolveManagedDirectory: (themeId) => workspaceService.resolveManagedArtifactDirectory(themeId),
    openPath: (filePath) => shell.openPath(filePath),
  });
  const aiProvider = new AiProviderService(app.getPath("userData"));
  const batchTranscriptionRepository = new BatchTranscriptionRepository(workspaceRepository);
  const batchTranscription = new BatchTranscriptionService({
    repository: batchTranscriptionRepository,
    entityRepository: workspaceRepository,
    mediaCapture,
    providerRegistry: isSmokeTest ? {
      resolve: () => ({
        binding: {
          feature: "transcript_batch",
          provider_profile_id: "tasken-smoke-provider",
          provider_label: "Tasken packaged fake provider",
          model_profile_id: "tasken-smoke-model",
          model_id: "tasken-smoke-transcriber",
          processing_mode: "local",
          enabled: true,
          credential_configured: false,
          model_lifecycle: "available",
          capabilities: ["batch_transcription", "local_processing"],
          max_file_size: 1024 * 1024,
          supported_mime_types: ["audio/wav", "audio/webm"],
        },
        provider: {
          providerProfileId: "tasken-smoke-provider",
          transcribe: ({ source, fileSize }: { source: { fileDescriptor: number }; fileSize: number }) => {
            const bytes = Buffer.alloc(fileSize);
            const count = fs.readSync(source.fileDescriptor, bytes, 0, fileSize, 0);
            if (count !== fileSize || !bytes.subarray(0, 4).equals(Buffer.from("RIFF"))) throw new Error("fake transcription source mismatch");
            return Promise.resolve({ rawText: "Tasken packaged fake transcript", language: "ja" });
          },
        },
      }),
    } : { resolve: () => aiProvider.resolveBatchTranscriptionProvider() },
    confirmationSecret: workspaceRepository.ensureMeta(
      "batch_transcription_confirmation_secret",
      `${randomUUID()}${randomUUID()}`,
    ),
    resolveVisibility: (artifact: Entity | null) => {
      const themeId = typeof artifact?.theme_id === "string" ? artifact.theme_id : null;
      const theme = themeId
        ? workspaceRepository.get("theme", themeId) || workspaceRepository.get("project", themeId)
        : null;
      return resolveAiVisibility({
        entity: artifact,
        theme,
        workspaceDefault: workspaceRepository.getPreference("aiVisibilityDefault"),
      }).audiences;
    },
    notifyChanged: () => notifyMainWindowRefresh(),
  });
  const screenRecording = new ScreenRecordingService();
  installScreenRecordingDisplayHandler(screenRecording);
  smokeMediaCaptureService = isSmokeTest ? mediaCapture : null;
  const mediaRecovery = mediaCapture.recoverPending();
  if (mediaRecovery.recovered || mediaRecovery.pending) {
    console.info(`Media Capture recovery: recovered=${mediaRecovery.recovered}, pending=${mediaRecovery.pending}`);
  }
  if (smokeAudioSourcePath) mediaCapture.prepareFile(smokeAudioSourcePath, null);
  registerMediaProtocol(mediaCapture);
  sharedFolderSyncService = new SharedFolderSyncService(
    workspaceRepository,
    notifyMainWindowRefresh,
    path.join(app.getPath("userData"), "attachments", "markdown-images"),
  );
  registerIpc(
    workspaceRepository,
    workspaceService,
    automaticSnapshotBackup,
    sharedFolderSyncService,
    aiProvider,
    new CalendarService(app.getPath("userData"), safeStorage, fetch, (url) => shell.openExternal(url)),
    applicationCommands,
    mediaCapture,
    batchTranscription,
    screenRecording,
    (types) => {
      notifyMainWindowRefresh();
      notifyTodayMiniRefresh(types);
    },
    notifyCommandApplied, notifyTodayMiniRefresh,
  );
  // 切り離しウィンドウの共通基盤（#290）。位置・サイズは端末ごとの見え方なので
  // 正本DBではなくuserData配下のJSONへ置き、別端末へ同期させない。
  satelliteWindows = createSatelliteWindowRegistry({
    stateFilePath: path.join(app.getPath("userData"), "satellite-windows.json"),
    getAppIconPath,
    // 付箋の開閉を本体の一覧へ即時反映する（#298）。
    onChanged: () => notifyMemoStickyWindowsChanged(),
    resolvePageUrl: (page) => (
      process.env.ELECTRON_RENDERER_URL
        ? { url: `${process.env.ELECTRON_RENDERER_URL}/${page}.html` }
        : { file: path.join(__dirname, `../renderer/${page}.html`) }
    ),
  });
  ipcMain.handle(IPC.satelliteWindowState, () => ({
    todayOpen: isVisibleWindow(todayMiniController?.getWindow() || null),
    openMemoIds: memoStickyController?.visibleMemoIds() || [],
    stickyMemoIds: memoStickyController?.stickyMemoIds() || [],
    alwaysOnTopMemoIds: memoStickyController?.alwaysOnTopMemoIds() || [],
  } satisfies SatelliteWindowStatePayload));
  memoStickyController = createMemoStickyController({
    repository: workspaceRepository,
    satelliteWindows,
    showMainWindow,
    notifyWorkspaceChanged: notifyMainWindowRefresh,
    notifyStickyStateChanged: notifyMemoStickyWindowsChanged,
    requestRendererFlush,
    isAppQuitApproved: () => appQuitApproved,
  });
  memoStickyController.registerIpc();
  noteWindowController = createNoteWindowController({
    repository: workspaceRepository,
    satelliteWindows,
    showMainWindow,
    isAppQuitApproved: () => appQuitApproved,
  });
  noteWindowController.registerIpc();
  taskenRootController = createTaskenRootController({
    getPreference: (key) => workspaceRepository.getPreference(key),
    setPreference: (key, value) => { workspaceRepository.setPreference(key, value); },
    getAppIconPath,
    showMainTarget: (request: RootOpenRequest) => {
      const mainWindow = showMainWindow();
      const send = () => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.workspaceOpenRootTarget, request);
      };
      if (readyMainWindows.has(mainWindow)) send();
      else mainWindow.webContents.once("did-finish-load", send);
    },
  });
  taskenRootController.registerIpc();
  quickCaptureController = createQuickCaptureController({
    repository: workspaceRepository,
    notifyWorkspaceChanged: notifyMainWindowRefresh,
    notifyCommandApplied,
    executeCommand: (envelope) => applicationCommands.execute(envelope),
  });
  quickCaptureController.registerIpc();
  todayMiniController = createTodayMiniController({
    repository: workspaceRepository,
    satelliteWindows,
    showMainWindow,
    notifyWorkspaceChanged: notifyMainWindowRefresh,
    notifyCommandApplied,
    executeCommand: (envelope) => applicationCommands.execute(envelope),
  });
  todayMiniController.registerIpc();
  createRecordingIndicatorController({
    satelliteWindows,
    getMainWindow: () => findMainWindow(),
  }).registerIpc();
  reminderController = createReminderController({
    repository: workspaceRepository,
    getAppIconPath,
    openTask: (taskId) => {
      todayMiniController?.openTask(taskId);
    },
    showMainWindow: () => {
      showMainWindow();
    },
  });
  trayController = createTrayController({
    appName: APP_NAME,
    getAppIconPath,
    showTodayMini: () => todayMiniController?.show(),
    quickCaptureMenuItems: () => quickCaptureController?.menuItems() || [],
    showQuickCapture: () => quickCaptureController?.show("inbox"),
    showMainWindow: () => {
      showMainWindow();
    },
  });
  recordSmoke("app-ready");
  applyApplicationMenu();
  createWindow();

  if (!isSmokeTest) {
    automaticSnapshotBackup.run("startup");
    sharedFolderSyncService.start();
    trayController.setup();
    reminderController.start();
    const directHandlers: Record<(typeof DIRECT_SHORTCUT_DEFINITIONS)[number]["id"], () => void> = {
      "quick-capture": () => quickCaptureController?.show("inbox"),
      "today-task": () => quickCaptureController?.show("today-task"),
      "done-task": () => quickCaptureController?.show("done-task"),
      "micro-memo": () => quickCaptureController?.show("micro-memo"),
    };
    for (const definition of DIRECT_SHORTCUT_DEFINITIONS) {
      globalShortcut.register(definition.accelerator, directHandlers[definition.id]);
    }
    taskenRootController.registerShortcut();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  console.warn("Tasken is already running. Reusing the existing application instance.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) showMainWindow();
  });
  void startDesktopApp().catch(async (error: unknown) => {
    await taskenCoreRuntime?.stop().catch((stopError: unknown) => {
      logMain("warn", "tasken-core", "起動失敗後にloopback hostを停止できませんでした", stopError);
    });
    taskenCoreRuntime = null;
    console.error("Tasken failed to start.", error);
    recordSmoke("startup-failed", { error: String(error) });
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
    // トレイ常駐中はメインウィンドウを閉じてもアプリを終了しない
    if (process.platform === "darwin") return;
    if (trayController?.isActive()) return;
    app.quit();
});

app.on("before-quit", (event) => {
  if (appQuitApproved) {
    sharedFolderSyncService?.stop();
    return;
  }
  event.preventDefault();
  if (appFlushPending) return;
  appFlushPending = true;
  void Promise.all(rendererWindowsForAppFlush().map((window) => requestRendererFlush(window))).then(async (results) => {
    appFlushPending = false;
    if (results.some((ok) => !ok)) {
      console.warn("終了前flushが完了しなかったため、アプリを終了しませんでした。");
      return;
    }
    await taskenCoreRuntime?.stop().catch((error: unknown) => {
      logMain("warn", "tasken-core", "loopback hostを停止できませんでした", error);
    });
    taskenCoreRuntime = null;
    appQuitApproved = true;
    app.quit();
  });
});

app.on("will-quit", () => {
    reminderController?.stop();
    taskenRootController?.destroy();
    globalShortcut.unregisterAll();
});
