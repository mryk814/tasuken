import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { registerIpc } from "./ipc/registerIpc";
import { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { WorkspaceService } from "./services/workspaceService";

const isSmokeTest = process.argv.includes("--smoke-test");
const userDataArgument = process.argv.find((argument) => argument.startsWith("--user-data-dir="));
const requestedUserDataPath = userDataArgument?.slice("--user-data-dir=".length);
const smokeResultPath = path.join(os.tmpdir(), "research-desk-smoke-result.json");
const APP_NAME = "Tasken";
let workspaceRepository: InstanceType<typeof WorkspaceDatabase>;
let tray: Tray | null = null;
let captureWindow: BrowserWindow | null = null;

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

function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 180,
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

function showCaptureWindow(): void {
  if (!captureWindow || captureWindow.isDestroyed()) {
    captureWindow = createCaptureWindow();
  }

  const themeMode = workspaceRepository?.getPreference("themeMode") ?? "light";
  captureWindow.webContents.send("quick-capture:theme", themeMode);

  captureWindow.center();
  captureWindow.show();
  captureWindow.focus();
  captureWindow.webContents.send("quick-capture:shown");
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
    { label: "クイック記録", accelerator: "CmdOrCtrl+Shift+N", click: showCaptureWindow },
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
  tray.on("click", showCaptureWindow);
}

function notifyMainWindowRefresh(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== captureWindow && !win.isDestroyed()) {
      win.webContents.send("workspace:changed");
    }
  }
}

function registerCaptureIpc(): void {
  ipcMain.handle("quick-capture:save", (_event, text: string) => {
    const trimmed = (text || "").trim();
    if (!trimmed) throw new Error("入力が空です。");
    const saved = workspaceRepository.save("item", {
      title: trimmed,
      kind: "idea",
      level: "task",
      status: "inbox",
      priority: "normal",
    }, { source: "quick-capture" });
    notifyMainWindowRefresh();
    return saved;
  });

  ipcMain.on("quick-capture:hide", () => {
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
  });
}

interface SmokeCreatedResult {
  title: string;
  rootReady: boolean;
  saved: boolean;
  themeMode: string;
  clipboardWritten: boolean;
}

interface SmokeReloadResult {
  persisted: boolean;
  themeMode: string;
}

function recordSmoke(stage: string, details: Record<string, unknown> = {}): void {
  if (!isSmokeTest) return;
  fs.writeFileSync(smokeResultPath, JSON.stringify({ stage, argv: process.argv, ...details }, null, 2));
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("in-process-gpu");

if (requestedUserDataPath) {
  app.setPath("userData", path.resolve(requestedUserDataPath));
} else if (isSmokeTest) {
  app.setPath("userData", path.join(app.getPath("temp"), "research-desk-smoke-test"));
  recordSmoke("main-started");
  setTimeout(() => {
    recordSmoke("timeout");
    app.exit(1);
  }, 15000);
}

async function runSmokeTest(window: BrowserWindow): Promise<void> {
  recordSmoke("renderer-loaded");
  const testTitle = `デスクトップ動作確認 ${Date.now()}`;
  const created = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForButton = async (label) => {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const target = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
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
      await window.api.preferences.set("themeMode", "dark");
      const themeMode = await window.api.preferences.get("themeMode");
      const clipboardWritten = await window.api.clipboard.writeText("Tasken smoke test");

      return {
        title: document.title,
        rootReady: Boolean(document.querySelector("#root > *")),
        saved: [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(testTitle)})),
        themeMode,
        clipboardWritten,
      };
    })()
  `) as SmokeCreatedResult;

  window.webContents.once("did-finish-load", async () => {
    try {
      const afterReload = await window.webContents.executeJavaScript(`
        Promise.all([
          window.api.entities.list("note"),
          window.api.preferences.get("themeMode"),
        ]).then(([notes, themeMode]) => ({
          persisted: notes.some((note) => note.title === ${JSON.stringify(testTitle)}),
          themeMode,
        }))
      `) as SmokeReloadResult;
      const result = {
        ...created,
        persistedAfterReload: afterReload.persisted,
        themeModeAfterReload: afterReload.themeMode,
      };
      console.log(JSON.stringify(result));
      recordSmoke("passed", result);
      app.exit(
        result.persistedAfterReload
        && result.saved
        && result.rootReady
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

function createWindow(): void {
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
}

void app.whenReady().then(() => {
  migrateLegacyUserDataIfNeeded();
  workspaceRepository = new WorkspaceDatabase(path.join(app.getPath("userData"), "research-desk.sqlite"));
  registerIpc(workspaceRepository, new WorkspaceService(workspaceRepository));
  registerCaptureIpc();
  recordSmoke("app-ready");
  createWindow();

  if (!isSmokeTest) {
    setupTray();
    globalShortcut.register("CmdOrCtrl+Shift+N", showCaptureWindow);
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
  globalShortcut.unregisterAll();
});
