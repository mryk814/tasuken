import path from "node:path";

import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";

import { IPC, type RootOpenRequest, type RootShortcutState } from "../shared/ipc/contracts";
import {
  DEFAULT_ROOT_SHORTCUT,
  normalizeRootShortcut,
  ROOT_SHORTCUT_PREFERENCE_KEY,
} from "../shared/taskenRoot";

interface TaskenRootControllerOptions {
  getPreference: (key: string) => unknown;
  setPreference: (key: string, value: unknown) => void;
  getAppIconPath: () => string;
  showMainTarget: (request: RootOpenRequest) => void;
  isAppQuitApproved?: () => boolean;
}

export interface TaskenRootController {
  registerIpc(): void;
  registerShortcut(): RootShortcutState;
  toggle(): void;
  hide(): void;
  destroy(): void;
  getWindow(): BrowserWindow | null;
}

export function createTaskenRootController(
  options: TaskenRootControllerOptions,
): TaskenRootController {
  let window: BrowserWindow | null = null;
  let activeShortcut = "";
  let shortcutState: RootShortcutState = { shortcut: DEFAULT_ROOT_SHORTCUT, registered: false };

  function createWindow(): BrowserWindow {
    const rootWindow = new BrowserWindow({
      width: 720,
      height: 520,
      minWidth: 560,
      minHeight: 360,
      show: false,
      frame: false,
      transparent: false,
      resizable: true,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#F4EEEC",
      icon: options.getAppIconPath(),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, "../preload/index.mjs"),
      },
    });
    rootWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    rootWindow.on("close", (event) => {
      if (options.isAppQuitApproved?.() === true) return;
      event.preventDefault();
      rootWindow.hide();
    });
    rootWindow.on("closed", () => {
      if (window === rootWindow) window = null;
    });
    if (process.env.ELECTRON_RENDERER_URL) {
      void rootWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/root.html`);
    } else {
      void rootWindow.loadFile(path.join(__dirname, "../renderer/root.html"));
    }
    return rootWindow;
  }

  function positionAndShow(): void {
    if (!window || window.isDestroyed()) window = createWindow();
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const bounds = window.getBounds();
    const x = Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2);
    const y = Math.round(
      display.workArea.y + Math.max(40, (display.workArea.height - bounds.height) * 0.22),
    );
    window.setPosition(x, y, false);
    window.show();
    window.focus();
    window.webContents.send(IPC.taskenRootShown);
  }

  function hide(): void {
    if (window && !window.isDestroyed()) window.hide();
  }

  function toggle(): void {
    if (window && !window.isDestroyed() && window.isVisible()) hide();
    else positionAndShow();
  }

  function registerShortcut(
    shortcut = normalizeRootShortcut(options.getPreference(ROOT_SHORTCUT_PREFERENCE_KEY)),
  ): RootShortcutState {
    if (activeShortcut) globalShortcut.unregister(activeShortcut);
    activeShortcut = "";
    const normalized = normalizeRootShortcut(shortcut);
    let registered = false;
    let registrationError = "";
    try {
      registered = globalShortcut.register(normalized, toggle);
    } catch (error) {
      registrationError = error instanceof Error ? error.message : String(error);
    }
    if (registered) activeShortcut = normalized;
    shortcutState = {
      shortcut: normalized,
      registered,
      error: registered
        ? undefined
        : registrationError || "このショートカットは他のアプリまたはTasken内で使用されています。",
    };
    return shortcutState;
  }

  function registerIpc(): void {
    ipcMain.handle(IPC.taskenRootHide, () => {
      hide();
      return true;
    });
    ipcMain.handle(IPC.taskenRootToggle, () => {
      toggle();
      return true;
    });
    ipcMain.handle(IPC.taskenRootShortcutGet, () => shortcutState);
    ipcMain.handle(IPC.taskenRootShortcutSet, (_event, value: unknown) => {
      const previous = shortcutState.shortcut;
      const next = normalizeRootShortcut(value);
      const state = registerShortcut(next);
      if (!state.registered) {
        registerShortcut(previous);
        return { ...state, shortcut: next };
      }
      options.setPreference(ROOT_SHORTCUT_PREFERENCE_KEY, next);
      return state;
    });
    ipcMain.handle(IPC.taskenRootOpen, (_event, request: RootOpenRequest) => {
      if (!request || typeof request.kind !== "string" || typeof request.id !== "string")
        return false;
      hide();
      options.showMainTarget(request);
      return true;
    });
  }

  return {
    registerIpc,
    registerShortcut: () => {
      const preferred = normalizeRootShortcut(options.getPreference(ROOT_SHORTCUT_PREFERENCE_KEY));
      const state = registerShortcut(preferred);
      return state.registered || preferred === DEFAULT_ROOT_SHORTCUT
        ? state
        : registerShortcut(DEFAULT_ROOT_SHORTCUT);
    },
    toggle,
    hide,
    destroy: () => {
      if (activeShortcut) globalShortcut.unregister(activeShortcut);
      activeShortcut = "";
      if (window && !window.isDestroyed()) window.destroy();
      window = null;
    },
    getWindow: () => (window && !window.isDestroyed() ? window : null),
  };
}
