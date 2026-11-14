import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import { buildMcpBridge } from "../scripts/build-mcp-bridge.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";

// Museの手順書（clients/muse/CONNECTOR.md）の流れを、本物のhelper（clients/muse/tasken.py）と
// 本物のHeadless Core・HTTP bridgeで一続きに通す。helperは試験用のTASKEN_BASE_URLとTASKEN_TEST_TOKENで、
// このテストのbridgeへ書き込みのclient（muse）として入る。記録はすべて架空。

const museDirectory = path.resolve("clients", "muse");

function findPython() {
  // Windowsのpython3はMicrosoft Storeの偽物が答えるので使わない。
  const names = process.platform === "win32" ? ["python"] : ["python3", "python"];
  for (const name of names) {
    const probe = spawnSync(name, ["-I", "-c", "import sys; print(sys.version_info[0])"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (probe.status === 0 && probe.stdout.trim() === "3") return name;
  }
  return null;
}

const python = findPython();

/**
 * bridgeが登録する全ツールの名前（`tasken.`を除く）。capabilityを渡さないと絞り込まずに全部を登録する。
 * main.mcpの公開口（server.mjs）だけを使い、内部の要件表は読まない。
 */
async function bridgeToolNames() {
  const server = createTaskenMcpServer({
    coreClient: {},
    readOnly: false,
    toolsets: ["all", "legacy"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "muse-connector-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    return new Set(tools.map((tool) => tool.name.replace(/^tasken\./, "")));
  } finally {
    await client.close();
    await server.close();
  }
}

test("CONNECTOR.md names only tools that exist", async () => {
  const doc = fs.readFileSync(path.join(museDirectory, "CONNECTOR.md"), "utf8");
  const tools = await bridgeToolNames();
  const called = [...doc.matchAll(/\b(?:T|tasken\.py) call ([A-Za-z0-9_]+)/g)].map(
    (match) => match[1],
  );
  assert.ok(called.length > 0);
  for (const tool of called) {
    assert.ok(tools.has(tool), `CONNECTOR.md calls unknown tool ${tool}`);
  }
  // 表に挙げたツール名（バッククォートで囲んだ小文字のsnake_case）も同じ。
  // 終わりは見出しより後の最初のコード例。前のコード例で切ると範囲が空になり、何も確かめなくなる。
  const heading = doc.indexOf("### Which tool for which moment");
  assert.ok(heading >= 0);
  const table = doc.slice(heading, doc.indexOf("```text", heading));
  const named = [...table.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]);
  assert.ok(named.length >= 10, "the table of tools was not found");
  for (const tool of named) {
    assert.ok(tools.has(tool), `CONNECTOR.md names unknown tool ${tool}`);
  }
});

test(
  "the runbook flow works through the real helper",
  { skip: python ? false : "Pythonが無いので、helperの流れは確かめられない" },
  async () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-muse-"));
    // Bundled native imports resolve through this checkout's node_modules.
    const bundleDirectory = fs.mkdtempSync(path.join(process.cwd(), ".tasken-muse-test-"));
    const userDataPath = path.join(root, "user-data");
    fs.mkdirSync(userDataPath);
    let core;
    let http;
    try {
      const headlessPath = path.join(bundleDirectory, "headless.mjs");
      await build({
        stdin: {
          contents: `export { startTaskenHeadlessCore } from "./src/main/headless/taskenHeadlessCore.ts";`,
          resolveDir: process.cwd(),
        },
        alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
        bundle: true,
        platform: "node",
        format: "esm",
        external: ["better-sqlite3", "pptxgenjs"],
        outfile: headlessPath,
        logLevel: "silent",
      });
      const { startTaskenHeadlessCore } = await import(pathToFileURL(headlessPath).href);
      core = await startTaskenHeadlessCore({ userDataPath, writeMode: "proposals" });
      const outDir = path.join(root, "mcp-dist");
      await buildMcpBridge({ outDir });
      const token = randomBytes(32).toString("base64url");
      const credentialsPath = path.join(root, "http-clients.json");
      fs.writeFileSync(credentialsPath, JSON.stringify({ muse: { token, readOnly: false } }), {
        mode: 0o600,
      });
      const child = spawn(
        process.env.TASKEN_NODE_EXEC_PATH || "node",
        [path.join(outDir, "http-server.mjs")],
        {
          env: {
            ...process.env,
            TASKEN_USER_DATA_DIR: userDataPath,
            TASKEN_MCP_READ_ONLY: "0",
            TASKEN_MCP_HTTP_PORT: "0",
            TASKEN_MCP_HTTP_CLIENTS_FILE: credentialsPath,
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      const exited = new Promise((resolve) => child.once("exit", resolve));
      http = async () => {
        if (child.exitCode === null) child.kill();
        await exited;
      };
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("HTTP bridge readiness timed out")), 15_000);
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
          const match = /listening on 127\.0\.0\.1:(\d+)/.exec(stderr);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("HTTP bridge exited before ready"));
        });
      });

      // helperの標準出力は、端末の既定の文字コードに依らずUTF-8で受ける。
      const env = {
        ...process.env,
        TASKEN_BASE_URL: `http://127.0.0.1:${port}`,
        TASKEN_TEST_TOKEN: token,
        PYTHONIOENCODING: "utf-8",
      };
      // 非同期で動かす: Coreはこのテストと同じプロセスにいるので、同期で待つとCoreが答えられない。
      const run = (...args) =>
        new Promise((resolve, reject) => {
          const child = spawn(python, [path.join(museDirectory, "tasken.py"), ...args], {
            env,
            windowsHide: true,
          });
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
          child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
          child.once("error", reject);
          child.once("close", (code) => {
            try {
              resolve({ code, out: JSON.parse(stdout) });
            } catch {
              reject(
                Error(`${args.join(" ")} printed no JSON (exit ${code}): ${stdout} ${stderr}`),
              );
            }
          });
        });
      const ok = async (...args) => {
        const { code, out } = await run(...args);
        assert.equal(code, 0, `${args.join(" ")}: ${JSON.stringify(out)}`);
        return out;
      };

      // 接続の確かめ: 一覧とhash。書き込みのclientには書き込みのツールも出る。
      const described = await ok("describe");
      assert.match(described.hash, /^[0-9a-f]{64}$/);
      const names = described.tools.map(({ name }) => name);
      assert.ok(names.includes("search_items") && names.includes("propose_feed_post"));
      const one = await ok("describe", "propose_feed_post");
      assert.equal(one.hash, described.hash);
      assert.ok(one.inputSchema.properties.idempotency_key);
      assert.equal((await run("describe", "no_such_tool")).code, 1);

      await ok("call", "search_items", '{"query":"架空の実験"}');

      // 書く: 鍵は道具が決めて出力に入れる。
      const body = '{"topic":"insight","body":["架空の確かめ: 手順書の流れを通す。"]}';
      const first = await ok("call", "propose_feed_post", body);
      assert.ok(first.idempotency_key);
      assert.ok(first.proposal_id);
      // 応答が切れた想定で、同じ鍵・同じ内容で送り直すと同じProposal ID。
      const again = await ok("call", "propose_feed_post", body, "--key", first.idempotency_key);
      assert.equal(again.proposal_id, first.proposal_id);
      assert.equal(again.idempotency_key, first.idempotency_key);
      // 新しい鍵なら別のProposal（鍵が重複の防ぎ手であることの確かめ）。
      assert.notEqual((await ok("call", "propose_feed_post", body)).proposal_id, first.proposal_id);
      // 本文の鍵と--keyが食い違うと、送らずに失敗する。
      const clash = await run(
        "call",
        "propose_feed_post",
        JSON.stringify({ ...JSON.parse(body), idempotency_key: "a" }),
        "--key",
        "b",
      );
      assert.equal(clash.code, 1);
      assert.equal(clash.out.http_status, undefined);

      // 保存せずに検証。dry_runの無いツールでは断る。
      const dry = await ok(
        "call",
        "propose_feed_post",
        body,
        "--key",
        first.idempotency_key,
        "--dry-run",
      );
      assert.equal(dry.proposal_id, first.proposal_id);
      const noDryRun = await run("call", "search_items", "{}", "--dry-run");
      assert.equal(noDryRun.code, 1);

      const status = await ok(
        "call",
        "get_proposal_status",
        JSON.stringify({ proposal_id: first.proposal_id }),
      );
      assert.equal(status.idempotency_key, undefined, "a read has no key");

      // 未知の引数は400で、書き込みなので鍵が付く。
      const unknown = await run(
        "call",
        "propose_feed_post",
        '{"topic":"insight","body":["x"],"idempotencyKey":"x"}',
      );
      assert.equal(unknown.code, 1);
      assert.equal(unknown.out.http_status, 400);
      assert.equal(unknown.out.error, "unknown_arguments");
      assert.ok(unknown.out.idempotency_key);
    } finally {
      await http?.();
      await core?.stop();
      fs.rmSync(bundleDirectory, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "the credential is matched against the host name without the port (#720)",
  { skip: python ? false : "Pythonが無いので確かめられない" },
  () => {
    // Museの照合（dynamic_credentials.ensure_allowed_url）は、URLのhostname（ポート無し）とallowed_hostsを
    // そのまま比べる。ポート付きのhostをそのまま渡すと、どの要求も断られる。
    const script = [
      "import sys, urllib.parse",
      "sys.path.insert(0, sys.argv[1])",
      "import tasken",
      "url = urllib.parse.urlsplit('https://' + tasken.host() + '/api/v1')",
      "print(tasken.credential_host() == url.hostname, tasken.credential_host())",
    ].join("\n");
    for (const [host, expected] of [
      ["nas.example.ts.net:8444", "nas.example.ts.net"],
      ["nas.example.ts.net", "nas.example.ts.net"],
    ]) {
      const result = spawnSync(python, ["-c", script, museDirectory], {
        env: { ...process.env, TASKEN_HOST: host },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), `True ${expected}`);
    }
  },
);
