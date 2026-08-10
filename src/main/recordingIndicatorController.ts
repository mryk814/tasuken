import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";

import { IPC, type RecordingIndicatorCommand, type RecordingIndicatorState } from "../shared/ipc/contracts";
import { logMain } from "./log";
import type { SatelliteWindowRegistry } from "./satelliteWindowRegistry";

const INDICATOR_COMMANDS: readonly RecordingIndicatorCommand[] = ["pause", "resume", "stop", "discard"];
const MAX_TARGET_LABEL_CHARS = 120;

interface RecordingIndicatorControllerOptions {
  satelliteWindows: SatelliteWindowRegistry;
  /** 録画を実際に持っている本体ウィンドウ。操作はここへ転送する。 */
  getMainWindow: () => BrowserWindow | null;
}

export interface RecordingIndicatorController {
  registerIpc: () => void;
}

function normalizeState(value: unknown): RecordingIndicatorState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.state !== "recording" && input.state !== "paused" && input.state !== "stopping") return null;
  const elapsedMs = Number(input.elapsedMs);
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) return null;
  const targetLabel = typeof input.targetLabel === "string" ? input.targetLabel.slice(0, MAX_TARGET_LABEL_CHARS) : "";
  // 表示に要らないものは載せない。source IDやpathをこの窓へ渡さない。
  return { state: input.state, targetLabel, elapsedMs };
}

export function createRecordingIndicatorController(
  options: RecordingIndicatorControllerOptions,
): RecordingIndicatorController {
  const windowKey = { kind: "recording" as const, entityId: "screen-recording" };
  let current: RecordingIndicatorState | null = null;

  function ensureWindow(): BrowserWindow {
    const win = options.satelliteWindows.open(windowKey, {
      title: "録画中",
      width: 460,
      height: 64,
      minWidth: 360,
      minHeight: 56,
      page: "recording-indicator",
      preload: path.join(__dirname, "../preload/recordingIndicator.mjs"),
      alwaysOnTop: true,
      frame: false,
      skipTaskbar: true,
    });
    // これが本題。Windows 10 2004+ のWDA_EXCLUDEFROMCAPTUREで、
    // インジケータ自身が録画結果へ写り込まないようにする（#383）。
    win.setContentProtection(true);
    win.setAlwaysOnTop(true, "screen-saver");
    return win;
  }

  function push(state: RecordingIndicatorState): void {
    const win = options.satelliteWindows.get(windowKey);
    if (!win || win.isDestroyed()) return;
    const send = () => { if (!win.isDestroyed()) win.webContents.send(IPC.recordingIndicatorState, state); };
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
    else send();
  }

  function close(): void {
    current = null;
    options.satelliteWindows.close(windowKey);
  }

  return {
    registerIpc(): void {
      // 本体から状態を受け取る。録画が終わったらnullが来て窓を畳む。
      ipcMain.handle(IPC.recordingIndicatorApply, (_event, value: unknown) => {
        const state = normalizeState(value);
        if (!state) {
          close();
          return false;
        }
        current = state;
        ensureWindow();
        push(state);
        return true;
      });
      ipcMain.handle(IPC.recordingIndicatorRequestState, () => current);
      ipcMain.handle(IPC.recordingIndicatorCommand, (_event, value: unknown) => {
        if (typeof value !== "string" || !INDICATOR_COMMANDS.includes(value as RecordingIndicatorCommand)) {
          throw new Error("録画インジケータの操作が不正です。");
        }
        const main = options.getMainWindow();
        if (!main || main.isDestroyed()) {
          logMain("warn", "recording-indicator:command", "本体ウィンドウが無いため転送できない");
          return false;
        }
        // 録画そのものはRendererのMediaRecorderが持つので、操作は本体へ転送する。
        main.webContents.send(IPC.recordingIndicatorCommand, value);
        return true;
      });
    },
  };
}
