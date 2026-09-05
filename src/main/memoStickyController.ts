import { BrowserWindow, clipboard, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { SatelliteWindowRegistry } from "./satelliteWindowRegistry";
import { saveMemoStickyWithinTransaction, type MemoStickySaveTransaction } from "./memoStickySave";
import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import type {
  MemoStickyColorResult,
  MemoStickyContent,
  MemoStickyCreateResult,
  MemoStickySaveResult,
  MemoStickyTargetResult,
  MemoStickyVisibilityResult,
  WorkspaceChangePayload,
} from "../shared/ipc/contracts";
import { IPC } from "../shared/ipc/contracts";
import {
  isStickyMemoTarget,
  markMemoStickyColor,
  markStickyMemoTarget,
  memoStickyColorOf,
  memoStickyVisibilityAction,
  parseMemoStickyColorRequest,
  parseMemoStickyTargetRequest,
  parseMemoStickyThemeRequest,
  type MemoStickyColor,
} from "../shared/memoPresentation";
import type { Entity } from "../shared/types/workspace";

/**
 * 同じMemoを付箋として投影する。A=表示対象、B=window visibility、C=always-on-topは別状態。
 * 正式データは capture_entry、window状態は SatelliteWindowRegistry が正本（#298 / #327 / #377）。
 */

const MEMO_KIND = "micro_memo";
const STICKY_DEFAULT_WIDTH = 300;
const STICKY_DEFAULT_HEIGHT = 260;
const STICKY_MIN_WIDTH = 220;
const STICKY_MIN_HEIGHT = 160;

const STICKY_BACKGROUND: Record<"light" | "dark", Record<MemoStickyColor, string>> = {
  light: {
    yellow: "#FFF5C7",
    blue: "#E9F3FA",
    green: "#EAF5EF",
    pink: "#F9ECEE",
    purple: "#F0ECFA",
    neutral: "#F2EFED",
  },
  dark: {
    yellow: "#302A1A",
    blue: "#1D2931",
    green: "#1D2C25",
    pink: "#302124",
    purple: "#282337",
    neutral: "#292422",
  },
};

interface MemoStickyControllerOptions {
  repository: InstanceType<typeof WorkspaceDatabase>;
  satelliteWindows: SatelliteWindowRegistry;
  showMainWindow: () => BrowserWindow;
  notifyWorkspaceChanged: (change: WorkspaceChangePayload) => void;
  notifyStickyStateChanged: () => void;
  requestRendererFlush: (window: BrowserWindow) => Promise<boolean>;
  isAppQuitApproved?: () => boolean;
}

export interface MemoStickyController {
  open: (memoId: string) => boolean;
  /** B: 現在見えている付箋window。 */
  visibleMemoIds: () => string[];
  /** app-exit flush向け。hiddenを含む、存在する付箋window。 */
  windowMemoIds: () => string[];
  /** A: 利用者が付箋表示対象にしたMemo。windowを閉じても残る。 */
  stickyMemoIds: () => string[];
  /** C: OS always-on-topが有効な付箋window。 */
  alwaysOnTopMemoIds: () => string[];
  registerIpc: () => void;
}

function memoTitle(memo: Entity): string {
  const title = typeof memo.title === "string" ? memo.title.trim() : "";
  return title || "付箋メモ";
}

export function createMemoStickyController(
  options: MemoStickyControllerOptions,
): MemoStickyController {
  const attachedWindows = new WeakSet<BrowserWindow>();
  const pendingCloseWindows = new WeakSet<BrowserWindow>();
  const pendingFlushWindows = new WeakSet<BrowserWindow>();
  const approvedCloseWindows = new WeakSet<BrowserWindow>();
  let activeTheme: "light" | "dark" =
    options.repository.getPreference("themeMode") === "dark" ? "dark" : "light";

  function readMemo(memoId: string): Entity | null {
    const memo = options.repository.get("capture_entry", memoId) as Entity | null;
    if (!memo || memo.kind !== MEMO_KIND || memo.state === "archived" || memo.deleted_at)
      return null;
    return memo;
  }

  function toContent(memo: Entity): MemoStickyContent {
    return {
      id: String(memo.id),
      title: typeof memo.title === "string" ? memo.title : "",
      text: typeof memo.text === "string" ? memo.text : "",
      url: typeof memo.url === "string" ? memo.url : "",
      capturedAt: String(memo.captured_at || ""),
      version: Number(memo.version || 0),
      target: isStickyMemoTarget(memo),
      color: memoStickyColorOf(memo),
      theme: activeTheme,
    };
  }

  function keyOf(memoId: string) {
    return { kind: "memo" as const, entityId: memoId };
  }

  function applyWindowAppearance(window: BrowserWindow, memo: Entity): void {
    if (window.isDestroyed()) return;
    window.setTitle(memoTitle(memo));
    window.setBackgroundColor(STICKY_BACKGROUND[activeTheme][memoStickyColorOf(memo)]);
  }

  function open(memoId: string, arrange = true): boolean {
    const memo = readMemo(memoId);
    if (!memo) return false;
    // openはBだけを変える。Aの付箋対象化は setTarget(true) だけが行う（#377）。
    const key = keyOf(memoId);
    const window = options.satelliteWindows.open(key, {
      title: memoTitle(memo),
      width: STICKY_DEFAULT_WIDTH,
      height: STICKY_DEFAULT_HEIGHT,
      minWidth: STICKY_MIN_WIDTH,
      minHeight: STICKY_MIN_HEIGHT,
      page: "memo-sticky",
      preload: path.join(__dirname, "../preload/memoSticky.mjs"),
      backgroundColor: STICKY_BACKGROUND[activeTheme][memoStickyColorOf(memo)],
      alwaysOnTop: false,
      frame: false,
      skipTaskbar: true,
    });
    applyWindowAppearance(window, memo);
    attachCloseHandshake(window);
    if (arrange) options.satelliteWindows.arrange([key]);
    return true;
  }

  function windowInfos() {
    return options.satelliteWindows.list("memo");
  }

  function visibleMemoIds(): string[] {
    return windowInfos()
      .filter((entry) => entry.visible)
      .map((entry) => entry.entityId);
  }

  function windowMemoIds(): string[] {
    return windowInfos().map((entry) => entry.entityId);
  }

  function stickyMemoIds(): string[] {
    return (options.repository.list("capture_entry") as Entity[])
      .filter(isStickyMemoTarget)
      .map((memo) => String(memo.id));
  }

  function alwaysOnTopMemoIds(): string[] {
    return windowInfos()
      .filter((entry) => entry.alwaysOnTop)
      .map((entry) => entry.entityId);
  }

  function memoIdOf(event: Electron.IpcMainInvokeEvent): string | null {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const key = options.satelliteWindows.keyOf(window);
    return key?.kind === "memo" ? key.entityId : null;
  }

  function authorizeRequestedMemo(
    event: Electron.IpcMainInvokeEvent,
    requestedMemoId: string,
  ): boolean {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    const key = options.satelliteWindows.keyOf(window);
    if (!key) return true;
    return key.kind === "memo" && key.entityId === requestedMemoId;
  }

  async function flushWindow(window: BrowserWindow): Promise<boolean> {
    if (pendingFlushWindows.has(window)) return false;
    pendingFlushWindows.add(window);
    try {
      return await options.requestRendererFlush(window);
    } finally {
      pendingFlushWindows.delete(window);
    }
  }

  async function flushAndClose(window: BrowserWindow, afterFlush?: () => void): Promise<boolean> {
    if (pendingCloseWindows.has(window)) return false;
    pendingCloseWindows.add(window);
    try {
      const flushed = await flushWindow(window);
      if (!flushed) return false;
      afterFlush?.();
      approvedCloseWindows.add(window);
      if (!window.isDestroyed()) window.close();
      return true;
    } finally {
      pendingCloseWindows.delete(window);
    }
  }

  function attachCloseHandshake(window: BrowserWindow): void {
    if (attachedWindows.has(window)) return;
    attachedWindows.add(window);
    window.on("close", (event) => {
      if (approvedCloseWindows.has(window) || options.isAppQuitApproved?.() === true) return;
      event.preventDefault();
      if (pendingCloseWindows.has(window)) return;
      void flushAndClose(window).then((closed) => {
        if (!closed)
          console.warn(
            "付箋メモの終了前flushが完了しなかったため、ウィンドウを開いたままにします。",
          );
      });
    });
  }

  function saveTarget(
    memoId: string,
    target: boolean,
  ): { entity: Entity | null; changed: boolean } {
    return options.repository.runTransaction((transaction: MemoStickySaveTransaction) => {
      const memo = transaction.get("capture_entry", memoId) as Entity | null;
      if (!memo || memo.kind !== MEMO_KIND || memo.state === "archived" || memo.deleted_at) {
        return { entity: null, changed: false };
      }
      if (isStickyMemoTarget(memo) === target) return { entity: memo, changed: false };
      const entity = transaction.save("capture_entry", markStickyMemoTarget(memo, target), {
        source: "memo-sticky",
      }) as Entity;
      return { entity, changed: true };
    });
  }

  async function setTarget(
    event: Electron.IpcMainInvokeEvent,
    value: unknown,
  ): Promise<MemoStickyTargetResult> {
    const request = parseMemoStickyTargetRequest(value);
    if (!request || !authorizeRequestedMemo(event, request.memoId)) {
      return { status: "not_found", target: false, visible: false, content: null };
    }
    const key = keyOf(request.memoId);
    const window = options.satelliteWindows.get(key);
    if (!request.target && window?.isVisible()) {
      const flushed = await flushWindow(window);
      if (!flushed) {
        const memo = readMemo(request.memoId);
        return {
          status: "flush_failed",
          target: true,
          visible: true,
          content: memo ? toContent(memo) : null,
        };
      }
    }
    const outcome = saveTarget(request.memoId, request.target);
    if (!outcome.entity)
      return { status: "not_found", target: false, visible: false, content: null };

    if (request.target) open(request.memoId);
    else options.satelliteWindows.hide(key);

    if (outcome.changed)
      options.notifyWorkspaceChanged({ type: "capture_entry", entity: outcome.entity });
    options.notifyStickyStateChanged();
    return {
      status: "applied",
      target: request.target,
      visible: options.satelliteWindows.get(key)?.isVisible() === true,
      content: toContent(outcome.entity),
    };
  }

  async function toggleTargetsVisibility(): Promise<MemoStickyVisibilityResult> {
    const targets = stickyMemoIds();
    const action = memoStickyVisibilityAction(targets, visibleMemoIds());
    if (action === "empty") return { status: "empty", targetCount: 0, visibleCount: 0 };
    if (action === "show") {
      for (const memoId of targets) open(memoId, false);
      options.satelliteWindows.arrange(targets.map(keyOf));
      return { status: "shown", targetCount: targets.length, visibleCount: targets.length };
    }

    const windows = targets
      .map((memoId) => options.satelliteWindows.get(keyOf(memoId)))
      .filter((window): window is BrowserWindow => Boolean(window?.isVisible()));
    const flushed = await Promise.all(windows.map(flushWindow));
    if (flushed.some((ok) => !ok)) {
      return {
        status: "flush_failed",
        targetCount: targets.length,
        visibleCount: visibleMemoIds().length,
      };
    }
    for (const memoId of targets) options.satelliteWindows.hide(keyOf(memoId));
    return { status: "hidden", targetCount: targets.length, visibleCount: 0 };
  }

  function setTheme(value: unknown): boolean {
    const request = parseMemoStickyThemeRequest(value);
    if (!request) return false;
    activeTheme = request.theme;
    for (const memoId of windowMemoIds()) {
      const memo = readMemo(memoId);
      const window = options.satelliteWindows.get(keyOf(memoId));
      if (memo && window) applyWindowAppearance(window, memo);
    }
    options.satelliteWindows.broadcast(IPC.memoStickyThemeChanged, activeTheme);
    return true;
  }

  async function setColor(
    event: Electron.IpcMainInvokeEvent,
    value: unknown,
  ): Promise<MemoStickyColorResult> {
    const request = parseMemoStickyColorRequest(value);
    const memoId = memoIdOf(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!request || !memoId || !window) return { status: "not_found", content: null };
    if (!(await flushWindow(window))) {
      const memo = readMemo(memoId);
      return { status: "flush_failed", content: memo ? toContent(memo) : null };
    }
    const outcome = options.repository.runTransaction((transaction: MemoStickySaveTransaction) => {
      const memo = transaction.get("capture_entry", memoId) as Entity | null;
      if (!memo || memo.kind !== MEMO_KIND || memo.state === "archived" || memo.deleted_at)
        return null;
      if (memoStickyColorOf(memo) === request.color) return { entity: memo, changed: false };
      return {
        entity: transaction.save("capture_entry", markMemoStickyColor(memo, request.color), {
          source: "memo-sticky",
        }) as Entity,
        changed: true,
      };
    });
    if (!outcome) return { status: "not_found", content: null };
    applyWindowAppearance(window, outcome.entity);
    if (outcome.changed)
      options.notifyWorkspaceChanged({ type: "capture_entry", entity: outcome.entity });
    return { status: "applied", content: toContent(outcome.entity) };
  }

  async function createMemo(event: Electron.IpcMainInvokeEvent): Promise<MemoStickyCreateResult> {
    const sourceMemoId = memoIdOf(event);
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (!sourceMemoId || !sourceWindow) return { status: "not_found", content: null };
    if (!(await flushWindow(sourceWindow))) return { status: "flush_failed", content: null };

    const created = options.repository.runTransaction(
      (transaction: MemoStickySaveTransaction) =>
        transaction.save(
          "capture_entry",
          markStickyMemoTarget(
            {
              id: randomUUID(),
              title: "",
              text: "新しい付箋",
              kind: MEMO_KIND,
              content_type: "text",
              captured_at: new Date().toISOString(),
              state: "untriaged",
            } as Entity,
            true,
          ),
          { source: "memo-sticky" },
        ) as Entity,
    );
    const memoId = String(created.id);
    options.notifyWorkspaceChanged({ type: "capture_entry", entity: created });
    options.notifyStickyStateChanged();
    if (!open(memoId, false)) return { status: "not_found", content: null };
    options.satelliteWindows.arrangeNextTo(keyOf(memoId), keyOf(sourceMemoId));
    return { status: "created", content: toContent(created) };
  }

  function registerIpc(): void {
    ipcMain.handle(IPC.memoStickyLoad, (event) => {
      const memoId = memoIdOf(event);
      const memo = memoId ? readMemo(memoId) : null;
      return memo ? toContent(memo) : null;
    });

    ipcMain.handle(IPC.memoStickyCreate, (event) => createMemo(event));

    ipcMain.handle(IPC.memoStickySave, (event, value: unknown): MemoStickySaveResult => {
      const memoId = memoIdOf(event);
      if (!memoId) throw new Error("対象の付箋メモがありません。");
      const outcome = options.repository.runTransaction((transaction: MemoStickySaveTransaction) =>
        saveMemoStickyWithinTransaction(transaction, memoId, value),
      );
      const { request } = outcome;
      if (outcome.status === "saved") {
        options.notifyWorkspaceChanged({
          type: "capture_entry",
          entity: outcome.entity,
          memoStickySave: {
            kind: "memo_sticky_save",
            saveRequestId: request.saveRequestId,
            editRevision: request.editRevision,
          },
        });
      }
      return {
        status: outcome.status,
        editRevision: request.editRevision,
        saveRequestId: request.saveRequestId,
        content: toContent(outcome.entity),
      };
    });

    ipcMain.handle(IPC.memoStickyCopy, (event) => {
      const memoId = memoIdOf(event);
      const memo = memoId ? readMemo(memoId) : null;
      if (!memo) return false;
      clipboard.writeText(typeof memo.text === "string" ? memo.text : "");
      return true;
    });

    ipcMain.handle(IPC.memoStickyClose, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      return window ? flushAndClose(window) : false;
    });

    // 閉じるのとは別に、付箋対象を保ったまま一時的に視界から退避する。
    // 最小化前にもflushするので、autosave待ちの本文を失わない。
    ipcMain.handle(IPC.memoStickyMinimize, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || !options.satelliteWindows.has(window)) return false;
      if (!(await flushWindow(window))) return false;
      window.minimize();
      options.notifyStickyStateChanged();
      return window.isMinimized();
    });

    ipcMain.handle(IPC.memoStickySetTarget, (event, value: unknown) => setTarget(event, value));
    ipcMain.handle(IPC.memoStickySetColor, (event, value: unknown) => setColor(event, value));
    ipcMain.handle(IPC.memoStickySetTheme, (_event, value: unknown) => setTheme(value));
    ipcMain.handle(IPC.memoStickyToggleTargetsVisibility, () => toggleTargetsVisibility());

    ipcMain.handle(IPC.memoStickySetAlwaysOnTop, (event, value: unknown) => {
      const request =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      if (!request || Object.keys(request).length !== 1 || typeof request.alwaysOnTop !== "boolean")
        return false;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || !options.satelliteWindows.has(window)) return false;
      window.setAlwaysOnTop(request.alwaysOnTop);
      options.notifyStickyStateChanged();
      return window.isAlwaysOnTop();
    });

    ipcMain.handle(IPC.memoStickyIsAlwaysOnTop, (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      return window ? window.isAlwaysOnTop() : false;
    });

    ipcMain.handle(IPC.memoStickyOpenInMain, (event) => {
      const memoId = memoIdOf(event);
      if (!memoId) return false;
      const mainWindow = options.showMainWindow();
      const send = (): void => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.workspaceOpenMemo, memoId);
      };
      if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
      else send();
      return true;
    });

    ipcMain.handle(IPC.memoStickyArchive, async (event) => {
      const memoId = memoIdOf(event);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!memoId || !window) return false;
      return flushAndClose(window, () => {
        const memo = readMemo(memoId);
        if (!memo) return;
        const saved = options.repository.save(
          "capture_entry",
          { ...memo, state: "archived" },
          { source: "memo-sticky" },
        ) as Entity;
        options.notifyWorkspaceChanged({ type: "capture_entry", entity: saved });
        options.notifyStickyStateChanged();
      });
    });

    ipcMain.handle(IPC.memoStickyDelete, async (event) => {
      const memoId = memoIdOf(event);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!memoId || !window) return false;
      return flushAndClose(window, () => {
        const memo = readMemo(memoId);
        if (!memo) return;
        options.repository.remove("capture_entry", memoId);
        options.notifyWorkspaceChanged({
          type: "capture_entry",
          entity: { ...memo, deleted_at: new Date().toISOString() } as Entity,
        });
        options.notifyStickyStateChanged();
      });
    });
  }

  return { open, visibleMemoIds, windowMemoIds, stickyMemoIds, alwaysOnTopMemoIds, registerIpc };
}
