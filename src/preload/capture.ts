import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc/contracts";

contextBridge.exposeInMainWorld("captureApi", {
  save: (text: string, mode: string, themeId?: string, rangeSemantics?: "once_within_window" | "ongoing") => ipcRenderer.invoke(IPC.quickCaptureSave, text, mode, themeId, rangeSemantics),
  previewDue: (text: string) => ipcRenderer.invoke(IPC.quickCapturePreviewDue, text),
  hide: () => ipcRenderer.send(IPC.quickCaptureHide),
  onShow: (callback: (mode: string) => void) => {
    ipcRenderer.on(IPC.quickCaptureShown, (_event, mode: string) => callback(mode));
  },
  onThemeChange: (callback: (mode: string) => void) => {
    ipcRenderer.on(IPC.quickCaptureTheme, (_event, mode: string) => callback(mode));
  },
  onThemes: (callback: (themes: { id: string; name: string }[]) => void) => {
    ipcRenderer.on(IPC.quickCaptureThemes, (_event, themes: { id: string; name: string }[]) => callback(themes));
  },
});
