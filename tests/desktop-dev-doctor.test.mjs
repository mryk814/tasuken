import assert from "node:assert/strict";
import test from "node:test";

import { detectExecutablePlatform, evaluateDesktopEnvironment, parseWestonState } from "../scripts/desktop-dev-doctor.mjs";

function healthyWslSnapshot(overrides = {}) {
  return {
    platform: "linux",
    arch: "x64",
    nodeVersion: "v24.0.0",
    nodeExecPath: "/home/ootan/.nvm/versions/node/v24.0.0/bin/node",
    npmPath: "/home/ootan/.nvm/versions/node/v24.0.0/bin/npm",
    electronPath: "/workspace/node_modules/electron/dist/electron",
    electronPlatform: "linux",
    isWsl: true,
    isWsl2: true,
    kernelRelease: "6.18.0-microsoft-standard-WSL2",
    wslInteropRegistered: true,
    display: ":0",
    waylandDisplay: "wayland-0",
    ozonePlatform: "x11",
    wslgSocketPath: "/run/user/1000/wayland-0",
    wslgSocketPresent: true,
    wslgSocketReachable: true,
    westonState: { latestMonitor: { width: 2560, height: 1440 }, notifyFailure: false },
    activeElectronPids: [],
    staleSingletonPid: null,
    ...overrides,
  };
}

test("desktop doctor identifies Windows and Linux Electron binaries", () => {
  assert.equal(detectExecutablePlatform(Buffer.from([0x4d, 0x5a, 0x90, 0x00])), "win32");
  assert.equal(detectExecutablePlatform(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), "linux");
  assert.equal(detectExecutablePlatform(Buffer.from([0x00, 0x01, 0x02, 0x03])), "unknown");
});

test("desktop doctor reads the latest WSLg monitor state", () => {
  const state = parseWestonState([
    "rdpMonitor[0]: x:0, y:0, width:0, height:0, is_primary:1",
    "Head mode change:rdp-0 NEW width:1920, height:1080, scale:1",
    "wet_module_init: connect(/mnt/wslg/weston-notify.sock) failed No such file or directory",
  ].join("\n"));
  assert.equal(state.latestMonitor?.width, 1920);
  assert.equal(state.latestMonitor?.height, 1080);
  assert.equal(state.notifyFailure, true);
});

test("desktop doctor blocks a zero-sized WSLg monitor before Electron launch", () => {
  const checks = evaluateDesktopEnvironment(healthyWslSnapshot({
    wslInteropRegistered: false,
    westonState: { latestMonitor: { width: 0, height: 0 }, notifyFailure: true },
  }), { requireWsl: true });
  assert.equal(checks.find((entry) => entry.code === "wslg-zero-monitor")?.status, "error");
  assert.equal(checks.find((entry) => entry.code === "wsl-interop")?.status, "warning");
});

test("desktop doctor rejects mixed Linux Node and Windows npm", () => {
  const checks = evaluateDesktopEnvironment(healthyWslSnapshot({ npmPath: "/mnt/c/Program Files/nodejs/npm" }));
  assert.equal(checks.find((entry) => entry.code === "npm-platform-mismatch")?.status, "error");
});

test("desktop doctor rejects a platform-mismatched Electron binary and duplicate process", () => {
  const checks = evaluateDesktopEnvironment(healthyWslSnapshot({
    electronPath: "/workspace/node_modules/electron/dist/electron.exe",
    electronPlatform: "win32",
    activeElectronPids: [1234],
  }));
  assert.equal(checks.find((entry) => entry.code === "electron-platform-mismatch")?.status, "error");
  assert.equal(checks.find((entry) => entry.code === "tasken-already-running")?.status, "error");
});

test("desktop doctor accepts the canonical healthy WSL2 lane", () => {
  const checks = evaluateDesktopEnvironment(healthyWslSnapshot(), { requireWsl: true });
  assert.equal(checks.some((entry) => entry.status === "error"), false);
});
