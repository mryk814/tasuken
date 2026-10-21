#!/usr/bin/env node
import { startTaskenMcpHttpServer } from "../src/main/mcp/httpServer.mjs";

try {
  const server = await startTaskenMcpHttpServer();
  console.error(`Tasken MCP HTTP is listening on 127.0.0.1:${server.address().port}.`);
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      server.close();
      server.closeAllConnections();
    });
  }
} catch {
  // Do not print config contents, credentials, or private discovery paths.
  console.error("Tasken MCP HTTP could not start. Check port and client credentials file.");
  process.exitCode = 78;
}
