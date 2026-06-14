const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("researchDesk", {
  workspace: {
    load: () => ipcRenderer.invoke("workspace:load"),
    bootstrap: (legacy) => ipcRenderer.invoke("workspace:bootstrap", legacy),
    getMeta: () => ipcRenderer.invoke("workspace:meta"),
  },
  preferences: {
    get: (key) => ipcRenderer.invoke("preference:get", key),
    set: (key, value) => ipcRenderer.invoke("preference:set", key, value),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  },
  app: {
    reload: () => ipcRenderer.invoke("app:reload"),
  },
  entities: {
    list: (type, includeDeleted = false) => ipcRenderer.invoke("entity:list", type, includeDeleted),
    get: (type, id) => ipcRenderer.invoke("entity:get", type, id),
    save: (type, entity, options = {}) => ipcRenderer.invoke("entity:save", type, entity, options),
    saveMany: (operations) => ipcRenderer.invoke("entity:save-many", operations),
    remove: (type, id) => ipcRenderer.invoke("entity:remove", type, id),
    restore: (type, id) => ipcRenderer.invoke("entity:restore", type, id),
  },
  snapshots: {
    exportFile: () => ipcRenderer.invoke("snapshot:export"),
    inspectFile: () => ipcRenderer.invoke("snapshot:inspect"),
    applyImport: (token, decisions) => ipcRenderer.invoke("snapshot:apply", token, decisions),
  },
});
