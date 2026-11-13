import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Database from "better-sqlite3";
import { build } from "esbuild";

import { issueCoreClientToken } from "../src/main/infrastructure/http/coreClientTokens.mjs";
import { RequestStats } from "../src/main/infrastructure/http/requestStats.ts";

const bundled = await build({
  stdin: {
    contents: `
      export { TaskenCoreHost } from "./src/main/infrastructure/http/taskenCoreHost.ts";
      export { MobileGatewayHost } from "./src/main/gateway/mobile/mobileGatewayHost.ts";
      export { startTaskenMcpHttpServer } from "./src/main/mcp/httpServer.mjs";
      export { createTaskenMcpServer } from "./src/main/mcp/server.mjs";
      export { TaskenCoreClient, TaskenCoreClientError } from "./src/main/mcp/taskenCoreClient.mjs";
      export { classifyToolResult } from "./src/main/mcp/toolStats.mjs";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const {
  TaskenCoreHost,
  MobileGatewayHost,
  startTaskenMcpHttpServer,
  createTaskenMcpServer,
  TaskenCoreClient,
  TaskenCoreClientError,
  classifyToolResult,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

// t.afterは登録順に走り、sqliteを開いたままのフォルダ(Windows)は消せないので、片付けはファイルの最後にまとめる。
const directories = [];
after(() => {
  for (const directory of directories) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-stats-test-"));
  directories.push(directory);
  return directory;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let index = 0; index < 5; index += 1) await tick();
};

function row(overrides = {}) {
  return {
    entry: "core GET /health",
    caller: "local",
    status: 200,
    code: "",
    us: 1000,
    bytes: 10,
    ...overrides,
  };
}

function readRows(file) {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare("SELECT * FROM request_stats ORDER BY entry, caller, status, code").all();
  } finally {
    db.close();
  }
}

// --- RequestStats 単体 -------------------------------------------------------------

test("RequestStats merges rows with the same key, across flushes", (t) => {
  const file = path.join(temporaryDirectory(t), "stats.sqlite");
  const stats = new RequestStats({ filePath: file, now: () => new Date(2026, 10, 14, 12) });
  stats.record(row({ us: 2000, bytes: 100 }));
  stats.record(row({ us: 6000, bytes: 300 }));
  stats.record(row({ us: 4000, bytes: 50, status: 404, code: "NOT_FOUND" }));
  stats.flush();
  stats.record(row({ us: 1000, bytes: 1 }));
  stats.flush();
  stats.close();
  const rows = readRows(file);
  assert.equal(rows.length, 2);
  const ok = rows.find((entry) => entry.status === 200);
  assert.deepEqual(
    { ...ok },
    {
      day: "2026-11-14",
      entry: "core GET /health",
      caller: "local",
      status: 200,
      code: "",
      count: 3,
      us_total: 9000,
      us_max: 6000,
      bytes_total: 401,
    },
  );
  assert.equal(rows.find((entry) => entry.status === 404).code, "NOT_FOUND");
});

test("RequestStats.read returns the documented shape and only counts 400/409/422 as failing", (t) => {
  const stats = new RequestStats({
    filePath: path.join(temporaryDirectory(t), "stats.sqlite"),
    now: () => new Date(2026, 10, 14, 12),
  });
  t.after(() => stats.close());
  stats.record(row({ entry: "core POST /v1/commands/change-task", us: 3000, bytes: 100 }));
  stats.record(
    row({
      entry: "core POST /v1/commands/change-task",
      status: 400,
      code: "VALIDATION_FAILED",
      us: 5000,
      bytes: 200,
    }),
  );
  stats.record(
    row({
      entry: "core POST /v1/commands/change-task",
      caller: "mcp:muse",
      status: 409,
      code: "CONFLICT",
      us: 9000,
    }),
  );
  stats.record(
    row({ entry: "core POST /v1/commands/change-task", status: 422, caller: "mcp:muse" }),
  );
  stats.record(
    row({ entry: "core POST /v1/commands/change-task", status: 401, code: "UNAUTHORIZED" }),
  );
  stats.record(
    row({ entry: "core POST /v1/commands/change-task", status: 500, code: "INTERNAL_ERROR" }),
  );
  stats.record(row({ entry: "core GET /health", us: 100, bytes: 20 }));

  const report = stats.read(7);
  assert.deepEqual(Object.keys(report).sort(), [
    "days",
    "failing",
    "requests",
    "since",
    "slowest",
    "tool_errors",
  ]);
  assert.equal(report.days, 7);
  assert.equal(report.since, "2026-11-08");
  assert.equal(report.requests, 7);
  assert.deepEqual(Object.keys(report.slowest[0]).sort(), [
    "avg_bytes",
    "avg_ms",
    "count",
    "entry",
    "max_ms",
  ]);
  assert.equal(report.slowest[0].entry, "core POST /v1/commands/change-task");
  assert.equal(report.slowest[0].count, 6);
  assert.equal(report.slowest[0].max_ms, 9);
  assert.equal(report.slowest[0].avg_ms, 3.3);
  assert.equal(report.slowest[1].entry, "core GET /health");

  assert.equal(report.failing.length, 1);
  assert.deepEqual(report.failing[0], {
    entry: "core POST /v1/commands/change-task",
    count: 6,
    failed: 3,
    by_status: { 400: 1, 409: 1, 422: 1 },
    by_caller: { local: 1, "mcp:muse": 2 },
    by_code: { VALIDATION_FAILED: 1, CONFLICT: 1 },
  });
  assert.deepEqual(report.tool_errors, []);
});

test("RequestStats.read lists non-200 tool calls under tool_errors", (t) => {
  const stats = new RequestStats({
    filePath: path.join(temporaryDirectory(t), "stats.sqlite"),
    now: () => new Date(2026, 10, 14, 12),
  });
  t.after(() => stats.close());
  const entry = "tool tasken.report_work";
  for (let index = 0; index < 6; index += 1) stats.record(row({ entry, caller: "mcp:muse" }));
  stats.record(row({ entry, caller: "mcp:muse", status: 400, code: "INVALID_ARGUMENTS" }));
  stats.record(row({ entry, caller: "mcp:muse", status: 400, code: "INVALID_ARGUMENTS" }));
  stats.record(row({ entry, caller: "mcp:muse", status: 404, code: "NOT_FOUND" }));
  stats.record(row({ entry, caller: "mcp:muse", status: 500, code: "INTERNAL_ERROR" }));
  stats.record(row({ entry: "core GET /health", status: 503 }));

  const { tool_errors: toolErrors } = stats.read(1);
  assert.equal(toolErrors.length, 1);
  assert.deepEqual(toolErrors[0], {
    entry,
    count: 10,
    failed: 4,
    by_status: { 400: 2, 404: 1, 500: 1 },
    by_code: { INVALID_ARGUMENTS: 2, NOT_FOUND: 1, INTERNAL_ERROR: 1 },
    by_caller: { "mcp:muse": 4 },
  });
});

test("RequestStats drops rows older than a year and keeps the days window", (t) => {
  const file = path.join(temporaryDirectory(t), "stats.sqlite");
  const old = new RequestStats({ filePath: file, now: () => new Date(2025, 10, 1, 12) });
  old.record(row({ entry: "core GET /version" }));
  old.close();
  const recent = new RequestStats({ filePath: file, now: () => new Date(2026, 10, 14, 12) });
  t.after(() => recent.close());
  assert.equal(readRows(file).length, 1);
  recent.record(row());
  recent.flush();
  assert.deepEqual(
    readRows(file).map((entry) => entry.entry),
    ["core GET /health"],
  );
  assert.equal(recent.read(1).requests, 1);
});

test("RequestStats puts rows back in memory when the flush fails", (t) => {
  const directory = temporaryDirectory(t);
  const folder = path.join(directory, "later");
  const file = path.join(folder, "stats.sqlite");
  const stats = new RequestStats({ filePath: file, now: () => new Date(2026, 10, 14, 12) });
  t.after(() => stats.close());
  stats.record(row({ us: 2000 }));
  stats.flush(); // 保存先のフォルダがまだ無いので失敗する
  stats.record(row({ us: 4000 }));
  fs.mkdirSync(folder);
  const report = stats.read(1);
  assert.equal(report.requests, 2);
  assert.equal(report.slowest[0].avg_ms, 3);
});

test("RequestStats flushes outside the request after the interval, not on every record", async (t) => {
  const file = path.join(temporaryDirectory(t), "stats.sqlite");
  let current = new Date(2026, 10, 14, 12, 0, 0).getTime();
  const stats = new RequestStats({
    filePath: file,
    now: () => new Date(current),
    flushEveryMs: 30_000,
  });
  t.after(() => stats.close());
  stats.record(row());
  await settle();
  assert.equal(fs.existsSync(file), false);
  current += 31_000;
  stats.record(row());
  assert.equal(fs.existsSync(file), false, "record must not write inside the request");
  await settle();
  assert.equal(readRows(file)[0].count, 2);
});

test("RequestStats.record never throws", () => {
  const stats = new RequestStats({ filePath: path.join(os.tmpdir(), "x", "y", "z.sqlite") });
  assert.doesNotThrow(() => stats.record({ entry: 1, us: Number.NaN, bytes: "x" }));
  assert.doesNotThrow(() => stats.record(null));
  assert.doesNotThrow(() => stats.close());
});

// --- MCP tool の分類と呼び手 -------------------------------------------------------

async function connectMcp(t, { coreClient, ...options } = {}) {
  const rows = [];
  const server = createTaskenMcpServer({
    env: {},
    readOnly: true,
    coreClient: { status: async () => ({ capabilities: [] }), ...coreClient },
    statsSink: { record: (value) => rows.push(value) },
    ...options,
  });
  const client = new Client({ name: options.clientName ?? "Stats Test!", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(a);
  await client.connect(b);
  return { client, rows };
}

test("tool calls are classified by status and code and carry the caller", async (t) => {
  const { client, rows } = await connectMcp(t, {
    coreClient: {
      searchItems: async () => ({ items: [] }),
      getTaskContext: async () => {
        throw new TaskenCoreClientError("NOT_FOUND", "no such task", { status: 404 });
      },
    },
    statsCaller: "mcp:muse",
  });

  const ok = await client.callTool({ name: "tasken.search_items", arguments: {} });
  assert.notEqual(ok.isError, true);
  const notFound = await client.callTool({
    name: "tasken.get_task_context",
    arguments: { task_id: "task-1" },
  });
  assert.equal(notFound.isError, true);
  const invalid = await client.callTool({
    name: "tasken.search_items",
    arguments: { limit: "not-a-number" },
  });
  assert.equal(invalid.isError, true);
  const unknown = await client.callTool({ name: "tasken.no_such_tool", arguments: {} });
  assert.equal(unknown.isError, true);
  await settle();

  const summary = rows.map(({ entry, caller, status, code }) => ({ entry, caller, status, code }));
  assert.deepEqual(summary, [
    { entry: "tool tasken.search_items", caller: "mcp:muse", status: 200, code: "" },
    { entry: "tool tasken.get_task_context", caller: "mcp:muse", status: 404, code: "NOT_FOUND" },
    {
      entry: "tool tasken.search_items",
      caller: "mcp:muse",
      status: 400,
      code: "INVALID_ARGUMENTS",
    },
    { entry: "tool {unknown}", caller: "mcp:muse", status: 404, code: "UNKNOWN_TOOL" },
  ]);
  for (const entry of rows) {
    assert.ok(Number.isInteger(entry.us) && entry.us >= 0);
    assert.ok(Number.isInteger(entry.bytes) && entry.bytes >= 0);
  }
  assert.ok(rows[0].bytes > 0);
});

test("stdio tool calls take the caller from the client's initialize name", async (t) => {
  const { client, rows } = await connectMcp(t, {
    clientName: "Claude Code/1.0",
    coreClient: { searchItems: async () => ({ items: [] }) },
  });
  await client.callTool({ name: "tasken.search_items", arguments: {} });
  await settle();
  assert.equal(rows[0].caller, "mcp:local/claudecode1.0");
});

test("classifyToolResult maps the documented result shapes", () => {
  assert.deepEqual(classifyToolResult({ content: [] }), { status: 200, code: "" });
  const errorResult = (value) => ({
    isError: true,
    structuredContent: value,
    content: [{ type: "text", text: "x" }],
  });
  assert.deepEqual(classifyToolResult(errorResult({ error: { code: "idempotency_conflict" } })), {
    status: 409,
    code: "IDEMPOTENCY_CONFLICT",
  });
  assert.deepEqual(classifyToolResult(errorResult({ error: { code: "bad code!" } })), {
    status: 422,
    code: "OTHER",
  });
  assert.deepEqual(
    classifyToolResult({ isError: true, content: [{ type: "text", text: "MCP error -32602: x" }] }),
    { status: 400, code: "INVALID_ARGUMENTS" },
  );
  assert.deepEqual(
    classifyToolResult({ isError: true, content: [{ type: "text", text: "boom" }] }),
    { status: 500, code: "INTERNAL_ERROR" },
  );
  assert.deepEqual(
    classifyToolResult({ isError: true, content: [{ type: "text", text: "not found" }] }, false),
    { status: 404, code: "UNKNOWN_TOOL" },
  );
});

// --- Core の口 --------------------------------------------------------------------

async function startCore(t, options = {}) {
  const userDataPath = temporaryDirectory(t);
  const host = new TaskenCoreHost({
    userDataPath,
    listAgentReadyTasks: { execute: () => ({ tasks: [] }) },
    ...options,
  });
  const { origin, discoveryPath } = await host.start();
  t.after(() => host.stop());
  const { token } = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
  const call = (route, { method = "GET", credential = token, body, headers = {} } = {}) =>
    fetch(`${origin}${route}`, {
      method,
      headers: {
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  return { host, userDataPath, origin, token, call };
}

test("Core: /v1/stats/record needs the full token and validates every row", async (t) => {
  const { userDataPath, call, host } = await startCore(t);
  const reader = (await issueCoreClientToken(userDataPath, "awai")).token;
  const valid = {
    entry: "tool tasken.search_items",
    caller: "mcp:muse",
    status: 200,
    code: "",
    us: 1500,
    bytes: 20,
  };

  assert.equal(
    (await call("/v1/stats/record", { method: "POST", credential: "", body: { rows: [valid] } }))
      .status,
    401,
  );
  const forbidden = await call("/v1/stats/record", {
    method: "POST",
    credential: reader,
    body: { rows: [valid] },
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "READ_ONLY_CLIENT");
  assert.equal((await call("/v1/stats/record")).status, 405);

  const accepted = await call("/v1/stats/record", {
    method: "POST",
    body: { rows: [valid, valid] },
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { recorded: 2 });

  const bad = [
    { rows: [] },
    { rows: Array.from({ length: 101 }, () => valid) },
    { rows: [{ ...valid, extra: 1 }] },
    { rows: [valid], extra: 1 },
    { rows: [{ ...valid, entry: "tool tasken.Bad-Name" }] },
    { rows: [{ ...valid, entry: "mcp-http GET /api/v1/anything" }] },
    { rows: [{ ...valid, entry: "core GET /health" }] },
    { rows: [{ ...valid, caller: "mcp:has space" }] },
    { rows: [{ ...valid, status: 99 }] },
    { rows: [{ ...valid, status: 600 }] },
    { rows: [{ ...valid, code: "lowercase" }] },
    { rows: [{ ...valid, us: -1 }] },
    { rows: [{ ...valid, us: 3_600_000_001 }] },
    { rows: [{ ...valid, bytes: 1.5 }] },
    // 1件でも不正なら、正しい行も含めて何も記録しない。
    {
      rows: [
        { ...valid, entry: "tool tasken.only_in_a_bad_batch" },
        { ...valid, status: 99 },
      ],
    },
  ];
  for (const body of bad) {
    const response = await call("/v1/stats/record", { method: "POST", body });
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal((await response.json()).error.code, "VALIDATION_FAILED");
  }
  const report = host.stats.read(1);
  assert.equal(
    report.slowest.some((entry) => entry.entry === "tool tasken.only_in_a_bad_batch"),
    false,
  );
  assert.equal(report.slowest.find((entry) => entry.entry === "tool tasken.search_items").count, 2);
});

test("Core: GET /v1/stats validates days and is readable by read-only clients", async (t) => {
  const { userDataPath, call } = await startCore(t);
  const reader = (await issueCoreClientToken(userDataPath, "awai")).token;

  const defaults = await (await call("/v1/stats")).json();
  assert.equal(defaults.days, 7);
  assert.equal((await (await call("/v1/stats?days=1", { credential: reader })).json()).days, 1);
  assert.equal((await (await call("/v1/stats?days=366")).json()).days, 366);
  assert.equal((await call("/v1/stats", { credential: "" })).status, 401);
  assert.equal((await call("/v1/stats", { method: "POST", body: {} })).status, 405);
  for (const days of ["0", "367", "abc", "1.5", "-1", "", "7&days=8"]) {
    const response = await call(`/v1/stats?days=${days}`);
    assert.equal(response.status, 400, days);
    assert.equal((await response.json()).error.code, "VALIDATION_FAILED");
  }

  // 呼び手は全権tokenなら local、読み取りclientなら token:<名前>。
  const failing = (await (await call("/v1/stats?days=7")).json()).failing;
  const entry = failing.find((item) => item.entry === "core GET /v1/stats");
  assert.equal(entry.by_caller.local >= 1, true);
  assert.equal(entry.by_code.VALIDATION_FAILED >= 1, true);
});

// --- 中身を記録しない -------------------------------------------------------------

test("no title, body, query, ID or path text from a request reaches the stats file", async (t) => {
  const sentinels = [
    "SENTINEL_TITLE_7f3a",
    "SENTINEL_BODY_91c2",
    "SENTINEL_QUERY_55de",
    "SENTINEL_TASKID_0b8e",
    "SENTINEL_CORE_PATH_c4a1",
    "SENTINEL_RECORD_ENTRY_2d90",
    "SENTINEL_GATEWAY_PATH_a7f6",
    "SENTINEL_TOOL_NAME_3e18",
    "SENTINEL_TOKEN_b5c4",
  ];
  const { host, userDataPath, origin, token, call } = await startCore(t);
  const statsFile = path.join(userDataPath, "request-stats.sqlite");

  // MCPの道具の引数（成功・入力の誤り・未知の道具名）。送り先は実物のCoreの計測の口。
  const coreClient = new TaskenCoreClient({ userDataPath });
  const { client } = await connectMcp(t, {
    clientName: "SENTINEL_CLIENT_NAME_1234",
    coreClient: {
      status: async () => ({ capabilities: [] }),
      searchItems: async () => ({ items: [] }),
      getTaskContext: async () => {
        throw new TaskenCoreClientError("NOT_FOUND", "no such task", { status: 404 });
      },
      recordStats: (rows) => coreClient.recordStats(rows),
    },
    statsSink: undefined,
  });
  await client.callTool({
    name: "tasken.search_items",
    arguments: { query: "SENTINEL_QUERY_55de", theme_id: "SENTINEL_TASKID_0b8e" },
  });
  await client.callTool({
    name: "tasken.get_task_context",
    arguments: { task_id: "SENTINEL_TASKID_0b8e" },
  });
  await client.callTool({
    name: "tasken.search_items",
    arguments: { query: "SENTINEL_QUERY_55de", limit: "SENTINEL_BODY_91c2" },
  });
  await client.callTool({
    name: "SENTINEL_TOOL_NAME_3e18",
    arguments: { title: "SENTINEL_TITLE_7f3a", body: "SENTINEL_BODY_91c2" },
  });
  await client.callTool({
    name: "tasken.create_task",
    arguments: { title: "SENTINEL_TITLE_7f3a", body: "SENTINEL_BODY_91c2" },
  });
  await settle();

  // Coreへの未知のpath・query・本文・未知の認証。
  const unknownCore = await call("/v1/queries/SENTINEL_CORE_PATH_c4a1?q=SENTINEL_QUERY_55de");
  assert.equal(unknownCore.status, 404);
  await call("/v1/queries/SENTINEL_CORE_PATH_c4a1?q=SENTINEL_QUERY_55de", {
    credential: "SENTINEL_TOKEN_b5c4",
  });
  await call("/v1/queries/search-items", {
    method: "POST",
    body: { query: 1, title: "SENTINEL_TITLE_7f3a", body: "SENTINEL_BODY_91c2" },
  });
  await call("/health?x=SENTINEL_QUERY_55de");

  // 計測の口へ、目印入りの入口名・呼び手を送る。
  const rejected = await call("/v1/stats/record", {
    method: "POST",
    body: {
      rows: [
        {
          entry: "tool tasken.SENTINEL_RECORD_ENTRY_2d90",
          caller: "mcp:SENTINEL_RECORD_ENTRY_2d90 x",
          status: 200,
          code: "",
          us: 1,
          bytes: 1,
        },
      ],
    },
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.text()).includes("SENTINEL"), false);

  // Mobile Gatewayへの未知のpath。
  const gateway = new MobileGatewayHost({
    adapter: {
      handle: async () => ({
        status: 404,
        body: { ok: false, error: { code: "not_found" } },
        headers: {},
      }),
    },
    devices: { authenticate: () => null },
    state: {
      current: () => ({ serverId: "s", serverRevision: 1, generatedAt: new Date().toISOString() }),
    },
    port: 0,
    stats: host.stats,
  });
  await gateway.start();
  t.after(() => gateway.stop());
  const gatewayOrigin = gateway.diagnostics().localOrigin;
  for (const [method, body] of [
    ["GET", undefined],
    ["POST", JSON.stringify({ title: "SENTINEL_TITLE_7f3a" })],
  ]) {
    const response = await fetch(
      `${gatewayOrigin}/v1/SENTINEL_GATEWAY_PATH_a7f6?q=SENTINEL_QUERY_55de`,
      {
        method,
        headers: { authorization: "Bearer SENTINEL_TOKEN_b5c4" },
        body,
      },
    );
    assert.ok(response.status >= 400);
  }

  const apiResponse = await (await call("/v1/stats?days=7")).text();
  for (const sentinel of sentinels) assert.equal(apiResponse.includes(sentinel), false, sentinel);
  const report = JSON.parse(apiResponse);
  const names = report.slowest.map((entry) => entry.entry);
  // 空のテストにならないよう、閉じた集合の名前では数えられていることも確かめる。
  assert.ok(names.includes("core GET {unknown}"), names.join(","));
  assert.ok(names.includes("gateway GET {unknown}"), names.join(","));
  assert.ok(names.includes("gateway POST {unknown}"), names.join(","));
  assert.ok(names.includes("tool {unknown}"), names.join(","));
  assert.ok(names.includes("tool tasken.search_items"), names.join(","));
  assert.ok(names.includes("core POST /v1/queries/search-items"), names.join(","));
  assert.ok(names.includes("core GET /health"), names.join(","));
  assert.equal(names.includes("core POST /v1/stats/record"), false);

  await gateway.stop();
  await host.stop();
  const bytes = fs.readFileSync(statsFile);
  for (const sentinel of sentinels) {
    assert.equal(bytes.includes(Buffer.from(sentinel)), false, `${sentinel} is in the file`);
  }
  assert.ok(readRows(statsFile).length > 0);
  assert.equal(origin.startsWith("http://127.0.0.1:"), true);
  assert.equal(token.length > 0, true);
});

// --- MCP の HTTP server --------------------------------------------------------------

test("MCP HTTP server serves /api/stats from Core and sends mcp-http rows", async (t) => {
  const clientToken = randomBytes(32).toString("base64url");
  const sent = [];
  const requested = [];
  const server = await startTaskenMcpHttpServer({
    env: {},
    port: 0,
    clients: { reader: { token: clientToken } },
    coreClient: {
      status: async () => ({ capabilities: [] }),
      recordStats: async (rows) => {
        sent.push(...rows);
      },
      getStats: async (days) => {
        requested.push(days);
        if (days === 9) throw new Error("core is down");
        return {
          days,
          since: "2026-11-01",
          requests: 3,
          slowest: [],
          failing: [],
          tool_errors: [],
        };
      },
    },
  });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (route, credential = clientToken) =>
    fetch(`${origin}${route}`, {
      headers: credential ? { authorization: `Bearer ${credential}` } : {},
    });

  const stats = await get("/api/stats?days=3");
  assert.equal(stats.status, 200);
  assert.deepEqual(await stats.json(), {
    days: 3,
    since: "2026-11-01",
    requests: 3,
    slowest: [],
    failing: [],
    tool_errors: [],
  });
  assert.equal((await (await get("/api/stats")).json()).days, 7);
  assert.deepEqual(requested, [3, 7]);
  assert.equal((await get("/api/stats?days=0")).status, 400);
  assert.equal((await get("/api/stats?days=367")).status, 400);
  assert.equal((await get("/api/stats?days=9")).status, 503);
  assert.equal((await get("/api/stats", "")).status, 401);
  assert.equal(
    (
      await fetch(`${origin}/api/stats`, {
        method: "POST",
        headers: { authorization: `Bearer ${clientToken}` },
      })
    ).status,
    405,
  );
  assert.equal((await get("/SENTINEL_HTTP_PATH?q=SENTINEL_QUERY_55de", "")).status, 404);
  assert.equal((await get("/api/v1")).status, 200);
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const summary = sent.map(({ entry, caller, status, code }) => ({ entry, caller, status, code }));
  const has = (expected) =>
    assert.ok(
      summary.some((item) => JSON.stringify(item) === JSON.stringify(expected)),
      `${JSON.stringify(expected)} not in ${JSON.stringify(summary)}`,
    );
  has({ entry: "mcp-http GET /api/stats", caller: "token:reader", status: 200, code: "" });
  has({ entry: "mcp-http GET /api/stats", caller: "anonymous", status: 401, code: "UNAUTHORIZED" });
  has({
    entry: "mcp-http GET /api/stats",
    caller: "token:reader",
    status: 503,
    code: "CORE_UNAVAILABLE",
  });
  has({ entry: "mcp-http GET {unknown}", caller: "anonymous", status: 404, code: "NOT_FOUND" });
  has({ entry: "mcp-http GET /api/v1", caller: "token:reader", status: 200, code: "" });
  assert.equal(JSON.stringify(sent).includes("SENTINEL"), false);
  for (const entry of sent) {
    assert.ok(Number.isInteger(entry.us) && entry.bytes >= 0);
  }
});
