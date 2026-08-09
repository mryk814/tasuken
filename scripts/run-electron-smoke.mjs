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

export function buildElectronSmokeArgs(paths, options = {}) {
  const args = [
    "--disable-gpu",
    "--disable-gpu-compositing",
    ...(options.packaged ? ["--smoke-require-packaged"] : ["."]),
    "--smoke-test",
    `--smoke-run-id=${paths.runId}`,
    `--user-data-dir=${paths.userDataDir}`,
    `--smoke-result-path=${paths.resultPath}`,
  ];
  if (options.restartArtifactId && options.restartMicrophoneArtifactId && options.restartVideoArtifactId && options.restartVideoOwnerId) {
    args.push(
      "--smoke-restart-check",
      `--smoke-media-artifact-id=${options.restartArtifactId}`,
      `--smoke-microphone-artifact-id=${options.restartMicrophoneArtifactId}`,
      `--smoke-video-artifact-id=${options.restartVideoArtifactId}`,
      `--smoke-video-owner-id=${options.restartVideoOwnerId}`,
    );
  }
  return args;
}

export function restartArtifactIdFromResult(value) {
  const id = value?.stage === "restart-ready" ? value?.audioArtifactId : "";
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  return id;
}

export function restartArtifactIdsFromResult(value) {
  const audioArtifactId = restartArtifactIdFromResult(value);
  const microphoneArtifactId = value?.stage === "restart-ready" ? value?.microphoneArtifactId : "";
  const videoArtifactId = value?.stage === "restart-ready" ? value?.videoArtifactId : "";
  const videoOwnerId = value?.stage === "restart-ready" ? value?.smokeTaskId : "";
  if (!audioArtifactId
    || typeof microphoneArtifactId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(microphoneArtifactId)
    || typeof videoArtifactId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoArtifactId)
    || typeof videoOwnerId !== "string" || !videoOwnerId.trim()) return null;
  return { audioArtifactId, microphoneArtifactId, videoArtifactId, videoOwnerId };
}

function electronExecutable(cwd = process.cwd()) {
  const executable = process.platform === "win32" ? "electron.exe" : "electron";
  let candidateRoot = path.resolve(cwd);
  while (true) {
    const candidate = path.join(candidateRoot, "node_modules", "electron", "dist", executable);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(candidateRoot);
    if (parent === candidateRoot) return path.join(cwd, "node_modules", "electron", "dist", executable);
    candidateRoot = parent;
  }
}

export function runElectronSmoke({ cwd = process.cwd(), tempRoot = os.tmpdir(), executablePath = "", packaged = false } = {}) {
  const paths = createSmokePaths(tempRoot);
  mkdirSync(paths.userDataDir, { recursive: true });
  console.log(JSON.stringify({ smokeRunId: paths.runId, userDataDir: paths.userDataDir, resultPath: paths.resultPath }));
  const executable = executablePath ? path.resolve(executablePath) : electronExecutable(cwd);
  const child = spawn(executable, buildElectronSmokeArgs(paths, { packaged }), {
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
    let restartArtifactIds = null;
    try {
      if (existsSync(paths.resultPath)) restartArtifactIds = restartArtifactIdsFromResult(JSON.parse(readFileSync(paths.resultPath, "utf8")));
    } catch (error) {
      console.error(`Electron smoke result is invalid: ${String(error)}`);
    }
    if (code !== 0 || signal !== null || !restartArtifactIds) {
      console.error(`Electron smoke failed before restart check; preserving diagnostics at ${paths.runRoot}`);
      process.exitCode = 1;
      return;
    }
    const restarted = spawn(executable, buildElectronSmokeArgs(paths, {
      packaged,
      restartArtifactId: restartArtifactIds.audioArtifactId,
      restartMicrophoneArtifactId: restartArtifactIds.microphoneArtifactId,
      restartVideoArtifactId: restartArtifactIds.videoArtifactId,
      restartVideoOwnerId: restartArtifactIds.videoOwnerId,
    }), {
      cwd, env: process.env, stdio: "inherit", windowsHide: true,
    });
    restarted.on("error", (error) => {
      console.error(`Electron smoke restart could not start: ${error.message}`);
      process.exitCode = 1;
    });
    restarted.on("exit", (restartCode, restartSignal) => {
      let passed = false;
      try {
        passed = existsSync(paths.resultPath) && JSON.parse(readFileSync(paths.resultPath, "utf8")).stage === "passed";
      } catch (error) {
        console.error(`Electron smoke restart result is invalid: ${String(error)}`);
      }
      const exitCode = restartCode === 0 && restartSignal === null && passed ? 0 : 1;
      if (exitCode === 0) rmSync(paths.runRoot, { recursive: true, force: true });
      else console.error(`Electron smoke failed; preserving diagnostics at ${paths.runRoot}`);
      process.exitCode = exitCode;
    });
  });
  return { paths, child };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) runElectronSmoke();
