import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export function createSmokePaths(tempRoot = os.tmpdir(), requestedRunId = "") {
  const runId = `${requestedRunId || "run"}-${process.pid}-${Date.now()}-${randomUUID()}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const runRoot = path.resolve(tempRoot, `tasken-smoke-${runId}`);
  return {
    runId,
    runRoot,
    userDataDir: path.join(runRoot, "userData"),
    resultPath: path.join(runRoot, "result.json"),
  };
}

export function buildElectronSmokeArgs(paths) {
  return [
    "--disable-gpu",
    "--disable-gpu-compositing",
    ".",
    "--smoke-test",
    `--smoke-run-id=${paths.runId}`,
    `--user-data-dir=${paths.userDataDir}`,
    `--smoke-result-path=${paths.resultPath}`,
  ];
}

function electronExecutable(cwd = process.cwd()) {
  const executable = process.platform === "win32" ? "electron.exe" : "electron";
  return path.join(cwd, "node_modules", "electron", "dist", executable);
}

export function runElectronSmoke({ cwd = process.cwd(), tempRoot = os.tmpdir() } = {}) {
  const paths = createSmokePaths(tempRoot);
  mkdirSync(paths.userDataDir, { recursive: true });
  console.log(JSON.stringify({ smokeRunId: paths.runId, userDataDir: paths.userDataDir, resultPath: paths.resultPath }));
  const child = spawn(electronExecutable(cwd), buildElectronSmokeArgs(paths), {
    cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", (error) => {
    console.error(`Electron smoke could not start: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    let passed = false;
    if (existsSync(paths.resultPath)) {
      try {
        passed = JSON.parse(readFileSync(paths.resultPath, "utf8")).stage === "passed";
      } catch (error) {
        console.error(`Electron smoke result is invalid: ${String(error)}`);
      }
    } else {
      console.error(`Electron smoke result was not written: ${paths.resultPath}`);
    }
    const exitCode = code === 0 && signal === null && passed ? 0 : 1;
    if (exitCode === 0) rmSync(paths.runRoot, { recursive: true, force: true });
    else console.error(`Electron smoke failed; preserving diagnostics at ${paths.runRoot}`);
    process.exitCode = exitCode;
  });
  return { paths, child };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) runElectronSmoke();
