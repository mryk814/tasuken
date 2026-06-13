import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WorkspaceDatabase } from "./database.mjs";
import { createSnapshot, readSnapshot } from "./snapshots.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, "..");
const isSmokeTest = process.argv.includes("--smoke-test");
const smokeResultPath = path.join(os.tmpdir(), "research-desk-smoke-result.json");
const pendingSnapshots = new Map();
let workspaceDb;

function recordSmoke(stage, details = {}) {
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

async function runSmokeTest(window) {
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
        const state = document.body.innerText.slice(0, 1000);
        throw new Error(label + " ボタンが見つかりません。画面: " + state);
      };
      const clickButton = (label) => {
        const target = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
        if (!target) throw new Error(label + " ボタンが見つかりません");
        target.click();
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

      return {
        title: document.title,
        rootReady: Boolean(document.querySelector("#root > *")),
        saved: [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(testTitle)})),
      };
    })()
  `);

  window.webContents.once("did-finish-load", async () => {
    try {
      const persisted = await window.webContents.executeJavaScript(`
        window.researchDesk.entities.list("note")
          .then((notes) => notes.some((note) => note.title === ${JSON.stringify(testTitle)}))
      `);
      console.log(JSON.stringify({ ...created, persistedAfterReload: persisted }));
      recordSmoke("passed", { ...created, persistedAfterReload: persisted });
      app.exit(persisted && created.saved && created.rootReady ? 0 : 1);
    } catch (error) {
      console.error(error);
      recordSmoke("reload-check-failed", { error: String(error) });
      app.exit(1);
    }
  });
  window.reload();
}

function createWindow() {
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
      sandbox: !isSmokeTest,
      preload: path.join(currentDir, "preload.mjs"),
    },
  });

  if (!isSmokeTest) {
    window.once("ready-to-show", () => window.show());
  }
  window.webContents.once("did-finish-load", () => {
    if (isSmokeTest) {
      runSmokeTest(window).catch((error) => {
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
    recordSmoke("renderer-gone", details);
    if (isSmokeTest) app.exit(1);
  });
  window.loadFile(path.join(appRoot, "dist", "index.html"));

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("file://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  workspaceDb = new WorkspaceDatabase(path.join(app.getPath("userData"), "research-desk.sqlite"));
  registerIpc();
  recordSmoke("app-ready");
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function registerIpc() {
  ipcMain.handle("workspace:load", () => workspaceDb.loadWorkspace());
  ipcMain.handle("workspace:bootstrap", (_event, legacy) => workspaceDb.bootstrap(legacy));
  ipcMain.handle("workspace:meta", () => workspaceDb.getMeta());
  ipcMain.handle("entity:list", (_event, type, includeDeleted) => workspaceDb.list(type, includeDeleted));
  ipcMain.handle("entity:get", (_event, type, id) => workspaceDb.get(type, id));
  ipcMain.handle("entity:save", (_event, type, entity, options) => workspaceDb.save(type, entity, options));
  ipcMain.handle("entity:remove", (_event, type, id) => workspaceDb.remove(type, id));
  ipcMain.handle("entity:restore", (_event, type, id) => workspaceDb.restore(type, id));

  ipcMain.handle("snapshot:export", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: "Workspace Snapshotを書き出す",
      defaultPath: `workspace_export_${date}.zip`,
      filters: [{ name: "Research Desk Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    createSnapshot(workspaceDb.loadWorkspace()).writeZip(result.filePath);
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle("snapshot:inspect", async () => {
    const result = await dialog.showOpenDialog({
      title: "Workspace Snapshotを読み込む",
      properties: ["openFile"],
      filters: [{ name: "Research Desk Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const parsed = readSnapshot(result.filePaths[0]);
    const token = cryptoToken();
    pendingSnapshots.set(token, parsed.workspace);
    return {
      canceled: false,
      token,
      manifest: parsed.manifest,
      changes: workspaceDb.previewSnapshot(parsed.workspace),
    };
  });

  ipcMain.handle("snapshot:apply", (_event, token, decisions) => {
    const snapshot = pendingSnapshots.get(token);
    if (!snapshot) throw new Error("Importプレビューの有効期限が切れました。もう一度Snapshotを選択してください。");
    const result = workspaceDb.applySnapshot(snapshot, decisions);
    pendingSnapshots.delete(token);
    return result;
  });
}

function cryptoToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
