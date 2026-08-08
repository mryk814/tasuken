import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("captureApi", {
  save: (text: string, mode: string, themeId?: string, rangeSemantics?: "once_within_window" | "ongoing") => ipcRenderer.invoke("quick-capture:save", text, mode, themeId, rangeSemantics),
  previewDue: (text: string) => ipcRenderer.invoke("quick-capture:preview-due", text),
  hide: () => ipcRenderer.send("quick-capture:hide"),
  onShow: (callback: (mode: string) => void) => {
    ipcRenderer.on("quick-capture:shown", (_event, mode: string) => callback(mode));
  },
  onThemeChange: (callback: (mode: string) => void) => {
    ipcRenderer.on("quick-capture:theme", (_event, mode: string) => callback(mode));
  },
  onThemes: (callback: (themes: { id: string; name: string }[]) => void) => {
    ipcRenderer.on("quick-capture:themes", (_event, themes: { id: string; name: string }[]) => callback(themes));
  },
});
