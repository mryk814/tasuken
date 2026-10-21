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
    { a: { token }, b: { token } },
  ]) {
    assert.throws(() => parseHttpClients(invalid), /MCP_HTTP_CLIENTS_INVALID/);
  }
  assert.equal(parseHttpClients({ a: { token } })[0].readOnly, true);
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

test("unsafe full or start-enabled Core profiles cannot expose writes over HTTP", async (t) => {
  for (const capability of ["task.command", "task.start_work"]) {
    const { url } = await fixture(t, {
      env: { TASKEN_MCP_READ_ONLY: "0" },
      coreClient: { status: async () => ({ capabilities: [...proposalCapabilities, capability] }) },
    });
    const response = await fetch(url, {
      method: "POST",
      body: "{}",
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal(response.status, 503);
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
