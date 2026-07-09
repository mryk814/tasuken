import { contextBridge, ipcRenderer, webUtils } from "electron";

import { IPC, type ResearchDeskApi } from "../shared/ipc/contracts";

type Unsubscribe = () => void;

const api: ResearchDeskApi = {
  workspace: {
    load: () => ipcRenderer.invoke(IPC.workspaceLoad),
    bootstrap: (legacy) => ipcRenderer.invoke(IPC.workspaceBootstrap, legacy),
    getMeta: () => ipcRenderer.invoke(IPC.workspaceMeta),
  },
  preferences: {
    get: (key) => ipcRenderer.invoke(IPC.preferenceGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.preferenceSet, key, value),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC.clipboardWriteText, text),
    writeHtml: (payload) => ipcRenderer.invoke(IPC.clipboardWriteHtml, payload),
  },
  files: {
    openPath: (filePath) => ipcRenderer.invoke(IPC.fileOpen, filePath),
    showItemInFolder: (filePath) => ipcRenderer.invoke(IPC.fileShowInFolder, filePath),
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  dialogs: {
    chooseDirectory: (title) => ipcRenderer.invoke(IPC.dialogChooseDirectory, title),
    chooseFiles: (title) => ipcRenderer.invoke(IPC.dialogChooseFiles, title),
  },
  attachments: {
    saveMarkdownImage: (request) => ipcRenderer.invoke(IPC.markdownImageSave, request),
    importArtifactFiles: (request) => ipcRenderer.invoke(IPC.artifactFilesImport, request),
  },
  app: {
    reload: () => ipcRenderer.invoke(IPC.appReload),
    checkForUpdates: () => ipcRenderer.invoke(IPC.appUpdateCheck),
    openReleasePage: (url) => ipcRenderer.invoke(IPC.appReleasePageOpen, url),
    showTodayMiniWindow: () => ipcRenderer.invoke("today-mini:show"),
    onWorkspaceChanged: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, change: unknown): void => {
        callback(change as Parameters<typeof callback>[0]);
      };
      ipcRenderer.on("workspace:changed", handler);
      return () => { ipcRenderer.removeListener("workspace:changed", handler); };
    },
    onOpenTaskDetail: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, taskId: string): void => {
        callback(taskId);
      };
      ipcRenderer.on("workspace:open-task-detail", handler);
      return () => { ipcRenderer.removeListener("workspace:open-task-detail", handler); };
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
  snapshots: {
    exportFile: () => ipcRenderer.invoke(IPC.snapshotExport),
    inspectFile: () => ipcRenderer.invoke(IPC.snapshotInspect),
    applyImport: (token, decisions) => ipcRenderer.invoke(IPC.snapshotApply, token, decisions),
  },
  exports: {
    markdownFile: (request) => ipcRenderer.invoke(IPC.markdownFileExport, request),
    markdownPdf: (request) => ipcRenderer.invoke(IPC.markdownPdfExport, request),
  },
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("researchDesk", api);
