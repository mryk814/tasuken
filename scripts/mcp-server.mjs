#!/usr/bin/env node
import process from "node:process";

function writeDiagnostic(error) {
  const code = typeof error?.code === "string" ? error.code : "MCP_START_FAILED";
  process.stderr.write(`TASKEN_MCP_DIAGNOSTIC ${JSON.stringify({
    schema_version: 1,
    status: "blocked",
    code,
    message: code === "MCP_START_FAILED"
      ? "Tasken MCP serverを起動できませんでした。Taskenを再インストールしてください。"
      : "Tasken MCP serverを起動できませんでした。Taskenを起動してから再試行してください。",
  })}\n`);
}

try {
  const { startTaskenMcpServer } = await import("../src/main/mcp/server.mjs");
  await startTaskenMcpServer();
} catch (error) {
  writeDiagnostic(error);
  process.exitCode = 78;
}
