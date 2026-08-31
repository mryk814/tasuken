import { BrowserWindow, dialog, ipcMain } from "electron";

import { IPC } from "../../shared/ipc/contracts";
import { entityTypes, type Entity, type EntityType } from "../../shared/types/workspace";
import type { WorkspaceService } from "../services/workspaceService";
import type { AutomaticSnapshotBackupService } from "../services/automaticSnapshotBackup";
import type { SharedFolderSyncService } from "../services/sharedFolderSync.mjs";
import type { CalendarService } from "../services/calendarService";
import type { ApplicationCommandService } from "../services/applicationCommandService";
import { AiProposalAcceptanceService } from "../services/aiProposalAcceptanceService";
import type { MediaCaptureService } from "../services/mediaCaptureService";
import { parseBatchTranscriptionArtifactRequest } from "../../shared/batchTranscriptionIpc";
import type { ScreenRecordingService } from "../services/screenRecordingService";
import {
  parseAudioCaptureCancelRequest,
  parseAudioCaptureCommitRequest,
  parseAudioCapturePrepareRequest,
  parseMediaArtifactOpenRequest,
  parseMediaRecordingAppendRequest,
  parseMediaRecordingControlRequest,
  parseMediaRecordingStartRequest,
  parseVideoImportCommitRequest,
  parseVideoImportPrepareRequest,
  parseVideoTrimExportRequest,
  parseVideoTrimSourceRequest,
} from "../../shared/mediaCapture";
import {
  projectCommandReceiptForRenderer,
  projectEntityForRenderer,
  projectSnapshotInspectForRenderer,
  projectWorkspaceForRenderer,
} from "../rendererMediaProjection";
import type { CommandReceipt } from "../../shared/applicationCommand";
import { projectMediaCaptureIpcError } from "../mediaCaptureIpcError";
import { projectScreenRecordingIpcError } from "../screenRecordingIpcError";
import { logMain } from "../log";
import { normalizeMediaCapturePersistence } from "../mediaCapturePersistence";
import { registerTaskIpc, type TaskCapabilityService } from "../modules/task/public.ts";
import { assertRendererBootstrapContainsNoMedia } from "../services/snapshotMediaValidation";
import {
  isViewPreferenceId,
  normalizeViewPreference,
  normalizeViewPreferenceEnvelope,
  getViewPreferenceDefinition,
} from "../../shared/viewPreferenceRegistry.mjs";
import type {
  AutomaticSnapshotBackupConfig,
  ViewPreferenceEnvelope,
  ViewPreferenceChange,
} from "../../shared/ipc/contracts";

interface WorkspaceRepository {
  loadWorkspace(includeDeleted?: boolean): unknown;
  bootstrap(legacy: unknown): unknown;
  getMeta(): unknown;
  getPreference(key: string): unknown;
  setPreference(key: string, value: unknown): unknown;
  getViewPreferences(): unknown;
  setViewPreference(id: string, scopeKey: string, value: unknown, schemaVersion: number): unknown;
  list(type: EntityType, includeDeleted?: boolean): Entity[];
  get(type: EntityType, id: string, includeDeleted?: boolean): Entity | null;
  save(type: EntityType, entity: Entity, options?: unknown): Entity;
  saveMany(operations: unknown): Entity[];
  remove(type: EntityType, id: string): Entity | null;
  restore(type: EntityType, id: string): Entity | null;
}

interface TranscriptionHistoryReader {
  getHistory(artifactId: string): {
    capture: { id?: string } | null;
    revisions: unknown[];
  };
}

function requireEntityType(value: unknown): EntityType {
  if (typeof value !== "string" || !entityTypes.includes(value as EntityType)) {
    throw new Error("保存対象の種類が不正です。画面を再読み込みして、もう一度試してください。");
  }
  return value as EntityType;
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("対象IDがありません。画面を再読み込みして、もう一度試してください。");
  }
  return value;
}

function publishIpc(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}
function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label}の形式が不正です。画面を再読み込みして、もう一度試してください。`);
  }
  return value;
}

function requireAutomaticSnapshotConfig(value: unknown): AutomaticSnapshotBackupConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "自動バックアップの設定形式が不正です。画面を再読み込みして、もう一度試してください。",
    );
  }
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== "boolean" || typeof input.directory !== "string") {
    throw new Error("自動バックアップの設定値が不正です。設定を選び直してください。");
  }
  if (
    !Number.isInteger(input.generations) ||
    Number(input.generations) < 1 ||
    Number(input.generations) > 20
  ) {
    throw new Error("バックアップの世代数は1〜20で指定してください。");
  }
  return {
    enabled: input.enabled,
    directory: input.directory,
    generations: Number(input.generations),
  };
}

/** RendererからMainの内部時刻や未知のrepository optionを注入させない。 */
export function normalizeIpcSaveOptions(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const options: Record<string, unknown> = {};
  if (typeof input.reason === "string") options.reason = input.reason;
  if (typeof input.source === "string") options.source = input.source;
  if (typeof input.quiet === "boolean") options.quiet = input.quiet;
  if (input.canonicalMarkdown === "normal" || input.canonicalMarkdown === "overwrite") {
    options.canonicalMarkdown = input.canonicalMarkdown;
  }
  return options;
}

function saveManyTypes(operations: unknown[]): EntityType[] {
  const types: EntityType[] = [];
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") continue;
    const type = (operation as { type?: unknown }).type;
    if (typeof type === "string" && entityTypes.includes(type as EntityType)) {
      types.push(type as EntityType);
    }
  }
  return types;
}

export function documentSaveChangedTypes(request: unknown): EntityType[] {
  // Document保存はcanonical Markdownからstable link Referenceを再計算し、
  // Note/Report所属ArtifactのThemeも同期する。requestだけでは派生差分を
  // 列挙できないため、成功後は3投影を再読込する。
  return ["note", "reference", "artifact"];
}

function rejectTaskPersistence(type: EntityType, operation = "保存"): void {
  if (type === "task") {
    throw new Error(`Taskの${operation}はApplication Command経由で実行してください。`);
  }
}

function requireAudioCaptureThemeId(
  repository: WorkspaceRepository,
  request: unknown,
): string | null {
  const { themeId = null } = parseAudioCapturePrepareRequest(request);
  if (!themeId) return null;
  if (!repository.get("theme", themeId) && !repository.get("project", themeId)) {
    throw new Error("音声CaptureのThemeが見つかりません。Themeを選び直してください。");
  }
  return themeId;
}

function requireVideoImportRequest(repository: WorkspaceRepository, request: unknown) {
  const parsed = parseVideoImportPrepareRequest(request);
  const ownerType = parsed.sourceType === "report" ? "note" : parsed.sourceType;
  const owner = repository.get(ownerType, parsed.sourceId) as Entity | null;
  if (!owner || owner.deleted_at)
    throw new Error("動画の添付先が見つかりません。画面を再読み込みしてください。");
  return parsed;
}

function screenRecordingRequestContext(event: Electron.IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (!frame || frame.detached) throw new Error("画面録画は現在のMain frameから操作してください。");
  let parsed: URL;
  try {
    parsed = new URL(frame.url);
  } catch {
    throw new Error("画面録画のoriginを確認できません。画面を再読み込みしてください。");
  }
  return {
    senderWebContentsId: event.sender.id,
    frameTreeNodeId: frame.frameTreeNodeId,
    securityOrigin: parsed.protocol === "file:" ? "file://" : parsed.origin,
    isMainFrame: event.sender.mainFrame === frame,
    detached: frame.detached,
  };
}

export function registerIpc(
  repository: WorkspaceRepository,
  service: WorkspaceService,
  automaticSnapshotBackup: AutomaticSnapshotBackupService,
  sharedSync: SharedFolderSyncService,
  calendar: CalendarService,
  applicationCommands: ApplicationCommandService,
  taskCapability: TaskCapabilityService,
  mediaCapture: MediaCaptureService,
  batchTranscription: TranscriptionHistoryReader,
  screenRecording: ScreenRecordingService,
  notifyEntitiesChanged: (types: EntityType[]) => void = () => {},
  notifyCommandApplied: (
    receipt: CommandReceipt | CommandReceipt[],
    senderId: number,
    options?: { senderReceivesAll?: boolean },
  ) => void = () => {},
  notifyTaskProjectionChanged: (types: EntityType[]) => void = () => {},
): void {
  const screenRecordingSenderIds = new Set<number>();
  const aiProposalAcceptance = new AiProposalAcceptanceService(
    applicationCommands,
    service,
    repository,
  );
  registerTaskIpc(
    {
      channels: {
        command: IPC.taskCommand,
        query: IPC.taskQuery,
        changed: IPC.taskChanged,
      },
      handle: (channel, listener) => ipcMain.handle(channel, listener),
      publish: publishIpc,
      authorize: (event) => {
        const url = new URL(
          (event as Electron.IpcMainInvokeEvent).senderFrame?.url || "about:blank",
        );
        return !url.search && (url.pathname === "/" || url.pathname.endsWith("/index.html"));
      },
    },
    taskCapability,
    () => notifyTaskProjectionChanged(["task"]),
  );
  ipcMain.handle(IPC.workspaceLoad, () => projectWorkspaceForRenderer(service.loadWorkspace()));
  ipcMain.handle(IPC.workspaceBootstrap, (_event, legacy) => {
    assertRendererBootstrapContainsNoMedia(legacy);
    return projectWorkspaceForRenderer(repository.bootstrap(legacy));
  });
  ipcMain.handle(IPC.workspaceMeta, () => repository.getMeta());
  ipcMain.handle(IPC.activityCanonicalRootStatus, () => service.getActivityCanonicalRootStatus());
  ipcMain.handle(IPC.activityOpenCanonicalRef, (_event, ref) =>
    service.openActivityCanonicalRef(ref),
  );
  ipcMain.handle(IPC.aiContextPreview, (_event, request) => service.getAiContextPreview(request));
  ipcMain.handle(IPC.dataHealthGet, (_event, query) => service.getDataHealth(query));
  ipcMain.handle(IPC.dataHealthSetState, (_event, request) =>
    service.setDataHealthIssueState(request),
  );
  ipcMain.handle(IPC.themeAiPackStatus, (_event, themeId) =>
    service.getThemeAiPackStatus(requireId(themeId)),
  );
  ipcMain.handle(IPC.themeAiPackPreview, (_event, themeId) =>
    service.getThemeAiPackPreview(requireId(themeId)),
  );
  ipcMain.handle(IPC.themeAiPackPublish, (_event, request) => {
    const result = service.publishThemeAiPack(request);
    const change = {
      themeId: result.themeId,
      contentHash: result.contentHash,
      state: result.state,
      dirty: result.dirty,
    };
    publishIpc(IPC.themeAiPackChanged, change);
    return result;
  });
  ipcMain.handle(IPC.themeAiPackOpenFolder, (_event, themeId) =>
    service.openThemeAiPackFolder(requireId(themeId)),
  );
  ipcMain.handle(IPC.conversationContextPreview, (_event, request) =>
    service.getConversationContextPreview(request),
  );
  ipcMain.handle(IPC.conversationContextPublish, (_event, request) => {
    const result = service.publishConversationContext(request);
    notifyEntitiesChanged(["resource"]);
    return result;
  });
  ipcMain.handle(IPC.conversationContextRemove, (_event, request) => {
    const result = service.removeConversationContext(request);
    notifyEntitiesChanged(["resource"]);
    return result;
  });
  ipcMain.handle(IPC.preferenceGet, (_event, key) => repository.getPreference(requireId(key)));
  ipcMain.handle(IPC.preferenceSet, (_event, key, value) => {
    const normalizedKey = requireId(key);
    const saved = repository.setPreference(normalizedKey, value);
    if (normalizedKey === "themeMode") {
      const mode = value === "dark" ? "dark" : "light";
      publishIpc(IPC.todayMiniTheme, mode);
    }
    if (normalizedKey === "artifactDirectory") {
      // Root changes are workspace projection changes, not entity changes.
      // Refreshing here updates canonical_root_status in the live renderer.
      publishIpc(IPC.workspaceChanged, {});
    }
    return saved;
  });
  ipcMain.handle(
    IPC.viewPreferenceGet,
    () =>
      normalizeViewPreferenceEnvelope(repository.getViewPreferences()) as ViewPreferenceEnvelope,
  );
  ipcMain.handle(IPC.viewPreferenceSet, (_event, id, scopeKey, value, schemaVersion) => {
    if (!isViewPreferenceId(id))
      throw new Error("未登録の表示設定です。画面を再読み込みしてください。");
    const definition = getViewPreferenceDefinition(id);
    const normalizedScopeKey = definition?.scope === "theme" ? requireText(scopeKey, "Theme") : "";
    const normalized = normalizeViewPreference(id, value, Number(schemaVersion) || 1);
    const change = repository.setViewPreference(
      id,
      normalizedScopeKey,
      normalized,
      definition?.schemaVersion || 1,
    ) as ViewPreferenceChange;
    publishIpc(IPC.viewPreferenceChanged, change);
    return change;
  });
  ipcMain.handle(IPC.clipboardWriteText, (_event, text) =>
    service.writeClipboard(requireText(text, "コピーするテキスト")),
  );
  ipcMain.handle(IPC.clipboardWriteHtml, (_event, payload) => service.writeClipboardHtml(payload));
  ipcMain.handle(IPC.clipboardWriteImage, (_event, payload) =>
    service.writeClipboardImage(payload),
  );
  ipcMain.handle(IPC.clipboardWriteSvg, (_event, payload) => service.writeClipboardSvg(payload));
  ipcMain.handle(IPC.fileOpen, (_event, filePath) =>
    service.openPath(requireText(filePath, "開くファイル")),
  );
  ipcMain.handle(IPC.fileShowInFolder, (_event, filePath) =>
    service.showItemInFolder(requireText(filePath, "表示するファイル")),
  );
  ipcMain.handle(IPC.filePathExists, (_event, filePath) =>
    service.pathExists(requireText(filePath, "確認する場所")),
  );
  ipcMain.handle(IPC.fileReadPreview, (_event, filePath) =>
    service.readFilePreview(requireText(filePath, "プレビューするファイル")),
  );
  ipcMain.handle(IPC.dialogChooseDirectory, (_event, title) => service.chooseDirectory(title));
  ipcMain.handle(IPC.dialogChooseFiles, (_event, title) => service.chooseFiles(title));
  ipcMain.handle(IPC.markdownImageSave, (_event, request) =>
    service.saveMarkdownImageAttachment(request),
  );
  ipcMain.handle(IPC.artifactFilesImport, (_event, request) =>
    service.importArtifactFiles(request),
  );
  ipcMain.handle(IPC.artifactWebPreview, (_event, artifactId) =>
    service.getWebArtifactPreview(requireId(artifactId)),
  );
  ipcMain.handle(IPC.audioCapturePrepare, async (event, request) => {
    try {
      const themeId = requireAudioCaptureThemeId(repository, request);
      const window = BrowserWindow.fromWebContents(event.sender) || undefined;
      const options = {
        title: "Inboxへ取り込む音声を選択",
        properties: ["openFile"],
        filters: [
          { name: "音声", extensions: ["mp3", "mpga", "wav", "webm", "ogg", "opus", "m4a", "mp4"] },
        ],
      } satisfies Electron.OpenDialogOptions;
      const selected = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      if (selected.canceled || !selected.filePaths[0]) return { canceled: true as const };
      return {
        canceled: false as const,
        ...mediaCapture.prepareFile(selected.filePaths[0], themeId),
      };
    } catch (error) {
      throw projectMediaCaptureIpcError("prepare", error);
    }
  });
  ipcMain.handle(IPC.audioCaptureListPrepared, (_event, ...args) => {
    try {
      if (args.length > 0) throw new Error("保存待ち音声の一覧requestに引数は指定できません。");
      return mediaCapture.listPreparedAudio();
    } catch (error) {
      throw projectMediaCaptureIpcError("list", error);
    }
  });
  ipcMain.handle(IPC.audioCaptureCommit, (event, request) => {
    try {
      const result = mediaCapture.commit(parseAudioCaptureCommitRequest(request));
      notifyCommandApplied(result.receipt, event.sender.id, { senderReceivesAll: true });
      return result.publicResult;
    } catch (error) {
      throw projectMediaCaptureIpcError("commit", error);
    }
  });
  ipcMain.handle(IPC.audioCaptureCancel, (_event, request) => {
    try {
      const { sessionId } = parseAudioCaptureCancelRequest(request);
      return mediaCapture.cancel(sessionId);
    } catch (error) {
      throw projectMediaCaptureIpcError("cancel", error);
    }
  });
  ipcMain.handle(IPC.screenRecordingCapabilities, (_event, ...args) => {
    try {
      if (args.length) throw new Error("画面録画capability requestに引数は指定できません。");
      return { ...screenRecording.capabilities(), ...mediaCapture.recordingCapacity() };
    } catch (error) {
      logMain("error", "screen-recording:capabilities", "capabilityを取得できません", error);
      throw projectScreenRecordingIpcError(error);
    }
  });
  ipcMain.handle(IPC.screenRecordingListSources, async (event, ...args) => {
    try {
      if (args.length) throw new Error("画面録画source一覧requestに引数は指定できません。");
      if (!screenRecordingSenderIds.has(event.sender.id)) {
        const senderId = event.sender.id;
        screenRecordingSenderIds.add(senderId);
        event.sender.on(
          "did-start-navigation",
          (_navigationEvent, _url, _isInPlace, isMainFrame) => {
            if (isMainFrame) screenRecording.clearSender(senderId);
          },
        );
        event.sender.once("destroyed", () => {
          screenRecordingSenderIds.delete(senderId);
          screenRecording.clearSender(senderId);
        });
      }
      return await screenRecording.listSources(screenRecordingRequestContext(event));
    } catch (error) {
      logMain("error", "screen-recording:list-sources", "録画対象を列挙できません", error);
      throw projectScreenRecordingIpcError(error);
    }
  });
  ipcMain.handle(IPC.screenRecordingArm, (event, request) => {
    try {
      return screenRecording.arm(request, screenRecordingRequestContext(event));
    } catch (error) {
      logMain("error", "screen-recording:arm", "録画対象を確定できません", error);
      throw projectScreenRecordingIpcError(error);
    }
  });
  ipcMain.handle(IPC.mediaRecordingStart, (_event, request) => {
    try {
      const parsed = parseMediaRecordingStartRequest(request);
      if (parsed.mediaKind === "audio") {
        const themeId = requireAudioCaptureThemeId(repository, { themeId: parsed.themeId });
        return mediaCapture.startRecording({ ...parsed, themeId });
      }
      // 録画開始時にownerを検証しない。紐づけ先は保存時に決める（#383）。
      return mediaCapture.startRecording(parsed);
    } catch (error) {
      throw projectMediaCaptureIpcError("record", error);
    }
  });
  ipcMain.handle(IPC.mediaRecordingAppend, (_event, request) => {
    try {
      return mediaCapture.appendRecordingChunk(parseMediaRecordingAppendRequest(request));
    } catch (error) {
      throw projectMediaCaptureIpcError("record", error);
    }
  });
  ipcMain.handle(IPC.mediaRecordingPause, (_event, request) => {
    try {
      return mediaCapture.pauseRecording(parseMediaRecordingControlRequest(request).sessionId);
    } catch (error) {
      throw projectMediaCaptureIpcError("record", error);
    }
  });
  ipcMain.handle(IPC.mediaRecordingResume, (_event, request) => {
    try {
      return mediaCapture.resumeRecording(parseMediaRecordingControlRequest(request).sessionId);
    } catch (error) {
      throw projectMediaCaptureIpcError("record", error);
    }
  });
  ipcMain.handle(IPC.mediaRecordingStop, (_event, request) => {
    try {
      return mediaCapture.stopRecording(parseMediaRecordingControlRequest(request).sessionId);
    } catch (error) {
      throw projectMediaCaptureIpcError("record", error);
    }
  });
  ipcMain.handle(IPC.videoImportPrepare, async (event, request) => {
    try {
      const parsed = requireVideoImportRequest(repository, request);
      const window = BrowserWindow.fromWebContents(event.sender) || undefined;
      const options = {
        title:
          parsed.storageMode === "managed" ? "Taskenへ取り込む動画を選択" : "参照する動画を選択",
        properties: ["openFile"],
        filters: [{ name: "動画", extensions: ["mp4", "m4v", "mov", "webm"] }],
      } satisfies Electron.OpenDialogOptions;
      const selected = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      if (selected.canceled || !selected.filePaths[0]) return { canceled: true as const };
      return {
        canceled: false as const,
        ...mediaCapture.prepareVideoFile(selected.filePaths[0], parsed),
      };
    } catch (error) {
      throw projectMediaCaptureIpcError("prepare", error);
    }
  });
  ipcMain.handle(IPC.videoImportListPrepared, (_event, ...args) => {
    try {
      if (args.length > 0) throw new Error("保存待ち動画の一覧requestに引数は指定できません。");
      return mediaCapture.listPreparedVideo();
    } catch (error) {
      throw projectMediaCaptureIpcError("list", error);
    }
  });
  ipcMain.handle(IPC.videoImportCommit, (event, request) => {
    try {
      const result = mediaCapture.commitVideo(parseVideoImportCommitRequest(request));
      notifyCommandApplied(result.receipt, event.sender.id, { senderReceivesAll: true });
      return result.publicResult;
    } catch (error) {
      throw projectMediaCaptureIpcError("commit", error);
    }
  });
  ipcMain.handle(IPC.videoImportCancel, (_event, request) => {
    try {
      const { sessionId } = parseAudioCaptureCancelRequest(request);
      return mediaCapture.cancel(sessionId);
    } catch (error) {
      throw projectMediaCaptureIpcError("cancel", error);
    }
  });
  ipcMain.handle(IPC.mediaArtifactOpenExternal, (_event, request) => {
    const { artifactId } = parseMediaArtifactOpenRequest(request);
    return mediaCapture.openArtifactExternally(artifactId);
  });
  ipcMain.handle(IPC.mediaArtifactInspect, (_event, request) => {
    const { artifactId } = parseMediaArtifactOpenRequest(request);
    return mediaCapture.inspectArtifactMedia(artifactId);
  });
  ipcMain.handle(IPC.screenRecordingSelectRegion, async (event, request) => {
    try {
      return await screenRecording.selectRegion(request, screenRecordingRequestContext(event));
    } catch (error) {
      logMain("error", "screen-recording:select-region", "録画範囲を選択できません", error);
      throw projectScreenRecordingIpcError(error);
    }
  });
  ipcMain.handle(IPC.screenRecordingRegionIndicatorApply, async (event, request) => {
    try {
      screenRecordingRequestContext(event);
      return await screenRecording.applyRegionIndicator(request);
    } catch (error) {
      logMain(
        "error",
        "screen-recording:region-indicator",
        "録画範囲の表示を更新できません",
        error,
      );
      throw projectScreenRecordingIpcError(error);
    }
  });
  ipcMain.handle(IPC.videoTrimSource, (_event, request) => {
    try {
      return mediaCapture.getVideoTrimSource(parseVideoTrimSourceRequest(request).artifactId);
    } catch (error) {
      throw projectMediaCaptureIpcError("prepare", error);
    }
  });
  ipcMain.handle(IPC.videoTrimExport, async (event, request) => {
    try {
      const result = await mediaCapture.exportTrimmedVideo(parseVideoTrimExportRequest(request));
      notifyCommandApplied(result.receipt, event.sender.id, { senderReceivesAll: true });
      return result.publicResult;
    } catch (error) {
      throw projectMediaCaptureIpcError("commit", error);
    }
  });
  ipcMain.handle(IPC.batchTranscriptionHistory, (_event, request) => {
    const { artifactId } = parseBatchTranscriptionArtifactRequest(request);
    const { capture, revisions } = batchTranscription.getHistory(artifactId);
    return { artifactId, captureId: capture?.id || null, revisions };
  });
  ipcMain.handle(IPC.appReload, (event) => service.reload(event.sender));
  ipcMain.handle(IPC.appUpdateCheck, () => service.checkForUpdates());
  ipcMain.handle(IPC.appReleasePageOpen, (_event, url) =>
    service.openReleasePage(typeof url === "string" ? url : undefined),
  );
  ipcMain.handle(IPC.mcpBridgeInfo, () => service.getMcpBridgeInfo());
  ipcMain.handle(IPC.taskAgentLaunchOptions, (_event, request) =>
    service.getTaskAgentLaunchOptions(request),
  );
  ipcMain.handle(IPC.taskAgentLaunch, (_event, request) => service.launchTaskAgent(request));
  ipcMain.handle(IPC.appTitleBarTheme, (event, theme) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    const dark = theme === "dark";
    window.setTitleBarOverlay({
      color: dark ? "#211E1D" : "#FBF8F6",
      symbolColor: dark ? "#F4EEEC" : "#3D3532",
      height: 40,
    });
    return true;
  });
  ipcMain.handle(IPC.entityList, (_event, type, includeDeleted) => {
    const entityType = requireEntityType(type);
    const entities = repository.list(entityType, Boolean(includeDeleted));
    return Array.isArray(entities)
      ? entities.map((entity) => projectEntityForRenderer(entityType, entity as Entity))
      : entities;
  });
  ipcMain.handle(IPC.entityGet, (_event, type, id) => {
    const entityType = requireEntityType(type);
    const entity = repository.get(entityType, requireId(id));
    return entity && typeof entity === "object"
      ? projectEntityForRenderer(entityType, entity as Entity)
      : entity;
  });
  ipcMain.handle(IPC.entitySave, (_event, type, entity, options) => {
    if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
      throw new Error("保存内容が不正です。入力内容を確認してください。");
    }
    const entityType = requireEntityType(type);
    rejectTaskPersistence(entityType);
    const normalizedEntity = normalizeMediaCapturePersistence(repository, entityType, entity);
    const saved = repository.save(
      entityType,
      normalizedEntity as Entity,
      normalizeIpcSaveOptions(options),
    );
    notifyEntitiesChanged([entityType]);
    return saved && typeof saved === "object"
      ? projectEntityForRenderer(entityType, saved as Entity)
      : saved;
  });
  ipcMain.handle(IPC.documentSave, (_event, request) => {
    const saved = service.saveCanonicalNote(request);
    notifyEntitiesChanged(documentSaveChangedTypes(request));
    return saved;
  });
  ipcMain.handle(IPC.entitySaveMany, (_event, operations) => {
    if (!Array.isArray(operations))
      throw new Error("一括保存の内容が不正です。入力内容を確認してください。");
    const types = saveManyTypes(operations);
    if (types.includes("task")) rejectTaskPersistence("task", "一括保存");
    for (const operation of operations) {
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      const value = operation as Record<string, unknown>;
      const type = requireEntityType(value.type);
      value.entity = normalizeMediaCapturePersistence(repository, type, value.entity, "一括保存");
    }
    const saved = repository.saveMany(
      operations.map((operation) =>
        operation && typeof operation === "object" && !Array.isArray(operation)
          ? {
              ...(operation as Record<string, unknown>),
              options: normalizeIpcSaveOptions((operation as Record<string, unknown>).options),
            }
          : operation,
      ),
    );
    notifyEntitiesChanged(types);
    return Array.isArray(saved)
      ? saved.map((entity, index) => {
          const operation = operations[index] as Record<string, unknown> | undefined;
          const type = operation ? requireEntityType(operation.type) : null;
          return type && entity && typeof entity === "object"
            ? projectEntityForRenderer(type, entity as Entity)
            : entity;
        })
      : saved;
  });
  ipcMain.handle(IPC.entityRemove, (_event, type, id) => {
    const entityType = requireEntityType(type);
    rejectTaskPersistence(entityType, "削除");
    const removed = repository.remove(entityType, requireId(id));
    notifyEntitiesChanged([entityType]);
    return removed && typeof removed === "object"
      ? projectEntityForRenderer(entityType, removed as Entity)
      : removed;
  });
  ipcMain.handle(IPC.entityRestore, (_event, type, id) => {
    const entityType = requireEntityType(type);
    const restored = repository.restore(entityType, requireId(id));
    notifyEntitiesChanged([entityType]);
    return restored && typeof restored === "object"
      ? projectEntityForRenderer(entityType, restored as Entity)
      : restored;
  });
  ipcMain.handle(IPC.applicationCommand, (event, envelope) => {
    const receipt = aiProposalAcceptance.execute(envelope);
    notifyCommandApplied(receipt, event.sender.id);
    return projectCommandReceiptForRenderer(receipt);
  });
  ipcMain.handle(IPC.applicationCommandBatch, (event, envelopes) => {
    if (!Array.isArray(envelopes) || !envelopes.length)
      throw new Error("Application Command batchが空です。");
    const receipts = applicationCommands.executeBatch(envelopes);
    notifyCommandApplied(receipts, event.sender.id);
    return receipts.map(projectCommandReceiptForRenderer);
  });
  ipcMain.handle(IPC.snapshotExport, () => service.exportSnapshot());
  ipcMain.handle(IPC.snapshotInspect, async () =>
    projectSnapshotInspectForRenderer(await service.inspectSnapshot()),
  );
  ipcMain.handle(IPC.snapshotApply, (_event, token, decisions) =>
    projectWorkspaceForRenderer(
      service.applySnapshot(
        requireId(token),
        decisions && typeof decisions === "object" && !Array.isArray(decisions)
          ? (decisions as Record<string, string>)
          : {},
      ),
    ),
  );
  ipcMain.handle(IPC.automaticSnapshotStatus, () => automaticSnapshotBackup.status());
  ipcMain.handle(IPC.automaticSnapshotConfigure, (_event, config) => {
    const normalized = requireAutomaticSnapshotConfig(config);
    repository.setPreference("automaticSnapshotBackupEnabled", normalized.enabled);
    repository.setPreference("automaticSnapshotBackupDirectory", normalized.directory);
    repository.setPreference("automaticSnapshotBackupGenerations", normalized.generations);
    return automaticSnapshotBackup.configure(normalized);
  });
  ipcMain.handle(IPC.automaticSnapshotRun, () => automaticSnapshotBackup.run("manual"));
  ipcMain.handle(IPC.sharedSyncStatus, () => sharedSync.status());
  ipcMain.handle(IPC.sharedSyncConfigure, (_event, directory) =>
    sharedSync.configure(requireText(directory, "同期フォルダ")),
  );
  ipcMain.handle(IPC.sharedSyncDisable, () => sharedSync.disable());
  ipcMain.handle(IPC.sharedSyncNow, () => sharedSync.syncNow());
  ipcMain.handle(IPC.sharedSyncResolve, (_event, conflictId, choice) =>
    sharedSync.resolveConflict(requireId(conflictId), choice === "incoming" ? "incoming" : "local"),
  );
  ipcMain.handle(IPC.markdownFileExport, (_event, request) => service.exportMarkdownFile(request));
  ipcMain.handle(IPC.markdownPdfExport, (_event, request) => service.exportMarkdownPdf(request));
  ipcMain.handle(IPC.sketchExport, (_event, request) => service.exportSketch(request));
  ipcMain.handle(IPC.slideTimelineExport, (_event, request) =>
    service.exportSlideTimeline(request),
  );
  ipcMain.handle(IPC.mermaidSvgExport, (_event, request) => service.exportMermaidSvg(request));
  ipcMain.handle(IPC.mermaidPptxExport, (_event, request) => service.exportMermaidPptx(request));
  ipcMain.handle(IPC.calendarStatus, () => calendar.getStatus());
  ipcMain.handle(IPC.calendarConnect, (_event, request) => calendar.connect(request));
  ipcMain.handle(IPC.calendarDisconnect, (_event, request) => calendar.disconnect(request));
  ipcMain.handle(IPC.calendarEvents, (_event, date) =>
    calendar.getEvents(requireText(date, "取得する日付")),
  );
}
