#!/usr/bin/env node
import process from "node:process";

import { collectAgentHookEvent, flushPendingAgentSessions } from "../src/main/mcp/agentSessionHookCollector.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

try {
  const clientKind = argument("--client");
  if (process.argv.includes("--flush")) {
    const result = await flushPendingAgentSessions();
    process.stderr.write(`TASKEN_SESSION_HOOK ${JSON.stringify(result)}\n`);
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await collectAgentHookEvent(clientKind, input);
    if (result.status === "pending") {
      process.stderr.write(`TASKEN_SESSION_HOOK ${JSON.stringify(result)}\n`);
    }
  }
  process.stdout.write("{}\n");
} catch (error) {
  process.stderr.write(`TASKEN_SESSION_HOOK ${JSON.stringify({
    status: "failed",
    code: typeof error?.code === "string" ? error.code : "INVALID_HOOK_EVENT",
    message: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.stdout.write("{}\n");
}
