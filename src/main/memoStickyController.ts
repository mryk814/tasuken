import { BrowserWindow, clipboard, ipcMain } from "electron";
import path from "node:path";

import type { SatelliteWindowRegistry } from "./satelliteWindowRegistry";
import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import type { MemoStickyContent } from "../shared/ipc/contracts";
import { IPC } from "../shared/ipc/contracts";
import { isStickyMemoTarget, markStickyMemoTarget } from "../shared/memoPresentation";
import type { Entity, EntityType } from "../shared/types/workspace";

/**
 * InboxのMemoをデスクトップ付箋として浮かせる（#298）。
 *
 * 付箋は別Entityではなく、同じMemo（capture_entry / kind: micro_memo）の表示状態でしかない。
 * したがってここには「付箋用のデータ」を作らず、常に同じMemo IDへ読み書きする。
 * ウィンドウの一意性・位置記憶・変更配信は satelliteWindowRegistry が受け持つ。
 */

const MEMO_KIND = "micro_memo";
const STICKY_DEFAULT_WIDTH = 300;
const STICKY_DEFAULT_HEIGHT = 260;
const STICKY_MIN_WIDTH = 220;
const STICKY_MIN_HEIGHT = 160;

interface MemoStickyControllerOptions {
  repository: InstanceType<typeof WorkspaceDatabase>;
  satelliteWindows: SatelliteWindowRegistry;
  showMainWindow: () => BrowserWindow;
  notifyWorkspaceChanged: (
    change: { type: EntityType; entity: Entity } | { entities: Array<{ type: EntityType; entity: Entity }> },
  ) => void;
}

export interface MemoStickyController {
  open: (memoId: string) => boolean;
  /** いま浮いているMemoのID。本体側で「付箋表示中」を区別するために使う。 */
  openMemoIds: () => string[];
  /** 利用者が付箋表示対象にしたMemoのID。閉じてもこの指定は残る。 */
  stickyMemoIds: () => string[];
  showAll: () => number;
  registerIpc: () => void;
}

function memoTitle(memo: Entity): string {
  const title = typeof memo.title === "string" ? memo.title.trim() : "";
  if (title) return title;
  const text = typeof memo.text === "string" ? memo.text.trim() : "";
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  return firstLine.slice(0, 40) || "付箋メモ";
}

function toContent(memo: Entity): MemoStickyContent {
  return {
    id: String(memo.id),
    title: typeof memo.title === "string" ? memo.title : "",
    text: typeof memo.text === "string" ? memo.text : "",
    url: typeof memo.url === "string" ? memo.url : "",
    capturedAt: String(memo.captured_at || ""),
  };
}

export function createMemoStickyController(options: MemoStickyControllerOptions): MemoStickyController {
  function readMemo(memoId: string): Entity | null {
    const memo = options.repository.get("capture_entry", memoId) as Entity | null;
    if (!memo || memo.kind !== MEMO_KIND || memo.state === "archived" || memo.deleted_at) return null;
    return memo;
  }

  function open(memoId: string): boolean {
    const memo = readMemo(memoId);
    if (!memo) return false;
    if (!isStickyMemoTarget(memo)) {
      const marked = options.repository.save(
        "capture_entry",
        markStickyMemoTarget(memo, true),
        { source: "memo-sticky" },
      ) as Entity;
      options.notifyWorkspaceChanged({ type: "capture_entry", entity: marked });
    }
    // 同じMemoの二枚目は作らない。既に浮いていれば前面へ出すだけ（#298）。
    const key = { kind: "memo" as const, entityId: memoId };
    options.satelliteWindows.open(key, {
      title: memoTitle(memo),
      width: STICKY_DEFAULT_WIDTH,
      height: STICKY_DEFAULT_HEIGHT,
      minWidth: STICKY_MIN_WIDTH,
      minHeight: STICKY_MIN_HEIGHT,
      page: "memo-sticky",
      preload: path.join(__dirname, "../preload/memoSticky.mjs"),
      // 付箋アプリの用途上、既定で手前に置く。ウィンドウごとに切り替えられる。
      alwaysOnTop: true,
      frame: false,
      skipTaskbar: true,
    });
    options.satelliteWindows.arrange([key]);
    return true;
  }

  function openMemoIds(): string[] {
    return options.satelliteWindows.list("memo").map((entry) => entry.entityId);
  }

  function stickyMemoIds(): string[] {
    return (options.repository.list("capture_entry") as Entity[])
      .filter(isStickyMemoTarget)
      .map((memo) => String(memo.id));
  }

  function showAll(): number {
    const ids = stickyMemoIds();
    for (const memoId of ids) open(memoId);
    options.satelliteWindows.arrange(ids.map((entityId) => ({ kind: "memo", entityId })));
    return ids.length;
  }

  /** IPCの送り元ウィンドウから対象Memoを特定する。renderer側のIDを信用しない。 */
  function memoIdOf(event: Electron.IpcMainInvokeEvent): string | null {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const key = options.satelliteWindows.keyOf(window);
    return key?.kind === "memo" ? key.entityId : null;
  }

  function registerIpc(): void {
    ipcMain.handle(IPC.memoStickyOpen, (_event, memoId: unknown) => {
      if (typeof memoId !== "string" || !memoId.trim()) return false;
      return open(memoId);
    });

    ipcMain.handle(IPC.memoStickyLoad, (event) => {
      const memoId = memoIdOf(event);
      if (!memoId) return null;
      const memo = readMemo(memoId);
      return memo ? toContent(memo) : null;
    });

    // 付箋上の編集は同じMemo IDへ保存する。別コピーを作らない（#298）。
    ipcMain.handle(IPC.memoStickySave, (event, text: unknown) => {
      const memoId = memoIdOf(event);
      if (!memoId) throw new Error("対象の付箋メモがありません。");
      if (typeof text !== "string") throw new Error("メモの内容を入力してください。");
      const memo = readMemo(memoId);
      if (!memo) throw new Error("メモが見つかりません。");
      const saved = options.repository.save("capture_entry", { ...memo, text }, { source: "memo-sticky" }) as Entity;
      options.notifyWorkspaceChanged({ type: "capture_entry", entity: saved });
      return toContent(saved);
    });

    ipcMain.handle(IPC.memoStickyCopy, (event) => {
      const memoId = memoIdOf(event);
      const memo = memoId ? readMemo(memoId) : null;
      if (!memo) return false;
      clipboard.writeText(typeof memo.text === "string" ? memo.text : "");
      return true;
    });

    // ×は表示を閉じるだけ。Memo本体は消さない（削除は明示操作）。
    ipcMain.handle(IPC.memoStickyClose, (event) => {
      const memoId = memoIdOf(event);
      if (!memoId) return false;
      return options.satelliteWindows.close({ kind: "memo", entityId: memoId });
    });

    ipcMain.handle(IPC.memoStickySetAlwaysOnTop, (event, pinned: unknown) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || !options.satelliteWindows.has(window)) return false;
      window.setAlwaysOnTop(pinned === true);
      return window.isAlwaysOnTop();
    });

    ipcMain.handle(IPC.memoStickyIsAlwaysOnTop, (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      return window ? window.isAlwaysOnTop() : false;
    });

    // 付箋から本体を開く。付箋自身は閉じず、編集位置も保つ。
    ipcMain.handle(IPC.memoStickyOpenInMain, (event) => {
      const memoId = memoIdOf(event);
      if (!memoId) return false;
      const mainWindow = options.showMainWindow();
      const send = (): void => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send("workspace:open-memo", memoId);
      };
      if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
      else send();
      return true;
    });

    // 本体側からの状態確認（付箋になっているMemoを一覧で区別する）。
    ipcMain.handle(IPC.memoStickyListOpen, () => openMemoIds());
    ipcMain.handle(IPC.memoStickyListTargets, () => stickyMemoIds());

    // 「付箋表示対象」の一括操作。すべて閉じてもMemoは削除しない。
    ipcMain.handle(IPC.memoStickyShowAll, () => showAll());
    ipcMain.handle(IPC.memoStickyCloseAll, () => {
      const ids = openMemoIds();
      for (const memoId of ids) options.satelliteWindows.close({ kind: "memo", entityId: memoId });
      return ids.length;
    });

    // 付箋を閉じることとは別の操作として、Memo自体をアーカイブ・削除する（#298）。
    ipcMain.handle(IPC.memoStickyArchive, (event) => {
      const memoId = memoIdOf(event);
      if (!memoId) return false;
      const memo = readMemo(memoId);
      if (!memo) return false;
      const saved = options.repository.save("capture_entry", { ...memo, state: "archived" }, { source: "memo-sticky" }) as Entity;
      options.notifyWorkspaceChanged({ type: "capture_entry", entity: saved });
      options.satelliteWindows.close({ kind: "memo", entityId: memoId });
      return true;
    });
    ipcMain.handle(IPC.memoStickyDelete, (event) => {
      const memoId = memoIdOf(event);
      if (!memoId) return false;
      const memo = readMemo(memoId);
      if (!memo) return false;
      options.repository.remove("capture_entry", memoId);
      options.notifyWorkspaceChanged({ type: "capture_entry", entity: { ...memo, deleted_at: new Date().toISOString() } as Entity });
      options.satelliteWindows.close({ kind: "memo", entityId: memoId });
      return true;
    });
  }

  return { open, openMemoIds, stickyMemoIds, showAll, registerIpc };
}
