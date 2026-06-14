import { app, BrowserWindow, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { registerIpc } from "./ipc/registerIpc";
import { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { WorkspaceService } from "./services/workspaceService";

const isSmokeTest = process.argv.includes("--smoke-test");
const smokeResultPath = path.join(os.tmpdir(), "research-desk-smoke-result.json");
let workspaceRepository: InstanceType<typeof WorkspaceDatabase>;

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

if (isSmokeTest) {
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
      const clipboardWritten = await window.api.clipboard.writeText("Research Desk smoke test");

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
    title: "Research Desk",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
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
    if (/^(https?|file):/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

void app.whenReady().then(() => {
  workspaceRepository = new WorkspaceDatabase(path.join(app.getPath("userData"), "research-desk.sqlite"));
  registerIpc(workspaceRepository, new WorkspaceService(workspaceRepository));
  recordSmoke("app-ready");
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
