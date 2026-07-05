import { contextBridge, ipcRenderer } from "electron";

import type { TodayMiniTask } from "../shared/ipc/contracts";

type Unsubscribe = () => void;

contextBridge.exposeInMainWorld("todayMiniApi", {
  list: (): Promise<TodayMiniTask[]> => ipcRenderer.invoke("today-mini:list"),
  addTask: (title: string): Promise<TodayMiniTask[]> => ipcRenderer.invoke("today-mini:add-task", title),
  toggle: (taskId: string): Promise<TodayMiniTask[]> => ipcRenderer.invoke("today-mini:toggle", taskId),
  openTask: (taskId: string): Promise<boolean> => ipcRenderer.invoke("today-mini:open-task", taskId),
  pinTopRight: (): Promise<boolean> => ipcRenderer.invoke("today-mini:pin-top-right"),
  hide: (): Promise<boolean> => ipcRenderer.invoke("today-mini:hide"),
  refresh: (): Promise<TodayMiniTask[]> => ipcRenderer.invoke("today-mini:refresh"),
  onRefresh: (callback: () => void): Unsubscribe => {
    const handler = (): void => callback();
    ipcRenderer.on("today-mini:refresh", handler);
    return () => { ipcRenderer.removeListener("today-mini:refresh", handler); };
  },
});
