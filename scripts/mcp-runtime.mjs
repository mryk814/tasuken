import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveTaskenDatabasePath } from "../src/shared/taskenPaths.mjs";

export const MCP_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const MCP_EXIT_CODE = 78;

export const MCP_DIAGNOSTIC_CODES = Object.freeze({
  ELECTRON_RUNTIME_REQUIRED: "MCP_ELECTRON_RUNTIME_REQUIRED",
  ELECTRON_MISSING: "MCP_ELECTRON_MISSING",
  ELECTRON_PROBE_FAILED: "MCP_ELECTRON_PROBE_FAILED",
  NATIVE_BINDING_MISSING: "MCP_NATIVE_BINDING_MISSING",
  NATIVE_BINDING_NODE_ABI_MISMATCH: "MCP_NATIVE_BINDING_NODE_ABI_MISMATCH",
  NATIVE_BINDING_ELECTRON_ABI_MISMATCH: "MCP_NATIVE_BINDING_ELECTRON_ABI_MISMATCH",
  DATABASE_MISSING: "MCP_DATABASE_MISSING",
});

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const require = createRequire(import.meta.url);

function executableName(platform = process.platform) {
  return platform === "win32" ? "electron.exe" : "electron";
}

export function electronExecutable({ cwd = projectRoot, platform = process.platform } = {}) {
  return path.resolve(cwd, "node_modules", "electron", "dist", executableName(platform));
}

export function runtimeKind({ env = process.env, versions = process.versions } = {}) {
  if (versions.electron && env.ELECTRON_RUN_AS_NODE === "1") return "electron-as-node";
  if (versions.electron) return "electron";
  return "node";
}

export function runtimeSnapshot({
  env = process.env,
  versions = process.versions,
  execPath = process.execPath,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  return {
    kind: runtimeKind({ env, versions }),
    exec_path: execPath,
    node_version: versions.node || process.version,
    node_abi: versions.modules || null,
    electron_version: versions.electron || null,
    platform,
    arch,
    electron_run_as_node: env.ELECTRON_RUN_AS_NODE === "1",
  };
}

export function electronRuntimeRequiredDiagnostic(snapshot = runtimeSnapshot()) {
  return {
    schema_version: MCP_DIAGNOSTIC_SCHEMA_VERSION,
    ok: false,
    code: MCP_DIAGNOSTIC_CODES.ELECTRON_RUNTIME_REQUIRED,
    message: "Tasken MCP server must run under the bundled Electron runtime so better-sqlite3 uses the Electron ABI.",
    runtime: snapshot,
    next_actions: [
      "Run `npm run mcp` from the Tasken project.",
      "For an installed app, invoke the Tasken executable with ELECTRON_RUN_AS_NODE=1 and the bundled MCP server path.",
      "Run `npm run doctor:mcp -- --json` to inspect runtime, ABI, binding, and database paths.",
    ],
  };
}

export function errorDiagnostic(error, { snapshot = runtimeSnapshot(), code, nextActions = [] } = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const inferredCode = code
    || (message.includes("NODE_MODULE_VERSION") ? MCP_DIAGNOSTIC_CODES.NATIVE_BINDING_NODE_ABI_MISMATCH : "MCP_SERVER_START_FAILED");
  return {
    schema_version: MCP_DIAGNOSTIC_SCHEMA_VERSION,
    ok: false,
    code: inferredCode,
    message,
    runtime: snapshot,
    next_actions: nextActions.length ? nextActions : [
      "Run `npm run doctor:mcp -- --json` and follow the reported action.",
    ],
  };
}

function packageRoot(packageName) {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return "";
  }
}

function nativeBindingPath(packageName = "better-sqlite3") {
  const root = packageRoot(packageName);
  return root ? path.join(root, "build", "Release", "better_sqlite3.node") : "";
}

function runElectronProbe(electronPath) {
  if (!electronPath || !fs.existsSync(electronPath)) {
    return { ok: false, code: MCP_DIAGNOSTIC_CODES.ELECTRON_MISSING, message: "Electron executable was not found." };
  }
  return { ok: true, electron_path: electronPath };
}

export function inspectMcpEnvironment({ env = process.env, cwd = projectRoot } = {}) {
  const electronPath = electronExecutable({ cwd });
  const databasePath = resolveTaskenDatabasePath({ env, platform: process.platform, home: os.homedir() });
  const packagePath = packageRoot("better-sqlite3");
  const bindingPath = nativeBindingPath();
  return {
    schema_version: MCP_DIAGNOSTIC_SCHEMA_VERSION,
    runtime: runtimeSnapshot({ env }),
    electron: {
      path: electronPath,
      exists: fs.existsSync(electronPath),
      package_path: path.join(cwd, "node_modules", "electron", "package.json"),
    },
    binding: {
      package: "better-sqlite3",
      package_path: packagePath || null,
      native_path: bindingPath || null,
      native_exists: Boolean(bindingPath && fs.existsSync(bindingPath)),
    },
    database: {
      path: databasePath,
      exists: fs.existsSync(databasePath),
      parent_exists: fs.existsSync(path.dirname(databasePath)),
      configured_by: env.TASKEN_DB_PATH ? "TASKEN_DB_PATH" : "Tasken userData default",
    },
    electron_probe: runElectronProbe(electronPath),
  };
}

export function isElectronAsNodeRuntime(snapshot = runtimeSnapshot()) {
  return snapshot.kind === "electron-as-node";
}

export { projectRoot };
