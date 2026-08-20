#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

import {
  MCP_DIAGNOSTIC_CODES,
  MCP_DIAGNOSTIC_SCHEMA_VERSION,
  inspectMcpEnvironment,
} from "./mcp-runtime.mjs";

const cwd = process.cwd();
const environment = inspectMcpEnvironment({ cwd });

function parseProbeOutput(output) {
  try {
    return JSON.parse(String(output || "").trim());
  } catch {
    return null;
  }
}

function probeNode(command, args, env) {
  const source = [
    "try {",
    "  const Database = require('better-sqlite3');",
    "  const db = new Database(':memory:');",
    "  db.prepare('select 1 as ok').get();",
    "  db.close();",
    "  process.stdout.write(JSON.stringify({ ok: true, abi: process.versions.modules, node: process.version, platform: process.platform, arch: process.arch }));",
    "} catch (error) {",
    "  process.stdout.write(JSON.stringify({ ok: false, code: error?.code || null, message: error instanceof Error ? error.message : String(error), abi: process.versions.modules, node: process.version, platform: process.platform, arch: process.arch }));",
    "  process.exitCode = 1;",
    "}",
  ].join("\n");
  const result = spawnSync(command, [...args, "-e", source], {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const parsed = parseProbeOutput(result.stdout);
  return parsed || {
    ok: false,
    code: result.error?.code || "MCP_PROBE_NO_JSON",
    message: result.error?.message || String(result.stderr || "Probe did not return JSON."),
  };
}

function bindingStatus(probe, mismatchCode, { failureStatus = "error" } = {}) {
  if (probe.ok) return { status: "ok", code: "MCP_NATIVE_BINDING_READY", message: "better-sqlite3 loaded and opened an in-memory database." };
  if (probe.code === "MODULE_NOT_FOUND" || /Cannot find module.*better-sqlite3/i.test(probe.message || "")) {
    return { status: failureStatus, code: MCP_DIAGNOSTIC_CODES.NATIVE_BINDING_MISSING, message: "better-sqlite3 is not installed or cannot be resolved." };
  }
  if (/NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(probe.message || "")) {
    return {
      status: failureStatus,
      code: mismatchCode,
      message: failureStatus === "warning"
        ? "The binding is not compatible with the plain Node ABI; MCP intentionally uses Electron and must not run npm rebuild against Node."
        : "The better-sqlite3 binding ABI does not match the Electron runtime.",
      next_actions: failureStatus === "warning"
        ? ["Use `npm run mcp`; do not run `npm rebuild` with the plain Node runtime."]
        : ["Install dependencies so the binding is built for the bundled Electron runtime.", "Run `npm run doctor:mcp -- --json` again."],
    };
  }
  return { status: failureStatus, code: "MCP_NATIVE_BINDING_LOAD_FAILED", message: probe.message || "better-sqlite3 failed to load." };
}

function buildReport() {
  const checks = [];
  const electron = environment.electron;
  const binding = environment.binding;
  const db = environment.database;

  if (!electron.exists) {
    checks.push({
      status: "error",
      code: MCP_DIAGNOSTIC_CODES.ELECTRON_MISSING,
      message: "The bundled Electron executable was not found.",
      next_actions: ["Run npm install in the Tasken project.", "Check electron.path in this report."],
    });
  } else {
    checks.push({ status: "ok", code: "MCP_ELECTRON_FOUND", message: "Bundled Electron executable was found." });
  }

  if (!binding.native_exists) {
    checks.push({
      status: "error",
      code: MCP_DIAGNOSTIC_CODES.NATIVE_BINDING_MISSING,
      message: "The better-sqlite3 native binding file was not found.",
      next_actions: ["Run npm install so electron-builder install-app-deps can install the Electron binding."],
    });
  }

  const nodeProbe = probeNode(process.execPath, [], { ...process.env });
  const nodeBinding = bindingStatus(nodeProbe, MCP_DIAGNOSTIC_CODES.NATIVE_BINDING_NODE_ABI_MISMATCH, { failureStatus: "warning" });
  checks.push({ scope: "node", ...nodeBinding, details: nodeProbe });

  let electronProbe = { ok: false, code: "MCP_ELECTRON_NOT_PROBED", message: "Electron probe was skipped." };
  let electronBinding = { status: "error", code: "MCP_ELECTRON_NOT_PROBED", message: electronProbe.message };
  if (electron.exists) {
    electronProbe = probeNode(electron.path, [], { ...process.env, ELECTRON_RUN_AS_NODE: "1" });
    electronBinding = bindingStatus(electronProbe, MCP_DIAGNOSTIC_CODES.NATIVE_BINDING_ELECTRON_ABI_MISMATCH);
    checks.push({ scope: "electron", ...electronBinding, details: electronProbe });
  }

  if (db.exists) {
    checks.push({ status: "ok", code: "MCP_DATABASE_FOUND", message: "The configured Tasken database exists." });
  } else {
    checks.push({
      status: "warning",
      code: MCP_DIAGNOSTIC_CODES.DATABASE_MISSING,
      message: "The configured Tasken database does not exist yet; the MCP server cannot return workspace data until Tasken creates it.",
      next_actions: ["Start Tasken once to create the workspace database, or set TASKEN_DB_PATH to a fixture database."],
    });
  }

  const ok = checks.every((check) => check.status !== "error");
  return {
    schema_version: MCP_DIAGNOSTIC_SCHEMA_VERSION,
    command: "doctor:mcp",
    ok,
    status: ok ? "ready" : "blocked",
    checks,
    runtime: {
      ...environment.runtime,
      electron_abi: electronProbe.abi || null,
      electron_platform: electronProbe.platform || null,
      electron_arch: electronProbe.arch || null,
    },
    electron: {
      ...electron,
      probe: electronProbe,
    },
    binding: {
      ...binding,
      node_probe: nodeProbe,
      electron_probe: electronProbe,
    },
    database: db,
  };
}

const report = buildReport();
if (process.argv.includes("--human")) {
  process.stdout.write("Tasken MCP doctor\n");
  for (const check of report.checks) {
    const label = check.status === "ok" ? "OK" : check.status === "warning" ? "WARN" : "ERROR";
    process.stdout.write(`[${label}] ${check.code}: ${check.message}\n`);
  }
  process.stdout.write(`${report.status === "ready" ? "MCP environment: READY" : "MCP environment: BLOCKED"}\n`);
} else {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
if (!report.ok) process.exitCode = 1;
