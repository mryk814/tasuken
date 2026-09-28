import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { build } from "esbuild";

import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";

const workspaceRepositoryModule = "../src/main/repositories/" + "workspaceRepository.mjs";
const { WorkspaceDatabase } = await import(workspaceRepositoryModule);

const bundledCore = await build({
  stdin: {
    contents: `
      export { TaskenCoreHost } from "./src/main/infrastructure/http/taskenCoreHost.ts";
      export { createTaskenCore } from "./src/main/infrastructure/sqlite/public.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { TaskenCoreHost, createTaskenCore } = await import(
  `data:text/javascript;base64,${Buffer.from(bundledCore.outputFiles[0].text).toString("base64")}`
);

async function withMcp(run) {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-mcp-dry-run-"));
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  database.bootstrap({
    themes: [{ id: "theme-dry", name: "Dry run", code: "DR" }],
    tasks: [{ id: "task-dry", title: "Dry run task", state: "todo", project_id: "theme-dry" }],
    notes: [
      { id: "note-dry", title: "Dry run note", body_markdown: "本文。", project_id: "theme-dry" },
    ],
  });
  const host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(database) });
  await host.start();
  const coreClient = new TaskenCoreClient({ discoveryPath: path.join(root, "tasken-core.json") });
  const server = createTaskenMcpServer({
    coreClient,
    readOnly: false,
    capabilities: (await coreClient.status()).capabilities,
  });
  const client = new Client({ name: "tasken-dry-run-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await run({ client, database });
  } finally {
    await client.close();
    await server.close();
    await host.stop();
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("dry_run validates proposals without saving them and reports version drift", async () => {
  await withMcp(async ({ client, database }) => {
    const taskVersion = database.get("task", "task-dry").version;
    const report = {
      task_id: "task-dry",
      expected_version: taskVersion + 1,
      idempotency_key: "dry-run-report",
      caller: "dry run test",
      source_app: "dry-run-test",
      executor_kind: "ai_agent",
      executor_label: "dry run test",
      summary: "検証だけを行う。",
    };
    const preview = await client.callTool({
      name: "tasken.report_task_done",
      arguments: { ...report, dry_run: true },
    });
    assert.equal(preview.isError, undefined, JSON.stringify(preview));
    assert.equal(preview.structuredContent.status, "validated");
    assert.equal(preview.structuredContent.dry_run, true);
    assert.equal(preview.structuredContent.would_status, "queued");
    assert.deepEqual(
      preview.structuredContent.checks.map(({ code, ok }) => ({ code, ok })),
      [
        { code: "task_found", ok: true },
        { code: "expected_version_current", ok: false },
      ],
    );
    assert.equal(database.list("ai_proposal").length, 0, "dry_runは保存しない");

    // 本送信は同じkeyで同じProposal IDになり、その後のdry_runは重複と見積もる。
    const sent = await client.callTool({
      name: "tasken.report_task_done",
      arguments: { ...report, expected_version: taskVersion },
    });
    assert.equal(sent.structuredContent.status, "queued");
    assert.equal(sent.structuredContent.proposal_id, preview.structuredContent.proposal_id);
    const again = await client.callTool({
      name: "tasken.report_task_done",
      arguments: { ...report, expected_version: taskVersion, dry_run: true },
    });
    assert.equal(again.structuredContent.would_status, "duplicate");
    assert.equal(database.list("ai_proposal").length, 1);

    const noteVersion = database.get("note", "note-dry").version;
    const edit = await client.callTool({
      name: "tasken.propose_note_edit",
      arguments: {
        idempotency_key: "dry-run-edit",
        caller: "dry run test",
        note_id: "note-dry",
        base_version: noteVersion,
        title: "Dry run note",
        body: "書き換え案。",
        reason: "確認",
        dry_run: true,
      },
    });
    assert.equal(edit.structuredContent.status, "validated");
    assert.deepEqual(
      edit.structuredContent.checks.map(({ code, ok }) => ({ code, ok })),
      [
        { code: "note_found", ok: true },
        { code: "base_version_current", ok: true },
      ],
    );
    const feed = await client.callTool({
      name: "tasken.propose_feed_post",
      arguments: { topic: "insight", body: ["保存しない投稿。"], dry_run: true },
    });
    assert.equal(feed.structuredContent.status, "validated");
    assert.equal(database.list("ai_proposal").length, 1, "dry_runの読み物もFeedへ出さない");
  });
});

test("list_proposals recovers Proposal IDs by sender without returning payload bodies", async () => {
  await withMcp(async ({ client }) => {
    const sent = [];
    for (const [session, title] of [
      ["session-a", "BODY_SECRET_A"],
      ["session-b", "BODY_SECRET_B"],
    ]) {
      const result = await client.callTool({
        name: "tasken.propose_note",
        arguments: {
          idempotency_key: `list-${session}`,
          caller: "list test",
          source_session: session,
          title,
          body: `${title}の本文。`,
        },
      });
      sent.push(result.structuredContent.proposal_id);
    }
    const mine = await client.callTool({
      name: "tasken.list_proposals",
      arguments: { source_session: "session-a", status: "pending" },
    });
    assert.equal(mine.isError, undefined, JSON.stringify(mine));
    assert.deepEqual(
      mine.structuredContent.proposals.map((proposal) => proposal.proposal_id),
      [sent[0]],
    );
    assert.equal(mine.structuredContent.proposals[0].awaiting_review, true);
    assert.equal(mine.structuredContent.proposals[0].tool, "tasken.propose_note");
    assert.equal(mine.structuredContent.view.delivery_confirmed, false);
    assert.doesNotMatch(JSON.stringify(mine.structuredContent), /BODY_SECRET/);

    const all = await client.callTool({ name: "tasken.list_proposals", arguments: { limit: 1 } });
    assert.deepEqual(all.structuredContent.result_meta, {
      returned_count: 1,
      matched_count: 2,
      truncated: true,
    });
  });
});

test("tool results that carry an error are always marked isError", async () => {
  await withMcp(async ({ client }) => {
    const missing = await client.callTool({
      name: "tasken.get_note",
      arguments: { note_id: "note-missing" },
    });
    assert.equal(missing.isError, true);
    assert.equal(missing.structuredContent.error.code, "not_found");
    assert.equal(missing.structuredContent.next_tools[0].tool, "tasken.search_notes");
  });
});
