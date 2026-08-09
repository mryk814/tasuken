import { BrowserWindow, ipcMain } from "electron";

import { IPC } from "../../shared/ipc/contracts";
import { entityTypes, type EntityType } from "../../shared/types/workspace";
import type { WorkspaceService } from "../services/workspaceService";
import type { SharedFolderSyncService } from "../services/sharedFolderSync.mjs";
import type { AiProviderService } from "../services/aiProviderService";
import type { CalendarService } from "../services/calendarService";
import type { ApplicationCommandService } from "../services/applicationCommandService";
import type { CommandReceipt } from "../../shared/applicationCommand";
import { authorizeNoteAiRequest } from "../services/ai/noteContextAuthority.mjs";
import {
  isViewPreferenceId,
  normalizeViewPreference,
  normalizeViewPreferenceEnvelope,
  getViewPreferenceDefinition,
} from "../../shared/viewPreferenceRegistry.mjs";
import type { ViewPreferenceEnvelope, ViewPreferenceChange } from "../../shared/ipc/contracts";

interface WorkspaceRepository {
  loadWorkspace(includeDeleted?: boolean): unknown;
  bootstrap(legacy: unknown): unknown;
  getMeta(): unknown;
  getPreference(key: string): unknown;
  setPreference(key: string, value: unknown): unknown;
  getViewPreferences(): unknown;
  setViewPreference(id: string, scopeKey: string, value: unknown, schemaVersion: number): unknown;
  list(type: EntityType, includeDeleted?: boolean): unknown;
  get(type: EntityType, id: string): unknown;
  save(type: EntityType, entity: unknown, options?: unknown): unknown;
  saveMany(operations: unknown): unknown;
  remove(type: EntityType, id: string): unknown;
  restore(type: EntityType, id: string): unknown;
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

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label}の形式が不正です。画面を再読み込みして、もう一度試してください。`);
  }
  return value;
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
  // Stable Internal Links are derived inside WorkspaceService from the
  // canonical Markdown body, so the request does not enumerate every changed
  // Reference. Always refresh both projections after a successful Note save.
  return ["note", "reference"];
}

function rejectTaskPersistence(type: EntityType, operation = "保存"): void {
  if (type === "task") {
    throw new Error(`Taskの${operation}はApplication Command経由で実行してください。`);
  }
}

export function registerIpc(
  repository: WorkspaceRepository,
  service: WorkspaceService,
  sharedSync: SharedFolderSyncService,
  aiProvider: AiProviderService,
  calendar: CalendarService,
  applicationCommands: ApplicationCommandService,
  notifyEntitiesChanged: (types: EntityType[]) => void = () => {},
  notifyCommandApplied: (receipt: CommandReceipt | CommandReceipt[], senderId: number) => void = () => {},
): void {
  ipcMain.handle(IPC.workspaceLoad, () => service.loadWorkspace());
  ipcMain.handle(IPC.workspaceBootstrap, (_event, legacy) => repository.bootstrap(legacy));
  ipcMain.handle(IPC.workspaceMeta, () => repository.getMeta());
  ipcMain.handle(IPC.activityCanonicalRootStatus, () => service.getActivityCanonicalRootStatus());
  ipcMain.handle(IPC.activityOpenCanonicalRef, (_event, ref) => service.openActivityCanonicalRef(ref));
  ipcMain.handle(IPC.aiContextPreview, (_event, request) => service.getAiContextPreview(request));
  ipcMain.handle(IPC.dataHealthGet, (_event, query) => service.getDataHealth(query));
  ipcMain.handle(IPC.dataHealthSetState, (_event, request) => service.setDataHealthIssueState(request));
  ipcMain.handle(IPC.themeAiPackStatus, (_event, themeId) => service.getThemeAiPackStatus(requireId(themeId)));
  ipcMain.handle(IPC.themeAiPackPreview, (_event, themeId) => service.getThemeAiPackPreview(requireId(themeId)));
  ipcMain.handle(IPC.themeAiPackPublish, (_event, request) => {
    const result = service.publishThemeAiPack(request);
    const change = {
      themeId: result.themeId,
      contentHash: result.contentHash,
      state: result.state,
      dirty: result.dirty,
    };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.themeAiPackChanged, change);
    }
    return result;
  });
  ipcMain.handle(IPC.themeAiPackOpenFolder, (_event, themeId) => service.openThemeAiPackFolder(requireId(themeId)));
  ipcMain.handle(IPC.conversationContextPreview, (_event, request) => service.getConversationContextPreview(request));
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
    if (normalizedKey === "artifactDirectory") {
      // Root changes are workspace projection changes, not entity changes.
      // Refreshing here updates canonical_root_status in the live renderer.
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC.workspaceChanged, {});
      }
    }
    return saved;
  });
  ipcMain.handle(IPC.viewPreferenceGet, () => normalizeViewPreferenceEnvelope(repository.getViewPreferences()) as ViewPreferenceEnvelope);
  ipcMain.handle(IPC.viewPreferenceSet, (_event, id, scopeKey, value, schemaVersion) => {
    if (!isViewPreferenceId(id)) throw new Error("未登録の表示設定です。画面を再読み込みしてください。");
    const definition = getViewPreferenceDefinition(id);
    const normalizedScopeKey = definition?.scope === "theme" ? requireText(scopeKey, "Theme") : "";
    const normalized = normalizeViewPreference(id, value, Number(schemaVersion) || 1);
    const change = repository.setViewPreference(id, normalizedScopeKey, normalized, definition?.schemaVersion || 1) as ViewPreferenceChange;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.viewPreferenceChanged, change);
    }
    return change;
  });
  ipcMain.handle(IPC.aiConfigGet, () => aiProvider.getConfig());
  ipcMain.handle(IPC.aiProviderSave, (_event, update) => aiProvider.saveProviderProfile(update));
  ipcMain.handle(IPC.aiProviderDelete, (_event, id) => aiProvider.deleteProviderProfile(id));
  ipcMain.handle(IPC.aiModelSave, (_event, update) => aiProvider.saveModelProfile(update));
  ipcMain.handle(IPC.aiModelDelete, (_event, id) => aiProvider.deleteModelProfile(id));
  ipcMain.handle(IPC.aiDefaultProvider, (_event, id) => aiProvider.setDefaultProviderProfile(id));
  ipcMain.handle(IPC.aiDefaultModel, (_event, id) => aiProvider.setDefaultModelProfile(id));
  ipcMain.handle(IPC.aiTestConnection, (_event, request) => aiProvider.testConnection(request));
  ipcMain.handle(IPC.aiFeatureAvailability, (_event, feature, providerProfileId, modelProfileId) => aiProvider.getFeatureAvailability(feature, providerProfileId, modelProfileId));
  ipcMain.handle(IPC.aiNoteStreamStart, async (event, requestId, request) => {
    const normalizedRequestId = requireId(requestId);
    const authorizedRequest = authorizeNoteAiRequest(repository, request);
    const cancelOnDestroyed = () => { aiProvider.cancelNoteStream(normalizedRequestId); };
    event.sender.once("destroyed", cancelOnDestroyed);
    try {
      return await aiProvider.streamNote(normalizedRequestId, authorizedRequest, (streamEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.aiNoteStreamEvent, normalizedRequestId, streamEvent);
      });
    } finally {
      event.sender.removeListener("destroyed", cancelOnDestroyed);
    }
  });
  ipcMain.handle(IPC.aiNoteStreamCancel, (_event, requestId) => aiProvider.cancelNoteStream(requireId(requestId)));
  ipcMain.handle(IPC.clipboardWriteText, (_event, text) => service.writeClipboard(requireText(text, "コピーするテキスト")));
  ipcMain.handle(IPC.clipboardWriteHtml, (_event, payload) => service.writeClipboardHtml(payload));
  ipcMain.handle(IPC.clipboardWriteImage, (_event, payload) => service.writeClipboardImage(payload));
  ipcMain.handle(IPC.clipboardWriteSvg, (_event, payload) => service.writeClipboardSvg(payload));
  ipcMain.handle(IPC.fileOpen, (_event, filePath) => service.openPath(requireText(filePath, "開くファイル")));
  ipcMain.handle(IPC.fileShowInFolder, (_event, filePath) => service.showItemInFolder(requireText(filePath, "表示するファイル")));
  ipcMain.handle(IPC.filePathExists, (_event, filePath) => service.pathExists(requireText(filePath, "確認する場所")));
  ipcMain.handle(IPC.fileReadPreview, (_event, filePath) => service.readFilePreview(requireText(filePath, "プレビューするファイル")));
  ipcMain.handle(IPC.dialogChooseDirectory, (_event, title) => service.chooseDirectory(title));
  ipcMain.handle(IPC.dialogChooseFiles, (_event, title) => service.chooseFiles(title));
  ipcMain.handle(IPC.markdownImageSave, (_event, request) => service.saveMarkdownImageAttachment(request));
  ipcMain.handle(IPC.artifactFilesImport, (_event, request) => service.importArtifactFiles(request));
  ipcMain.handle(IPC.artifactProposalMaterialize, (_event, request) => service.materializeArtifactProposal(request));
  ipcMain.handle(IPC.appReload, (event) => service.reload(event.sender));
  ipcMain.handle(IPC.appUpdateCheck, () => service.checkForUpdates());
  ipcMain.handle(IPC.appReleasePageOpen, (_event, url) => service.openReleasePage(typeof url === "string" ? url : undefined));
  ipcMain.handle(IPC.mcpBridgeInfo, () => service.getMcpBridgeInfo());
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
  ipcMain.handle(IPC.entityList, (_event, type, includeDeleted) =>
    repository.list(requireEntityType(type), Boolean(includeDeleted)));
  ipcMain.handle(IPC.entityGet, (_event, type, id) =>
    repository.get(requireEntityType(type), requireId(id)));
  ipcMain.handle(IPC.entitySave, (_event, type, entity, options) => {
    if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
      throw new Error("保存内容が不正です。入力内容を確認してください。");
    }
    const entityType = requireEntityType(type);
    rejectTaskPersistence(entityType);
    const saved = repository.save(entityType, entity, normalizeIpcSaveOptions(options));
    notifyEntitiesChanged([entityType]);
    return saved;
  });
  ipcMain.handle(IPC.documentSave, (_event, request) => {
    const saved = service.saveCanonicalNote(request);
    notifyEntitiesChanged(documentSaveChangedTypes(request));
    return saved;
  });
  ipcMain.handle(IPC.documentApplyAiProposal, (event, request, envelope) => {
    const receipt = applicationCommands.executeCanonicalNoteAiProposal(envelope, (note, operations) => {
      const input = request && typeof request === "object" && !Array.isArray(request)
        ? request as Record<string, unknown>
        : {};
      return service.saveCanonicalNote({ ...input, entity: note }, operations) as import("../../shared/types/workspace").Entity;
    });
    notifyCommandApplied(receipt, event.sender.id);
    return receipt;
  });
  ipcMain.handle(IPC.entitySaveMany, (_event, operations) => {
    if (!Array.isArray(operations)) throw new Error("一括保存の内容が不正です。入力内容を確認してください。");
    const types = saveManyTypes(operations);
    if (types.includes("task")) rejectTaskPersistence("task", "一括保存");
    const saved = repository.saveMany(operations.map((operation) => (
      operation && typeof operation === "object" && !Array.isArray(operation)
        ? { ...(operation as Record<string, unknown>), options: normalizeIpcSaveOptions((operation as Record<string, unknown>).options) }
        : operation
    )));
    notifyEntitiesChanged(types);
    return saved;
  });
  ipcMain.handle(IPC.entityRemove, (_event, type, id) => {
    const entityType = requireEntityType(type);
    rejectTaskPersistence(entityType, "削除");
    const removed = repository.remove(entityType, requireId(id));
    notifyEntitiesChanged([entityType]);
    return removed;
  });
  ipcMain.handle(IPC.entityRestore, (_event, type, id) => {
    const entityType = requireEntityType(type);
    const restored = repository.restore(entityType, requireId(id));
    notifyEntitiesChanged([entityType]);
    return restored;
  });
  ipcMain.handle(IPC.applicationCommand, (event, envelope) => {
    const receipt = applicationCommands.execute(envelope);
    notifyCommandApplied(receipt, event.sender.id);
    return receipt;
  });
  ipcMain.handle(IPC.applicationCommandBatch, (event, envelopes) => {
    if (!Array.isArray(envelopes) || !envelopes.length) throw new Error("Application Command batchが空です。");
    const receipts = applicationCommands.executeBatch(envelopes);
    notifyCommandApplied(receipts, event.sender.id);
    return receipts;
  });
  ipcMain.handle(IPC.snapshotExport, () => service.exportSnapshot());
  ipcMain.handle(IPC.snapshotInspect, () => service.inspectSnapshot());
  ipcMain.handle(IPC.snapshotApply, (_event, token, decisions) =>
    service.applySnapshot(requireId(token), decisions && typeof decisions === "object" && !Array.isArray(decisions) ? (decisions as Record<string, string>) : {}));
  ipcMain.handle(IPC.sharedSyncStatus, () => sharedSync.status());
  ipcMain.handle(IPC.sharedSyncConfigure, (_event, directory) =>
    sharedSync.configure(requireText(directory, "同期フォルダ")));
  ipcMain.handle(IPC.sharedSyncDisable, () => sharedSync.disable());
  ipcMain.handle(IPC.sharedSyncNow, () => sharedSync.syncNow());
  ipcMain.handle(IPC.sharedSyncResolve, (_event, conflictId, choice) =>
    sharedSync.resolveConflict(
      requireId(conflictId),
      choice === "incoming" ? "incoming" : "local",
    ));
  ipcMain.handle(IPC.markdownFileExport, (_event, request) => service.exportMarkdownFile(request));
  ipcMain.handle(IPC.markdownPdfExport, (_event, request) => service.exportMarkdownPdf(request));
  ipcMain.handle(IPC.sketchExport, (_event, request) => service.exportSketch(request));
  ipcMain.handle(IPC.slideTimelineExport, (_event, request) => service.exportSlideTimeline(request));
  ipcMain.handle(IPC.mermaidSvgExport, (_event, request) => service.exportMermaidSvg(request));
  ipcMain.handle(IPC.mermaidPptxExport, (_event, request) => service.exportMermaidPptx(request));
  ipcMain.handle(IPC.calendarStatus, () => calendar.getStatus());
  ipcMain.handle(IPC.calendarConnect, (_event, request) => calendar.connect(request));
  ipcMain.handle(IPC.calendarDisconnect, (_event, request) => calendar.disconnect(request));
  ipcMain.handle(IPC.calendarEvents, (_event, date) => calendar.getEvents(requireText(date, "取得する日付")));
}
