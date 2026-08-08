import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { localDateString } from "./dateTime";
import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import type { TodayMiniTask } from "../shared/ipc/contracts";
import type { Entity, EntityType } from "../shared/types/workspace";
import { canonicalThemeId } from "../shared/themeRef.mjs";
import { selectTodayTasks, TODAY_TASK_POLICY } from "../shared/todayTasks.mjs";
import type { CommandEnvelope, CommandReceipt } from "../shared/applicationCommand";
import { IPC } from "../shared/ipc/contracts";


const INACTIVE_OPACITY = 0.5;
const FADE_DELAY_MS = 30000;
const SCREEN_MARGIN = 16;
const PINNED_WIDTH = 360;
const PINNED_HEIGHT = 560;
const THEME_COLOR_KEYS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
  "theme-extra-1",
  "theme-extra-2",
  "theme-extra-3",
  "theme-extra-4",
] as const;

interface TodayMiniControllerOptions {
  repository: InstanceType<typeof WorkspaceDatabase>;
  getAppIconPath: () => string;
  showMainWindow: () => BrowserWindow;
  notifyWorkspaceChanged: (
    change: { type: EntityType; entity: Entity } | { entities: Array<{ type: EntityType; entity: Entity }> },
  ) => void;
  notifyCommandApplied: (receipt: CommandReceipt, senderId: number) => void;
  executeCommand: (envelope: CommandEnvelope) => CommandReceipt;
}

export interface TodayMiniController {
  getWindow: () => BrowserWindow | null;
  show: () => void;
  hide: () => boolean;
  openTask: (taskId: string) => boolean;
  registerIpc: () => void;
}

export function createTodayMiniController(options: TodayMiniControllerOptions): TodayMiniController {
  let window: BrowserWindow | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearFadeTimer(): void {
    if (!fadeTimer) return;
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }

  function restoreOpacity(win: BrowserWindow | null = window): void {
    clearFadeTimer();
    if (win && !win.isDestroyed()) win.setOpacity(1);
  }

  function scheduleFade(win: BrowserWindow): void {
    clearFadeTimer();
    fadeTimer = setTimeout(() => {
      if (!win.isDestroyed() && win.isVisible() && !win.isFocused()) {
        win.setOpacity(INACTIVE_OPACITY);
      }
    }, FADE_DELAY_MS);
  }

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 380,
      height: 520,
      minWidth: 320,
      minHeight: 360,
      show: false,
      frame: false,
      resizable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      title: "今日やること",
      icon: options.getAppIconPath(),
      backgroundColor: "#F4EEEC",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, "../preload/todayMini.mjs"),
      },
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/today-mini.html`);
    } else {
      void win.loadFile(path.join(__dirname, "../renderer/today-mini.html"));
    }

    win.on("closed", () => {
      clearFadeTimer();
      if (window === win) window = null;
    });
    win.on("focus", () => restoreOpacity(win));
    win.on("blur", () => scheduleFade(win));
    return win;
  }

  function ensureWindow(): BrowserWindow {
    if (!window || window.isDestroyed()) window = createWindow();
    return window;
  }

  function show(): void {
    const win = ensureWindow();
    restoreOpacity(win);
    win.show();
    win.focus();
    win.setAlwaysOnTop(true);
    if (!win.webContents.isLoading()) win.webContents.send(IPC.todayMiniRefresh);
  }

  function hide(): boolean {
    if (!window || window.isDestroyed()) return false;
    window.hide();
    restoreOpacity(window);
    return true;
  }

  function pinTopRight(): boolean {
    const win = ensureWindow();
    const bounds = win.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const width = Math.min(PINNED_WIDTH, Math.max(320, workArea.width - SCREEN_MARGIN * 2));
    const height = Math.min(PINNED_HEIGHT, Math.max(360, workArea.height - SCREEN_MARGIN * 2));
    const x = workArea.x + workArea.width - width - SCREEN_MARGIN;
    const y = workArea.y + SCREEN_MARGIN;
    win.setBounds({ x: Math.max(workArea.x, x), y: Math.max(workArea.y, y), width, height }, false);
    restoreOpacity(win);
    return true;
  }

  function checklistCounts(task: Entity): { done: number; total: number } {
    const items = Array.isArray(task.checklist_items) ? task.checklist_items : [];
    const valid = items.filter((item) => item && typeof item === "object" && "title" in item);
    return {
      done: valid.filter((item) => Boolean((item as Record<string, unknown>).done)).length,
      total: valid.length,
    };
  }

  function themeColor(theme: Entity | undefined, index: number): string {
    const rawColor = typeof theme?.color === "string" ? theme.color.trim() : "";
    const colorKey = THEME_COLOR_KEYS.includes(rawColor as typeof THEME_COLOR_KEYS[number])
      ? rawColor
      : THEME_COLOR_KEYS[((index % THEME_COLOR_KEYS.length) + THEME_COLOR_KEYS.length) % THEME_COLOR_KEYS.length];
    return `var(--color-${colorKey})`;
  }

  function themeMap(): Map<string, { name: string; color: string }> {
    const entries = [
      ...(options.repository.list("theme") as Entity[]),
      ...(options.repository.list("project") as Entity[]),
    ];
    return new Map(entries.map((entry, index) => [
      String(entry.id),
      {
        name: String(entry.name || entry.title || "個人業務"),
        color: themeColor(entry, index),
      },
    ] as const));
  }

  function listTasks(): TodayMiniTask[] {
    const today = localDateString();
    const tasks = options.repository.list("task") as Entity[];
    const schedules = options.repository.list("schedule") as Entity[];
    const themes = themeMap();

    const selected = selectTodayTasks(tasks, schedules, today, TODAY_TASK_POLICY) as Array<{ task: Entity; schedule?: Entity }>;
    return selected
      .map(({ task, schedule }): TodayMiniTask => {
        const counts = checklistCounts(task);
        const theme = typeof task.project_id === "string" ? themes.get(task.project_id) : null;
        return {
          id: String(task.id),
          title: String(task.title || "無題のタスク"),
          themeName: theme?.name || "個人業務",
          themeColor: theme?.color || "var(--color-chart-6)",
          scheduleLabel: String(schedule?.end_date || schedule?.start_date || today),
          hasReminder: typeof task.reminder_at === "string" && task.reminder_at.trim().length > 0,
          priority: task.priority === "high" ? "high" : "normal",
          checklistDone: counts.done,
          checklistTotal: counts.total,
        };
      });
  }

  function addTask(title: string, senderId = 0): TodayMiniTask[] {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("タスク名を入力してください。");
    const today = localDateString();
    const taskId = randomUUID();
    const receipt = options.executeCommand({
      commandId: randomUUID(),
      name: "CreateTask",
      payload: {
        task: {
          id: taskId,
          title: trimmed,
          state: "todo",
          priority: "normal",
          project_id: canonicalThemeId(null, { defaultPersonal: true }),
          source: "today-mini",
        },
        schedule: {
          id: randomUUID(),
          owner_type: "task",
          owner_id: taskId,
          start_date: today,
          end_date: today,
          date_kind: "point",
          confidence: "fixed",
          granularity: "day",
        },
      },
      actor: { kind: "user" },
      source: "today_window",
      issuedAt: new Date().toISOString(),
    });
    options.notifyCommandApplied(receipt, senderId);
    return listTasks();
  }

  function openTask(taskId: string): boolean {
    const task = options.repository.get("task", taskId);
    if (!task) return false;
    const mainWindow = options.showMainWindow();
    const send = () => {
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.workspaceOpenTaskDetail, taskId);
        }
      }, 150);
    };
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
    else send();
    return true;
  }

  function registerIpc(): void {
    ipcMain.handle(IPC.todayMiniShow, () => {
      show();
      return true;
    });
    ipcMain.handle(IPC.todayMiniPinTopRight, () => pinTopRight());
    ipcMain.handle(IPC.todayMiniHide, () => hide());
    ipcMain.handle(IPC.todayMiniList, () => listTasks());
    ipcMain.handle(IPC.todayMiniRefresh, () => listTasks());
    ipcMain.handle(IPC.todayMiniAddTask, (event, title: unknown) => {
      if (typeof title !== "string") throw new Error("タスク名を入力してください。");
      return addTask(title, event.sender.id);
    });
    ipcMain.handle(IPC.todayMiniToggle, (event, taskId: unknown) => {
      if (typeof taskId !== "string" || !taskId.trim()) {
        throw new Error("対象タスクがありません。");
      }
      const task = options.repository.get("task", taskId) as Entity | null;
      if (!task) throw new Error("タスクが見つかりません。");
      const completing = task.state !== "done";
      const receipt = options.executeCommand({
        commandId: randomUUID(),
        name: completing ? "CompleteTask" : "ReopenTask",
        payload: { taskId: task.id },
        actor: { kind: "user" },
        source: "today_window",
        expectedVersions: [{ type: "task", id: task.id, version: Number(task.version || 0) }],
        issuedAt: new Date().toISOString(),
      });
      if (receipt.changes.length) options.notifyCommandApplied(receipt, event.sender.id);
      return listTasks();
    });
    ipcMain.handle(IPC.todayMiniOpenTask, (_event, taskId: unknown) => {
      if (typeof taskId !== "string" || !taskId.trim()) return false;
      return openTask(taskId);
    });
  }

  return {
    getWindow: () => window,
    show,
    hide,
    openTask,
    registerIpc,
  };
}
