import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const branch = execFileSync(
  "git",
  ["-c", `safe.directory=${root}`, "-C", root, "branch", "--show-current"],
  {
    encoding: "utf8",
  },
).trim();
if (!/^codex\/(komori-20261003-agent-activity(?:-\d+)?|ai-work-log-import)$/.test(branch)) {
  throw new Error("AI作業ログの専用trial branchから起動してください。");
}
const executable = path.join(
  root,
  "node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
if (!fs.existsSync(executable) || !fs.existsSync(path.join(root, "out/main/index.js"))) {
  throw new Error("npm ci と npm run build を先に実行してください。");
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-log-preview-"));
fs.writeFileSync(path.join(profile, "TASKEN-AI-LOG-TRIAL.txt"), "Explicit import trial profile.\n");
const environment = {
  ...process.env,
  TASKEN_USER_DATA_DIR: profile,
  TASKEN_DEV_USER_DATA_DIR: profile,
  TASKEN_DB_PATH: path.join(profile, "research-desk.sqlite"),
};
delete environment.ELECTRON_RUN_AS_NODE;
console.log(`隔離profile: ${profile}`);
console.log("Debriefの取込からfixtures/agent-work-logs/*.jsonを選択し、内容を確認して採用します。");
console.log("このTaskenのwindowを閉じると試用を終了します。");
const child = spawn(executable, [root, `--user-data-dir=${profile}`], {
  cwd: root,
  env: environment,
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
