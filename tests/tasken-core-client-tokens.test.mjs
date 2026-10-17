import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { build } from "esbuild";

import {
  TASKEN_CORE_CLIENTS_FILE,
  issueCoreClientToken,
  listCoreClients,
  revokeCoreClientToken,
} from "../src/main/infrastructure/http/coreClientTokens.mjs";

const compiled = await build({
  stdin: {
    contents: 'export { TaskenCoreHost } from "./src/main/infrastructure/http/taskenCoreHost.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { TaskenCoreHost } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

const run = promisify(execFile);

async function temporaryUserData(t) {
  const base = await fs.realpath(os.tmpdir());
  const userDataPath = await fs.mkdtemp(path.join(base, "tasken-core-client-tokens-test-"));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  return userDataPath;
}

async function withHost(t, run) {
  const userDataPath = await temporaryUserData(t);
  const calls = [];
  const record = (name, value) => ({
    execute: (request) => {
      calls.push(name);
      return value(request);
    },
  });
  const host = new TaskenCoreHost({
    userDataPath,
    listAgentReadyTasks: record("list_agent_ready_tasks", () => ({ tasks: [] })),
    searchItems: record("search_items", () => ({ items: [{ id: "fictional-task" }] })),
    getRecentNotes: record("get_recent_notes", () => ({ notes: [{ id: "fictional-note" }] })),
    taskCommand: record("task_command", () => ({ ok: true })),
    listProposals: record("list_proposals", () => ({ proposals: [] })),
    proposeContent: record("propose_content", () => ({ proposal_id: "fictional" })),
  });
  const { origin } = await host.start();
  t.after(() => host.stop());
  const discovery = JSON.parse(
    await fs.readFile(path.join(userDataPath, "tasken-core.json"), "utf8"),
  );
  const call = (token, route, body = {}) =>
    fetch(`${origin}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  await run({ host, userDataPath, origin, discovery, calls, call });
}

test("a read-only client token reaches only read query routes", async (t) => {
  await withHost(t, async ({ userDataPath, calls, call }) => {
    // Issued after Core started: the registry is consulted per request.
    const { token } = await issueCoreClientToken(userDataPath, "awai");
    assert.match(token, /^tkr_[A-Za-z0-9_-]{43}$/);

    const items = await call(token, "/v1/queries/search-items", { query: "架空" });
    assert.equal(items.status, 200);
    assert.deepEqual((await items.json()).items, [{ id: "fictional-task" }]);
    const notes = await call(token, "/v1/queries/get-recent-notes", { query: "架空" });
    assert.equal(notes.status, 200);

    for (const route of [
      "/v1/commands/propose-content",
      "/v1/task/command",
      "/v1/queries/list-proposals",
    ]) {
      const denied = await call(token, route, {});
      assert.equal(denied.status, 403, route);
      assert.equal((await denied.json()).error.code, "READ_ONLY_CLIENT", route);
    }
    assert.deepEqual(calls, ["search_items", "get_recent_notes"]);
  });
});

test("the full Core token and the discovery document are unchanged", async (t) => {
  await withHost(t, async ({ userDataPath, discovery, calls, call }) => {
    await issueCoreClientToken(userDataPath, "awai");
    assert.deepEqual(Object.keys(discovery).sort(), [
      "api_version",
      "capabilities",
      "origin",
      "pid",
      "schema_version",
      "started_at",
      "token",
    ]);
    assert.match(discovery.token, /^[A-Za-z0-9_-]{43}$/);
    const listed = await call(discovery.token, "/v1/queries/list-proposals", {});
    assert.equal(listed.status, 200);
    assert.deepEqual(calls, ["list_proposals"]);
  });
});

test("wrong and revoked client tokens are refused at once", async (t) => {
  await withHost(t, async ({ userDataPath, call }) => {
    const { token } = await issueCoreClientToken(userDataPath, "awai");
    assert.equal((await call(`${token}x`, "/v1/queries/search-items", {})).status, 401);
    assert.equal((await call("tkr_" + "A".repeat(43), "/v1/queries/search-items", {})).status, 401);
    assert.equal((await call(token, "/v1/queries/search-items", {})).status, 200);

    await revokeCoreClientToken(userDataPath, "awai");
    assert.equal((await call(token, "/v1/queries/search-items", {})).status, 401);
  });
});

test("Core publishes a token-free endpoint file for read-only clients", async (t) => {
  await withHost(t, async ({ host, userDataPath, origin }) => {
    const endpointPath = path.join(userDataPath, "tasken-core-endpoint.json");
    const endpoint = JSON.parse(await fs.readFile(endpointPath, "utf8"));
    assert.equal(endpoint.origin, origin);
    assert.equal(endpoint.api_version, "1");
    assert.equal(endpoint.pid, process.pid);
    assert.equal("token" in endpoint, false);
    assert.doesNotMatch(await fs.readFile(endpointPath, "utf8"), /token/);

    await host.stop();
    await assert.rejects(fs.access(endpointPath));
  });
});

test("the client registry keeps only token hashes and one active token per name", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const { token } = await issueCoreClientToken(userDataPath, "awai");
  const stored = await fs.readFile(path.join(userDataPath, TASKEN_CORE_CLIENTS_FILE), "utf8");
  assert.equal(stored.includes(token), false);
  assert.equal(stored.includes(token.slice(4)), false);

  await assert.rejects(issueCoreClientToken(userDataPath, "awai"), /awai/);
  await assert.rejects(issueCoreClientToken(userDataPath, "Bad Name"), /name/);
  await assert.rejects(revokeCoreClientToken(userDataPath, "missing"), /missing/);

  const listed = await listCoreClients(userDataPath);
  assert.deepEqual(
    listed.map(({ name, scope, revoked_at }) => ({ name, scope, revoked_at })),
    [{ name: "awai", scope: "read", revoked_at: null }],
  );
  assert.equal(JSON.stringify(listed).includes("sha256"), false);

  await revokeCoreClientToken(userDataPath, "awai");
  const reissued = await issueCoreClientToken(userDataPath, "awai");
  assert.notEqual(reissued.token, token);
});

test("the CLI prints a new token only on stdout and never lists secrets", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const env = { ...process.env, TASKEN_USER_DATA_DIR: userDataPath };
  const cli = path.join("scripts", "tasken-core-client.mjs");

  const issued = await run(process.execPath, [cli, "issue", "awai"], { env });
  assert.match(issued.stdout, /^tkr_[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.stderr.includes(issued.stdout), false);

  const listed = await run(process.execPath, [cli, "list"], { env });
  assert.match(listed.stdout, /awai/);
  assert.equal(listed.stdout.includes(issued.stdout), false);

  await run(process.execPath, [cli, "revoke", "awai"], { env });
  const [client] = await listCoreClients(userDataPath);
  assert.notEqual(client.revoked_at, null);
});
