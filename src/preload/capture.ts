import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("captureApi", {
  save: (text: string) => ipcRenderer.invoke("quick-capture:save", text),
  hide: () => ipcRenderer.send("quick-capture:hide"),
  onShow: (callback: () => void) => {
    ipcRenderer.on("quick-capture:shown", callback);
  },
  onThemeChange: (callback: (mode: string) => void) => {
    ipcRenderer.on("quick-capture:theme", (_event, mode: string) => callback(mode));
  },
});
