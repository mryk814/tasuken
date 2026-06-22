import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("captureApi", {
  save: (text: string, mode: string) => ipcRenderer.invoke("quick-capture:save", text, mode),
  hide: () => ipcRenderer.send("quick-capture:hide"),
  onShow: (callback: (mode: string) => void) => {
    ipcRenderer.on("quick-capture:shown", (_event, mode: string) => callback(mode));
  },
  onThemeChange: (callback: (mode: string) => void) => {
    ipcRenderer.on("quick-capture:theme", (_event, mode: string) => callback(mode));
  },
});
