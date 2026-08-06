import { contextBridge, ipcRenderer } from "electron";

import type { MemoStickyContent } from "../shared/ipc/contracts";

type Unsubscribe = () => void;

// 対象Memoはウィンドウ側から渡さない。Mainがウィンドウの登録情報から特定する（#298）。
contextBridge.exposeInMainWorld("memoStickyApi", {
  load: (): Promise<MemoStickyContent | null> => ipcRenderer.invoke("memo-sticky:load"),
  save: (text: string): Promise<MemoStickyContent> => ipcRenderer.invoke("memo-sticky:save", text),
  copy: (): Promise<boolean> => ipcRenderer.invoke("memo-sticky:copy"),
  close: (): Promise<boolean> => ipcRenderer.invoke("memo-sticky:close"),
  openInMain: (): Promise<boolean> => ipcRenderer.invoke("memo-sticky:open-in-main"),
  isAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke("memo-sticky:is-always-on-top"),
  setAlwaysOnTop: (pinned: boolean): Promise<boolean> => ipcRenderer.invoke("memo-sticky:set-always-on-top", pinned),
  // 本体や他のウィンドウでの変更を受けて、同じMemoの表示を追従させる。
  onWorkspaceChanged: (callback: () => void): Unsubscribe => {
    const handler = (): void => callback();
    ipcRenderer.on("workspace:changed", handler);
    return () => { ipcRenderer.removeListener("workspace:changed", handler); };
  },
});
