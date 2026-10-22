import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { build } from "esbuild";

import { buildMcpBridge } from "../scripts/build-mcp-bridge.mjs";

async function launchHttp(serverPath, userDataPath, credentialsPath) {
  const child = spawn(process.env.TASKEN_NODE_EXEC_PATH || "node", [serverPath], {
    env: {
      ...process.env,
      TASKEN_USER_DATA_DIR: userDataPath,
      TASKEN_MCP_READ_ONLY: "1",
      TASKEN_MCP_HTTP_PORT: "0",
      TASKEN_MCP_HTTP_CLIENTS_FILE: credentialsPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await exited;
  };
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("HTTP bridge readiness timed out")), 15_000);
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = /listening on 127\.0\.0\.1:(\d+)/.exec(stderr);
        if (match) {
          clearTimeout(timer);
          resolve(new URL(`http://127.0.0.1:${match[1]}/mcp`));
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error("HTTP bridge exited before ready"));
      });
    });
    return { url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function connectHttp(url, token) {
  const client = new Client({ name: "tasken-http-core-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

test("production HTTP and stdio bridges share the isolated Headless Core; restart rotates HTTP credentials", async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-http-core-"));
  // Bundled native imports resolve through this checkout's node_modules.
  const bundleDirectory = fs.mkdtempSync(path.join(process.cwd(), ".tasken-http-core-test-"));
  const userDataPath = path.join(root, "user-data");
  fs.mkdirSync(userDataPath);
  let core;
  let http;
  let httpClient;
  let stdioClient;
  try {
    const headlessPath = path.join(bundleDirectory, "headless.mjs");
    await build({
      stdin: {
        contents: `
          export { startTaskenHeadlessCore } from "./src/main/headless/taskenHeadlessCore.ts";
          export { TaskenCoreClient } from "./src/main/mcp/taskenCoreClient.mjs";
        `,
        resolveDir: process.cwd(),
      },
      alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["better-sqlite3", "adm-zip", "pptxgenjs"],
      outfile: headlessPath,
      logLevel: "silent",
    });
    const { startTaskenHeadlessCore, TaskenCoreClient } = await import(
      pathToFileURL(headlessPath).href
    );
    core = await startTaskenHeadlessCore({ userDataPath, writeMode: "create-only" });
    const seeded = await new TaskenCoreClient({ userDataPath }).createAiItem({
      kind: "task",
      title: "Read the same isolated task",
      body: "Seed the HTTP integration through the public Core creation contract.",
      caller: "http-integration-test",
      source_app: "http-integration-test",
      source_session: "isolated-session",
      idempotency_key: "http-integration-seed-task",
      reason: "Create disposable data for the transport integration test",
    });
    assert.equal(seeded.status, "created");
    const taskId = seeded.entity.id;
    await core.stop();
    core = undefined;
    core = await startTaskenHeadlessCore({ userDataPath });
    const outDir = path.join(root, "mcp-dist");
    await buildMcpBridge({ outDir });
    const token = randomBytes(32).toString("base64url");
    const credentialsPath = path.join(root, "http-clients.json");
    fs.writeFileSync(credentialsPath, JSON.stringify({ grokbot: { token } }), { mode: 0o600 });
    http = await launchHttp(path.join(outDir, "http-server.mjs"), userDataPath, credentialsPath);
    httpClient = await connectHttp(http.url, token);
    stdioClient = new Client({ name: "tasken-stdio-http-test", version: "1.0.0" });
    await stdioClient.connect(
      new StdioClientTransport({
        command: process.env.TASKEN_NODE_EXEC_PATH || "node",
        args: [path.join(outDir, "server.mjs")],
        env: { ...process.env, TASKEN_USER_DATA_DIR: userDataPath, TASKEN_MCP_READ_ONLY: "1" },
        stderr: "pipe",
      }),
    );
    for (const client of [httpClient, stdioClient]) {
      const tools = (await client.listTools()).tools;
      assert.ok(tools.length > 0);
      assert.ok(tools.every(({ annotations }) => annotations.readOnlyHint));
      const capabilities = await client.callTool({
        name: "tasken.get_capabilities",
        arguments: {},
      });
      assert.equal(capabilities.isError, undefined);
      assert.equal(capabilities.structuredContent.bridge.read_only, true);
      assert.equal(capabilities.structuredContent.core.write_profile, "read-only");
      const searched = await client.callTool({
        name: "tasken.search_items",
        arguments: { query: "isolated task" },
      });
      assert.equal(searched.isError, undefined);
      assert.ok(searched.structuredContent.items.some(({ id }) => id === taskId));
    }
    assert.deepEqual((await httpClient.listTools()).tools, (await stdioClient.listTools()).tools);
    const discoveryBefore = fs.readFileSync(core.discoveryPath, "utf8");
    await httpClient.close();
    httpClient = undefined;
    await http.stop();
    http = undefined;
    const rotated = randomBytes(32).toString("base64url");
    fs.writeFileSync(credentialsPath, JSON.stringify({ grokbot: { token: rotated } }));
    http = await launchHttp(path.join(outDir, "http-server.mjs"), userDataPath, credentialsPath);
    const denied = await fetch(http.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(denied.status, 401);
    httpClient = await connectHttp(http.url, rotated);
    assert.ok((await httpClient.listTools()).tools.length > 0);
    assert.equal(fs.readFileSync(core.discoveryPath, "utf8"), discoveryBefore);
    assert.ok((await stdioClient.listTools()).tools.length > 0, "HTTP restart leaves stdio usable");
  } finally {
    await httpClient?.close();
    await stdioClient?.close();
    await http?.stop();
    await core?.stop();
    fs.rmSync(bundleDirectory, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
