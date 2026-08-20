#!/usr/bin/env node
import process from "node:process";

import {
  MCP_EXIT_CODE,
  electronRuntimeRequiredDiagnostic,
  errorDiagnostic,
  isElectronAsNodeRuntime,
  runtimeSnapshot,
} from "./mcp-runtime.mjs";

function writeDiagnostic(diagnostic) {
  process.stderr.write(`TASKEN_MCP_DIAGNOSTIC ${JSON.stringify(diagnostic)}\n`);
}

const snapshot = runtimeSnapshot();
if (!isElectronAsNodeRuntime(snapshot)) {
  writeDiagnostic(electronRuntimeRequiredDiagnostic(snapshot));
  process.exitCode = MCP_EXIT_CODE;
} else {
  try {
    // Keep the native SQLite import behind the Electron-as-Node guard. A plain
    // Node invocation must fail with an actionable diagnostic, not an ABI stack.
    const { startTaskenMcpServer } = await import("../src/main/mcp/server.mjs");
    await startTaskenMcpServer();
  } catch (error) {
    writeDiagnostic(errorDiagnostic(error, { snapshot }));
    process.exitCode = MCP_EXIT_CODE;
  }
}
