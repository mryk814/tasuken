import { BrowserWindow, ipcMain, screen } from "electron";
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
  return { state: input.state, targetLabel, elapsedMs, keepMainWindowVisible: input.keepMainWindowVisible === true };
}

export function createRecordingIndicatorController(
  options: RecordingIndicatorControllerOptions,
): RecordingIndicatorController {
  const windowKey = { kind: "recording" as const, entityId: "screen-recording" };
  let current: RecordingIndicatorState | null = null;
  let minimizedMainWindow = false;

  function ensureWindow(): BrowserWindow {
    const existing = options.satelliteWindows.get(windowKey);
    if (existing && !existing.isDestroyed()) return existing;
    const win = options.satelliteWindows.open(windowKey, {
      title: "録画中",
      width: 460,
      height: 64,
      minWidth: 360,
      minHeight: 12,
      page: "recording-indicator",
      preload: path.join(__dirname, "../preload/recordingIndicator.mjs"),
      alwaysOnTop: true,
      frame: false,
      skipTaskbar: true,
      transparent: true,
      hasShadow: false,
      backgroundColor: "#00000000",
    });
    const main = options.getMainWindow();
    const display = main && !main.isDestroyed()
      ? screen.getDisplayMatching(main.getBounds())
      : screen.getPrimaryDisplay();
    const bounds = win.getBounds();
    win.setMinimumSize(360, 12);
    win.setSize(Math.max(360, bounds.width), 64, false);
    win.setPosition(
      Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2),
      display.workArea.y,
      false,
    );
    // これが本題。Windows 10 2004+ のWDA_EXCLUDEFROMCAPTUREで、
    // インジケータ自身が録画結果へ写り込まないようにする（#383）。
    win.setContentProtection(true);
    win.setBackgroundColor("#00000000");
    win.setAlwaysOnTop(true, "screen-saver");
    return win;
  }

  function minimizeMainWindow(state: RecordingIndicatorState): void {
    if (state.keepMainWindowVisible || minimizedMainWindow) return;
    const main = options.getMainWindow();
    if (!main || main.isDestroyed() || main.isMinimized()) return;
    main.minimize();
    minimizedMainWindow = true;
  }

  function restoreMainWindow(): void {
    if (!minimizedMainWindow) return;
    minimizedMainWindow = false;
    const main = options.getMainWindow();
    if (!main || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
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
    restoreMainWindow();
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
        minimizeMainWindow(state);
        push(state);
        return true;
      });
      ipcMain.handle(IPC.recordingIndicatorRequestState, () => current);
      ipcMain.handle(IPC.recordingIndicatorSetRetracted, (event, value: unknown) => {
        const win = options.satelliteWindows.get(windowKey);
        if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id || typeof value !== "boolean") return false;
        const bounds = win.getBounds();
        win.setBounds({ ...bounds, height: value ? 12 : 64 }, false);
        return true;
      });
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
