import { contextBridge, ipcRenderer } from "electron";

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
  },
  app: {
    reload: () => ipcRenderer.invoke(IPC.appReload),
    onWorkspaceChanged: (callback): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, change: unknown): void => {
        callback(change as Parameters<typeof callback>[0]);
      };
      ipcRenderer.on("workspace:changed", handler);
      return () => { ipcRenderer.removeListener("workspace:changed", handler); };
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
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("researchDesk", api);
