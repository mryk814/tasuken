import { contextBridge, ipcRenderer } from "electron";

import { IPC, type MemoStickyContent } from "../shared/ipc/contracts";

type Unsubscribe = () => void;

// 対象Memoはウィンドウ側から渡さない。Mainがウィンドウの登録情報から特定する（#298）。
contextBridge.exposeInMainWorld("memoStickyApi", {
  load: (): Promise<MemoStickyContent | null> => ipcRenderer.invoke(IPC.memoStickyLoad),
  save: (text: string): Promise<MemoStickyContent> => ipcRenderer.invoke(IPC.memoStickySave, text),
  copy: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyCopy),
  close: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyClose),
  openInMain: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyOpenInMain),
  // 付箋を閉じることとは別の操作。実行するとMemo自体の状態が変わる。
  archive: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyArchive),
  remove: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyDelete),
  isAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyIsAlwaysOnTop),
  setAlwaysOnTop: (pinned: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickySetAlwaysOnTop, pinned),
  // 本体や他のウィンドウでの変更を受けて、同じMemoの表示を追従させる。
  onWorkspaceChanged: (callback: () => void): Unsubscribe => {
    const handler = (): void => callback();
    ipcRenderer.on(IPC.workspaceChanged, handler);
    return () => { ipcRenderer.removeListener(IPC.workspaceChanged, handler); };
  },
});
