import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function check(status, code, message, detail = "") {
  return { status, code, message, detail };
}

export function detectExecutablePlatform(bytes) {
  if (!bytes || bytes.length < 4) return "unknown";
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return "win32";
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return "linux";
  const magic = bytes.readUInt32BE(0);
  if ([0xfeedface, 0xfeedfacf, 0xcafebabe].includes(magic)) return "darwin";
  return "unknown";
}

export function parseWestonState(source) {
  const monitorMatches = [];
  const patterns = [
    /rdpMonitor\[\d+\]:[^\n]*?width:(\d+), height:(\d+)/g,
    /Head mode change:[^\n]*?width:(\d+), height:(\d+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      monitorMatches.push({ index: match.index ?? 0, width: Number(match[1]), height: Number(match[2]) });
    }
  }
  monitorMatches.sort((left, right) => left.index - right.index);
  const latestMonitor = monitorMatches.at(-1) || null;
  const notifyFailure = /connect\([^\n]*weston-notify\.sock\) failed/i.test(source);
  return { latestMonitor, notifyFailure };
}

function isWindowsPath(value) {
  return /^[a-z]:[\\/]/i.test(value) || /^\/mnt\/[a-z]\//i.test(value) || /\.cmd$/i.test(value);
}

export function evaluateDesktopEnvironment(snapshot, { requireWsl = false } = {}) {
  const checks = [];
  checks.push(check("ok", "node-runtime", `Node ${snapshot.nodeVersion} (${snapshot.platform}/${snapshot.arch})`, snapshot.nodeExecPath));

  if (!snapshot.npmPath) {
    checks.push(check("warning", "npm-path-unknown", "npmの実体を確認できません。", "node scripts/desktop-dev-doctor.mjs から直接実行した場合は警告のみです。"));
  } else {
    const npmLooksWindows = isWindowsPath(snapshot.npmPath);
    const npmMismatch = (snapshot.platform === "linux" && npmLooksWindows)
      || (snapshot.platform === "win32" && !npmLooksWindows && snapshot.npmPath.startsWith("/"));
    checks.push(npmMismatch
      ? check("error", "npm-platform-mismatch", "Nodeとnpmが異なるOSのものです。", `npm=${snapshot.npmPath}`)
      : check("ok", "npm-platform", "NodeとnpmのOSが一致しています。", snapshot.npmPath));
  }

  if (!snapshot.electronPath) {
    checks.push(check("error", "electron-missing", "Electron実行ファイルが見つかりません。", "このcheckoutでnpm ciを実行してください。"));
  } else if (snapshot.electronPlatform !== snapshot.platform) {
    checks.push(check("error", "electron-platform-mismatch", "Electronが現在のNodeと異なるOS向けです。", `Electron=${snapshot.electronPlatform}: ${snapshot.electronPath}`));
  } else {
    checks.push(check("ok", "electron-platform", `Electronは${snapshot.electronPlatform}向けです。`, snapshot.electronPath));
  }

  if (requireWsl && !snapshot.isWsl) {
    checks.push(check("error", "wsl-required", "dev:wslはWSL内で実行してください。"));
  }

  if (snapshot.isWsl) {
    checks.push(snapshot.isWsl2
      ? check("ok", "wsl-version", "WSL2カーネルです。", snapshot.kernelRelease)
      : check("error", "wsl-version", "WSL2が必要です。", snapshot.kernelRelease));
    checks.push(snapshot.wslInteropRegistered
      ? check("ok", "wsl-interop", "WSLInteropが登録されています。")
      : check("warning", "wsl-interop", "WSLInteropが登録されていません。", "Windows runtime laneはWSLを完全再起動するまで利用できません。"));

    if (!snapshot.display && !snapshot.waylandDisplay) {
      checks.push(check("error", "wslg-environment", "DISPLAYとWAYLAND_DISPLAYがありません。", "WSLgが有効なWSLセッションから実行してください。"));
    } else {
      checks.push(check("ok", "wslg-environment", "WSLgの環境変数があります。", `DISPLAY=${snapshot.display || "-"}, WAYLAND_DISPLAY=${snapshot.waylandDisplay || "-"}`));
    }

    if (!snapshot.wslgSocketPresent || !snapshot.wslgSocketReachable) {
      checks.push(check("error", "wslg-socket", "WSLgの画面ソケットへ接続できません。", snapshot.wslgSocketPath || "socket not found"));
    } else {
      checks.push(check("ok", "wslg-socket", `WSLgの${snapshot.ozonePlatform || "desktop"}ソケットへ接続できます。`, snapshot.wslgSocketPath));
    }

    const monitor = snapshot.westonState?.latestMonitor;
    if (!monitor) {
      checks.push(check("error", "wslg-monitor-missing", "WSLgのmonitor情報を確認できません。", "/mnt/wslg/weston.log を確認してください。"));
    } else if (monitor.width <= 0 || monitor.height <= 0) {
      checks.push(check("error", "wslg-zero-monitor", "WSLgの画面サイズが0×0です。", "稼働中のWSL作業を終了してから、Windows側でwsl --shutdownを実行してください。"));
    } else {
      checks.push(check("ok", "wslg-monitor", `WSLg monitorは${monitor.width}×${monitor.height}です。`));
    }
    if (snapshot.westonState?.notifyFailure) {
      checks.push(check("warning", "wslg-notify", "WSLgのWindows通知チャネル接続に失敗した記録があります。", "monitorが正常でも画面が出ない場合はWSLの完全再起動が必要です。"));
    }
  }

  if (snapshot.activeElectronPids.length) {
    checks.push(check("error", "tasken-already-running", "このcheckoutのTasken Electronが既に起動しています。", `PID: ${snapshot.activeElectronPids.join(", ")}`));
  } else {
    checks.push(check("ok", "tasken-process", "同じcheckoutのElectronプロセスはありません。"));
  }
  if (snapshot.processScanError) {
    checks.push(check("warning", "tasken-process-scan", "WindowsのElectronプロセス一覧を確認できませんでした。", snapshot.processScanError));
  }

  if (snapshot.staleSingletonPid) {
    checks.push(check("warning", "stale-singleton", "前回起動のSingletonLockが残っています。", `PID: ${snapshot.staleSingletonPid}`));
  }

  return checks;
}

function readTail(filePath, bytes = 256 * 1024) {
  const stat = fs.statSync(filePath);
  const length = Math.min(stat.size, bytes);
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.readSync(descriptor, buffer, 0, length, stat.size - length);
  } finally {
    fs.closeSync(descriptor);
  }
  return buffer.toString("utf8");
}

function firstNpmOnPath(platform, pathValue) {
  const names = platform === "win32" ? ["npm.cmd", "npm.exe", "npm"] : ["npm"];
  for (const directory of String(pathValue || "").split(path.delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function electronExecutable() {
  try {
    const value = require("electron");
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function readExecutableHeader(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buffer = Buffer.alloc(4);
  const descriptor = fs.openSync(filePath, "r");
  try {
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function activeElectronProcesses(root, environment) {
  if (process.platform === "linux" && fs.existsSync("/proc")) {
    const pids = fs.readdirSync("/proc", { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) return [];
      try {
        const command = fs.readFileSync(`/proc/${entry.name}/cmdline`, "utf8").replaceAll("\0", " ");
        return command.includes(root) && /node_modules\/electron\/dist\/electron(?:\s|$)/.test(command) ? [Number(entry.name)] : [];
      } catch {
        return [];
      }
    });
    return { pids, error: "" };
  }
  if (process.platform === "win32") {
    const powershell = path.join(environment.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const escapedRoot = root.replaceAll("'", "''");
    const script = `Get-CimInstance Win32_Process -Filter \"Name = 'electron.exe'\" | Where-Object { $_.CommandLine -like '*${escapedRoot}*' } | ForEach-Object { $_.ProcessId }`;
    try {
      const output = execFileSync(powershell, ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 3000 });
      const pids = output.split(/\r?\n/).map((value) => Number(value.trim())).filter(Number.isInteger);
      return { pids, error: "" };
    } catch (error) {
      return { pids: [], error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { pids: [], error: "" };
}

function staleSingletonPid(environment) {
  if (process.platform !== "linux") return null;
  const userData = environment.TASKEN_DEV_USER_DATA_DIR
    ? path.resolve(environment.TASKEN_DEV_USER_DATA_DIR)
    : path.join(os.homedir(), ".config", "tasken");
  const lockPath = path.join(userData, "SingletonLock");
  try {
    const target = fs.readlinkSync(lockPath);
    const pid = Number(target.match(/-(\d+)$/)?.[1]);
    return pid && !fs.existsSync(`/proc/${pid}`) ? pid : null;
  } catch {
    return null;
  }
}

function socketPathForEnvironment(environment, ozonePlatform) {
  if (ozonePlatform === "wayland" && environment.WAYLAND_DISPLAY) {
    return path.join(environment.XDG_RUNTIME_DIR || "/mnt/wslg/runtime-dir", environment.WAYLAND_DISPLAY);
  }
  const displayNumber = String(environment.DISPLAY || "").match(/:(\d+)/)?.[1];
  return displayNumber == null ? "" : `/tmp/.X11-unix/X${displayNumber}`;
}

function probeSocket(socketPath, timeoutMs = 800) {
  if (!socketPath || !fs.existsSync(socketPath)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = createConnection({ path: socketPath });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function collectDesktopSnapshot(environment = process.env) {
  const procVersion = fs.existsSync("/proc/version") ? fs.readFileSync("/proc/version", "utf8") : "";
  const kernelRelease = os.release();
  const isWsl = process.platform === "linux" && (/microsoft/i.test(procVersion) || Boolean(environment.WSL_DISTRO_NAME));
  const electronPath = electronExecutable();
  const electronBytes = readExecutableHeader(electronPath);
  const westonLogPath = "/mnt/wslg/weston.log";
  const westonState = isWsl && fs.existsSync(westonLogPath) ? parseWestonState(readTail(westonLogPath)) : null;
  const ozonePlatform = environment.TASKEN_OZONE_PLATFORM || "x11";
  const wslgSocketPath = isWsl ? socketPathForEnvironment(environment, ozonePlatform) : "";
  const processes = activeElectronProcesses(projectRoot, environment);
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    nodeExecPath: process.execPath,
    npmPath: environment.npm_execpath || firstNpmOnPath(process.platform, environment.PATH),
    electronPath,
    electronPlatform: detectExecutablePlatform(electronBytes),
    isWsl,
    isWsl2: /WSL2/i.test(kernelRelease) || /WSL2/i.test(procVersion),
    kernelRelease,
    wslInteropRegistered: fs.existsSync("/proc/sys/fs/binfmt_misc/WSLInterop"),
    display: environment.DISPLAY || "",
    waylandDisplay: environment.WAYLAND_DISPLAY || "",
    ozonePlatform,
    wslgSocketPath,
    wslgSocketPresent: Boolean(wslgSocketPath && fs.existsSync(wslgSocketPath)),
    wslgSocketReachable: isWsl ? await probeSocket(wslgSocketPath) : false,
    westonState,
    activeElectronPids: processes.pids,
    processScanError: processes.error,
    staleSingletonPid: staleSingletonPid(environment),
  };
}

export async function runDesktopDoctor({ json = false, requireWsl = false, snapshot = null } = {}) {
  const resolvedSnapshot = snapshot || await collectDesktopSnapshot();
  const checks = evaluateDesktopEnvironment(resolvedSnapshot, { requireWsl });
  const ok = checks.every((entry) => entry.status !== "error");
  if (json) {
    console.log(JSON.stringify({ ok, checks, snapshot: resolvedSnapshot }, null, 2));
  } else {
    console.log("Tasken desktop development doctor");
    for (const entry of checks) {
      const label = entry.status === "ok" ? "OK" : entry.status === "warning" ? "WARN" : "ERROR";
      console.log(`[${label}] ${entry.message}${entry.detail ? `\n       ${entry.detail}` : ""}`);
    }
    console.log(ok ? "Desktop development environment: READY" : "Desktop development environment: BLOCKED");
  }
  return { ok, checks, snapshot: resolvedSnapshot };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await runDesktopDoctor({
    json: process.argv.includes("--json"),
    requireWsl: process.argv.includes("--require-wsl"),
  });
  if (!result.ok) process.exitCode = 1;
}
