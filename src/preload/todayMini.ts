import { contextBridge, ipcRenderer } from "electron";

import { IPC, type TodayMiniAddTaskRequest, type TodayMiniTask, type TodayMiniThemeOption } from "../shared/ipc/contracts";

type Unsubscribe = () => void;

contextBridge.exposeInMainWorld("todayMiniApi", {
  list: (): Promise<TodayMiniTask[]> => ipcRenderer.invoke(IPC.todayMiniList),
  listThemes: (): Promise<TodayMiniThemeOption[]> => ipcRenderer.invoke(IPC.todayMiniThemes),
  addTask: (request: TodayMiniAddTaskRequest): Promise<TodayMiniTask[]> => ipcRenderer.invoke(IPC.todayMiniAddTask, request),
  toggle: (taskId: string): Promise<TodayMiniTask[]> => ipcRenderer.invoke(IPC.todayMiniToggle, taskId),
  openTask: (taskId: string): Promise<boolean> => ipcRenderer.invoke(IPC.todayMiniOpenTask, taskId),
  pinTopRight: (): Promise<boolean> => ipcRenderer.invoke(IPC.todayMiniPinTopRight),
  hide: (): Promise<boolean> => ipcRenderer.invoke(IPC.todayMiniHide),
  refresh: (): Promise<TodayMiniTask[]> => ipcRenderer.invoke(IPC.todayMiniRefresh),
  onRefresh: (callback: () => void): Unsubscribe => {
    const handler = (): void => callback();
    ipcRenderer.on(IPC.todayMiniRefresh, handler);
    return () => { ipcRenderer.removeListener(IPC.todayMiniRefresh, handler); };
  },
  onThemeChange: (callback: (mode: "light" | "dark") => void): Unsubscribe => {
    const handler = (_event: Electron.IpcRendererEvent, mode: "light" | "dark"): void => callback(mode);
    ipcRenderer.on(IPC.todayMiniTheme, handler);
    return () => { ipcRenderer.removeListener(IPC.todayMiniTheme, handler); };
  },
});
