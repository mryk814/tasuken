import { nodeExecPath } from "./helpers/childProcessNode.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { build } from "esbuild";

import { markdownSignature } from "../src/shared/canonicalMarkdown.mjs";
import {
  TASKEN_MCP_REQUIRED_CORE_CAPABILITIES,
  TaskenCoreClient,
  TaskenCoreClientError,
} from "../src/main/mcp/taskenCoreClient.mjs";
import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";
import { TASKEN_CORE_WRITE_CAPABILITIES } from "../src/shared/contracts/core/public.mjs";
import { issueCoreClientToken } from "../src/main/infrastructure/http/coreClientTokens.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  SharedFolderSyncService,
  SYNC_PACKET_FILE_PATTERN,
} from "../src/main/services/sharedFolderSync.mjs";

const bundleDirectory = fs.mkdtempSync(path.join(process.cwd(), ".tasken-headless-core-test-"));
after(() => fs.rmSync(bundleDirectory, { recursive: true, force: true }));

async function bundleEntry(relativePath, fileName) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["better-sqlite3", "pptxgenjs"],
    write: false,
    logLevel: "silent",
  });
  const bundlePath = path.join(bundleDirectory, fileName);
  fs.writeFileSync(bundlePath, result.outputFiles[0].text);
  return import(pathToFileURL(bundlePath).href);
}

const { startTaskenHeadlessCore, TaskenHeadlessCoreError } = await bundleEntry(
  "src/main/headless/taskenHeadlessCore.ts",
  "taskenHeadlessCore.mjs",
);

/** Headless Coreが既定で公開しない書き込みcapability（汎用のtask.commandはどの配備も出さない）。 */
const WRITE_CORE_CAPABILITIES = ["task.command", ...TASKEN_CORE_WRITE_CAPABILITIES];
const { parseTaskenHeadlessCoreArgs } = await bundleEntry(
  "src/main/headless/main.ts",
  "headlessMain.mjs",
);
/** Desktop役の採用経路。replicaが作ったProposalを人が採用する側を再現する。 */
const { ApplicationCommandService } = await bundleEntry(
  "src/main/services/applicationCommandService.ts",
  "applicationCommandService.mjs",
);

/** Desktop役の採用経路（Note編集案の版照合と本文の反映）。 */
const { AiProposalAcceptanceService } = await bundleEntry(
  "src/main/services/aiProposalAcceptanceService.ts",
  "aiProposalAcceptanceService.mjs",
);
const { WorkspaceService } = await bundleEntry(
  "src/main/services/workspaceService.ts",
  "workspaceService.mjs",
);
/** Desktop役が、NASのAIの直接変更をActivityから取り消す経路。 */
const { createAiTaskChangeService } = await bundleEntry(
  "src/main/composition/aiTaskChangePort.ts",
  "aiTaskChangePort.mjs",
);
/** Desktop役がFeedの返信を読む経路。 */
const { FeedContextQueryService } = await bundleEntry(
  "src/main/core/services/feedContextQueryService.ts",
  "feedContextQueryService.mjs",
);
const { WorkspaceFeedContextReadAdapter } = await bundleEntry(
  "src/main/infrastructure/sqlite/workspaceFeedContextReadAdapter.ts",
  "workspaceFeedContextReadAdapter.mjs",
);

function temporaryUserData() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-headless-core-test-"));
}

function bootstrapWorkspace(database) {
  database.bootstrap({
    themes: [{ id: "theme-headless", name: "Headless Theme", code: "HL" }],
    tasks: [
      {
        id: "task-headless",
        title: "Headless context read",
        description: "Read through the headless Core over loopback MCP.",
        state: "todo",
        // Desktopが保存する形に合わせてcanonicalなTheme IDと優先度を持たせる（採用・直接変更の検証を通す）。
        priority: "normal",
        project_id: "theme-headless",
      },
    ],
  });
}

function seedWorkspace(userDataPath) {
  const database = new WorkspaceDatabase(path.join(userDataPath, "research-desk.sqlite"));
  try {
    bootstrapWorkspace(database);
  } finally {
    database.db.close();
  }
}

async function connectMcp(userDataPath, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: nodeExecPath,
    args: ["scripts/mcp-server.mjs"],
    env: { ...process.env, TASKEN_USER_DATA_DIR: userDataPath, ...extraEnv },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-headless-core-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

test("Headless Core serves MCP reads without Electron and stops cleanly", async (t) => {
  const userDataPath = temporaryUserData();
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  seedWorkspace(userDataPath);
  const handle = await startTaskenHeadlessCore({ userDataPath });
  let client;
  try {
    assert.match(handle.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(handle.writeMode, "read-only", "既定では書き込みを公開しない");
    assert.equal(fs.existsSync(handle.discoveryPath), true);
    const inspected = await new TaskenCoreClient({ userDataPath }).inspect();
    assert.equal(inspected.status, "ok");
    const readCapabilities = TASKEN_MCP_REQUIRED_CORE_CAPABILITIES.filter(
      (capability) => !WRITE_CORE_CAPABILITIES.includes(capability),
    );
    for (const capability of readCapabilities) {
      assert.ok(inspected.capabilities.includes(capability), capability);
    }
    for (const capability of WRITE_CORE_CAPABILITIES) {
      assert.equal(
        inspected.capabilities.includes(capability),
        false,
        `既定のHeadless Coreは${capability}を公開しない`,
      );
    }

    client = await connectMcp(userDataPath);
    const listed = await client.listTools();
    // 書き込みを公開しないCoreでは、bridgeがwrite可能でも使えない書き込みtoolを並べない。
    assert.equal(listed.tools.length, 16);
    assert.equal(
      listed.tools.some((tool) => /(propose|report|append|start|answer)_/u.test(tool.name)),
      false,
    );
    const searched = await client.callTool({
      name: "tasken.search_items",
      arguments: { query: "Headless context" },
    });
    assert.equal(searched.isError, undefined, JSON.stringify(searched));
    assert.ok(
      searched.structuredContent.items.some((item) => item.id === "task-headless"),
      JSON.stringify(searched.structuredContent),
    );
  } finally {
    await client?.close().catch(() => {});
    await handle.stop();
  }
  assert.equal(fs.existsSync(handle.discoveryPath), false);
  await assert.rejects(
    () => new TaskenCoreClient({ userDataPath }).inspect(),
    (error) => error instanceof TaskenCoreClientError && error.code === "CORE_UNAVAILABLE",
  );
});

test("Headless Core refuses a second writer on the same userData", async (t) => {
  const userDataPath = temporaryUserData();
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const handle = await startTaskenHeadlessCore({ userDataPath });
  try {
    await assert.rejects(
      () => startTaskenHeadlessCore({ userDataPath }),
      (error) => error instanceof TaskenHeadlessCoreError && error.code === "CORE_ALREADY_RUNNING",
    );
  } finally {
    await handle.stop();
  }
  const restarted = await startTaskenHeadlessCore({ userDataPath });
  await restarted.stop();
});

test("Headless replica joins a shared-folder sync and serves read-only MCP reads", async (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-headless-replica-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = path.join(root, "shared");
  const hostUserData = path.join(root, "host");
  const replicaUserData = path.join(root, "replica");
  fs.mkdirSync(shared, { recursive: true });
  const host = new WorkspaceDatabase(path.join(hostUserData, "research-desk.sqlite"));
  const hostSync = new SharedFolderSyncService(
    host,
    () => {},
    path.join(hostUserData, "attachments", "markdown-images"),
    path.join(hostUserData, "attachments", "capture-images"),
  );
  let client;
  try {
    bootstrapWorkspace(host);
    await hostSync.configure(shared);

    const handle = await startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
    });
    try {
      assert.equal(handle.syncDirectory, shared);

      client = await connectMcp(replicaUserData, { TASKEN_MCP_READ_ONLY: "1" });
      const listed = await client.listTools();
      assert.ok(listed.tools.length < 22, String(listed.tools.length));
      for (const writeTool of [
        "tasken.start_task_work",
        "tasken.report_work",
        "tasken.propose_note",
        "tasken.propose_feed_post",
        "tasken.answer_feed_question",
      ]) {
        assert.equal(
          listed.tools.some((tool) => tool.name === writeTool),
          false,
          writeTool,
        );
      }
      const bootstrapped = await client.callTool({
        name: "tasken.search_items",
        arguments: { query: "Headless context" },
      });
      assert.ok(
        bootstrapped.structuredContent.items.some((item) => item.id === "task-headless"),
        JSON.stringify(bootstrapped.structuredContent),
      );

      host.save("task", {
        id: "task-replica-b",
        title: "Replica shared task B",
        state: "todo",
        priority: "normal",
      });
      await hostSync.syncNow();
      await handle.syncNow();
      const later = await client.callTool({
        name: "tasken.search_items",
        arguments: { query: "Replica shared task B" },
      });
      assert.ok(
        later.structuredContent.items.some((item) => item.id === "task-replica-b"),
        JSON.stringify(later.structuredContent),
      );
    } finally {
      await client?.close().catch(() => {});
      client = undefined;
      await handle.stop();
    }

    const before = new WorkspaceDatabase(path.join(replicaUserData, "research-desk.sqlite"));
    const identity = {
      workspaceId: before.workspaceId,
      deviceId: before.deviceId,
      hasLaterTask: Boolean(before.get("task", "task-replica-b")),
      pending: before.syncPendingCount(),
      conflicts: before.listSyncConflicts().length,
    };
    before.db.close();
    assert.equal(identity.workspaceId, host.workspaceId);
    assert.equal(identity.hasLaterTask, true);
    assert.equal(identity.pending, 0);
    assert.equal(identity.conflicts, 0);

    const restarted = await startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
    });
    await restarted.stop();
    const after = new WorkspaceDatabase(path.join(replicaUserData, "research-desk.sqlite"));
    assert.equal(after.workspaceId, identity.workspaceId);
    assert.equal(after.deviceId, identity.deviceId);
    assert.equal(Boolean(after.get("task", "task-replica-b")), true);
    after.db.close();
  } finally {
    await hostSync.stop();
    if (host.db.open) host.db.close();
  }
});

test("Headless replicaが受けたProposalはDesktopへ届き、採否はreplicaへ戻る", async (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-headless-write-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = path.join(root, "shared");
  const hostUserData = path.join(root, "host");
  const replicaUserData = path.join(root, "replica");
  fs.mkdirSync(shared, { recursive: true });
  const host = new WorkspaceDatabase(path.join(hostUserData, "research-desk.sqlite"));
  const hostSync = new SharedFolderSyncService(
    host,
    () => {},
    path.join(hostUserData, "attachments", "markdown-images"),
    path.join(hostUserData, "attachments", "capture-images"),
  );
  const body = ["NASで受けた投稿がDesktopへ届くかを確かめる。"];
  let client;
  let proposalId;
  try {
    bootstrapWorkspace(host);
    await hostSync.configure(shared);
    const handle = await startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
      writeMode: "proposals",
    });
    try {
      // replicaのCoreへ書き込む。MCP bridgeのread-only指定を付けない場合の経路。
      client = await connectMcp(replicaUserData);
      const inspected = await new TaskenCoreClient({ userDataPath: replicaUserData }).inspect();
      for (const capability of [
        "propose_content",
        "propose_repository_task",
        "propose_task_work",
      ]) {
        assert.ok(inspected.capabilities.includes(capability), capability);
      }
      for (const capability of ["task.command", "propose_agent_session"]) {
        assert.equal(inspected.capabilities.includes(capability), false, capability);
      }
      const queued = await client.callTool({
        name: "tasken.propose_feed_post",
        arguments: {
          idempotency_key: "replica-proposal-roundtrip",
          caller: "NAS replica test",
          source_app: "nas-replica",
          topic: "insight",
          body,
        },
      });
      assert.equal(queued.isError, undefined, JSON.stringify(queued));
      proposalId = String(queued.structuredContent.proposal_id);
      assert.equal(queued.structuredContent.payload_type, "feed_posts");
      // 受領はreplicaに残り、Desktopへはまだ届いていない。
      assert.equal(host.get("ai_proposal", proposalId), null);

      await handle.syncNow();
      await hostSync.syncNow();
      const received = host.get("ai_proposal", proposalId);
      assert.ok(received, "DesktopがreplicaのProposalを受け取る");
      assert.equal(received.status, "pending");
      assert.equal(received.source, "mcp");
      assert.deepEqual(received.payload.feed_posts[0].body, body);
      assert.equal(host.listSyncConflicts().length, 0, JSON.stringify(host.listSyncConflicts()));

      // 人がDesktopで採用すると、その状態が新しい差分としてreplicaへ戻る。
      host.save("ai_proposal", { ...received, status: "accepted" });
      await hostSync.syncNow();
      await handle.syncNow();
      assert.equal(host.listSyncConflicts().length, 0, JSON.stringify(host.listSyncConflicts()));

      // replicaは自分の同期状態を答えられる。受信後に未公開差分は残らない。
      const status = await client.callTool({
        name: "tasken.get_proposal_status",
        arguments: { proposal_id: proposalId },
      });
      assert.equal(status.isError, undefined, JSON.stringify(status));
      assert.equal(status.structuredContent.status, "accepted");
      assert.equal(status.structuredContent.sync.enabled, true);
      assert.match(String(status.structuredContent.sync.last_synced_at), /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(status.structuredContent.sync.pending_local_changes, 0);
      // replicaの応答はreplica自身の正本であり、Desktopの採否を代弁しない。
      assert.equal(status.structuredContent.view.canonical_node, "this_node");
      assert.equal(status.structuredContent.view.delivery_confirmed, false);
      assert.notEqual(status.structuredContent.view.device_id, host.deviceId);
    } finally {
      await client?.close().catch(() => {});
      client = undefined;
      await handle.stop();
    }

    const replica = new WorkspaceDatabase(path.join(replicaUserData, "research-desk.sqlite"));
    try {
      const applied = replica.get("ai_proposal", proposalId);
      assert.ok(applied, "replicaがProposalを保持している");
      assert.equal(applied.status, "accepted", "Desktopの採否がreplicaへ戻る");
      assert.deepEqual(applied.payload.feed_posts[0].body, body);
      assert.equal(replica.syncPendingCount(), 0, "replicaは受信を再公開しない");
      assert.equal(replica.listSyncConflicts().length, 0);
    } finally {
      replica.db.close();
    }
  } finally {
    await hostSync.stop();
    if (host.db.open) host.db.close();
  }
});

test("replicaが受けたTask作業報告はDesktopの採用でWork Receiptになり、採否がreplicaへ戻る", async (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-headless-taskwork-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = path.join(root, "shared");
  const hostUserData = path.join(root, "host");
  const replicaUserData = path.join(root, "replica");
  fs.mkdirSync(shared, { recursive: true });
  const host = new WorkspaceDatabase(path.join(hostUserData, "research-desk.sqlite"));
  const hostSync = new SharedFolderSyncService(
    host,
    () => {},
    path.join(hostUserData, "attachments", "markdown-images"),
    path.join(hostUserData, "attachments", "capture-images"),
  );
  const application = new ApplicationCommandService(host);
  let client;
  let proposalId;
  try {
    bootstrapWorkspace(host);
    await hostSync.configure(shared);
    const handle = await startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
      writeMode: "proposals",
    });
    try {
      client = await connectMcp(replicaUserData);
      // replicaが同期したTaskの版を使う。直接開始は公開されないため、報告だけを送る。
      const context = await client.callTool({
        name: "tasken.get_task_context",
        arguments: { task_id: "task-headless" },
      });
      assert.equal(context.isError, undefined, JSON.stringify(context));
      const task = context.structuredContent.task;
      assert.equal(task.id, "task-headless");

      const queued = await client.callTool({
        name: "tasken.report_work",
        arguments: {
          status: "done",
          idempotency_key: "replica-task-work",
          caller: "ChatGPT",
          source_app: "chatgpt",
          task_id: task.id,
          expected_version: task.version,
          executor_kind: "ai_agent",
          executor_label: "ChatGPT",
          summary: "NASで受けた作業報告。",
          completed_items: ["作業報告の往復確認"],
          changed_or_created_items: [],
          verification: [],
          remaining_work: [],
          reported_at: "2026-09-27T00:00:00.000Z",
        },
      });
      assert.equal(queued.isError, undefined, JSON.stringify(queued));
      proposalId = String(queued.structuredContent.proposal_id);
      assert.equal(queued.structuredContent.payload_type, "task_work");
      // 受領はreplicaに残り、Desktopへはまだ届いていない。採用前のTaskは変わらない。
      assert.equal(host.get("ai_proposal", proposalId), null);
      assert.equal(host.get("task", "task-headless").work_state || "", "");

      await handle.syncNow();
      await hostSync.syncNow();
      const received = host.get("ai_proposal", proposalId);
      assert.ok(received, "Desktopがreplicaの作業報告を受け取る");
      assert.equal(received.payload_type, "task_work");
      assert.equal(received.status, "pending");
      assert.equal(host.list("work_receipt").length, 0, "採用までWork Receiptは作られない");

      // 人がDesktopで採用すると、報告がWork Receiptになり、採否がreplicaへ戻る。
      application.execute({
        commandId: `${proposalId}:accept`,
        name: "ApplyTaskWorkProposal",
        payload: { proposalId, decision: "accept" },
        actor: { kind: "user", id: "desktop-test" },
        source: "main_ui",
        issuedAt: "2026-09-27T00:00:00.000Z",
        expectedVersions: [
          { type: "ai_proposal", id: proposalId, version: received.version },
          {
            type: "task",
            id: "task-headless",
            version: host.get("task", "task-headless").version,
          },
        ],
      });
      const receipt = host.get("work_receipt", proposalId);
      assert.ok(receipt, JSON.stringify(host.list("work_receipt")));
      assert.equal(receipt.summary, "NASで受けた作業報告。");
      assert.equal(receipt.provenance.reported_via, "mcp");
      assert.equal(host.get("ai_proposal", proposalId).status, "accepted");
      assert.equal(host.get("task", "task-headless").state, "todo", "報告の採用はTask完了ではない");

      await hostSync.syncNow();
      await handle.syncNow();
      assert.equal(host.listSyncConflicts().length, 0, JSON.stringify(host.listSyncConflicts()));
      const status = await client.callTool({
        name: "tasken.get_proposal_status",
        arguments: { proposal_id: proposalId },
      });
      assert.equal(status.isError, undefined, JSON.stringify(status));
      assert.equal(status.structuredContent.status, "accepted");
      assert.equal(status.structuredContent.view.canonical_node, "this_node");
      assert.equal(status.structuredContent.view.delivery_confirmed, false);
    } finally {
      await client?.close().catch(() => {});
      client = undefined;
      await handle.stop();
    }

    const replica = new WorkspaceDatabase(path.join(replicaUserData, "research-desk.sqlite"));
    try {
      assert.equal(replica.get("ai_proposal", proposalId).status, "accepted");
      assert.equal(replica.syncPendingCount(), 0, "replicaは受信を再公開しない");
      assert.equal(replica.listSyncConflicts().length, 0);
    } finally {
      replica.db.close();
    }
  } finally {
    await hostSync.stop();
    if (host.db.open) host.db.close();
  }
});

test("replicaが受けたNote編集案とFeedの返信はDesktopへ届き、古い版のNote編集案は採用で断られる", async (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-headless-noteedit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = path.join(root, "shared");
  const hostUserData = path.join(root, "host");
  const replicaUserData = path.join(root, "replica");
  fs.mkdirSync(shared, { recursive: true });
  fs.mkdirSync(path.join(hostUserData, "managed"), { recursive: true });
  const host = new WorkspaceDatabase(path.join(hostUserData, "research-desk.sqlite"));
  host.loadWorkspace();
  host.setPreference("artifactDirectory", path.join(hostUserData, "managed"));
  const hostSync = new SharedFolderSyncService(
    host,
    () => {},
    path.join(hostUserData, "attachments", "markdown-images"),
    path.join(hostUserData, "attachments", "capture-images"),
  );
  const workspace = new WorkspaceService(host, hostUserData, () => "2026-11-08T00:00:00.000Z");
  const acceptance = new AiProposalAcceptanceService(
    new ApplicationCommandService(host),
    workspace,
    host,
  );
  const originalBody = "a\nold\nsame";
  const createNote = (id) =>
    workspace.saveCanonicalNote({
      entity: { id, title: id, body_markdown: originalBody },
      snapshot: {
        owner: { recordType: "note", entityId: id },
        body: originalBody,
        expectedRevision: 0,
      },
    });
  // Desktopの採用操作と同じ形。編集元の署名は、利用者がPreviewで見た本文から作る。
  const acceptCommand = (proposal, note) => ({
    commandId: `${proposal.id}:accept:v${proposal.version}`,
    name: "ApplyAiProposal",
    payload: {
      proposal: { ...proposal, status: "accepted" },
      decision: "accept",
      decisions: [
        {
          entryIndex: 0,
          type: "note",
          action: "accept",
          acceptedHunks: [0],
          beforeSignature: markdownSignature(originalBody),
        },
      ],
      candidates: [{ type: "note", entity: { id: note.id, version: note.version } }],
    },
    actor: { kind: "user" },
    source: "main_ui",
    expectedVersions: [
      { type: "ai_proposal", id: proposal.id, version: proposal.version },
      { type: "note", id: note.id, version: Number(note.version) },
    ],
    issuedAt: proposal.received_at,
  });
  let client;
  try {
    bootstrapWorkspace(host);
    const fresh = createNote("note-fresh");
    const stale = createNote("note-stale");
    host.save("feed_reply", {
      id: "reply-question",
      post_id: "post-question",
      author_kind: "self",
      body: "この手法の限界は？",
      created_at: "2026-11-08T00:00:00.000Z",
      ai_requested_at: "2026-11-08T00:00:01.000Z",
    });
    await hostSync.configure(shared);
    const handle = await startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
      writeMode: "proposals",
    });
    try {
      client = await connectMcp(replicaUserData);
      const edit = async (note, key) => {
        const queued = await client.callTool({
          name: "tasken.propose_note_edit",
          arguments: {
            idempotency_key: key,
            caller: "NAS replica test",
            source_app: "nas-replica",
            note_id: note.id,
            base_version: Number(note.version),
            title: note.id,
            body: "a\nnew\nsame",
            reason: "NASで読んだ版からの編集案",
          },
        });
        assert.equal(queued.isError, undefined, JSON.stringify(queued));
        return String(queued.structuredContent.proposal_id);
      };
      const freshProposalId = await edit(fresh, "replica-edit-fresh");
      const staleProposalId = await edit(stale, "replica-edit-stale");
      const answered = await client.callTool({
        name: "tasken.answer_feed_question",
        arguments: {
          idempotency_key: "replica-reply",
          caller: "NAS replica test",
          source_app: "nas-replica",
          post_id: "post-question",
          reply_to: "reply-question",
          body: "限界は三つある。",
        },
      });
      assert.equal(answered.isError, undefined, JSON.stringify(answered));
      const replyProposalId = String(answered.structuredContent.proposal_id);

      await handle.syncNow();
      await hostSync.syncNow();
      for (const id of [freshProposalId, staleProposalId, replyProposalId]) {
        assert.equal(host.get("ai_proposal", id)?.status, "pending", id);
      }
      assert.equal(host.listSyncConflicts().length, 0, JSON.stringify(host.listSyncConflicts()));

      // Feedの返信: Desktop側のFeed文脈で、質問が回答済みとして読める。
      const feed = new FeedContextQueryService(new WorkspaceFeedContextReadAdapter(host)).execute({
        include_answered: true,
      });
      const question = feed.questions.find(({ id }) => id === "reply-question");
      assert.equal(question?.answered, true);
      const reply = host.get("ai_proposal", replyProposalId);
      assert.equal(reply.payload_type, "feed_replies");
      assert.equal(reply.payload.feed_replies[0].body, "限界は三つある。");
      assert.equal(reply.payload.feed_replies[0].reply_to, "reply-question");

      // Note編集案: 受領しただけではNoteは変わらない。
      assert.equal(host.get("note", fresh.id).body_markdown, originalBody);

      // Desktopが先にNoteを変えていた場合、古い版からの編集案は採用で断られ、Noteは変わらない。
      const localBody = `${originalBody}\nlocal`;
      const edited = workspace.saveCanonicalNote({
        entity: { ...host.get("note", stale.id), body_markdown: localBody },
        snapshot: {
          owner: { recordType: "note", entityId: stale.id },
          body: localBody,
          expectedRevision: 1,
        },
      });
      assert.ok(Number(edited.version) > Number(stale.version));
      assert.throws(
        () => acceptance.execute(acceptCommand(host.get("ai_proposal", staleProposalId), edited)),
        /base_version|更新済み/,
      );
      assert.equal(host.get("note", stale.id).body_markdown, localBody);
      assert.equal(host.get("ai_proposal", staleProposalId).status, "pending");

      // 版が進んでいなければ採用でき、Noteが変わる。
      acceptance.execute(
        acceptCommand(host.get("ai_proposal", freshProposalId), host.get("note", fresh.id)),
      );
      assert.equal(host.get("note", fresh.id).body_markdown, "a\nnew\nsame");
      assert.equal(host.get("ai_proposal", freshProposalId).status, "accepted");

      // 採否はreplicaへ戻る。
      await hostSync.syncNow();
      await handle.syncNow();
      assert.equal(host.listSyncConflicts().length, 0, JSON.stringify(host.listSyncConflicts()));
      const status = await client.callTool({
        name: "tasken.get_proposal_status",
        arguments: { proposal_id: freshProposalId },
      });
      assert.equal(status.structuredContent.status, "accepted");
    } finally {
      await client?.close().catch(() => {});
      client = undefined;
      await handle.stop();
    }
  } finally {
    await hostSync.stop();
    if (host.db.open) host.db.close();
  }
});

test("proposalsモードのHeadless Coreは許可した種類だけを受け付ける", async (t) => {
  const userDataPath = temporaryUserData();
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  seedWorkspace(userDataPath);
  const handle = await startTaskenHeadlessCore({ userDataPath, writeMode: "proposals" });
  let client;
  try {
    client = await connectMcp(userDataPath);

    // 許可: テキストの読み物投稿・Feedの返信・Note案・Note編集案・Task作業報告。
    for (const [name, args] of [
      [
        "tasken.propose_feed_post",
        {
          idempotency_key: "restricted-feed",
          caller: "gate test",
          source_app: "gate-test",
          topic: "insight",
          body: ["許可された投稿。"],
        },
      ],
      [
        "tasken.propose_note",
        {
          idempotency_key: "restricted-note",
          caller: "gate test",
          source_app: "gate-test",
          title: "許可されたNote案",
          body: "本文。",
        },
      ],
      [
        "tasken.propose_note_edit",
        {
          idempotency_key: "restricted-note-edit",
          caller: "gate test",
          source_app: "gate-test",
          note_id: "note-existing",
          base_version: 1,
          title: "許可されたNote編集案",
          body: "本文。",
          reason: "確認",
        },
      ],
      [
        "tasken.answer_feed_question",
        {
          idempotency_key: "restricted-reply",
          caller: "gate test",
          source_app: "gate-test",
          post_id: "post-1",
          reply_to: "reply-1",
          body: "許可された返信。",
        },
      ],
      [
        "tasken.report_work",
        {
          status: "done",
          idempotency_key: "restricted-report",
          caller: "gate test",
          source_app: "gate-test",
          task_id: "task-headless",
          expected_version: 1,
          executor_kind: "ai_agent",
          executor_label: "gate test",
          summary: "許可された作業報告。",
          completed_items: ["proposalsの許可範囲を確認した"],
          changed_or_created_items: [],
          verification: [],
          remaining_work: [],
        },
      ],
    ]) {
      const allowed = await client.callTool({ name, arguments: args });
      assert.equal(allowed.isError, undefined, `${name}: ${JSON.stringify(allowed)}`);
    }

    // 非公開: 使えない書き込みtoolは一覧に出さず、get_capabilitiesが理由を返す。
    const listedNames = new Set((await client.listTools()).tools.map((tool) => tool.name));
    for (const name of ["tasken.start_task_work"]) {
      assert.equal(listedNames.has(name), false, `${name}は一覧に出さない`);
    }
    for (const name of ["tasken.propose_note_edit", "tasken.answer_feed_question"]) {
      assert.equal(listedNames.has(name), true, `${name}は一覧に出す`);
    }
    const capabilities = await client.callTool({ name: "tasken.get_capabilities", arguments: {} });
    assert.equal(capabilities.isError, undefined, JSON.stringify(capabilities));
    assert.equal(capabilities.structuredContent.core.write_profile, "proposals");
    assert.deepEqual(capabilities.structuredContent.writes, {
      task_create: false,
      note_direct_create: false,
      task_edit: false,
      undo: false,
      note_edit_direct: false,
      proposal_decision: false,
      feed_post: true,
      feed_reply: true,
      note_create: true,
      note_images: false,
      note_edit: true,
      task_work_report: true,
      task_start: false,
    });
    assert.deepEqual(capabilities.structuredContent.unavailable_tools, [
      { name: "tasken.create_task", reason: "missing_capability:create_ai_item", listed: false },
      { name: "tasken.create_note", reason: "missing_capability:create_ai_item", listed: false },
      // 既存Taskの直接変更はDesktopだけ。NASには出さない（#703）。
      { name: "tasken.change_task", reason: "missing_capability:task.ai_change", listed: false },
      {
        name: "tasken.decide_proposal",
        reason: "missing_capability:ai_direct_write",
        listed: false,
      },
      { name: "tasken.edit_note", reason: "missing_capability:ai_direct_write", listed: false },
      { name: "tasken.undo_change", reason: "missing_capability:task.ai_change", listed: false },
      {
        name: "tasken.start_task_work",
        reason: "missing_capability:task.start_work",
        listed: false,
      },
    ]);

    // 拒否: bridgeを経由しない要求も、許可範囲外の種類はCore自身がWRITE_NOT_ALLOWEDで止める。
    const coreClient = new TaskenCoreClient({ userDataPath });
    for (const request of [{ kind: "knowledge_create", title: "知識" }]) {
      await assert.rejects(
        coreClient.proposeContent({
          ...request,
          idempotency_key: `restricted-${request.kind}`,
          caller: "gate test",
          actor: { kind: "ai_agent" },
          source: "mcp",
        }),
        (error) =>
          error instanceof TaskenCoreClientError &&
          error.code === "WRITE_NOT_ALLOWED" &&
          JSON.stringify(error.details.allowed_kinds) ===
            JSON.stringify(["feed_post", "feed_reply", "note_create", "note_edit"]),
      );
    }

    // 拒否: 一覧に残る種類でも、画像付きの提案はCoreがWRITE_NOT_ALLOWEDで止める。
    for (const [name, args] of [
      [
        "tasken.propose_note",
        {
          idempotency_key: "restricted-image",
          caller: "gate test",
          title: "画像付きNote案",
          body: "![alt](tasken-upload://shot)",
          images: [
            {
              reference_id: "shot",
              file_name: "shot.png",
              media_type: "image/png",
              data_base64: "aGVsbG8=",
            },
          ],
        },
      ],
      [
        "tasken.propose_feed_post",
        {
          idempotency_key: "restricted-feed-image",
          caller: "gate test",
          topic: "insight",
          body: ["画像付きの記事。"],
          article: {
            title: "画像付き記事",
            body: "![alt](tasken-upload://shot)",
            images: [
              {
                reference_id: "shot",
                file_name: "shot.png",
                media_type: "image/png",
                data_base64: "aGVsbG8=",
              },
            ],
          },
        },
      ],
    ]) {
      const refused = await client.callTool({ name, arguments: args });
      assert.equal(refused.isError, true, `${name}は拒否される`);
      assert.equal(
        refused.structuredContent.error.code,
        "WRITE_NOT_ALLOWED",
        `${name}: ${JSON.stringify(refused.structuredContent)}`,
      );
      assert.match(String(refused.structuredContent.error.next_action), /許可されていない/u);
      // 文言と詳細は同じ一覧から作る。作業報告は別経路として分けて示す。
      assert.deepEqual(refused.structuredContent.error.details.allowed_kinds, [
        "feed_post",
        "feed_reply",
        "note_create",
        "note_edit",
      ]);
      assert.equal(refused.structuredContent.error.details.task_work_allowed, true);
    }

    // 拒否: 起動時にCoreを読めず直接開始が一覧に残った場合も、配備の境界として案内する。
    const unfiltered = createTaskenMcpServer({ coreClient });
    const unfilteredClient = new Client({ name: "tasken-headless-unfiltered", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await unfiltered.connect(serverTransport);
    await unfilteredClient.connect(clientTransport);
    const unavailable = await unfilteredClient.callTool({
      name: "tasken.start_task_work",
      arguments: {
        idempotency_key: "restricted-start",
        caller: "gate test",
        task_id: "task-headless",
        expected_version: 1,
        started_at: "2026-09-21T00:00:00.000Z",
        work_attempt_id: "12c9a3df-084a-4314-8a80-de844b512fad",
      },
    });
    assert.equal(unavailable.isError, true);
    assert.equal(unavailable.structuredContent.error.code, "CAPABILITY_UNAVAILABLE");
    // 版の不一致ではなく配備の境界なので、「更新してください」だけを案内しない。
    assert.match(
      String(unavailable.structuredContent.error.next_action),
      /開始専用権限を公開していません/u,
    );
    await unfilteredClient.close();
    await unfiltered.close();
  } finally {
    await client?.close().catch(() => {});
    await stopAndInspect(handle, userDataPath, (database) => {
      // 拒否された要求はProposalもTask変更も残さない。作業報告はProposalとしてだけ残る。
      assert.equal(database.list("ai_proposal").length, 5);
      assert.equal(database.list("work_receipt").length, 0);
      assert.notEqual(database.get("task", "task-headless")?.work_state, "in_progress");
    });
  }
});

async function stopAndInspect(handle, userDataPath, inspect) {
  await handle.stop();
  const database = new WorkspaceDatabase(path.join(userDataPath, "research-desk.sqlite"));
  try {
    inspect(database);
  } finally {
    database.db.close();
  }
}

test("Headless replica serves synced capture and task images over Core HTTP (MCP photo tools removed)", async (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-headless-image-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = path.join(root, "shared");
  const hostUserData = path.join(root, "host");
  const replicaUserData = path.join(root, "replica");
  const hostPhotos = path.join(hostUserData, "attachments", "capture-images");
  fs.mkdirSync(shared, { recursive: true });
  fs.mkdirSync(hostPhotos, { recursive: true });
  const host = new WorkspaceDatabase(path.join(hostUserData, "research-desk.sqlite"));
  const hostSync = new SharedFolderSyncService(
    host,
    () => {},
    path.join(hostUserData, "attachments", "markdown-images"),
    hostPhotos,
  );
  const bytes = Buffer.from("replica photo canonical bytes");
  const fileName = "123e4567-e89b-02d3-0456-426614174001.jpg";
  const manifest = {
    reference_id: "photo",
    file_name: fileName,
    mime_type: "image/jpeg",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: `tasken-attachment://local/${fileName}/photo.jpg`,
  };
  try {
    fs.writeFileSync(path.join(hostPhotos, fileName), bytes);
    host.save("theme", { id: "theme-image", name: "Image Theme", code: "IM" });
    host.save("task", {
      id: "task-image",
      title: "Task image read",
      state: "todo",
      priority: "normal",
      theme_id: "theme-image",
      images: [manifest],
    });
    host.save("capture_entry", {
      id: "capture-image",
      title: "Capture image read",
      text: "Capture image read",
      kind: "inbox",
      content_type: "image",
      state: "untriaged",
      captured_at: new Date().toISOString(),
      theme_id: "theme-image",
      images: [manifest],
    });
    await hostSync.configure(shared);

    const handle = await startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
    });
    try {
      const coreClient = new TaskenCoreClient({ userDataPath: replicaUserData });
      const capture = await coreClient.getCaptureImage({
        capture_id: "capture-image",
        file_name: fileName,
      });
      assert.equal(capture.image.sha256, manifest.sha256);
      assert.equal(Buffer.from(capture.image.data_base64, "base64").equals(bytes), true);
      const task = await coreClient.getTaskImage({
        task_id: "task-image",
        file_name: fileName,
      });
      assert.equal(task.image.sha256, manifest.sha256);
    } finally {
      await handle.stop();
    }

    fs.writeFileSync(
      path.join(replicaUserData, "attachments", "capture-images", fileName),
      Buffer.alloc(bytes.length, 7),
    );
    const restarted = await startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
    });
    try {
      const coreClient = new TaskenCoreClient({ userDataPath: replicaUserData });
      const tampered = await coreClient.getCaptureImage({
        capture_id: "capture-image",
        file_name: fileName,
      });
      assert.equal(tampered.error?.code, "not_found");
    } finally {
      await restarted.stop();
    }
  } finally {
    await hostSync.stop();
    if (host.db.open) host.db.close();
  }
});

/** 書き込みの門を試す共有フォルダ。Desktop役が status.json を置き、replicaが参加する。 */
async function writeGateFixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-headless-gate-"));
  const shared = path.join(root, "shared");
  const hostUserData = path.join(root, "host");
  const replicaUserData = path.join(root, "replica");
  fs.mkdirSync(shared, { recursive: true });
  const host = new WorkspaceDatabase(path.join(hostUserData, "research-desk.sqlite"));
  const hostSync = new SharedFolderSyncService(
    host,
    () => {},
    path.join(hostUserData, "attachments", "markdown-images"),
    path.join(hostUserData, "attachments", "capture-images"),
  );
  t.after(async () => {
    await hostSync.stop();
    if (host.db.open) host.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  bootstrapWorkspace(host);
  await hostSync.configure(shared);
  const statusPath = path.join(shared, "devices", host.deviceId, "status.json");
  const hostShape = JSON.parse(fs.readFileSync(statusPath, "utf8")).syncShape;
  const sha = (letter) => letter.repeat(64);
  const mark = (shape, desktopFirst) => ({ shape_sha256: shape, desktop_first: desktopFirst });
  const startReplica = (syncShapeFlags, extra = {}) =>
    startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
      writeMode: "create-only",
      allowAiTaskStart: true,
      env: {},
      syncShapeFlags,
      ...extra,
    });
  return {
    shared,
    host,
    hostSync,
    statusPath,
    hostShape,
    sha,
    mark,
    startReplica,
    replicaUserData,
  };
}

const gateCreateRequest = (key) => ({
  kind: "task",
  title: "NASで作る",
  body: "本文",
  caller: "gate-test",
  source_app: "gate-test",
  source_session: "gate-session",
  idempotency_key: key,
  reason: "書き込みの門の試験",
});

const gateStartRequest = {
  task_id: "task-headless",
  expected_version: 1,
  idempotency_key: "gate-start",
  caller: "gate-test",
  started_at: "2026-11-08T00:00:00.000Z",
  work_attempt_id: "12c9a3df-084a-4314-8a80-de844b512fad",
  source_session: "gate-session",
};

const gateChangeRequest = (key, title) => ({
  task_id: "task-headless",
  expected_version: 1,
  action: "update",
  changes: { title },
  said: `題名を「${title}」にして`,
  caller: "gate-test",
  source_session: "gate-session",
  idempotency_key: key,
});

/** 断られたら { code, status }、通ったら "passed"（通ったあとの失敗は問わない）。 */
async function gateOutcome(call) {
  try {
    await call();
    return "passed";
  } catch (error) {
    if (
      error instanceof TaskenCoreClientError &&
      ["DESKTOP_BEHIND", "REPLICA_BEHIND"].includes(error.code)
    )
      return { code: error.code, status: error.status };
    return "passed";
  }
}

test("replicaは、取り込めないDesktopがいる間は書き込みを断る。読み取りは止めない", async (t) => {
  const f = await writeGateFixture(t);
  // Desktopの形が、desktop_firstの印より前を指す。
  const behind = await f.startReplica([f.mark(f.hostShape, false), f.mark(f.sha("b"), true)]);
  try {
    const core = new TaskenCoreClient({ userDataPath: f.replicaUserData });
    const blocked = { code: "DESKTOP_BEHIND", status: 409 };
    assert.deepEqual(await gateOutcome(() => core.createAiItem(gateCreateRequest("a"))), blocked);
    assert.deepEqual(await gateOutcome(() => core.proposeContent({})), blocked);
    assert.deepEqual(await gateOutcome(() => core.startAiTaskWork(gateStartRequest)), blocked);
    const searched = await core.searchItems({ query: "Headless context" });
    assert.ok(
      searched.items.some((item) => item.id === "task-headless"),
      "読み取りは止めない",
    );
    await assert.rejects(
      () => core.createAiItem(gateCreateRequest("a")),
      (error) => error.retryable === true && /Desktop の Tasken を最新版/u.test(error.next_action),
    );
  } finally {
    await behind.stop();
  }

  // Desktopが新しい形を出している（印の最後を指す）と通る。
  const current = await f.startReplica([f.mark(f.sha("a"), false), f.mark(f.hostShape, true)]);
  try {
    const core = new TaskenCoreClient({ userDataPath: f.replicaUserData });
    const created = await core.createAiItem(gateCreateRequest("b"));
    assert.equal(created.status, "created");
  } finally {
    await current.stop();
  }
});

test("replicaは取り込みが遅れている間、既存Taskを書き換える開始・直接変更・取り消しを断る。新規作成は通す", async (t) => {
  const f = await writeGateFixture(t);
  const handle = await f.startReplica([f.mark(f.hostShape, false)], { allowAiTaskChange: true });
  try {
    const core = new TaskenCoreClient({ userDataPath: f.replicaUserData });
    assert.notDeepEqual(
      await gateOutcome(() => core.startAiTaskWork(gateStartRequest)),
      { code: "REPLICA_BEHIND", status: 409 },
      "取り込めている間は断らない",
    );

    // Desktopが差分を足し、途中の一つが共有フォルダから欠ける。
    f.host.save("task", { id: "task-late-1", title: "late 1", state: "todo", priority: "normal" });
    f.host.save("task", { id: "task-late-2", title: "late 2", state: "todo", priority: "normal" });
    await f.hostSync.syncNow();
    const directory = path.join(f.shared, "devices", f.host.deviceId);
    const packets = fs
      .readdirSync(directory)
      .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
      .sort();
    fs.unlinkSync(path.join(directory, packets.at(-2)));
    await assert.rejects(() => handle.syncNow(), /を待っています/u);

    assert.deepEqual(await gateOutcome(() => core.startAiTaskWork(gateStartRequest)), {
      code: "REPLICA_BEHIND",
      status: 409,
    });
    // 手元の版との照合は遅れていても通ってしまうので、直接変更と取り消しも入口で断る。
    assert.deepEqual(
      await gateOutcome(() => core.changeTask(gateChangeRequest("late", "遅れて直す"))),
      {
        code: "REPLICA_BEHIND",
        status: 409,
      },
    );
    assert.deepEqual(
      await gateOutcome(() =>
        core.undoChange({
          undo_session: "gate-session",
          said: "戻して",
          caller: "gate-test",
          source_session: "gate-session",
          idempotency_key: "late-undo",
        }),
      ),
      { code: "REPLICA_BEHIND", status: 409 },
    );
    // 新規作成は既存Taskを書き換えないので通す。
    assert.equal((await core.createAiItem(gateCreateRequest("c"))).status, "created");
  } finally {
    await handle.stop();
  }
});

test("replicaは明示したときだけ既存Taskの直接変更を受け、Desktopへ届いた変更は本人が取り消せる", async (t) => {
  const f = await writeGateFixture(t);
  // 作れない配備に直接変更だけを持たせない。
  await assert.rejects(
    () =>
      startTaskenHeadlessCore({
        userDataPath: f.replicaUserData,
        writeMode: "proposals",
        allowAiTaskChange: true,
        env: {},
      }),
    (error) => error instanceof TaskenHeadlessCoreError && error.code === "WRITE_MODE_CONFLICT",
  );
  const plain = await f.startReplica([f.mark(f.hostShape, false)]);
  try {
    const { capabilities } = await new TaskenCoreClient({
      userDataPath: f.replicaUserData,
    }).inspect();
    assert.equal(capabilities.includes("task.ai_change"), false, "明示しないと出さない");
  } finally {
    await plain.stop();
  }

  const handle = await f.startReplica([f.mark(f.hostShape, false)], { allowAiTaskChange: true });
  try {
    const core = new TaskenCoreClient({ userDataPath: f.replicaUserData });
    const { capabilities } = await core.inspect();
    assert.ok(capabilities.includes("task.ai_change"));
    // 取り消せない直接の書き込み（Noteの編集と採否）はDesktopだけ。
    assert.equal(capabilities.includes("ai_direct_write"), false);
    const changed = await core.changeTask(gateChangeRequest("nas-change", "NASで直した"));
    assert.equal(changed.status, "applied");
    assert.equal(changed.task.title, "NASで直した");

    // 変更と本人の言葉がDesktopへ届く（DesktopのActivityに出る）。
    await handle.syncNow();
    await f.hostSync.syncNow();
    assert.equal(f.host.get("task", "task-headless").title, "NASで直した");
    const said = f.host
      .listChangeEventsByCommandId(changed.change_id)
      .map((event) => event.metadata?.ai_direct?.said);
    assert.ok(said.includes("題名を「NASで直した」にして"), JSON.stringify(said));

    // 本人がDesktopのActivityから取り消すと、NASにも戻る。
    const desktop = createAiTaskChangeService(
      f.host,
      new ApplicationCommandService(f.host),
      () => false,
    );
    const undone = desktop.undoByUser(changed.change_id);
    assert.equal(undone.stopped, null, JSON.stringify(undone.stopped));
    assert.equal(f.host.get("task", "task-headless").title, "Headless context read");
    await f.hostSync.syncNow();
    await handle.syncNow();
    const again = await core.changeTask({
      ...gateChangeRequest("nas-change-after-undo", "もう一度"),
      expected_version: f.host.get("task", "task-headless").version,
    });
    assert.equal(again.status, "applied", "取り消しがNASへ戻り、今の版で変えられる");
  } finally {
    await handle.stop();
  }
});

test("replicaはDesktopのstatusが無いとき、desktop_firstの印があれば断り、無ければ通す", async (t) => {
  const f = await writeGateFixture(t);
  fs.rmSync(f.statusPath);
  const first = await f.startReplica([f.mark(f.sha("a"), false), f.mark(f.sha("b"), true)]);
  try {
    const core = new TaskenCoreClient({ userDataPath: f.replicaUserData });
    assert.deepEqual(await gateOutcome(() => core.createAiItem(gateCreateRequest("d"))), {
      code: "DESKTOP_BEHIND",
      status: 409,
    });
  } finally {
    await first.stop();
  }
  const second = await f.startReplica([f.mark(f.sha("a"), false)]);
  try {
    const core = new TaskenCoreClient({ userDataPath: f.replicaUserData });
    assert.equal((await core.createAiItem(gateCreateRequest("d"))).status, "created");
  } finally {
    await second.stop();
  }
});

test("Headless Core CLI requires valid explicit arguments", () => {
  assert.deepEqual(parseTaskenHeadlessCoreArgs([]), { help: false, writeMode: "read-only" });
  assert.equal(parseTaskenHeadlessCoreArgs(["--help"]).help, true);
  const parsed = parseTaskenHeadlessCoreArgs([
    "--user-data-dir=relative-user-data",
    "--db-path=relative.sqlite",
    "--sync-directory=relative-sync",
  ]);
  assert.equal(path.isAbsolute(parsed.userDataPath), true);
  assert.equal(path.isAbsolute(parsed.databasePath), true);
  assert.equal(path.isAbsolute(parsed.syncDirectory), true);
  assert.equal(
    parseTaskenHeadlessCoreArgs([], { TASKEN_SYNC_DIRECTORY: "env-sync" }).syncDirectory,
    path.resolve("env-sync"),
  );
  // 書き込みは既定で公開せず、明示された場合だけ提案受付になる。
  assert.equal(parseTaskenHeadlessCoreArgs(["--write-mode=proposals"]).writeMode, "proposals");
  assert.equal(
    parseTaskenHeadlessCoreArgs([], { TASKEN_CORE_WRITE_MODE: "proposals" }).writeMode,
    "proposals",
  );
  assert.equal(parseTaskenHeadlessCoreArgs(["--write-mode=read-only"]).writeMode, "read-only");
  // 既存Taskの直接変更は、開始と同じく独立の明示だけで出す。
  assert.equal(parseTaskenHeadlessCoreArgs([]).allowAiTaskChange, undefined);
  assert.equal(parseTaskenHeadlessCoreArgs(["--allow-ai-task-change"]).allowAiTaskChange, true);
  assert.equal(
    parseTaskenHeadlessCoreArgs([], { TASKEN_CORE_AI_TASK_CHANGE: "1" }).allowAiTaskChange,
    true,
  );
  assert.equal(
    parseTaskenHeadlessCoreArgs([], { TASKEN_CORE_WRITE_MODE: "unknown" }).writeMode,
    "read-only",
  );
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--write-mode=write"]));
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--user-data-dir="]));
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--sync-directory="]));
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--unknown"]));
});

test("replicaは同期の鮮度を source_status で返し、MCPの結果にsourceを添える。syncDirectoryなしでは出さない", async (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-headless-source-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = path.join(root, "shared");
  const hostUserData = path.join(root, "host");
  const replicaUserData = path.join(root, "replica");
  const plainUserData = path.join(root, "plain");
  fs.mkdirSync(shared, { recursive: true });
  const host = new WorkspaceDatabase(path.join(hostUserData, "research-desk.sqlite"));
  const hostSync = new SharedFolderSyncService(
    host,
    () => {},
    path.join(hostUserData, "attachments", "markdown-images"),
    path.join(hostUserData, "attachments", "capture-images"),
  );
  let client;
  let plainClient;
  try {
    bootstrapWorkspace(host);
    await hostSync.configure(shared);
    const hostStatus = JSON.parse(
      fs.readFileSync(path.join(shared, "devices", host.deviceId, "status.json"), "utf8"),
    );

    const handle = await startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
    });
    try {
      const core = new TaskenCoreClient({ userDataPath: replicaUserData });
      assert.ok((await core.status()).capabilities.includes("source_status"));
      assert.deepEqual(await core.getSourceStatus(), {
        source: {
          node: "replica",
          state: "ok",
          as_of: hostStatus.at,
          desktop_seen_at: hostStatus.at,
        },
      });

      // 読み取り専用のclient tokenからも呼べる。
      const { token } = await issueCoreClientToken(replicaUserData, "awai");
      const endpoint = JSON.parse(
        fs.readFileSync(
          path.join(replicaUserData, "core-endpoint", "tasken-core-endpoint.json"),
          "utf8",
        ),
      );
      const response = await fetch(`${endpoint.origin}/v1/queries/get-source-status`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).source.state, "ok");
      const strict = await fetch(`${endpoint.origin}/v1/queries/get-source-status`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ extra: 1 }),
      });
      assert.equal(strict.status, 400);

      client = await connectMcp(replicaUserData, { TASKEN_MCP_READ_ONLY: "1" });
      assert.match(client.getInstructions() || "", /`source`/u);
      const searched = await client.callTool({
        name: "tasken.search_items",
        arguments: { query: "Headless context" },
      });
      assert.equal(searched.isError, undefined, JSON.stringify(searched));
      assert.ok(searched.structuredContent.items.some((item) => item.id === "task-headless"));
      assert.equal(searched.structuredContent.source.state, "ok");
      assert.equal(searched.structuredContent.source.as_of, hostStatus.at);
      assert.deepEqual(Object.keys(searched.structuredContent.source).sort(), [
        "as_of",
        "desktop_seen_at",
        "node",
        "state",
      ]);
    } finally {
      await client?.close().catch(() => {});
      await handle.stop();
    }

    // Desktop役（syncDirectoryなし）には出さず、MCPの結果も変えない。
    seedWorkspace(plainUserData);
    const plain = await startTaskenHeadlessCore({ userDataPath: plainUserData });
    try {
      const core = new TaskenCoreClient({ userDataPath: plainUserData });
      assert.equal((await core.status()).capabilities.includes("source_status"), false);
      await assert.rejects(
        () => core.getSourceStatus(),
        (error) =>
          error instanceof TaskenCoreClientError && error.code === "CAPABILITY_UNAVAILABLE",
      );
      plainClient = await connectMcp(plainUserData);
      assert.doesNotMatch(plainClient.getInstructions() || "", /`source`/u);
      const searched = await plainClient.callTool({
        name: "tasken.search_items",
        arguments: { query: "Headless context" },
      });
      assert.equal("source" in searched.structuredContent, false);
    } finally {
      await plainClient?.close().catch(() => {});
      await plain.stop();
    }
  } finally {
    await hostSync.stop();
    if (host.db.open) host.db.close();
  }
});
