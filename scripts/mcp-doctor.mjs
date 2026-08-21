#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  TASKEN_MCP_REQUIRED_CORE_CAPABILITIES,
  TaskenCoreClient,
  TaskenCoreClientError,
} from "../src/main/mcp/taskenCoreClient.mjs";

export async function buildReport(coreClient = new TaskenCoreClient()) {
  try {
    const status = await coreClient.inspect();
    const missing = TASKEN_MCP_REQUIRED_CORE_CAPABILITIES.filter((capability) => !status.capabilities.includes(capability));
    const checks = [
      { status: "ok", code: "MCP_CORE_HEALTHY", message: "Tasken Core health checkに成功しました。" },
      { status: "ok", code: "MCP_CORE_VERSION_MATCH", message: `Tasken Core API ${status.api_version} に接続しました。` },
      missing.length === 0
        ? { status: "ok", code: "MCP_CORE_CAPABILITIES_READY", message: `MCPに必要な ${TASKEN_MCP_REQUIRED_CORE_CAPABILITIES.length} capabilitiesを確認しました。` }
        : { status: "error", code: "MCP_CORE_CAPABILITIES_MISSING", message: `MCPに必要な capabilitiesが ${missing.length} 件不足しています。`, missing_capabilities: missing },
    ];
    return {
      schema_version: 2,
      command: "doctor:mcp",
      ok: missing.length === 0,
      status: missing.length === 0 ? "ready" : "blocked",
      checks,
      core: { api_version: status.api_version, capability_count: status.capabilities.length },
    };
  } catch (error) {
    const publicError = error instanceof TaskenCoreClientError
      ? error.toPublicError()
      : { code: "CORE_UNAVAILABLE", message: "Tasken Coreへ接続できません。Taskenを起動してください。" };
    return {
      schema_version: 2,
      command: "doctor:mcp",
      ok: false,
      status: "blocked",
      checks: [{
        status: "error",
        code: publicError.code,
        message: publicError.message,
        next_actions: [publicError.next_action || "Taskenを起動してから再試行してください。"],
      }],
    };
  }
}

export function writeReport(report, options = {}) {
  const human = options.human ?? process.argv.includes("--human");
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  if (!human) {
    stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  stderr.write("Tasken MCP doctor\n");
  for (const check of report.checks) {
    const label = check.status === "ok" ? "OK" : "ERROR";
    stderr.write(`[${label}] ${check.code}: ${check.message}\n`);
  }
  stderr.write(`${report.ok ? "MCP environment: READY" : "MCP environment: BLOCKED"}\n`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const report = await buildReport();
  writeReport(report);
  if (!report.ok) process.exitCode = 1;
}
