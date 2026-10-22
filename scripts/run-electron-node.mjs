import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

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

const result = spawnSync(electronPath, process.argv.slice(2), {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    TASKEN_NODE_EXEC_PATH: process.execPath,
  },
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
