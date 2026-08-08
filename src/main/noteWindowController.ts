import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";

import type { SatelliteWindowRegistry } from "./satelliteWindowRegistry";
import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import type { Entity } from "../shared/types/workspace";
import { IPC } from "../shared/ipc/contracts";

/**
 * Note / Markdown文書を別ウィンドウで編集する（#290）。
 *
 * 本体と同じrenderer（index.html）を `?window=note&noteId=...` で開く。
 * Editorを二重に実装しないので、Edit / Preview / Raw、検索・置換、画像、Mermaid等の
 * 既存機能がそのまま動き、保存経路も本体と同じ正本を通る。
 *
 * ウィンドウの一意性・位置記憶・変更配信は satelliteWindowRegistry が受け持つ。
 */

const NOTE_DEFAULT_WIDTH = 980;
const NOTE_DEFAULT_HEIGHT = 760;
const NOTE_MIN_WIDTH = 560;
const NOTE_MIN_HEIGHT = 420;

interface NoteWindowControllerOptions {
  repository: InstanceType<typeof WorkspaceDatabase>;
  satelliteWindows: SatelliteWindowRegistry;
  showMainWindow: () => BrowserWindow;
}

export interface NoteWindowController {
  open: (noteId: string) => boolean;
  /** いま別ウィンドウで開いているNoteのID。本体側の二重編集防止に使う。 */
  openNoteIds: () => string[];
  registerIpc: () => void;
}

function noteTitle(note: Entity): string {
  const title = typeof note.title === "string" ? note.title.trim() : "";
  return title || "無題のノート";
}

export function createNoteWindowController(options: NoteWindowControllerOptions): NoteWindowController {
  function readNote(noteId: string): Entity | null {
    return (options.repository.get("note", noteId) as Entity | null) ?? null;
  }

  function open(noteId: string): boolean {
    const note = readNote(noteId);
    if (!note) return false;
    // 同じNoteの二枚目は作らない。既にあれば前面へ出すだけにして、
    // 同一Noteを別Editorで同時編集させない（#290）。
    options.satelliteWindows.open({ kind: "note", entityId: noteId }, {
      title: noteTitle(note),
      width: NOTE_DEFAULT_WIDTH,
      height: NOTE_DEFAULT_HEIGHT,
      minWidth: NOTE_MIN_WIDTH,
      minHeight: NOTE_MIN_HEIGHT,
      // 本体と同じrendererを別モードで開く。Editorを二重に実装しない。
      page: "index",
      query: { window: "note", noteId },
      preload: path.join(__dirname, "../preload/index.mjs"),
    });
    return true;
  }

  function openNoteIds(): string[] {
    return options.satelliteWindows.list("note").map((entry) => entry.entityId);
  }

  function noteIdOf(event: Electron.IpcMainInvokeEvent): string | null {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const key = options.satelliteWindows.keyOf(window);
    return key?.kind === "note" ? key.entityId : null;
  }

  function registerIpc(): void {
    ipcMain.handle(IPC.noteWindowOpen, (_event, noteId: unknown) => {
      if (typeof noteId !== "string" || !noteId.trim()) return false;
      return open(noteId);
    });

    ipcMain.handle(IPC.noteWindowListOpen, () => openNoteIds());

    // 切り離しウィンドウを閉じ、本体で同じNoteを続けて編集できるようにする。
    ipcMain.handle(IPC.noteWindowReturnToMain, (event) => {
      const noteId = noteIdOf(event);
      if (!noteId) return false;
      const mainWindow = options.showMainWindow();
      const send = (): void => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.workspaceOpenNote, noteId);
      };
      if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
      else send();
      // 閉じるのは本体へ渡した後。未保存分は既存のautosave契約で保存済み。
      options.satelliteWindows.close({ kind: "note", entityId: noteId });
      return true;
    });

    // Noteウィンドウから関連Entityを開くときは、本体ウィンドウ側で表示する。
    // Noteウィンドウ自体は閉じず、編集位置も保つ（#290）。
    ipcMain.handle(IPC.noteWindowOpenInMain, (_event, route: unknown) => {
      const mainWindow = options.showMainWindow();
      if (typeof route !== "string" || !route.trim()) return true;
      const send = (): void => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.workspaceNavigate, route);
      };
      if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
      else send();
      return true;
    });

    ipcMain.handle(IPC.noteWindowClose, (event) => {
      const noteId = noteIdOf(event);
      if (!noteId) return false;
      return options.satelliteWindows.close({ kind: "note", entityId: noteId });
    });
  }

  return { open, openNoteIds, registerIpc };
}
