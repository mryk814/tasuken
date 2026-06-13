import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("researchDesk", {
  workspace: {
    load: () => ipcRenderer.invoke("workspace:load"),
    bootstrap: (legacy) => ipcRenderer.invoke("workspace:bootstrap", legacy),
    getMeta: () => ipcRenderer.invoke("workspace:meta"),
  },
  entities: {
    list: (type, includeDeleted = false) => ipcRenderer.invoke("entity:list", type, includeDeleted),
    get: (type, id) => ipcRenderer.invoke("entity:get", type, id),
    save: (type, entity, options = {}) => ipcRenderer.invoke("entity:save", type, entity, options),
    remove: (type, id) => ipcRenderer.invoke("entity:remove", type, id),
    restore: (type, id) => ipcRenderer.invoke("entity:restore", type, id),
  },
  snapshots: {
    exportFile: () => ipcRenderer.invoke("snapshot:export"),
    inspectFile: () => ipcRenderer.invoke("snapshot:inspect"),
    applyImport: (token, decisions) => ipcRenderer.invoke("snapshot:apply", token, decisions),
  },
});
