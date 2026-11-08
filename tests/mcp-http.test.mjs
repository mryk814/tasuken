import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { build } from "esbuild";

const bundled = await build({
  stdin: { contents: 'export * from "./src/main/mcp/httpServer.mjs";', resolveDir: process.cwd() },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { startTaskenMcpHttpServer, parseHttpClients } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const token = randomBytes(32).toString("base64url");
const otherToken = randomBytes(32).toString("base64url");
const starterToken = randomBytes(32).toString("base64url");
const proposalCapabilities = ["propose_repository_task", "propose_content", "propose_task_work"];

async function fixture(t, options = {}) {
  const coreClient = {
    status: async () => ({ apiVersion: "1", capabilities: proposalCapabilities }),
    ...options.coreClient,
  };
  const server = await startTaskenMcpHttpServer({
    env: {},
    port: 0,
    clients: { grokbot: { token }, writer: { token: otherToken, readOnly: false } },
    ...options,
    coreClient,
  });
  t.after(() => server.close());
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  return { server, url };
}

async function connect(t, url, credential = token) {
  const client = new Client({ name: "test", version: "1" });
  t.after(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${credential}` } },
    }),
  );
  return client;
}

test("HTTP credentials fail closed and reject duplicate, weak, or malformed settings", () => {
  for (const invalid of [
    {},
    [],
    { a: { token: "weak" } },
    { a: { token, readOnly: "false" } },
    { a: { token, allowStart: "true" } },
    { a: { token, toolsets: "core" } },
    { a: { token, toolsets: [] } },
    { a: { token, toolsets: ["unknown"] } },
    { a: { token }, b: { token } },
  ]) {
    assert.throws(() => parseHttpClients(invalid), /MCP_HTTP_CLIENTS_INVALID/);
  }
  assert.equal(parseHttpClients({ a: { token } })[0].readOnly, true);
  assert.equal(parseHttpClients({ a: { token } })[0].allowStart, false);
  assert.equal(parseHttpClients({ a: { token, allowStart: true } })[0].allowStart, true);
});

test("HTTP clients have independent toolsets, with environment fallback and a read-only ceiling", async (t) => {
  const { url } = await fixture(t, {
    env: { TASKEN_MCP_TOOLSETS: "core,meta", TASKEN_MCP_READ_ONLY: "0" },
    clients: {
      grokbot: { token, toolsets: ["core"] },
      writer: { token: otherToken, readOnly: false },
    },
  });
  const reader = await connect(t, url);
  const writer = await connect(t, url, otherToken);
  assert.equal((await reader.listTools()).tools.length, 6);
  assert.equal((await writer.listTools()).tools.length, 7);
  const result = await writer.callTool({ name: "tasken.get_capabilities", arguments: {} });
  assert.equal(result.structuredContent.writes.task_work_report, false);
  assert.deepEqual(result.structuredContent.bridge.toolsets, ["core", "meta"]);
  assert.equal(
    result.structuredContent.unavailable_tools.find(({ name }) => name === "tasken.report_work")
      .reason,
    "toolset_not_enabled",
  );
  assert.equal(
    (await reader.callTool({ name: "tasken.get_capabilities", arguments: {} })).isError,
    true,
  );
  assert.equal((await reader.listTools()).tools.length, 6);
});

test("HTTP authenticates every MCP method before contacting Core; health is minimal", async (t) => {
  let calls = 0;
  const { server, url } = await fixture(t, {
    coreClient: {
      status: async () => {
        calls++;
        throw Error();
      },
    },
  });
  assert.equal(server.address().address, "127.0.0.1");
  for (const method of ["POST", "GET", "DELETE"]) {
    for (const headers of [{}, { Authorization: "Bearer wrong" }]) {
      const response = await fetch(url, { method, headers });
      assert.equal(response.status, 401);
      assert.match(response.headers.get("www-authenticate"), /Bearer/);
    }
  }
  assert.equal(calls, 0);
  const health = await fetch(new URL("/health", url));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const unavailable = await fetch(url, {
    method: "POST",
    body: "{}",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(unavailable.status, 503);
});

test("SDK initialize, tools/list and capabilities work; default denies writes even for a writer token", async (t) => {
  const { url } = await fixture(t);
  for (const credential of [token, otherToken]) {
    const client = await connect(t, url, credential);
    const { tools } = await client.listTools();
    assert.ok(tools.some(({ name }) => name === "tasken.get_capabilities"));
    assert.ok(tools.every(({ annotations }) => annotations.readOnlyHint));
    const result = await client.callTool({ name: "tasken.get_capabilities", arguments: {} });
    assert.equal(result.structuredContent.bridge.read_only, true);
    const denied = await client.callTool({
      name: "tasken.propose_note",
      arguments: { title: "no write" },
    });
    assert.equal(denied.isError, true);
  }
});

test("explicit per-client write opt-in is capped by the Core profile and other clients stay read-only", async (t) => {
  const { url } = await fixture(t, { env: { TASKEN_MCP_READ_ONLY: "0" } });
  const reader = await connect(t, url);
  const writer = await connect(t, url, otherToken);
  const readerTools = (await reader.listTools()).tools;
  assert.ok(readerTools.every(({ annotations }) => annotations.readOnlyHint));
  const names = (await writer.listTools()).tools.map(({ name }) => name);
  assert.ok(names.includes("tasken.propose_note"));
  assert.ok(!names.includes("tasken.propose_note_edit"));
  assert.ok(!names.includes("tasken.start_task_work"));
  assert.ok(!names.includes("tasken.create_task"));
  assert.equal(
    (await writer.callTool({ name: "tasken.get_capabilities", arguments: {} })).structuredContent
      .writes.task_start,
    false,
  );
});

// 開始付きのprofile(start-only・proposals-and-start・create-and-start)も書き込みのclientを受ける。
// 開始そのものはclientごとのallowStartで出し分け、fullだけを今までどおり断る。
test("start-enabled Core profiles accept writers but only allowStart clients see start_task_work; full is refused", async (t) => {
  const clients = {
    grokbot: { token },
    writer: { token: otherToken, readOnly: false },
    starter: { token: starterToken, readOnly: false, allowStart: true },
  };
  for (const base of [[], proposalCapabilities, [...proposalCapabilities, "create_ai_item"]]) {
    const { url } = await fixture(t, {
      env: { TASKEN_MCP_READ_ONLY: "0" },
      clients,
      coreClient: { status: async () => ({ capabilities: [...base, "task.start_work"] }) },
    });
    const writer = await connect(t, url, otherToken);
    const starter = await connect(t, url, starterToken);
    const reader = await connect(t, url);
    const names = async (client) => (await client.listTools()).tools.map(({ name }) => name);
    assert.ok(!(await names(writer)).includes("tasken.start_task_work"));
    assert.ok((await names(starter)).includes("tasken.start_task_work"));
    assert.ok(!(await names(reader)).includes("tasken.start_task_work"));
    assert.ok(
      (await reader.listTools()).tools.every(({ annotations }) => annotations.readOnlyHint),
    );
  }
  for (const extra of [["task.command"], ["task.command", "task.start_work"]]) {
    const { url } = await fixture(t, {
      env: { TASKEN_MCP_READ_ONLY: "0" },
      clients,
      coreClient: { status: async () => ({ capabilities: [...proposalCapabilities, ...extra] }) },
    });
    for (const credential of [otherToken, starterToken]) {
      const response = await fetch(url, {
        method: "POST",
        body: "{}",
        headers: { Authorization: `Bearer ${credential}` },
      });
      assert.equal(response.status, 503);
    }
    const reader = await connect(t, url);
    assert.ok(
      (await reader.listTools()).tools.every(({ annotations }) => annotations.readOnlyHint),
    );
  }
});

test("browser origins are rejected and no CORS access is enabled", async (t) => {
  const { url } = await fixture(t);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Origin: "https://untrusted.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("HTTP rejects oversized chunked JSON with 413 before contacting Core", async (t) => {
  let calls = 0;
  const { url } = await fixture(t, {
    coreClient: {
      status: async () => {
        calls++;
        throw Error();
      },
    },
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    duplex: "half",
    body: Readable.from(
      (function* () {
        yield '"';
        for (let index = 0; index < 36; index++) yield Buffer.alloc(1024 * 1024, 97);
        yield '"';
      })(),
    ),
  });
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});

const apiClients = {
  grokbot: { token },
  writer: { token: otherToken, readOnly: false },
  starter: { token: starterToken, readOnly: false, allowStart: true },
};

async function api(url, name, body, credential = token) {
  const response = await fetch(new URL(`/api/v1/${name}`, url), {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("/api/v1/<tool> runs a read tool for a read-only client and attaches replica source", async (t) => {
  const source = { node: "replica", state: "ok", as_of: "2026-11-01T00:00:00.000Z" };
  const { url } = await fixture(t, {
    clients: apiClients,
    coreClient: {
      status: async () => ({ capabilities: [...proposalCapabilities, "source_status"] }),
      searchItems: async () => ({ items: [] }),
      getSourceStatus: async () => ({ source }),
    },
  });
  const ok = await api(url, "search_items", { query: "x" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { items: [], source });
});

test("/api/v1 shares /mcp authentication, origin, body and routing rules", async (t) => {
  const { url } = await fixture(t, { clients: apiClients });
  const target = new URL("/api/v1/search_items", url);
  assert.equal((await fetch(target, { method: "POST", body: "{}" })).status, 401);
  assert.equal(
    (
      await fetch(target, {
        method: "POST",
        body: "{}",
        headers: { Authorization: `Bearer ${token}`, Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(target, { headers: { Authorization: `Bearer ${token}` } })).status,
    405,
  );
  for (const path of ["/api/v1/", "/api/v1/a/b", "/api/v2/search_items", "/other"]) {
    assert.equal((await fetch(new URL(path, url), { method: "POST" })).status, 404);
  }
  for (const body of ["[]", "null", '"text"', "7", "{broken"]) {
    assert.equal((await api(url, "search_items", body)).status, 400);
  }
});

test("/api/v1 separates unknown tools (404) from tools this client cannot use (403)", async (t) => {
  const { url } = await fixture(t, { clients: apiClients, env: { TASKEN_MCP_READ_ONLY: "0" } });
  assert.deepEqual(await api(url, "no_such_tool", {}), {
    status: 404,
    body: { error: "unknown_tool" },
  });
  // 読み取り専用のclientには書き込みtoolが一覧に無い。
  assert.deepEqual(await api(url, "propose_feed_post", {}), {
    status: 403,
    body: { error: "tool_not_allowed" },
  });
});

test("/api/v1 hides start_task_work from clients without allowStart", async (t) => {
  const { url } = await fixture(t, {
    clients: apiClients,
    env: { TASKEN_MCP_READ_ONLY: "0" },
    coreClient: {
      status: async () => ({ capabilities: [...proposalCapabilities, "task.start_work"] }),
      startTaskWork: async () => ({ started: true }),
    },
  });
  const args = { task_id: "t", expected_version: 1, idempotency_key: "k" };
  assert.equal((await api(url, "start_task_work", args, otherToken)).status, 403);
  assert.equal((await api(url, "start_task_work", args)).status, 403);
  const starter = await api(url, "start_task_work", args, starterToken);
  assert.notEqual(starter.status, 403);
  assert.notEqual(starter.status, 404);
});

test("/api/v1 rejects unknown argument keys and a missing idempotency_key before Core is touched", async (t) => {
  const touched = [];
  const { url } = await fixture(t, {
    clients: apiClients,
    env: { TASKEN_MCP_READ_ONLY: "0" },
    coreClient: {
      proposeContent: async (request) => touched.push(request),
      searchItems: async (request) => touched.push(request),
    },
  });
  const post = { topic: "insight", body: ["found"] };
  assert.deepEqual(
    await api(url, "propose_feed_post", { ...post, idempotencyKey: "k" }, otherToken),
    { status: 400, body: { error: "unknown_arguments", arguments: ["idempotencyKey"] } },
  );
  assert.deepEqual(await api(url, "search_items", { qeury: "x" }), {
    status: 400,
    body: { error: "unknown_arguments", arguments: ["qeury"] },
  });
  assert.deepEqual(await api(url, "propose_feed_post", post, otherToken), {
    status: 400,
    body: { error: "idempotency_key_required" },
  });
  assert.deepEqual(touched, []);
});

test("writes record the verified client as caller and http:<client> as source_app on /api/v1 and /mcp", async (t) => {
  const requests = [];
  const { url } = await fixture(t, {
    clients: apiClients,
    env: { TASKEN_MCP_READ_ONLY: "0" },
    coreClient: {
      proposeContent: async (request) => {
        requests.push(request);
        return { proposal_id: "p1" };
      },
      proposeTaskWork: async (request) => {
        requests.push(request);
        return { proposal_id: "p2" };
      },
    },
  });
  const post = { topic: "insight", body: ["found"], idempotency_key: "k1" };
  const viaApi = await api(
    url,
    "propose_feed_post",
    { ...post, caller: "someone-else", source_app: "spoofed" },
    otherToken,
  );
  assert.equal(viaApi.status, 200);
  const writer = await connect(t, url, otherToken);
  await writer.callTool({
    name: "tasken.propose_feed_post",
    arguments: { ...post, caller: "someone-else", source_app: "spoofed" },
  });
  // callerが必須のtoolは、/api/v1では本文に書かなくても通る。/mcpでは何か入れて送ればbridgeが上書きする。
  const report = {
    task_id: "t",
    expected_version: 1,
    idempotency_key: "k2",
    status: "progress",
    summary: "s",
    executor_kind: "ai_agent",
    executor_label: "bot",
  };
  const reported = await api(url, "report_work", report, otherToken);
  assert.equal(reported.status, 200, JSON.stringify(reported.body));
  await writer.callTool({
    name: "tasken.report_work",
    arguments: { ...report, caller: "someone-else", source_app: "spoofed" },
  });
  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.caller, "writer");
    assert.equal(request.source_app, "http:writer");
  }
});

test("/api/v1 maps Core error codes to HTTP statuses", async (t) => {
  let code = "NOT_FOUND";
  const { url } = await fixture(t, {
    clients: apiClients,
    env: { TASKEN_MCP_READ_ONLY: "0" },
    coreClient: {
      searchItems: async () => ({ error: { code, message: "m" } }),
    },
  });
  for (const [errorCode, status] of [
    ["NOT_FOUND", 404],
    ["TASK_NOT_FOUND", 404],
    ["IDEMPOTENCY_CONFLICT", 409],
    ["STALE_VERSION", 409],
    ["WRITE_NOT_ALLOWED", 403],
    ["VALIDATION_FAILED", 400],
    ["PROPOSAL_TOO_LARGE", 413],
    ["CORE_UNAVAILABLE", 503],
    ["something_else", 422],
  ]) {
    code = errorCode;
    const result = await api(url, "search_items", {});
    assert.equal(result.status, status, errorCode);
    assert.equal(result.body.error.code, errorCode);
  }
  // SDKの入力検証の失敗は、{error}の形でないisErrorでも呼び方の誤りとして400。
  assert.equal((await api(url, "search_items", { limit: "many" })).status, 400);
});

test("/api/v1 reports an unexpected tool failure as 500, not as a caller error", async (t) => {
  const { url } = await fixture(t, {
    clients: apiClients,
    coreClient: {
      searchItems: async () => {
        throw new Error("boom");
      },
    },
  });
  assert.equal((await api(url, "search_items", {})).status, 500);
});
