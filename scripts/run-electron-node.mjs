import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const electronExecutable = process.platform === "win32" ? "electron.exe" : "electron";
const electronPath = path.resolve("node_modules", "electron", "dist", electronExecutable);

if (!existsSync(electronPath)) {
  throw new Error(`Electron executableが見つかりません: ${electronPath}`);
}

const result = spawnSync(electronPath, process.argv.slice(2), {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  },
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
