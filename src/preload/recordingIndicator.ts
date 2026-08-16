import { contextBridge, ipcRenderer } from "electron";

import { IPC, type RecordingIndicatorCommand, type RecordingIndicatorState } from "../shared/ipc/contracts";

type Unsubscribe = () => void;

contextBridge.exposeInMainWorld("recordingIndicatorApi", {
  /** 表示だけを持つ面なので、状態はMain経由で本体から受け取る。 */
  requestState: (): Promise<RecordingIndicatorState | null> => ipcRenderer.invoke(IPC.recordingIndicatorRequestState),
  command: (command: RecordingIndicatorCommand): Promise<boolean> => ipcRenderer.invoke(IPC.recordingIndicatorCommand, command),
  setRetracted: (retracted: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.recordingIndicatorSetRetracted, retracted),
  onState: (callback: (state: RecordingIndicatorState) => void): Unsubscribe => {
    const handler = (_event: Electron.IpcRendererEvent, state: RecordingIndicatorState): void => callback(state);
    ipcRenderer.on(IPC.recordingIndicatorState, handler);
    return () => { ipcRenderer.removeListener(IPC.recordingIndicatorState, handler); };
  },
});
