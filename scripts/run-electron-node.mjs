import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createTempRoot } from "./test-temp-root.mjs";

const electronExecutable = process.platform === "win32" ? "electron.exe" : "electron";
const electronPackagePath = path.resolve("node_modules", "electron");
const electronPath = path.join(electronPackagePath, "dist", electronExecutable);

if (!existsSync(electronPath)) {
  const install = spawnSync(process.execPath, [path.join(electronPackagePath, "install.js")], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (install.error) throw install.error;
  if (install.status !== 0) process.exit(install.status ?? 1);
  if (!existsSync(electronPath)) {
    throw new Error(`Electron installer後も実行ファイルが見つかりません: ${electronPath}`);
  }
}

const args = process.argv.slice(2);
const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  TASKEN_NODE_EXEC_PATH: process.execPath,
};
// 試験（--test）だけ、一時フォルダーを実行ごとの根へ向けて終わったら消す
// （scripts/test-temp-root.mjs）。監査や workspace の台本は一時フォルダーを変えない。
const tempRoot = args.includes("--test") ? createTempRoot({ env }) : null;
// Ctrl+C は試験の子にも届く。子が終わるのを待って根を消せるよう、ここでは終わらない。
if (tempRoot) process.on("SIGINT", () => {});

let result;
try {
  result = spawnSync(electronPath, args, {
    env: tempRoot?.env ?? env,
    stdio: "inherit",
    windowsHide: true,
  });
} finally {
  tempRoot?.remove();
}

if (result.error) throw result.error;
process.exit(result.status ?? 1);
