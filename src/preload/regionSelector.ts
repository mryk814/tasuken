import { contextBridge, ipcRenderer } from "electron";

import { IPC } from "../shared/ipc/contracts";

contextBridge.exposeInMainWorld("regionSelectorApi", {
  complete: (value: unknown) => ipcRenderer.send(IPC.screenRecordingRegionResult, value),
});
