import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { localDateString, localDateTimeString } from "./dateTime";
import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import type { Entity, EntityType } from "../shared/types/workspace";
import {
  firstCaptureUrl,
  parseQuickCaptureSchedule,
  quickCaptureContentType,
  quickCaptureScheduleLabel,
  quickCaptureTitle,
  splitQuickCaptureInput,
} from "../shared/quickCapture.mjs";
import { canonicalThemeId } from "../shared/themeRef.mjs";

export type QuickCaptureMode = "inbox" | "today-task" | "micro-memo" | "done-task" | "due-task";

interface QuickCaptureControllerOptions {
  repository: InstanceType<typeof WorkspaceDatabase>;
  notifyWorkspaceChanged: (
    change: { type: EntityType; entity: Entity } | { entities: Array<{ type: EntityType; entity: Entity }> },
  ) => void;
}

type QuickCaptureScheduleParse =
  | { ok: false; message: string }
  | { ok: true; kind: "single"; date: string; time: string }
  | { ok: true; kind: "range"; startDate: string; endDate: string; rangeSemantics: "once_within_window" | "ongoing"; ambiguous: boolean };

function parseSchedule(expression: string, today: string): QuickCaptureScheduleParse {
  return parseQuickCaptureSchedule(expression, today) as unknown as QuickCaptureScheduleParse;
}

export interface QuickCaptureController {
  getWindow: () => BrowserWindow | null;
  show: (mode?: QuickCaptureMode) => void;
  registerIpc: () => void;
  menuItems: () => Electron.MenuItemConstructorOptions[];
}

export function createQuickCaptureController(options: QuickCaptureControllerOptions): QuickCaptureController {
  let captureWindow: BrowserWindow | null = null;

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 420,
      // 期限の解釈結果を出す1行ぶんを含めた高さ（#308）。
      height: 284,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: false,
      backgroundColor: "#F4EEEC",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        // TODO: sandbox:true breaks the ESM preload bridge in the current smoke path.
        sandbox: false,
        preload: path.join(__dirname, "../preload/capture.mjs"),
      },
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/capture.html`);
    } else {
      void win.loadFile(path.join(__dirname, "../renderer/capture.html"));
    }

    win.on("blur", () => {
      if (win.isVisible()) win.hide();
    });
    return win;
  }

  function sendWindowState(win: BrowserWindow, mode: QuickCaptureMode): void {
    const themeMode = options.repository.getPreference("themeMode") ?? "light";
    const themes = [
      ...(options.repository.list("theme") as Entity[]).map((theme) => ({
        id: theme.id,
        name: String(theme.name || theme.title || "Theme"),
      })),
      ...(options.repository.list("project") as Entity[]).map((project) => ({
        id: project.id,
        name: String(project.name || project.title || "Theme"),
      })),
    ];
    const uniqueThemes = [...new Map(themes.map((theme) => [theme.id, theme])).values()]
      .sort((a, b) => a.name.localeCompare(b.name, "ja-JP"));
    win.webContents.send("quick-capture:theme", themeMode);
    win.webContents.send("quick-capture:themes", uniqueThemes);
    win.webContents.send("quick-capture:shown", mode);
  }

  function show(mode: QuickCaptureMode = "inbox"): void {
    if (!captureWindow || captureWindow.isDestroyed()) {
      captureWindow = createWindow();
    }
    captureWindow.center();
    captureWindow.show();
    captureWindow.focus();

    const win = captureWindow;
    if (win.webContents.isLoading()) {
      win.webContents.once("did-finish-load", () => {
        if (!win.isDestroyed()) sendWindowState(win, mode);
      });
    } else {
      sendWindowState(win, mode);
    }
  }

  function registerIpc(): void {
    ipcMain.handle("quick-capture:save", (_event, text: string, mode: QuickCaptureMode = "inbox", themeId?: string, selectedRangeSemantics?: "once_within_window" | "ongoing") => {
      const trimmed = (text || "").trim();
      if (!trimmed) throw new Error("入力が空です。");
      if (mode === "today-task" || mode === "done-task" || mode === "due-task") {
        const taskId = randomUUID();
        const today = localDateString();
        const now = new Date().toISOString();
        const isDoneTask = mode === "done-task";
        // 「本体｜補足」の補足はmodeごとに意味が違う（#308）。
        const { main, extra } = splitQuickCaptureInput(trimmed);
        if (!main) throw new Error("タスク名を入力してください。");
        const due = mode === "due-task" ? parseSchedule(extra, today) : null;
        if (due && !due.ok) throw new Error(due.message);
        const parsedDue = due?.ok ? due : null;
        const isRange = parsedDue?.kind === "range";
        const scheduledDate = parsedDue ? parsedDue.kind === "range" ? parsedDue.startDate : parsedDue.date : today;
        const scheduledEndDate = parsedDue?.kind === "range" ? parsedDue.endDate : scheduledDate;
        const rangeSemantics = parsedDue?.kind === "range"
          ? selectedRangeSemantics === "ongoing" ? "ongoing" : selectedRangeSemantics === "once_within_window" ? "once_within_window" : parsedDue.rangeSemantics
          : null;
        const saved = options.repository.saveMany([
          {
            action: "save",
            type: "task",
            entity: {
              id: taskId,
              title: main,
              // 期限modeの補足は日付として消費するので本文へは残さない。
              description: mode === "today-task" && extra ? extra : null,
              // やったことのひとことは本文と混ぜず、完了の記録として分けて保存する。
              completion_note: isDoneTask && extra ? extra : null,
              project_id: canonicalThemeId(themeId, { defaultPersonal: true }),
              state: isDoneTask ? "done" : "todo",
              priority: "normal",
              completed_at: isDoneTask ? now : null,
              reminder_at: parsedDue?.kind === "single" && parsedDue.time ? `${parsedDue.date}T${parsedDue.time}` : null,
              created_at: now,
            },
            options: { source: "quick-capture" },
          },
          {
            action: "save",
            type: "schedule",
            entity: {
              id: randomUUID(),
              owner_type: "task",
              owner_id: taskId,
              start_date: scheduledDate,
              end_date: scheduledEndDate,
              date_kind: isRange ? "range" : mode === "due-task" ? "deadline" : "point",
              range_semantics: rangeSemantics,
              confidence: "fixed",
              granularity: "day",
            },
            options: { source: "quick-capture" },
          },
        ]);
        options.notifyWorkspaceChanged({
          entities: [
            { type: "task", entity: saved[0] as Entity },
            { type: "schedule", entity: saved[1] as Entity },
          ],
        });
        return saved[0];
      }
      const contentType = quickCaptureContentType(trimmed);
      const saved = options.repository.save("capture_entry", {
        text: trimmed,
        title: mode === "micro-memo" ? null : quickCaptureTitle(trimmed),
        kind: mode === "micro-memo" ? "micro_memo" : "inbox",
        content_type: contentType,
        url: contentType === "url" ? firstCaptureUrl(trimmed) : null,
        project_id: canonicalThemeId(themeId, { defaultPersonal: true }),
        captured_at: localDateTimeString(),
        state: "untriaged",
      }, { source: "quick-capture" });
      options.notifyWorkspaceChanged({
        entities: [{ type: "capture_entry", entity: saved as Entity }],
      });
      return saved;
    });

    // 期限は保存前に解釈結果を確認できるようにする（#308）。解釈はmain側の一箇所だけで行う。
    ipcMain.handle("quick-capture:preview-due", (_event, text: unknown) => {
      const { extra } = splitQuickCaptureInput(typeof text === "string" ? text : "");
      if (!extra) return { state: "empty" as const };
      const due = parseSchedule(extra, localDateString());
      if (!due.ok) return { state: "error" as const, message: due.message };
      return {
        state: "ok" as const,
        label: quickCaptureScheduleLabel(due),
        kind: due.kind,
        rangeSemantics: due.kind === "range" ? due.rangeSemantics : null,
        ambiguous: due.kind === "range" ? due.ambiguous : false,
      };
    });

    ipcMain.on("quick-capture:hide", () => {
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
    });
  }

  function menuItems(): Electron.MenuItemConstructorOptions[] {
    return [
      { label: "Inboxへクイック記録", accelerator: "CmdOrCtrl+Shift+N", click: () => show("inbox") },
      { label: "今日のタスクを追加", accelerator: "CmdOrCtrl+Shift+M", click: () => show("today-task") },
      { label: "期限つきタスクを追加", accelerator: "CmdOrCtrl+Shift+D", click: () => show("due-task") },
      { label: "やったことを記録", accelerator: "CmdOrCtrl+Shift+,", click: () => show("done-task") },
      { label: "付箋メモを追加", accelerator: "CmdOrCtrl+Shift+.", click: () => show("micro-memo") },
    ];
  }

  return {
    getWindow: () => captureWindow,
    show,
    registerIpc,
    menuItems,
  };
}
