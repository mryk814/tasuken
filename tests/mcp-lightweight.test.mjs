import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";
import { TASKEN_MCP_REQUIRED_CORE_CAPABILITIES } from "../src/main/mcp/taskenCoreClient.mjs";
import { TASKEN_CORE_WRITE_CAPABILITIES } from "../src/shared/contracts/core/public.mjs";

const capabilities = [
  ...new Set([...TASKEN_MCP_REQUIRED_CORE_CAPABILITIES, ...TASKEN_CORE_WRITE_CAPABILITIES]),
];
const coreNames = [
  "search_items",
  "list_open_items",
  "get_task_context",
  "get_note",
  "search_notes",
  "get_activity",
].map((name) => `tasken.${name}`);

async function connect(t, options = {}) {
  const server = createTaskenMcpServer({
    env: {},
    coreClient: { status: async () => ({ capabilities }) },
    ...options,
  });
  const client = new Client({ name: "lightweight-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(a);
  await client.connect(b);
  return client;
}

test("discovery budgets: default read=16, write=24, core=6; legacy aliases require opt-in", async (t) => {
  for (const [label, options, count, budget] of [
    ["read-only", { readOnly: true }, 16, 11000],
    ["all", { readOnly: false }, 24, 30000],
    ["core", { readOnly: true, env: { TASKEN_MCP_TOOLSETS: "core" } }, 6, 6000],
    ["legacy", { readOnly: false, toolsets: ["all", "legacy"] }, 27, 45000],
  ]) {
    const client = await connect(t, options);
    const { tools } = await client.listTools();
    const chars = JSON.stringify(tools).length;
    t.diagnostic(
      `${label}: tools=${tools.length}, tools JSON=${chars}, instructions=${client.getInstructions().length}`,
    );
    assert.equal(tools.length, count);
    assert.ok(chars <= budget, `${label}: ${chars} > ${budget}`);
    assert.ok(client.getInstructions().length <= 800);
    for (const tool of tools)
      assert.ok(tool.description.length <= 200, `${tool.name}: ${tool.description.length}`);
    if (label === "core")
      assert.deepEqual(tools.map(({ name }) => name).sort(), coreNames.toSorted());
  }
});

test("toolsets filter without capabilities, report reasons and never override read-only", async (t) => {
  const client = await connect(t, {
    readOnly: true,
    toolsets: ["core", "meta", "write", "legacy"],
  });
  assert.equal((await client.listTools()).tools.length, 7);
  const result = await client.callTool({ name: "tasken.get_capabilities", arguments: {} });
  const excluded = result.structuredContent.tools.find(
    ({ name }) => name === "tasken.get_repository_context",
  );
  assert.equal(excluded.reason, "toolset_not_enabled");
  assert.equal(excluded.listed, false);
  const writer = result.structuredContent.tools.find(({ name }) => name === "tasken.report_work");
  assert.equal(writer.reason, "bridge_read_only");
  assert.equal(writer.listed, false);
  assert.equal(
    (await client.callTool({ name: "tasken.get_repository_context", arguments: {} })).isError,
    true,
  );
  const core = await connect(t, { readOnly: false, toolsets: "core" });
  assert.equal((await core.listTools()).tools.length, 6);
  const capped = await connect(t, { capabilities: [], readOnly: false, toolsets: "all" });
  assert.equal((await capped.listTools()).tools.length, 16);
  const meta = await connect(t, { readOnly: false, toolsets: "core,meta" });
  assert.equal(
    (await meta.callTool({ name: "tasken.get_capabilities", arguments: {} })).structuredContent
      .writes.task_work_report,
    false,
  );
});

test("toolset parsing rejects invalid input instead of silently publishing all tools", async (t) => {
  const client = await connect(t, { toolsets: "core, meta,core" });
  assert.deepEqual(
    (await client.callTool({ name: "tasken.get_capabilities", arguments: {} })).structuredContent
      .bridge.toolsets,
    ["core", "meta"],
  );
  for (const value of ["", "unknown", [], ["core", "nope"], null, 1, ["core", 1]]) {
    assert.throws(
      () => createTaskenMcpServer({ env: {}, toolsets: value }),
      /MCP_TOOLSETS_INVALID/,
    );
  }
});

test("report_work produces exactly the old normalized Core request for each status", async (t) => {
  const requests = [];
  const client = await connect(t, {
    readOnly: false,
    toolsets: "all,legacy",
    coreClient: {
      proposeTaskWork: async (args) => {
        requests.push(args);
        return { status: "queued" };
      },
    },
  });
  for (const [status, alias, action] of [
    ["progress", "append_work_receipt", "append_receipt"],
    ["done", "report_task_done", "report_done"],
    ["blocked", "report_task_blocked", "report_blocked"],
  ]) {
    const args = {
      task_id: randomUUID(),
      expected_version: 2,
      idempotency_key: `same-${status}`,
      caller: "test",
      executor_label: "Codex",
      work_attempt_id: randomUUID(),
      report_sequence: 3,
      reported_at: "2026-10-28T00:00:00.000Z",
      completed_checklist_item_ids: ["checked-1"],
      dry_run: true,
      ...(status === "blocked"
        ? { blocker: "Need input", request_id: randomUUID(), needed_input: ["answer"] }
        : { summary: "Verified", executor_kind: "ai_agent", verification: ["test passed"] }),
    };
    assert.equal(
      (await client.callTool({ name: `tasken.${alias}`, arguments: args })).isError,
      undefined,
    );
    assert.equal(
      (await client.callTool({ name: "tasken.report_work", arguments: { ...args, status } }))
        .isError,
      undefined,
    );
    assert.deepEqual(requests.at(-1), requests.at(-2));
    assert.equal(requests.at(-1).action, action);
    assert.equal("status" in requests.at(-1), false);
  }
});

test("compact schemas retain meaning while SDK validation still returns field paths and messages", async (t) => {
  let writes = 0;
  const client = await connect(t, {
    readOnly: false,
    coreClient: {
      proposeTaskWork: async () => {
        writes++;
        return {};
      },
    },
  });
  const { tools } = await client.listTools();
  const report = tools.find(({ name }) => name === "tasken.report_work");
  assert.deepEqual(report.inputSchema.properties.status.enum, ["progress", "done", "blocked"]);
  assert.equal(report.inputSchema.properties.work_attempt_id.format, "uuid");
  assert.equal(report.inputSchema.properties.expected_version.minimum, undefined);
  assert.ok(report.inputSchema.required.includes("status"));
  const base = {
    status: "done",
    task_id: randomUUID(),
    expected_version: 2,
    idempotency_key: "key",
    caller: "test",
    executor_label: "Codex",
    summary: "ok",
    executor_kind: "ai_agent",
  };
  for (const [patch, field] of [
    [{ expected_version: -1 }, "expected_version"],
    [{ expected_version: 1.5 }, "expected_version"],
    [{ idempotency_key: "x".repeat(201) }, "idempotency_key"],
    [{ work_attempt_id: "bad" }, "work_attempt_id"],
    [{ summary: undefined }, "summary"],
    [{ executor_kind: undefined }, "executor_kind"],
    [{ status: "blocked" }, "blocker"],
    [{ status: "invalid" }, "status"],
  ]) {
    const result = await client.callTool({
      name: "tasken.report_work",
      arguments: { ...base, ...patch },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(field));
    assert.match(result.content[0].text, /Input validation error/);
  }
  assert.equal(writes, 0);
  const feed = tools.find(({ name }) => name === "tasken.propose_feed_post");
  assert.equal(feed.inputSchema.properties.media.anyOf[0].properties.kind.const, "artifact");
  assert.equal(feed.inputSchema.properties.media.anyOf[0].additionalProperties, undefined);
});

test("detailed guides remain available without adding discovery tools, including in core-only mode", async (t) => {
  const client = await connect(t, { readOnly: true, toolsets: "core" });
  const { resources } = await client.listResources();
  for (const topic of ["feed_post", "note_article", "work_report", "proposals"]) {
    const uri = `tasken://guide/${topic}`;
    assert.ok(resources.some((resource) => resource.uri === uri));
    const result = await client.readResource({ uri });
    assert.ok(result.contents[0].text.length > 200);
  }
});
