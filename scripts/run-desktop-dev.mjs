import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runDesktopDoctor } from "./desktop-dev-doctor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireWsl = process.argv.includes("--require-wsl");
const forwardedArgs = process.argv.slice(2).filter((argument) => argument !== "--require-wsl");
const diagnosis = await runDesktopDoctor({ requireWsl });
if (!diagnosis.ok) process.exit(1);

const cliPath = path.join(root, "node_modules", "electron-vite", "bin", "electron-vite.js");
if (!fs.existsSync(cliPath)) {
  console.error(`electron-viteが見つかりません: ${cliPath}`);
  process.exit(1);
}

const electronArgs = [];
if (diagnosis.snapshot.isWsl) {
  electronArgs.push(
    "--disable-gpu",
    "--disable-gpu-compositing",
    `--ozone-platform=${process.env.TASKEN_OZONE_PLATFORM || "x11"}`,
  );
}
if (process.env.TASKEN_DEV_USER_DATA_DIR) {
  electronArgs.push(`--user-data-dir=${path.resolve(process.env.TASKEN_DEV_USER_DATA_DIR)}`);
}

const childArgs = [cliPath, "dev", ...forwardedArgs];
if (electronArgs.length) childArgs.push("--", ...electronArgs);

const child = spawn(process.execPath, childArgs, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  windowsHide: false,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error("Taskenのdesktop dev起動に失敗しました。", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
