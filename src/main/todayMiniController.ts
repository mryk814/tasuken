import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { localDateString } from "./dateTime";
import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { IPC, type TodayMiniAddTaskRequest, type TodayMiniTask, type TodayMiniThemeOption } from "../shared/ipc/contracts";
import type { Entity, EntityType } from "../shared/types/workspace";
import { canonicalThemeId, themePickerOptions } from "../shared/themeRef.mjs";
import { selectTodayTasks, TODAY_TASK_POLICY } from "../shared/todayTasks.mjs";
import type { CommandEnvelope, CommandReceipt } from "../shared/applicationCommand";
import { resolveTodayMiniThemeRef } from "../shared/todayMiniTheme";
import { presentTodayMiniTheme } from "../shared/todayMiniPresentation";
import type { SatelliteWindowRegistry } from "./satelliteWindowRegistry";

const INACTIVE_OPACITY = 0.5;
const FADE_DELAY_MS = 30000;
const SCREEN_MARGIN = 16;
const PINNED_WIDTH = 360;
const PINNED_HEIGHT = 560;

function themeMode(value: unknown): "light" | "dark" {
  return value === "dark" ? "dark" : "light";
}

interface TodayMiniControllerOptions {
  repository: InstanceType<typeof WorkspaceDatabase>;
  satelliteWindows: SatelliteWindowRegistry;
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
  toggle: () => boolean;
  openTask: (taskId: string) => boolean;
  registerIpc: () => void;
}

export function createTodayMiniController(options: TodayMiniControllerOptions): TodayMiniController {
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  const windowKey = { kind: "today" as const, entityId: "today" };

  function clearFadeTimer(): void {
    if (!fadeTimer) return;
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }

  function restoreOpacity(win: BrowserWindow | null = options.satelliteWindows.get(windowKey)): void {
    clearFadeTimer();
    if (win && !win.isDestroyed()) win.setOpacity(1);
  }

  function scheduleFade(win: BrowserWindow): void {
    clearFadeTimer();
    fadeTimer = setTimeout(() => {
      if (!win.isDestroyed() && win.isVisible() && !win.isFocused()) win.setOpacity(INACTIVE_OPACITY);
    }, FADE_DELAY_MS);
  }

  function ensureWindow(): BrowserWindow {
    const win = options.satelliteWindows.open(windowKey, {
      title: "今日やること",
      width: 380,
      height: 520,
      minWidth: 300,
      minHeight: 360,
      page: "today-mini",
      preload: path.join(__dirname, "../preload/todayMini.mjs"),
      backgroundColor: "#F4EEEC",
      alwaysOnTop: true,
      frame: false,
      skipTaskbar: true,
    });
    win.removeAllListeners("focus");
    win.on("focus", () => restoreOpacity(win));
    win.removeAllListeners("blur");
    win.on("blur", () => scheduleFade(win));
    return win;
  }

  function show(): void {
    const win = ensureWindow();
    restoreOpacity(win);
    options.satelliteWindows.focus(windowKey);
    win.setAlwaysOnTop(true);
    const refresh = () => {
      if (win.isDestroyed()) return;
      const mode = themeMode(options.repository.getPreference("themeMode"));
      win.setBackgroundColor(mode === "dark" ? "#191412" : "#ECE2DF");
      win.webContents.send(IPC.todayMiniTheme, mode);
      win.webContents.send(IPC.todayMiniRefresh);
    };
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", refresh);
    else refresh();
  }

  function hide(): boolean {
    const hidden = options.satelliteWindows.hide(windowKey);
    restoreOpacity();
    return hidden;
  }

  function toggle(): boolean {
    const current = options.satelliteWindows.get(windowKey);
    if (current && !current.isDestroyed() && current.isVisible()) {
      hide();
      return false;
    }
    show();
    return true;
  }

  function pinTopRight(): boolean {
    const win = ensureWindow();
    const bounds = win.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const width = Math.min(PINNED_WIDTH, Math.max(300, workArea.width - SCREEN_MARGIN * 2));
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

  function listThemeOptions(): TodayMiniThemeOption[] {
    return themePickerOptions(options.repository.list("theme") as Entity[], { allowPersonal: true, allowNone: false });
  }

  function listTasks(): TodayMiniTask[] {
    const today = localDateString();
    const tasks = options.repository.list("task") as Entity[];
    const schedules = options.repository.list("schedule") as Entity[];
    const themes = options.repository.list("theme") as Entity[];
    const selected = selectTodayTasks(tasks, schedules, today, TODAY_TASK_POLICY) as Array<{ task: Entity; schedule?: Entity }>;
    return selected.map(({ task, schedule }): TodayMiniTask => {
      const counts = checklistCounts(task);
      const theme = presentTodayMiniTheme(themes, canonicalThemeId(task.project_id, { legacyNullMeansPersonal: true }));
      return {
        id: String(task.id),
        title: String(task.title || "無題のタスク"),
        themeName: theme.name,
        themeColor: theme.color,
        scheduleLabel: String(schedule?.end_date || schedule?.start_date || today),
        hasReminder: typeof task.reminder_at === "string" && task.reminder_at.trim().length > 0,
        priority: task.priority === "high" ? "high" : "normal",
        checklistDone: counts.done,
        checklistTotal: counts.total,
      };
    });
  }

  function addTask(title: string, themeId: string | undefined, senderId = 0): TodayMiniTask[] {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("タスク名を入力してください。");
    const today = localDateString();
    const taskId = randomUUID();
    const themeRef = resolveTodayMiniThemeRef(listThemeOptions(), themeId);
    const receipt = options.executeCommand({
      commandId: randomUUID(),
      name: "CreateTask",
      payload: {
        task: {
          id: taskId,
          title: trimmed,
          state: "todo",
          priority: "normal",
          today_date: today,
          project_id: themeRef.id,
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
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.workspaceOpenTaskDetail, taskId);
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
    ipcMain.handle(IPC.todayMiniToggleWindow, () => toggle());
    ipcMain.handle(IPC.todayMiniPinTopRight, () => pinTopRight());
    ipcMain.handle(IPC.todayMiniHide, () => hide());
    ipcMain.handle(IPC.todayMiniList, () => listTasks());
    ipcMain.handle(IPC.todayMiniRefresh, () => listTasks());
    ipcMain.handle(IPC.todayMiniThemes, () => listThemeOptions());
    ipcMain.handle(IPC.todayMiniAddTask, (event, request: unknown) => {
      if (!request || typeof request !== "object" || typeof (request as TodayMiniAddTaskRequest).title !== "string") {
        throw new Error("タスク名を入力してください。");
      }
      const payload = request as TodayMiniAddTaskRequest;
      return addTask(payload.title, typeof payload.themeId === "string" ? payload.themeId : undefined, event.sender.id);
    });
    ipcMain.handle(IPC.todayMiniToggle, (event, taskId: unknown) => {
      if (typeof taskId !== "string" || !taskId.trim()) throw new Error("対象タスクがありません。");
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
    getWindow: () => options.satelliteWindows.get(windowKey),
    show,
    hide,
    toggle,
    openTask,
    registerIpc,
  };
}
