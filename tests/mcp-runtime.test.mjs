import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { buildReport, inspectBridge, writeReport } from "../scripts/mcp-doctor.mjs";
import {
  TASKEN_MCP_REQUIRED_CORE_CAPABILITIES,
  TaskenCoreClientError,
} from "../src/main/mcp/taskenCoreClient.mjs";

test("plain Node MCP entrypoint has no Electron or native SQLite runtime dependency", () => {
  const entry = fs.readFileSync("scripts/mcp-server.mjs", "utf8");
  const server = fs.readFileSync("src/main/mcp/server.mjs", "utf8");
  assert.doesNotMatch(
    `${entry}\n${server}`,
    /electron|better-sqlite3|ELECTRON_RUN_AS_NODE|\.node["']/i,
  );
  assert.match(entry, /startTaskenMcpServer/);
});

test("MCP doctor fails closed through Core discovery without exposing credentials or paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-mcp-doctor-"));
  try {
    const result = spawnSync(
      process.env.TASKEN_NODE_EXEC_PATH || "node",
      ["scripts/mcp-doctor.mjs", "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, TASKEN_USER_DATA_DIR: root },
      },
    );
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schema_version, 2);
    assert.equal(report.status, "blocked");
    assert.equal(report.checks[0].code, "CORE_UNAVAILABLE");
    assert.doesNotMatch(
      result.stdout,
      /token|authorization|tasken-core\.json|[A-Za-z]:\\|\/tmp\//i,
    );
    assert.doesNotMatch(result.stderr, /NODE_MODULE_VERSION|better_sqlite3\.node|Require stack/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP doctor reports health, version, and the complete capability set", async () => {
  const report = await buildReport({
    inspect: async () => ({
      status: "ok",
      api_version: "1",
      capabilities: [...TASKEN_MCP_REQUIRED_CORE_CAPABILITIES],
    }),
  });
  assert.equal(report.ok, true);
  assert.equal(report.status, "ready");
  assert.deepEqual(
    report.checks.map((check) => check.code),
    ["MCP_CORE_HEALTHY", "MCP_CORE_VERSION_MATCH", "MCP_CORE_CAPABILITIES_READY"],
  );
  assert.equal(report.core.capability_count, TASKEN_MCP_REQUIRED_CORE_CAPABILITIES.length);
});

test("MCP doctor blocks missing capabilities without exposing transport details", async () => {
  const report = await buildReport({
    inspect: async () => ({
      status: "ok",
      api_version: "1",
      capabilities: TASKEN_MCP_REQUIRED_CORE_CAPABILITIES.slice(1),
    }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.at(-1).code, "MCP_CORE_CAPABILITIES_MISSING");
  assert.deepEqual(report.checks.at(-1).missing_capabilities, [
    TASKEN_MCP_REQUIRED_CORE_CAPABILITIES[0],
  ]);
  assert.doesNotMatch(JSON.stringify(report), /token|authorization|tasken-core\.json|\/tmp\//i);
});

test("MCP doctor maps stale discovery, version, and auth failures to redacted public checks", async () => {
  for (const code of ["CORE_UNAVAILABLE", "VERSION_MISMATCH", "UNAUTHORIZED"]) {
    const report = await buildReport({
      inspect: async () => {
        throw new TaskenCoreClientError(code, "safe public message");
      },
    });
    assert.equal(report.ok, false);
    assert.equal(report.checks[0].code, code);
    assert.doesNotMatch(JSON.stringify(report), /private-token|Bearer|tasken-core\.json|\/tmp\//i);
  }
});

test("doctor keeps JSON protocol stdout clean and sends human diagnostics only to stderr", async () => {
  const report = await buildReport({
    inspect: async () => ({
      status: "ok",
      api_version: "1",
      capabilities: [...TASKEN_MCP_REQUIRED_CORE_CAPABILITIES],
    }),
  });
  const jsonOutput = [];
  const jsonErrors = [];
  writeReport(report, {
    human: false,
    stdout: { write: (value) => jsonOutput.push(value) },
    stderr: { write: (value) => jsonErrors.push(value) },
  });
  assert.equal(jsonErrors.join(""), "");
  assert.equal(JSON.parse(jsonOutput.join("")).status, "ready");

  const humanOutput = [];
  const humanErrors = [];
  writeReport(report, {
    human: true,
    stdout: { write: (value) => humanOutput.push(value) },
    stderr: { write: (value) => humanErrors.push(value) },
  });
  assert.equal(humanOutput.join(""), "");
  assert.match(humanErrors.join(""), /MCP environment: READY/);
});

test("doctor requires the Task command capability used by direct start", async () => {
  const { TASKEN_CORE_TASK_COMMAND_CAPABILITY } =
    await import("../src/shared/contracts/core/public.mjs");
  const report = await buildReport({
    inspect: async () => ({
      api_version: "1",
      capabilities: TASKEN_MCP_REQUIRED_CORE_CAPABILITIES.filter(
        (capability) => capability !== TASKEN_CORE_TASK_COMMAND_CAPABILITY,
      ),
    }),
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.at(-1).missing_capabilities, [
    TASKEN_CORE_TASK_COMMAND_CAPABILITY,
  ]);
});

test("doctor exercises stdio and a read, without exposing Task content or writing", async () => {
  const serverUrl = pathToFileURL(path.resolve("src/main/mcp/server.mjs")).href;
  const transportUrl = pathToFileURL(
    path.resolve("node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js"),
  ).href;
  for (const readOnly of [false, true]) {
    const code = `
      import { createTaskenMcpServer } from ${JSON.stringify(serverUrl)};
      import { StdioServerTransport } from ${JSON.stringify(transportUrl)};
      const coreClient = { listAgentReadyTasks: async () => ({
        tasks: [{ id: "doctor-fixture", intended_executor: "ai_agent", state: "todo", ai: {
          id: "doctor-fixture", type: "task", title: "PRIVATE_TASK_CONTENT", summary: "PRIVATE_TASK_CONTENT",
          ai_visibility: ["coding_agent"], ai_visibility_source: "workspace_default", theme_id: null, updated_at: null,
        }}],
        limit: 1, ai_audience: "coding_agent", read_only: true, excluded_count: 0, excluded_reasons: [],
      }) };
      const server = createTaskenMcpServer({ coreClient, env: { TASKEN_MCP_READ_ONLY: ${JSON.stringify(readOnly ? "1" : "0")} } });
      await server.connect(new StdioServerTransport());
    `;
    const report = await inspectBridge({
      command: process.env.TASKEN_NODE_EXEC_PATH || "node",
      args: ["--input-type=module", "-e", code],
    });
    assert.equal(report.status, "ok");
    assert.equal(report.task_work_available, !readOnly);
    assert.ok(report.prompt_names.includes("daily-report"));
    assert.ok(report.resource_templates.includes("tasken://themes/{themeId}/intent"));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TASK_CONTENT/);
  }
});

test("doctor rejects a malformed read even when MCP returns no isError", async () => {
  const serverUrl = pathToFileURL(path.resolve("src/main/mcp/server.mjs")).href;
  const transportUrl = pathToFileURL(
    path.resolve("node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js"),
  ).href;
  const code = `
    import { createTaskenMcpServer } from ${JSON.stringify(serverUrl)};
    import { StdioServerTransport } from ${JSON.stringify(transportUrl)};
    const server = createTaskenMcpServer({ coreClient: { listAgentReadyTasks: async () => ({ items: [] }) } });
    await server.connect(new StdioServerTransport());
  `;
  const report = await inspectBridge({
    command: process.env.TASKEN_NODE_EXEC_PATH || "node",
    args: ["--input-type=module", "-e", code],
  });
  assert.equal(report.status, "error");
  assert.equal(report.code, "MCP_READ_FAILED");
});

test("doctor redacts failed process starts and times out a silent MCP process", async () => {
  for (const options of [
    { command: "tasken-doctor-no-such-executable" },
    {
      command: process.env.TASKEN_NODE_EXEC_PATH || "node",
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 200,
    },
  ]) {
    const report = await inspectBridge(options);
    assert.equal(report.status, "error");
    assert.equal(report.code, "MCP_STDIO_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(report), /ENOENT|tasken-doctor-no-such|setInterval/);
  }
});

test("doctor distinguishes a running MCP bridge from an unavailable Core", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-doctor-offline-"));
  try {
    const report = await inspectBridge({ env: { ...process.env, TASKEN_USER_DATA_DIR: root } });
    assert.equal(report.status, "error");
    assert.equal(report.code, "MCP_READ_FAILED");
    assert.doesNotMatch(JSON.stringify(report), /tasken-doctor-offline-|tasken-core.json/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
