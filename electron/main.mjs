import { app, BrowserWindow, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, "..");
const isSmokeTest = process.argv.includes("--smoke-test");
const smokeResultPath = path.join(os.tmpdir(), "research-desk-smoke-result.json");

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
      const clickButton = (label) => {
        const target = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
        if (!target) throw new Error(label + " ボタンが見つかりません");
        target.click();
      };

      clickButton("Notes");
      await delay(60);
      clickButton("メモを書く");
      await delay(60);

      const title = document.querySelector('input[name="title"]');
      const body = document.querySelector('textarea[name="body"]');
      const form = document.querySelector(".drawer-form");
      if (!title || !body || !form) throw new Error("メモ入力フォームが見つかりません");

      title.value = ${JSON.stringify(testTitle)};
      body.value = "Electron内で入力と保存を確認しました。";
      form.requestSubmit();
      await delay(120);

      const notes = JSON.parse(localStorage.getItem("rd-notes") || "[]");
      return {
        title: document.title,
        rootReady: Boolean(document.querySelector("#root > *")),
        saved: notes.some((note) => note.title === ${JSON.stringify(testTitle)}),
        noteCount: notes.length,
      };
    })()
  `);

  window.webContents.once("did-finish-load", async () => {
    try {
      const persisted = await window.webContents.executeJavaScript(`
        JSON.parse(localStorage.getItem("rd-notes") || "[]")
          .some((note) => note.title === ${JSON.stringify(testTitle)})
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
  recordSmoke("app-ready");
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
