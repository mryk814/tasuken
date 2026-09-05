import { contextBridge, ipcRenderer } from "electron";

import {
  IPC,
  type MemoStickyColorResult,
  type MemoStickyContent,
  type MemoStickyCreateResult,
  type MemoStickySaveRequest,
  type MemoStickySaveResult,
  type MemoStickyTargetResult,
  type RendererFlushRequest,
  type WorkspaceChangePayload,
} from "../shared/ipc/contracts";
import type { MemoStickyColorRequest, MemoStickyTargetRequest } from "../shared/memoPresentation";

type Unsubscribe = () => void;

// 対象Memoはウィンドウ側から渡さない。Mainがウィンドウの登録情報から特定する（#298）。
contextBridge.exposeInMainWorld("memoStickyApi", {
  load: (): Promise<MemoStickyContent | null> => ipcRenderer.invoke(IPC.memoStickyLoad),
  create: (): Promise<MemoStickyCreateResult> => ipcRenderer.invoke(IPC.memoStickyCreate),
  save: (request: MemoStickySaveRequest): Promise<MemoStickySaveResult> =>
    ipcRenderer.invoke(IPC.memoStickySave, request),
  copy: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyCopy),
  close: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyClose),
  minimize: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyMinimize),
  setTarget: (request: MemoStickyTargetRequest): Promise<MemoStickyTargetResult> =>
    ipcRenderer.invoke(IPC.memoStickySetTarget, request),
  setColor: (request: MemoStickyColorRequest): Promise<MemoStickyColorResult> =>
    ipcRenderer.invoke(IPC.memoStickySetColor, request),
  openInMain: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyOpenInMain),
  // 付箋を閉じることとは別の操作。実行するとMemo自体の状態が変わる。
  archive: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyArchive),
  remove: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyDelete),
  isAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke(IPC.memoStickyIsAlwaysOnTop),
  setAlwaysOnTop: (alwaysOnTop: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.memoStickySetAlwaysOnTop, { alwaysOnTop }),
  onThemeChanged: (callback: (theme: "light" | "dark") => void): Unsubscribe => {
    const handler = (_event: Electron.IpcRendererEvent, theme: unknown): void => {
      if (theme === "light" || theme === "dark") callback(theme);
    };
    ipcRenderer.on(IPC.memoStickyThemeChanged, handler);
    return () => {
      ipcRenderer.removeListener(IPC.memoStickyThemeChanged, handler);
    };
  },
  // 本体や他のウィンドウでの変更を受けて、同じMemoの表示を追従させる。
  onWorkspaceChanged: (callback: (change?: WorkspaceChangePayload) => void): Unsubscribe => {
    const handler = (_event: Electron.IpcRendererEvent, change?: WorkspaceChangePayload): void =>
      callback(change);
    ipcRenderer.on(IPC.workspaceChanged, handler);
    return () => {
      ipcRenderer.removeListener(IPC.workspaceChanged, handler);
    };
  },
  onAppFlushRequested: (callback: (request: RendererFlushRequest) => void): Unsubscribe => {
    const handler = (_event: Electron.IpcRendererEvent, request: RendererFlushRequest): void =>
      callback(request);
    ipcRenderer.on(IPC.appFlushRequested, handler);
    return () => {
      ipcRenderer.removeListener(IPC.appFlushRequested, handler);
    };
  },
  ackAppFlush: (requestId: string, ok: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.appFlushAck, { requestId, ok }),
});
