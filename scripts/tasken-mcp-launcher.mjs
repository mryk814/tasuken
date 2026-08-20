#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  MCP_DIAGNOSTIC_CODES,
  MCP_EXIT_CODE,
  electronExecutable,
  errorDiagnostic,
  runtimeSnapshot,
} from "./mcp-runtime.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(scriptDirectory, "mcp-server.mjs");

function writeDiagnostic(diagnostic) {
  process.stderr.write(`TASKEN_MCP_DIAGNOSTIC ${JSON.stringify(diagnostic)}\n`);
}

function launchElectronServer() {
  const electronPath = electronExecutable();
  const snapshot = runtimeSnapshot();
  const child = spawn(electronPath, [serverPath, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    windowsHide: true,
  });

  child.once("error", (error) => {
    writeDiagnostic(errorDiagnostic(error, {
      snapshot,
      code: error.code === "ENOENT" ? MCP_DIAGNOSTIC_CODES.ELECTRON_MISSING : undefined,
      nextActions: [
        "Install dependencies with `npm install` so the bundled Electron executable exists.",
        "Run `npm run doctor:mcp -- --json` for the exact Electron path and native binding diagnosis.",
      ],
    }));
    process.exitCode = MCP_EXIT_CODE;
  });
  child.once("exit", (code, signal) => {
    if (signal) process.exitCode = MCP_EXIT_CODE;
    else process.exitCode = code ?? MCP_EXIT_CODE;
  });
}

if (process.versions.electron && process.env.ELECTRON_RUN_AS_NODE === "1") {
  writeDiagnostic(errorDiagnostic(new Error("The launcher must be invoked through Node; Electron should launch mcp-server.mjs."), {
    code: "MCP_LAUNCHER_WRONG_ENTRYPOINT",
    nextActions: ["Invoke `scripts/mcp-server.mjs` from the bundled Electron runtime."],
  }));
  process.exitCode = MCP_EXIT_CODE;
} else {
  launchElectronServer();
}
