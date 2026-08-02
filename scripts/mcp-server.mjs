#!/usr/bin/env node
import { startTaskenMcpServer } from "../src/main/mcp/server.mjs";

startTaskenMcpServer().catch((error) => {
  console.error("Tasken MCP Bridge failed.", error);
  process.exit(1);
});
