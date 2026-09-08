import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc/contracts";

contextBridge.exposeInMainWorld("captureApi", {
  platform: process.platform,
  save: (
    text: string,
    mode: string,
    themeId?: string,
    rangeSemantics?: "once_within_window" | "ongoing",
    organization?: unknown,
  ) => ipcRenderer.invoke(IPC.quickCaptureSave, text, mode, themeId, rangeSemantics, organization),
  organize: (input: unknown) => ipcRenderer.invoke(IPC.quickCaptureOrganize, input),
  copyExternalPrompt: (input: unknown) => ipcRenderer.invoke(IPC.quickCaptureExternalPrompt, input),
  importExternalResult: (text: string) => ipcRenderer.invoke(IPC.quickCaptureExternalImport, text),
  resize: (expanded: boolean) => ipcRenderer.send(IPC.quickCaptureResize, expanded),
  previewDue: (text: string) => ipcRenderer.invoke(IPC.quickCapturePreviewDue, text),
  hide: () => ipcRenderer.send(IPC.quickCaptureHide),
  onShow: (callback: (mode: string) => void) => {
    ipcRenderer.on(IPC.quickCaptureShown, (_event, mode: string) => callback(mode));
  },
  onHide: (callback: () => void) => {
    ipcRenderer.on(IPC.quickCaptureHidden, () => callback());
  },
  onThemeChange: (callback: (mode: string) => void) => {
    ipcRenderer.on(IPC.quickCaptureTheme, (_event, mode: string) => callback(mode));
  },
  onThemes: (callback: (themes: { id: string; name: string }[]) => void) => {
    ipcRenderer.on(IPC.quickCaptureThemes, (_event, themes: { id: string; name: string }[]) =>
      callback(themes),
    );
  },
});
