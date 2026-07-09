import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, protocol, screen, shell, Tray } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { registerIpc } from "./ipc/registerIpc";
import { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { WorkspaceService } from "./services/workspaceService";
import type { TodayMiniTask } from "../shared/ipc/contracts";
import type { Entity, EntityType } from "../shared/types/workspace";

const isSmokeTest = process.argv.includes("--smoke-test");
const userDataArgument = process.argv.find((argument) => argument.startsWith("--user-data-dir="));
const requestedUserDataPath = userDataArgument?.slice("--user-data-dir=".length);
const smokeResultPath = path.join(os.tmpdir(), "research-desk-smoke-result.json");
const APP_NAME = "Tasken";
const ATTACHMENT_PROTOCOL = "tasken-attachment";
let workspaceRepository: InstanceType<typeof WorkspaceDatabase>;
let tray: Tray | null = null;
let captureWindow: BrowserWindow | null = null;
let todayMiniWindow: BrowserWindow | null = null;
let todayMiniFadeTimer: ReturnType<typeof setTimeout> | null = null;
let reminderCheckTimer: ReturnType<typeof setInterval> | null = null;
const notifiedReminderIds = new Set<string>();
const TODAY_MINI_INACTIVE_OPACITY = 0.5;
const TODAY_MINI_FADE_DELAY_MS = 30000;
const TODAY_MINI_SCREEN_MARGIN = 16;
const TODAY_MINI_PINNED_WIDTH = 360;
const TODAY_MINI_PINNED_HEIGHT = 560;
const REMINDER_CHECK_INTERVAL_MS = 60000;
const TODAY_MINI_THEME_COLOR_KEYS = [
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
type QuickCaptureMode = "inbox" | "today-task" | "micro-memo" | "done-task";

protocol.registerSchemesAsPrivileged([
  {
    scheme: ATTACHMENT_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function openAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) return false;
    void shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

function getAppIconPath(): string {
  return path.join(__dirname, "../../resources/icon.ico");
}

function markdownAttachmentDirectory(): string {
  return path.join(app.getPath("userData"), "attachments", "markdown-images");
}

function attachmentMimeType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  return "image/png";
}

function registerAttachmentProtocol(): void {
  protocol.handle(ATTACHMENT_PROTOCOL, (request) => {
    try {
      const parsed = new URL(request.url);
      if (parsed.hostname !== "local") return new Response("Not found", { status: 404 });
      const fileName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean)[0] || "");
      if (!/^[a-f0-9-]+\.(png|jpg|gif|webp|bmp)$/i.test(fileName)) {
        return new Response("Not found", { status: 404 });
      }
      const root = path.resolve(markdownAttachmentDirectory());
      const filePath = path.resolve(root, fileName);
      if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) {
        return new Response("Not found", { status: 404 });
      }
      const bytes = fs.readFileSync(filePath);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "content-type": attachmentMimeType(fileName),
          "cache-control": "no-store",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function migrateLegacyUserDataIfNeeded(): void {
  const currentDbPath = path.join(app.getPath("userData"), "research-desk.sqlite");
  if (fs.existsSync(currentDbPath)) return;

  const legacyDbPath = path.join(app.getPath("appData"), "Research Desk", "research-desk.sqlite");
  if (!fs.existsSync(legacyDbPath)) return;

  fs.mkdirSync(path.dirname(currentDbPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const legacyPath = `${legacyDbPath}${suffix}`;
    if (fs.existsSync(legacyPath)) {
      fs.copyFileSync(legacyPath, `${currentDbPath}${suffix}`);
    }
  }
}

function getCapturePreloadPath(): string {
  return path.join(__dirname, "../preload/capture.mjs");
}

function getTodayMiniPreloadPath(): string {
  return path.join(__dirname, "../preload/todayMini.mjs");
}

function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 228,
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
      // Revisit when preload output/runtime is adjusted and window.captureApi can be verified.
      sandbox: false,
      preload: getCapturePreloadPath(),
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

function sendCaptureWindowState(win: BrowserWindow, mode: QuickCaptureMode): void {
  const themeMode = workspaceRepository?.getPreference("themeMode") ?? "light";
  const themes = [
    ...(workspaceRepository?.list("theme") ?? []).map((theme: Entity) => ({ id: theme.id, name: String(theme.name || theme.title || "Theme") })),
    ...(workspaceRepository?.list("project") ?? []).map((project: Entity) => ({ id: project.id, name: String(project.name || project.title || "Theme") })),
  ];
  const uniqueThemes = [...new Map(themes.map((theme) => [theme.id, theme])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "ja-JP"));
  win.webContents.send("quick-capture:theme", themeMode);
  win.webContents.send("quick-capture:themes", uniqueThemes);
  win.webContents.send("quick-capture:shown", mode);
}

function showCaptureWindow(mode: QuickCaptureMode = "inbox"): void {
  if (!captureWindow || captureWindow.isDestroyed()) {
    captureWindow = createCaptureWindow();
  }

  captureWindow.center();
  captureWindow.show();
  captureWindow.focus();

  const win = captureWindow;
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed()) sendCaptureWindowState(win, mode);
    });
  } else {
    sendCaptureWindowState(win, mode);
  }
}

function clearTodayMiniFadeTimer(): void {
  if (todayMiniFadeTimer) {
    clearTimeout(todayMiniFadeTimer);
    todayMiniFadeTimer = null;
  }
}

function restoreTodayMiniOpacity(win: BrowserWindow | null = todayMiniWindow): void {
  clearTodayMiniFadeTimer();
  if (win && !win.isDestroyed()) win.setOpacity(1);
}

function scheduleTodayMiniFade(win: BrowserWindow): void {
  clearTodayMiniFadeTimer();
  todayMiniFadeTimer = setTimeout(() => {
    if (!win.isDestroyed() && win.isVisible() && !win.isFocused()) {
      win.setOpacity(TODAY_MINI_INACTIVE_OPACITY);
    }
  }, TODAY_MINI_FADE_DELAY_MS);
}

function pinTodayMiniTopRight(): boolean {
  if (!todayMiniWindow || todayMiniWindow.isDestroyed()) {
    todayMiniWindow = createTodayMiniWindow();
  }
  const bounds = todayMiniWindow.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  const width = Math.min(TODAY_MINI_PINNED_WIDTH, Math.max(320, workArea.width - TODAY_MINI_SCREEN_MARGIN * 2));
  const height = Math.min(TODAY_MINI_PINNED_HEIGHT, Math.max(360, workArea.height - TODAY_MINI_SCREEN_MARGIN * 2));
  const x = workArea.x + workArea.width - width - TODAY_MINI_SCREEN_MARGIN;
  const y = workArea.y + TODAY_MINI_SCREEN_MARGIN;
  todayMiniWindow.setBounds({ x: Math.max(workArea.x, x), y: Math.max(workArea.y, y), width, height }, false);
  restoreTodayMiniOpacity(todayMiniWindow);
  return true;
}

function createTodayMiniWindow(): BrowserWindow {
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
    icon: getAppIconPath(),
    backgroundColor: "#F4EEEC",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: getTodayMiniPreloadPath(),
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/today-mini.html`);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/today-mini.html"));
  }

  win.on("closed", () => {
    clearTodayMiniFadeTimer();
    if (todayMiniWindow === win) todayMiniWindow = null;
  });
  win.on("focus", () => restoreTodayMiniOpacity(win));
  win.on("blur", () => scheduleTodayMiniFade(win));

  return win;
}

function showTodayMiniWindow(): void {
  if (!todayMiniWindow || todayMiniWindow.isDestroyed()) {
    todayMiniWindow = createTodayMiniWindow();
  }
  restoreTodayMiniOpacity(todayMiniWindow);
  todayMiniWindow.show();
  todayMiniWindow.focus();
  todayMiniWindow.setAlwaysOnTop(true);
  if (!todayMiniWindow.webContents.isLoading()) {
    todayMiniWindow.webContents.send("today-mini:refresh");
  }
}

function hideTodayMiniWindow(): boolean {
  if (!todayMiniWindow || todayMiniWindow.isDestroyed()) return false;
  todayMiniWindow.hide();
  restoreTodayMiniOpacity(todayMiniWindow);
  return true;
}

function createTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(getAppIconPath());
  if (!icon.isEmpty()) return icon.resize({ width: 16, height: 16 });

  // 16x16 RGBA: burgundy "RD" マーク
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const accent = [138, 47, 59, 255]; // #8A2F3B
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inOuter = x >= 1 && x < 15 && y >= 1 && y < 15;
      const inInner = x >= 3 && x < 13 && y >= 3 && y < 13;
      if (inOuter && !inInner) {
        buf[i] = accent[0]; buf[i + 1] = accent[1]; buf[i + 2] = accent[2]; buf[i + 3] = accent[3];
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function setupTray(): void {
  tray = new Tray(createTrayIcon());

  const contextMenu = Menu.buildFromTemplate([
    { label: "今日やることを表示", click: () => showTodayMiniWindow() },
    { type: "separator" },
    ...quickCaptureMenuItems(),
    { type: "separator" },
    { label: `${APP_NAME} を開く`, click: () => {
      const windows = BrowserWindow.getAllWindows().filter((w) => w !== captureWindow);
      if (windows.length) { windows[0].show(); windows[0].focus(); } else { createWindow(); }
    }},
    { type: "separator" },
    { label: "終了", click: () => app.quit() },
  ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => showCaptureWindow("inbox"));
}

function quickCaptureMenuItems(): Electron.MenuItemConstructorOptions[] {
  return [
    { label: "Inboxへクイック記録", accelerator: "CmdOrCtrl+Shift+N", click: () => showCaptureWindow("inbox") },
    { label: "今日のタスクを追加", accelerator: "CmdOrCtrl+Shift+M", click: () => showCaptureWindow("today-task") },
    { label: "やったことを記録", accelerator: "CmdOrCtrl+Shift+,", click: () => showCaptureWindow("done-task") },
    { label: "付箋メモを追加", accelerator: "CmdOrCtrl+Shift+.", click: () => showCaptureWindow("micro-memo") },
  ];
}

function showMainContextMenu(window: BrowserWindow, params: Electron.ContextMenuParams): void {
  const template: Electron.MenuItemConstructorOptions[] = [...quickCaptureMenuItems()];
  if (params.isEditable) {
    template.push(
      { type: "separator" },
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    );
  } else if (params.selectionText) {
    template.push(
      { type: "separator" },
      { role: "copy" },
    );
  }
  Menu.buildFromTemplate(template).popup({ window });
}

function notifyMainWindowRefresh(change?: { type: EntityType; entity: Entity } | { entities: Array<{ type: EntityType; entity: Entity }> }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== captureWindow && win !== todayMiniWindow && !win.isDestroyed()) {
      win.webContents.send("workspace:changed", change);
    }
  }
  if (todayMiniWindow && !todayMiniWindow.isDestroyed()) {
    todayMiniWindow.webContents.send("today-mini:refresh");
  }
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateTimeString(date = new Date()): string {
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${localDateString(date)}T${time}.${ms}`;
}

function localDateTimeMinute(date = new Date()): string {
  return localDateTimeString(date).slice(0, 16);
}

function normalizeReminderDateTime(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return "";
  const [hour, minute] = match[2].split(":");
  const normalizedHour = String(Number(hour)).padStart(2, "0");
  const normalizedMinute = String(Number(minute)).padStart(2, "0");
  if (!/^(?:[01]\d|2[0-3])$/.test(normalizedHour)) return "";
  if (!/^[0-5]\d$/.test(normalizedMinute)) return "";
  return `${match[1]}T${normalizedHour}:${normalizedMinute}`;
}

function reminderIsDueToday(value: unknown, nowMinute = localDateTimeMinute(), today = localDateString()): string {
  const at = normalizeReminderDateTime(value);
  if (!at || at.slice(0, 10) !== today || at > nowMinute) return "";
  return at;
}

function showReminderNotification(alert: { id: string; title: string; body: string; onClick?: () => void }): void {
  if (!Notification.isSupported()) return;
  if (notifiedReminderIds.has(alert.id)) return;
  notifiedReminderIds.add(alert.id);
  const notification = new Notification({
    title: alert.title,
    body: alert.body,
    icon: getAppIconPath(),
  });
  if (alert.onClick) notification.on("click", alert.onClick);
  notification.show();
}

function checkReminderNotifications(): void {
  if (!workspaceRepository) return;
  for (const task of workspaceRepository.list("task") as Entity[]) {
    const at = reminderIsDueToday(task.reminder_at);
    if (!at || task.state === "done" || task.state === "cancelled") continue;
    const taskId = String(task.id);
    showReminderNotification({
      id: `task:${taskId}:${at}`,
      title: "Tasken リマインダー",
      body: String(task.title || "無題のタスク"),
      onClick: () => openTaskInMainWindow(taskId),
    });
  }
  for (const waiting of workspaceRepository.list("waiting") as Entity[]) {
    const at = reminderIsDueToday(waiting.check_reminder_at);
    if (!at || waiting.state === "received" || waiting.state === "cancelled") continue;
    showReminderNotification({
      id: `waiting:${String(waiting.id)}:${at}`,
      title: "Tasken 確認リマインダー",
      body: String(waiting.title || "無題の待ち"),
      onClick: () => showMainWindow(),
    });
  }
}

function startReminderNotifications(): void {
  if (reminderCheckTimer) return;
  checkReminderNotifications();
  reminderCheckTimer = setInterval(checkReminderNotifications, REMINDER_CHECK_INTERVAL_MS);
}

function stopReminderNotifications(): void {
  if (!reminderCheckTimer) return;
  clearInterval(reminderCheckTimer);
  reminderCheckTimer = null;
}

function registerCaptureIpc(): void {
  ipcMain.handle("quick-capture:save", (_event, text: string, mode: QuickCaptureMode = "inbox", themeId?: string) => {
    const trimmed = (text || "").trim();
    if (!trimmed) throw new Error("入力が空です。");
    if (mode === "today-task" || mode === "done-task") {
      const taskId = randomUUID();
      const today = localDateString();
      const now = new Date().toISOString();
      const isDoneTask = mode === "done-task";
      const saved = workspaceRepository.saveMany([
        {
          action: "save",
          type: "task",
          entity: {
            id: taskId,
            title: trimmed,
            description: null,
            project_id: themeId || null,
            state: isDoneTask ? "done" : "todo",
            priority: "normal",
            completed_at: isDoneTask ? now : null,
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
            start_date: today,
            end_date: today,
            date_kind: "point",
            confidence: "fixed",
            granularity: "day",
          },
          options: { source: "quick-capture" },
        },
      ]);
      notifyMainWindowRefresh({
        entities: [
          { type: "task", entity: saved[0] as Entity },
          { type: "schedule", entity: saved[1] as Entity },
        ],
      });
      return saved[0];
    }
    const saved = workspaceRepository.save("capture_entry", {
      text: trimmed,
      title: mode === "micro-memo" ? null : trimmed,
      kind: mode === "micro-memo" ? "micro_memo" : "inbox",
      captured_at: localDateTimeString(),
      state: "untriaged",
    }, { source: "quick-capture" });
    notifyMainWindowRefresh({ entities: [{ type: "capture_entry", entity: saved as Entity }] });
    return saved;
  });

  ipcMain.on("quick-capture:hide", () => {
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
  });
}

function checklistCounts(task: Entity): { done: number; total: number } {
  const items = Array.isArray(task.checklist_items) ? task.checklist_items : [];
  const valid = items.filter((item) => item && typeof item === "object" && "title" in item);
  return {
    done: valid.filter((item) => Boolean((item as Record<string, unknown>).done)).length,
    total: valid.length,
  };
}

function todayMiniThemeColor(theme: Entity | undefined, index: number): string {
  const rawColor = typeof theme?.color === "string" ? theme.color.trim() : "";
  const colorKey = TODAY_MINI_THEME_COLOR_KEYS.includes(rawColor as typeof TODAY_MINI_THEME_COLOR_KEYS[number])
    ? rawColor
    : TODAY_MINI_THEME_COLOR_KEYS[((index % TODAY_MINI_THEME_COLOR_KEYS.length) + TODAY_MINI_THEME_COLOR_KEYS.length) % TODAY_MINI_THEME_COLOR_KEYS.length];
  return `var(--color-${colorKey})`;
}

function todayMiniThemeMap(): Map<string, { name: string; color: string }> {
  const entries = [
    ...(workspaceRepository.list("theme") as Entity[]),
    ...(workspaceRepository.list("project") as Entity[]),
  ];
  return new Map(entries.map((entry, index) => [
    String(entry.id),
    {
      name: String(entry.name || entry.title || "個人業務"),
      color: todayMiniThemeColor(entry, index),
    },
  ] as const));
}

function listTodayMiniTasks(): TodayMiniTask[] {
  const today = localDateString();
  const tasks = (workspaceRepository.list("task") as Entity[])
    .filter((task) => task.state !== "done" && task.state !== "cancelled");
  const schedules = (workspaceRepository.list("schedule") as Entity[])
    .filter((schedule) => schedule.owner_type === "task" && (schedule.start_date === today || schedule.end_date === today));
  const scheduleByTask = new Map(schedules.map((schedule) => [String(schedule.owner_id), schedule]));
  const themes = todayMiniThemeMap();

  return tasks
    .filter((task) => scheduleByTask.has(String(task.id)))
    .map((task): TodayMiniTask => {
      const schedule = scheduleByTask.get(String(task.id));
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
    })
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || a.title.localeCompare(b.title, "ja-JP"));
}

function addTodayMiniTask(title: string): TodayMiniTask[] {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("タスク名を入力してください。");
  const today = localDateString();
  const taskId = randomUUID();
  const saved = workspaceRepository.saveMany([
    {
      action: "save",
      type: "task",
      entity: {
        id: taskId,
        title: trimmed,
        state: "todo",
        priority: "normal",
        project_id: null,
        source: "today-mini",
      },
      options: { source: "today-mini" },
    },
    {
      action: "save",
      type: "schedule",
      entity: {
        id: randomUUID(),
        owner_type: "task",
        owner_id: taskId,
        start_date: today,
        end_date: today,
        date_kind: "point",
        confidence: "fixed",
        granularity: "day",
      },
      options: { source: "today-mini" },
    },
  ]) as Entity[];
  notifyMainWindowRefresh({
    entities: [
      { type: "task", entity: saved[0] },
      { type: "schedule", entity: saved[1] },
    ],
  });
  return listTodayMiniTasks();
}

function findMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()
    .find((win) => win !== captureWindow && win !== todayMiniWindow && !win.isDestroyed()) || null;
}

function showMainWindow(): BrowserWindow {
  const win = findMainWindow() || createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

function openTaskInMainWindow(taskId: string): boolean {
  const task = workspaceRepository.get("task", taskId);
  if (!task) return false;
  const win = showMainWindow();
  const send = () => {
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send("workspace:open-task-detail", taskId);
    }, 150);
  };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
  return true;
}

function registerTodayMiniIpc(): void {
  ipcMain.handle("today-mini:show", () => {
    showTodayMiniWindow();
    return true;
  });
  ipcMain.handle("today-mini:pin-top-right", () => pinTodayMiniTopRight());
  ipcMain.handle("today-mini:hide", () => hideTodayMiniWindow());
  ipcMain.handle("today-mini:list", () => listTodayMiniTasks());
  ipcMain.handle("today-mini:refresh", () => listTodayMiniTasks());
  ipcMain.handle("today-mini:add-task", (_event, title: unknown) => {
    if (typeof title !== "string") throw new Error("タスク名を入力してください。");
    return addTodayMiniTask(title);
  });
  ipcMain.handle("today-mini:toggle", (_event, taskId: unknown) => {
    if (typeof taskId !== "string" || !taskId.trim()) {
      throw new Error("対象タスクがありません。");
    }
    const task = workspaceRepository.get("task", taskId) as Entity | null;
    if (!task) throw new Error("タスクが見つかりません。");
    const nextState = task.state === "done" ? "todo" : "done";
    const saved = workspaceRepository.save("task", {
      ...task,
      state: nextState,
      completed_at: nextState === "done" ? new Date().toISOString() : null,
    }, { source: "today-mini" }) as Entity;
    notifyMainWindowRefresh({ type: "task", entity: saved });
    return listTodayMiniTasks();
  });
  ipcMain.handle("today-mini:open-task", (_event, taskId: unknown) => {
    if (typeof taskId !== "string" || !taskId.trim()) return false;
    return openTaskInMainWindow(taskId);
  });
}

interface SmokeCreatedResult {
  title: string;
  rootReady: boolean;
  smokeTaskId: string;
  smokeTaskTitle: string;
  todayMiniWindowOpened: boolean;
  saved: boolean;
  markdownSaved: boolean;
  markdownPreviewRendered: boolean;
  markdownFrontmatterRendered: boolean;
  markdownMathRendered: boolean;
  markdownImageRendered: boolean;
  notesPanePreviewRendered: boolean;
  notesPaneMathRendered: boolean;
  notesLiveEditSaved: boolean;
  notesMarkdownPasteRendered: boolean;
  rawCopyNotified: boolean;
  themeMode: string;
  clipboardWritten: boolean;
}

interface SmokeReloadResult {
  persisted: boolean;
  markdownPersisted: boolean;
  markdownThemeLinked: boolean;
  markdownFrontmatterPersisted: boolean;
  markdownLiveEditPersisted: boolean;
  markdownPastePersisted: boolean;
  themeMode: string;
}

interface SmokeMiniResult {
  todayMiniOpened: boolean;
  todayMiniAlwaysOnTop: boolean;
  todayMiniTaskVisible: boolean;
  todayMiniCompletionSaved: boolean;
  todayMiniOpenDetail: boolean;
}

function recordSmoke(stage: string, details: Record<string, unknown> = {}): void {
  if (!isSmokeTest) return;
  fs.writeFileSync(smokeResultPath, JSON.stringify({ stage, argv: process.argv, ...details }, null, 2));
}

app.disableHardwareAcceleration();
if (process.platform === "win32") app.setAppUserModelId("jp.personal.tasken");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("in-process-gpu");

if (requestedUserDataPath) {
  app.setPath("userData", path.resolve(requestedUserDataPath));
} else if (isSmokeTest) {
  const smokeUserDataPath = path.join(app.getPath("temp"), "research-desk-smoke-test");
  fs.rmSync(smokeUserDataPath, { recursive: true, force: true });
  app.setPath("userData", smokeUserDataPath);
  recordSmoke("main-started");
  setTimeout(() => {
    recordSmoke("timeout");
    app.exit(1);
  }, 25000);
}

async function runSmokeTest(window: BrowserWindow): Promise<void> {
  recordSmoke("renderer-loaded");
  const testTitle = `デスクトップ動作確認 ${Date.now()}`;
  const markdownTitle = `Markdown動作確認 ${Date.now()}`;
  const smokeTaskTitle = `Todayミニ動作確認 ${Date.now()}`;
  const smokeTaskId = randomUUID();
  const smokeThemeId = `smoke-theme-${Date.now()}`;
  const markdownBody = `---
theme: smoke
type: report
---
# Markdown Preview
- 箇条書き
本文中の式 $a^2 + b^2 = c^2$ を確認します。

$$
E = mc^2
$$

![Smoke Image](__SMOKE_IMAGE_URL__)

\`\`\`
code block
\`\`\``;
  const created = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const setInputValue = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const waitForButton = async (label) => {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const target = [...document.querySelectorAll("button")].find((button) => {
            const firstLabel = button.querySelector("span")?.textContent?.trim();
            return firstLabel === label || button.textContent.trim() === label;
          });
          if (target) return target;
          await delay(100);
        }
        throw new Error(label + " ボタンが見つかりません。画面: " + document.body.innerText.slice(0, 1000));
      };

      (await waitForButton("Notes")).click();
      await delay(60);
      (await waitForButton("メモを書く")).click();
      await delay(60);

      const title = document.querySelector('input[name="title"]');
      const body = document.querySelector('textarea[name="body_markdown"]');
      const form = document.querySelector(".drawer-form");
      if (!title || !body || !form) throw new Error("メモ入力フォームが見つかりません");

      title.value = ${JSON.stringify(testTitle)};
      body.value = "Electron内で入力と保存を確認しました。";
      form.requestSubmit();
      await delay(120);

      await window.api.entities.save("theme", { id: ${JSON.stringify(smokeThemeId)}, name: "Smoke Theme", code: "SMOKE", status: "active" });
      const smokeImage = await window.api.attachments.saveMarkdownImage({
        fileName: "smoke.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
      });
      (await waitForButton("Markdown文書")).click();
      await delay(80);
      const markdownForm = document.querySelector(".drawer-form");
      const markdownTitle = markdownForm?.querySelector('input[name="title"]');
      const markdownBody = markdownForm?.querySelector('textarea[name="body_markdown"]');
      const markdownTheme = markdownForm?.querySelector('input[name="theme_id"]');
      if (!markdownForm || !markdownTitle || !markdownBody || !markdownTheme) throw new Error("Markdown入力フォームが見つかりません");
      const clickMarkdownFormButton = (label) => {
        const button = [...markdownForm.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
        if (!button) throw new Error(label + " ボタンがMarkdown入力フォーム内に見つかりません。");
        button.click();
      };
      setInputValue(markdownTitle, ${JSON.stringify(markdownTitle)});
      markdownTheme.value = ${JSON.stringify(smokeThemeId)};
      markdownTheme.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(markdownBody, ${JSON.stringify(markdownBody)}.replace("__SMOKE_IMAGE_URL__", smokeImage.url));
      clickMarkdownFormButton("Preview");
      await delay(80);
      const preview = markdownForm.querySelector(".markdown-preview");
      const markdownPreviewRendered = Boolean(
        preview?.querySelector("h1")?.textContent?.includes("Markdown Preview")
        && preview?.querySelector("li")?.textContent?.includes("箇条書き")
        && [...(preview?.querySelectorAll("code") || [])].some((code) => code.textContent?.includes("code block"))
      );
      const markdownFrontmatterRendered = Boolean(preview?.querySelector(".md-frontmatter")?.textContent?.includes("type: report"));
      const markdownMathRendered = Boolean(preview?.querySelector(".md-math-inline")?.textContent?.includes("a^2") && preview?.querySelector(".md-math-block")?.textContent?.includes("E = mc^2"));
      const smokePreviewImage = preview?.querySelector('.md-image img[alt="Smoke Image"]');
      if (smokePreviewImage && !smokePreviewImage.complete) {
        await new Promise((resolve) => {
          smokePreviewImage.addEventListener("load", resolve, { once: true });
          smokePreviewImage.addEventListener("error", resolve, { once: true });
          setTimeout(resolve, 700);
        });
      }
      const markdownImageRendered = Boolean(smokePreviewImage?.getAttribute("src")?.startsWith("tasken-attachment://") && smokePreviewImage?.naturalWidth > 0);
      clickMarkdownFormButton("本文をコピー");
      await delay(140);
      const rawCopyNotified = document.body.innerText.includes("本文をコピーしました。");
      markdownForm.requestSubmit();
      await delay(160);
      const notesPane = document.querySelector(".note-preview-panel");
      const notesPanePreviewRendered = Boolean(
        notesPane?.querySelector("h2")?.textContent?.includes(${JSON.stringify(markdownTitle)})
        && notesPane?.querySelector(".note-live-editor h1")?.textContent?.includes("Markdown Preview")
        && notesPane?.querySelector(".document-publish-panel")
      );
      const notesPaneMathRendered = Boolean(
        notesPane?.querySelector(".note-editor-math-inline")
        && notesPane?.querySelector(".note-editor-math-block")
      );
      const liveEditable = notesPane?.querySelector(".note-mdx-content[contenteditable='true']");
      if (!liveEditable) throw new Error("Live Preview編集面が見つかりません");
      liveEditable.focus();
      let liveTextNode = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const walker = document.createTreeWalker(liveEditable, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node.nodeValue?.includes("本文中")) {
            liveTextNode = node;
            break;
          }
          node = walker.nextNode();
        }
        if (liveTextNode) break;
        await delay(100);
      }
      if (!liveTextNode) throw new Error("Live Preview編集対象の本文が見つかりません。表示: " + liveEditable.textContent?.slice(0, 500));
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(liveTextNode, liveTextNode.nodeValue?.length || 0);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand("insertText", false, " Live edit smoke");
      await delay(80);
      const pasteData = new DataTransfer();
      pasteData.setData("text/plain", "\\n\\n## Pasted Markdown Heading\\n\\n**Pasted Bold Text**\\n");
      const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, "clipboardData", { value: pasteData });
      liveEditable.dispatchEvent(pasteEvent);
      await delay(160);
      const notesLiveEditRendered = Boolean(notesPane?.querySelector(".note-live-editor")?.textContent?.includes("Live edit smoke"));
      const notesMarkdownPasteRendered = Boolean(
        notesPane?.querySelector(".note-live-editor h2")?.textContent?.includes("Pasted Markdown Heading")
        && notesPane?.querySelector(".note-live-editor strong")?.textContent?.includes("Pasted Bold Text")
      );
      const saveDraftButton = [...(notesPane?.querySelectorAll(".note-preview-actions button") || [])].find((button) => button.textContent.trim() === "保存");
      saveDraftButton?.click();
      await delay(180);
      const notesLiveEditSaved = notesLiveEditRendered && document.body.innerText.includes("保存しました。");
      await window.api.preferences.set("themeMode", "dark");
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      await window.api.entities.save("task", {
        id: ${JSON.stringify(smokeTaskId)},
        title: ${JSON.stringify(smokeTaskTitle)},
        project_id: ${JSON.stringify(smokeThemeId)},
        state: "todo",
        priority: "high",
        checklist_items: [{ id: "mini-1", title: "smoke", done: false, sort_order: 0 }],
        created_at: new Date().toISOString()
      }, { source: "smoke" });
      await window.api.entities.save("schedule", {
        id: crypto.randomUUID(),
        owner_type: "task",
        owner_id: ${JSON.stringify(smokeTaskId)},
        start_date: today,
        end_date: today,
        date_kind: "point",
        confidence: "fixed",
        granularity: "day"
      }, { source: "smoke" });
      const todayMiniWindowOpened = await window.api.app.showTodayMiniWindow();
      const themeMode = await window.api.preferences.get("themeMode");
      const clipboardWritten = await window.api.clipboard.writeText("Tasken smoke test");

      return {
        title: document.title,
        rootReady: Boolean(document.querySelector("#root > *")),
        smokeTaskId: ${JSON.stringify(smokeTaskId)},
        smokeTaskTitle: ${JSON.stringify(smokeTaskTitle)},
        todayMiniWindowOpened,
        saved: [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(testTitle)})),
        markdownSaved: [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(markdownTitle)})),
        markdownPreviewRendered,
        markdownFrontmatterRendered,
        markdownMathRendered,
        markdownImageRendered,
        notesPanePreviewRendered,
        notesPaneMathRendered,
        notesLiveEditSaved,
        notesMarkdownPasteRendered,
        rawCopyNotified,
        themeMode,
        clipboardWritten,
      };
    })()
  `) as SmokeCreatedResult;

  let mini: SmokeMiniResult = {
    todayMiniOpened: false,
    todayMiniAlwaysOnTop: false,
    todayMiniTaskVisible: false,
    todayMiniCompletionSaved: false,
    todayMiniOpenDetail: false,
  };
  const todayMini = todayMiniWindow && !todayMiniWindow.isDestroyed() ? todayMiniWindow : null;
  if (todayMini) {
    if (todayMini.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        todayMini.webContents.once("did-finish-load", () => resolve());
        setTimeout(resolve, 1200);
      });
    }
    mini.todayMiniOpened = created.todayMiniWindowOpened && todayMini.isVisible();
    mini.todayMiniAlwaysOnTop = todayMini.isAlwaysOnTop();
    const miniInteraction = await todayMini.webContents.executeJavaScript(`
      (async () => {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (document.body.innerText.includes(${JSON.stringify(smokeTaskTitle)})) break;
          await delay(100);
        }
        const todayMiniTaskVisible = document.body.innerText.includes(${JSON.stringify(smokeTaskTitle)});
        await window.todayMiniApi.toggle(${JSON.stringify(smokeTaskId)});
        await delay(140);
        const afterToggle = await window.todayMiniApi.list();
        const todayMiniCompletionSaved = !afterToggle.some((task) => task.id === ${JSON.stringify(smokeTaskId)});
        const todayMiniOpenDetail = await window.todayMiniApi.openTask(${JSON.stringify(smokeTaskId)});
        return { todayMiniTaskVisible, todayMiniCompletionSaved, todayMiniOpenDetail };
      })()
    `) as Pick<SmokeMiniResult, "todayMiniTaskVisible" | "todayMiniCompletionSaved" | "todayMiniOpenDetail">;
    mini = { ...mini, ...miniInteraction };
  }
  const detailOpened = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const drawer = document.querySelector(".drawer-form");
        const title = drawer?.querySelector('input[name="title"]');
        if (title?.value === ${JSON.stringify(smokeTaskTitle)}) return true;
        await delay(100);
      }
      return false;
    })()
  `) as boolean;
  mini.todayMiniOpenDetail = mini.todayMiniOpenDetail && detailOpened;

  window.webContents.once("did-finish-load", async () => {
    try {
      const afterReload = await window.webContents.executeJavaScript(`
        Promise.all([
          window.api.entities.list("note"),
          window.api.preferences.get("themeMode"),
        ]).then(([notes, themeMode]) => {
          const markdown = notes.find((note) => note.title === ${JSON.stringify(markdownTitle)});
          return ({
          persisted: notes.some((note) => note.title === ${JSON.stringify(testTitle)}),
          markdownPersisted: Boolean(markdown?.body_markdown?.includes("Markdown Preview")),
          markdownThemeLinked: markdown?.theme_id === ${JSON.stringify(smokeThemeId)},
          markdownFrontmatterPersisted: Boolean(markdown?.body_markdown?.includes("type: report")),
          markdownLiveEditPersisted: Boolean(markdown?.body_markdown?.includes("Live edit smoke")),
          markdownPastePersisted: Boolean(markdown?.body_markdown?.includes("## Pasted Markdown Heading") && markdown?.body_markdown?.includes("**Pasted Bold Text**")),
          themeMode,
        });
        })
      `) as SmokeReloadResult;
      const result = {
        ...created,
        persistedAfterReload: afterReload.persisted,
        markdownPersistedAfterReload: afterReload.markdownPersisted,
        markdownThemeLinkedAfterReload: afterReload.markdownThemeLinked,
        markdownFrontmatterPersistedAfterReload: afterReload.markdownFrontmatterPersisted,
        markdownLiveEditPersistedAfterReload: afterReload.markdownLiveEditPersisted,
        markdownPastePersistedAfterReload: afterReload.markdownPastePersisted,
        themeModeAfterReload: afterReload.themeMode,
        ...mini,
      };
      console.log(JSON.stringify(result));
      recordSmoke("passed", result);
      app.exit(
        result.persistedAfterReload
        && result.markdownPersistedAfterReload
        && result.markdownThemeLinkedAfterReload
        && result.markdownFrontmatterPersistedAfterReload
        && result.markdownLiveEditPersistedAfterReload
        && result.markdownPastePersistedAfterReload
        && result.saved
        && result.markdownSaved
        && result.markdownPreviewRendered
        && result.markdownFrontmatterRendered
        && result.markdownMathRendered
        && result.markdownImageRendered
        && result.notesPanePreviewRendered
        && result.notesPaneMathRendered
        && result.notesLiveEditSaved
        && result.notesMarkdownPasteRendered
        && result.rawCopyNotified
        && result.rootReady
        && result.todayMiniOpened
        && result.todayMiniAlwaysOnTop
        && result.todayMiniTaskVisible
        && result.todayMiniCompletionSaved
        && result.todayMiniOpenDetail
        && result.clipboardWritten
        && result.themeMode === "dark"
        && result.themeModeAfterReload === "dark"
          ? 0
          : 1,
      );
    } catch (error) {
      console.error(error);
      recordSmoke("reload-check-failed", { error: String(error) });
      app.exit(1);
    }
  });
  window.reload();
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 980,
    minHeight: 680,
    show: !isSmokeTest,
    backgroundColor: "#F4EEEC",
    title: APP_NAME,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // TODO: sandbox:true currently prevents window.api/window.researchDesk from being exposed.
      // Keep the verified contextIsolation/nodeIntegration boundary until the preload bridge is migrated.
      sandbox: false,
      preload: path.join(__dirname, "../preload/index.mjs"),
    },
  });

  if (!isSmokeTest) window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => {
    if (isSmokeTest) {
      runSmokeTest(window).catch((error: unknown) => {
        console.error(error);
        app.exit(1);
      });
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    recordSmoke("load-failed", { code, description });
    if (isSmokeTest) app.exit(1);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    recordSmoke("renderer-gone", { ...details });
    if (isSmokeTest) app.exit(1);
  });
  window.webContents.on("context-menu", (_event, params) => {
    showMainContextMenu(window, params);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!openAllowedExternalUrl(url)) {
      console.warn(`Blocked external URL: ${url}`);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      if (!openAllowedExternalUrl(url)) {
        console.warn(`Blocked navigation URL: ${url}`);
      }
    }
  });
  return window;
}

void app.whenReady().then(() => {
  migrateLegacyUserDataIfNeeded();
  registerAttachmentProtocol();
  workspaceRepository = new WorkspaceDatabase(path.join(app.getPath("userData"), "research-desk.sqlite"));
  registerIpc(workspaceRepository, new WorkspaceService(workspaceRepository, app.getPath("userData")));
  registerCaptureIpc();
  registerTodayMiniIpc();
  recordSmoke("app-ready");
  createWindow();

  if (!isSmokeTest) {
    setupTray();
    startReminderNotifications();
    globalShortcut.register("CmdOrCtrl+Shift+N", () => showCaptureWindow("inbox"));
    globalShortcut.register("CmdOrCtrl+Shift+M", () => showCaptureWindow("today-task"));
    globalShortcut.register("CmdOrCtrl+Shift+,", () => showCaptureWindow("done-task"));
    globalShortcut.register("CmdOrCtrl+Shift+.", () => showCaptureWindow("micro-memo"));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // トレイ常駐中はメインウィンドウを閉じてもアプリを終了しない
  if (process.platform === "darwin") return;
  if (tray && !tray.isDestroyed()) return;
  app.quit();
});

app.on("will-quit", () => {
  stopReminderNotifications();
  globalShortcut.unregisterAll();
});
