import { contextBridge, ipcRenderer, webUtils } from "electron";

import { IPC, type ResearchDeskApi } from "../shared/ipc/contracts";

type Unsubscribe = () => void;

const api: ResearchDeskApi = {
  workspace: {
    load: () => ipcRenderer.invoke(IPC.workspaceLoad),
    bootstrap: (legacy) => ipcRenderer.invoke(IPC.workspaceBootstrap, legacy),
    getMeta: () => ipcRenderer.invoke(IPC.workspaceMeta),
  },
  activity: {
    getCanonicalRootStatus: () => ipcRenderer.invoke(IPC.activityCanonicalRootStatus),
    openCanonicalRef: (ref) => ipcRenderer.invoke(IPC.activityOpenCanonicalRef, ref),
  },
  aiContext: {
    preview: (request) => ipcRenderer.invoke(IPC.aiContextPreview, request),
  },
  dataHealth: {
    get: (query) => ipcRenderer.invoke(IPC.dataHealthGet, query),
    setState: (request) => ipcRenderer.invoke(IPC.dataHealthSetState, request),
  },
  themeAiPack: {
    status: (themeId) => ipcRenderer.invoke(IPC.themeAiPackStatus, themeId),
    preview: (themeId) => ipcRenderer.invoke(IPC.themeAiPackPreview, themeId),
    publish: (request) => ipcRenderer.invoke(IPC.themeAiPackPublish, request),
    openFolder: (themeId) => ipcRenderer.invoke(IPC.themeAiPackOpenFolder, themeId),
    onChanged: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, change: Parameters<typeof callback>[0]): void => callback(change);
      ipcRenderer.on(IPC.themeAiPackChanged, handler);
      return () => { ipcRenderer.removeListener(IPC.themeAiPackChanged, handler); };
    },
  },
  conversationContext: {
    preview: (request) => ipcRenderer.invoke(IPC.conversationContextPreview, request),
    publish: (request) => ipcRenderer.invoke(IPC.conversationContextPublish, request),
    remove: (request) => ipcRenderer.invoke(IPC.conversationContextRemove, request),
  },
  preferences: {
    get: (key) => ipcRenderer.invoke(IPC.preferenceGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.preferenceSet, key, value),
    getView: () => ipcRenderer.invoke(IPC.viewPreferenceGet),
    setView: (id, scopeKey, value, schemaVersion) => ipcRenderer.invoke(IPC.viewPreferenceSet, id, scopeKey, value, schemaVersion),
    onViewChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, change: Parameters<typeof callback>[0]) => callback(change);
      ipcRenderer.on(IPC.viewPreferenceChanged, listener);
      return () => ipcRenderer.removeListener(IPC.viewPreferenceChanged, listener);
    },
  },
  ai: {
    getConfig: () => ipcRenderer.invoke(IPC.aiConfigGet),
    saveProviderProfile: (update) => ipcRenderer.invoke(IPC.aiProviderSave, update),
    deleteProviderProfile: (id) => ipcRenderer.invoke(IPC.aiProviderDelete, id),
    saveModelProfile: (update) => ipcRenderer.invoke(IPC.aiModelSave, update),
    deleteModelProfile: (id) => ipcRenderer.invoke(IPC.aiModelDelete, id),
    setDefaultProviderProfile: (id) => ipcRenderer.invoke(IPC.aiDefaultProvider, id),
    setDefaultModelProfile: (id) => ipcRenderer.invoke(IPC.aiDefaultModel, id),
    testConnection: (request) => ipcRenderer.invoke(IPC.aiTestConnection, request),
    featureAvailability: (feature, providerProfileId, modelProfileId) => ipcRenderer.invoke(IPC.aiFeatureAvailability, feature, providerProfileId, modelProfileId),
    startNoteStream: (requestId, request) => ipcRenderer.invoke(IPC.aiNoteStreamStart, requestId, request),
    cancelNoteStream: (requestId) => ipcRenderer.invoke(IPC.aiNoteStreamCancel, requestId),
    onNoteStreamEvent: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, requestId: string, streamEvent: Parameters<typeof callback>[1]): void => callback(requestId, streamEvent);
      ipcRenderer.on(IPC.aiNoteStreamEvent, handler);
      return () => { ipcRenderer.removeListener(IPC.aiNoteStreamEvent, handler); };
    },
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC.clipboardWriteText, text),
    writeHtml: (payload) => ipcRenderer.invoke(IPC.clipboardWriteHtml, payload),
    writeImage: (payload) => ipcRenderer.invoke(IPC.clipboardWriteImage, payload),
    writeSvg: (payload) => ipcRenderer.invoke(IPC.clipboardWriteSvg, payload),
  },
  files: {
    openPath: (filePath) => ipcRenderer.invoke(IPC.fileOpen, filePath),
    showItemInFolder: (filePath) => ipcRenderer.invoke(IPC.fileShowInFolder, filePath),
    pathExists: (filePath) => ipcRenderer.invoke(IPC.filePathExists, filePath),
    readPreview: (filePath) => ipcRenderer.invoke(IPC.fileReadPreview, filePath),
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  dialogs: {
    chooseDirectory: (title) => ipcRenderer.invoke(IPC.dialogChooseDirectory, title),
    chooseFiles: (title) => ipcRenderer.invoke(IPC.dialogChooseFiles, title),
  },
  attachments: {
    saveMarkdownImage: (request) => ipcRenderer.invoke(IPC.markdownImageSave, request),
    importArtifactFiles: (request) => ipcRenderer.invoke(IPC.artifactFilesImport, request),
    materializeArtifactProposal: (request) => ipcRenderer.invoke(IPC.artifactProposalMaterialize, request),
  },
  app: {
    reload: () => ipcRenderer.invoke(IPC.appReload),
    checkForUpdates: () => ipcRenderer.invoke(IPC.appUpdateCheck),
    openReleasePage: (url) => ipcRenderer.invoke(IPC.appReleasePageOpen, url),
    setTitleBarTheme: (theme) => ipcRenderer.invoke(IPC.appTitleBarTheme, theme),
    onAppFlushRequested: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, request: unknown): void => {
        const value = request && typeof request === "object" ? request as Record<string, unknown> : {};
        if (typeof value.requestId !== "string" || !value.requestId) return;
        callback({ requestId: value.requestId, noteId: typeof value.noteId === "string" ? value.noteId : undefined });
      };
      ipcRenderer.on(IPC.appFlushRequested, handler);
      return () => { ipcRenderer.removeListener(IPC.appFlushRequested, handler); };
    },
    ackAppFlush: (requestId, ok) => ipcRenderer.invoke(IPC.appFlushAck, { requestId, ok }),
    getMcpBridgeInfo: () => ipcRenderer.invoke(IPC.mcpBridgeInfo),
    showTodayMiniWindow: () => ipcRenderer.invoke(IPC.todayMiniShow),
    showMemoStickyWindow: (memoId) => ipcRenderer.invoke(IPC.memoStickyOpen, memoId),
    listOpenMemoStickies: () => ipcRenderer.invoke(IPC.memoStickyListOpen),
    listStickyMemoTargets: () => ipcRenderer.invoke(IPC.memoStickyListTargets),
    showAllMemoStickies: () => ipcRenderer.invoke(IPC.memoStickyShowAll),
    closeAllMemoStickies: () => ipcRenderer.invoke(IPC.memoStickyCloseAll),
    getSatelliteWindowState: () => ipcRenderer.invoke(IPC.satelliteWindowState),
    onSatelliteWindowStateChanged: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        const value = state && typeof state === "object" ? state as Record<string, unknown> : {};
        callback({
          todayOpen: value.todayOpen === true,
          openMemoIds: Array.isArray(value.openMemoIds) ? value.openMemoIds.map(String) : [],
          stickyMemoIds: Array.isArray(value.stickyMemoIds) ? value.stickyMemoIds.map(String) : [],
        });
      };
      ipcRenderer.on(IPC.satelliteWindowState, handler);
      return () => { ipcRenderer.removeListener(IPC.satelliteWindowState, handler); };
    },
    openNoteWindow: (noteId) => ipcRenderer.invoke(IPC.noteWindowOpen, noteId),
    listOpenNoteWindows: () => ipcRenderer.invoke(IPC.noteWindowListOpen),
    returnNoteWindowToMain: () => ipcRenderer.invoke(IPC.noteWindowReturnToMain),
    openNoteWindowInMain: (route) => ipcRenderer.invoke(IPC.noteWindowOpenInMain, route),
    onNoteWindowOpenChanged: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, noteIds: unknown): void => {
        callback(Array.isArray(noteIds) ? noteIds.map(String) : []);
      };
      ipcRenderer.on(IPC.noteWindowOpenChanged, handler);
      return () => { ipcRenderer.removeListener(IPC.noteWindowOpenChanged, handler); };
    },
    onNoteWindowFlushRequested: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, request: unknown): void => {
        const value = request && typeof request === "object" ? request as Record<string, unknown> : {};
        if (typeof value.requestId !== "string" || !value.requestId) return;
        callback({ requestId: value.requestId, noteId: typeof value.noteId === "string" ? value.noteId : undefined });
      };
      ipcRenderer.on(IPC.noteWindowFlushRequested, handler);
      return () => { ipcRenderer.removeListener(IPC.noteWindowFlushRequested, handler); };
    },
    ackNoteWindowFlush: (requestId, ok) => ipcRenderer.invoke(IPC.noteWindowFlushAck, { requestId, ok }),
    onMemoStickyOpenChanged: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, memoIds: unknown): void => {
        callback(Array.isArray(memoIds) ? memoIds.map(String) : []);
      };
      ipcRenderer.on(IPC.memoStickyOpenChanged, handler);
      return () => { ipcRenderer.removeListener(IPC.memoStickyOpenChanged, handler); };
    },
    onWorkspaceChanged: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, change: unknown): void => {
        callback(change as Parameters<typeof callback>[0]);
      };
      ipcRenderer.on(IPC.workspaceChanged, handler);
      return () => { ipcRenderer.removeListener(IPC.workspaceChanged, handler); };
    },
    // 切り離しウィンドウから本体へ表示を渡す（#290 / #298）。
    onOpenNote: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, noteId: string): void => callback(noteId);
      ipcRenderer.on(IPC.workspaceOpenNote, handler);
      return () => { ipcRenderer.removeListener(IPC.workspaceOpenNote, handler); };
    },
    onOpenMemo: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, memoId: string): void => callback(memoId);
      ipcRenderer.on(IPC.workspaceOpenMemo, handler);
      return () => { ipcRenderer.removeListener(IPC.workspaceOpenMemo, handler); };
    },
    onNavigate: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, route: string): void => callback(route);
      ipcRenderer.on(IPC.workspaceNavigate, handler);
      return () => { ipcRenderer.removeListener(IPC.workspaceNavigate, handler); };
    },
    onOpenTaskDetail: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, taskId: string): void => {
        callback(taskId);
      };
      ipcRenderer.on(IPC.workspaceOpenTaskDetail, handler);
      return () => { ipcRenderer.removeListener(IPC.workspaceOpenTaskDetail, handler); };
    },
  },
  entities: {
    list: (type, includeDeleted = false) => ipcRenderer.invoke(IPC.entityList, type, includeDeleted),
    get: (type, id) => ipcRenderer.invoke(IPC.entityGet, type, id),
    save: (type, entity, options = {}) => ipcRenderer.invoke(IPC.entitySave, type, entity, options),
    saveMany: (operations) => ipcRenderer.invoke(IPC.entitySaveMany, operations),
    remove: (type, id) => ipcRenderer.invoke(IPC.entityRemove, type, id),
    restore: (type, id) => ipcRenderer.invoke(IPC.entityRestore, type, id),
  },
  documents: {
    save: (request) => ipcRenderer.invoke(IPC.documentSave, request),
    applyAiProposal: (request, envelope) => ipcRenderer.invoke(IPC.documentApplyAiProposal, request, envelope),
  },
  commands: {
    execute: (envelope) => ipcRenderer.invoke(IPC.applicationCommand, envelope),
    executeBatch: (envelopes) => ipcRenderer.invoke(IPC.applicationCommandBatch, envelopes),
  },
  snapshots: {
    exportFile: () => ipcRenderer.invoke(IPC.snapshotExport),
    inspectFile: () => ipcRenderer.invoke(IPC.snapshotInspect),
    applyImport: (token, decisions) => ipcRenderer.invoke(IPC.snapshotApply, token, decisions),
  },
  sharedSync: {
    status: () => ipcRenderer.invoke(IPC.sharedSyncStatus),
    configure: (directory) => ipcRenderer.invoke(IPC.sharedSyncConfigure, directory),
    disable: () => ipcRenderer.invoke(IPC.sharedSyncDisable),
    syncNow: () => ipcRenderer.invoke(IPC.sharedSyncNow),
    resolveConflict: (conflictId, choice) =>
      ipcRenderer.invoke(IPC.sharedSyncResolve, conflictId, choice),
  },
  exports: {
    markdownFile: (request) => ipcRenderer.invoke(IPC.markdownFileExport, request),
    markdownPdf: (request) => ipcRenderer.invoke(IPC.markdownPdfExport, request),
    sketch: (request) => ipcRenderer.invoke(IPC.sketchExport, request),
    slideTimeline: (request) => ipcRenderer.invoke(IPC.slideTimelineExport, request),
    mermaidSvg: (request) => ipcRenderer.invoke(IPC.mermaidSvgExport, request),
    mermaidPptx: (request) => ipcRenderer.invoke(IPC.mermaidPptxExport, request),
  },
  calendar: {
    getStatus: () => ipcRenderer.invoke(IPC.calendarStatus),
    connect: (request) => ipcRenderer.invoke(IPC.calendarConnect, request),
    disconnect: (request) => ipcRenderer.invoke(IPC.calendarDisconnect, request),
    getEvents: (date) => ipcRenderer.invoke(IPC.calendarEvents, date),
  },
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("researchDesk", api);
