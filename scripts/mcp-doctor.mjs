#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { listAgentReadyTasksResponseSchema } from "../src/shared/contracts/task/public.ts";

import {
  TASKEN_MCP_REQUIRED_CORE_CAPABILITIES,
  TaskenCoreClient,
  TaskenCoreClientError,
} from "../src/main/mcp/taskenCoreClient.mjs";

export async function buildReport(coreClient = new TaskenCoreClient()) {
  try {
    const status = await coreClient.inspect();
    const missing = TASKEN_MCP_REQUIRED_CORE_CAPABILITIES.filter(
      (capability) => !status.capabilities.includes(capability),
    );
    const checks = [
      {
        status: "ok",
        code: "MCP_CORE_HEALTHY",
        message: "Tasken Core health checkに成功しました。",
      },
      {
        status: "ok",
        code: "MCP_CORE_VERSION_MATCH",
        message: `Tasken Core API ${status.api_version} に接続しました。`,
      },
      missing.length === 0
        ? {
            status: "ok",
            code: "MCP_CORE_CAPABILITIES_READY",
            message: `MCPに必要な ${TASKEN_MCP_REQUIRED_CORE_CAPABILITIES.length} capabilitiesを確認しました。`,
          }
        : {
            status: "error",
            code: "MCP_CORE_CAPABILITIES_MISSING",
            message: `MCPに必要な capabilitiesが ${missing.length} 件不足しています。`,
            missing_capabilities: missing,
          },
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
    const publicError =
      error instanceof TaskenCoreClientError
        ? error.toPublicError()
        : {
            code: "CORE_UNAVAILABLE",
            message: "Tasken Coreへ接続できません。Taskenを起動してください。",
          };
    return {
      schema_version: 2,
      command: "doctor:mcp",
      ok: false,
      status: "blocked",
      checks: [
        {
          status: "error",
          code: publicError.code,
          message: publicError.message,
          next_actions: [publicError.next_action || "Taskenを起動してから再試行してください。"],
        },
      ],
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

// Exercise the same process boundary as an external AI. Never print returned
// Task data, child stderr, or raw transport errors (they can contain paths).
export async function inspectBridge({
  command = "node",
  args = [fileURLToPath(new URL("./mcp-server.mjs", import.meta.url))],
  env = process.env,
  timeoutMs = 10_000,
} = {}) {
  const client = new Client({ name: "tasken-mcp-doctor", version: "1.0.0" });
  const transport = new StdioClientTransport({ command, args, env, stderr: "ignore" });
  const requestOptions = { timeout: timeoutMs };
  const check = {
    status: "error",
    code: "MCP_STDIO_UNAVAILABLE",
    message: "MCPを起動できません。AI側のNodeとserverパスを確認してください。",
  };
  try {
    await client.connect(transport, requestOptions);
    const tools = await client.listTools({}, requestOptions);
    const prompts = await client.listPrompts({}, requestOptions);
    const resources = await client.listResourceTemplates({}, requestOptions);
    const read = await client.callTool(
      { name: "tasken.list_agent_ready_tasks", arguments: { limit: 1 } },
      undefined,
      requestOptions,
    );
    if (
      read.isError ||
      !listAgentReadyTasksResponseSchema.safeParse(read.structuredContent).success
    ) {
      return {
        ...check,
        code: "MCP_READ_FAILED",
        message:
          "MCPは起動しましたがCoreから取得できません。Taskenの起動状態とTASKEN_USER_DATA_DIRを確認してください。",
      };
    }
    return {
      status: "ok",
      code: "MCP_STDIO_READY",
      message: "MCPの起動・ツール一覧・AI Readyの読み取りに成功しました（着手・書き込みなし）。",
      tool_count: tools.tools.length,
      prompt_names: prompts.prompts.map((prompt) => prompt.name),
      resource_templates: resources.resourceTemplates.map((resource) => resource.uriTemplate),
      task_work_available: tools.tools.some((tool) => tool.name === "tasken.start_task_work"),
    };
  } catch {
    // Return only the public diagnostic above, not credential-bearing errors.
    return check;
  } finally {
    await client.close();
  }
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const { values } = parseArgs({
    options: {
      json: { type: "boolean" },
      human: { type: "boolean" },
      server: { type: "string" },
      node: { type: "string" },
    },
  });
  const report = await buildReport();
  if (report.ok) {
    const bridge = await inspectBridge({
      ...(values.node ? { command: values.node } : {}),
      ...(values.server ? { args: [path.resolve(values.server)] } : {}),
    });
    report.checks.push(bridge);
    report.ok = bridge.status === "ok";
    report.status = report.ok ? "ready" : "blocked";
  }
  writeReport(report, { human: values.human });
  if (!report.ok) process.exitCode = 1;
}
