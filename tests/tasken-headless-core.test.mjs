import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import {
  TASKEN_MCP_REQUIRED_CORE_CAPABILITIES,
  TaskenCoreClient,
  TaskenCoreClientError,
} from "../src/main/mcp/taskenCoreClient.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";

const bundleDirectory = fs.mkdtempSync(path.join(process.cwd(), ".tasken-headless-core-test-"));
after(() => fs.rmSync(bundleDirectory, { recursive: true, force: true }));

async function bundleEntry(relativePath, fileName) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["better-sqlite3"],
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

/** Headless Coreが既定で公開しない書き込みcapability。 */
const WRITE_CORE_CAPABILITIES = [
  "task.command",
  "propose_task_work",
  "propose_agent_session",
  "propose_repository_task",
  "propose_content",
];
const { parseTaskenHeadlessCoreArgs } = await bundleEntry(
  "src/main/headless/main.ts",
  "headlessMain.mjs",
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
        theme_id: "theme-headless",
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
    command: process.execPath,
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
    assert.equal(listed.tools.length, 47);
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
      assert.ok(listed.tools.length < 47, String(listed.tools.length));
      for (const writeTool of [
        "tasken.start_task_work",
        "tasken.append_work_receipt",
        "tasken.report_task_done",
        "tasken.report_task_blocked",
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
        ai_visibility: ["coding_agent"],
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
    hostSync.stop();
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
      for (const capability of ["propose_content", "propose_repository_task"]) {
        assert.ok(inspected.capabilities.includes(capability), capability);
      }
      for (const capability of ["task.command", "propose_task_work", "propose_agent_session"]) {
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
    hostSync.stop();
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

    // 許可: テキストの読み物投稿・Note案・Task案。
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
        "tasken.propose_task",
        {
          idempotency_key: "restricted-task",
          caller: "gate test",
          source_app: "gate-test",
          title: "許可されたTask案",
        },
      ],
    ]) {
      const allowed = await client.callTool({ name, arguments: args });
      assert.equal(allowed.isError, undefined, `${name}: ${JSON.stringify(allowed)}`);
    }

    // 拒否: 許可範囲外の種類はCore自身がWRITE_NOT_ALLOWEDで止める。
    for (const [name, args] of [
      [
        "tasken.propose_note_edit",
        {
          idempotency_key: "restricted-edit",
          caller: "gate test",
          note_id: "note-existing",
          base_version: 1,
          title: "編集案",
          body: "本文。",
          reason: "確認",
        },
      ],
      [
        "tasken.answer_feed_question",
        {
          idempotency_key: "restricted-reply",
          caller: "gate test",
          post_id: "post-1",
          reply_to: "reply-1",
          body: "返信。",
        },
      ],
      [
        "tasken.propose_repository_context",
        {
          idempotency_key: "restricted-repo",
          caller: "gate test",
          label: "repository",
        },
      ],
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
    ]) {
      const refused = await client.callTool({ name, arguments: args });
      assert.equal(refused.isError, true, `${name}は拒否される`);
      assert.equal(
        refused.structuredContent.error.code,
        "WRITE_NOT_ALLOWED",
        `${name}: ${JSON.stringify(refused.structuredContent)}`,
      );
      assert.match(String(refused.structuredContent.error.next_action), /許可されていない/u);
    }

    // 拒否: 直接書き込みはcapabilityごと公開しない。
    const unavailable = await client.callTool({
      name: "tasken.start_task_work",
      arguments: {
        idempotency_key: "restricted-start",
        caller: "gate test",
        task_id: "task-headless",
        expected_version: 1,
        started_at: "2026-09-21T00:00:00.000Z",
      },
    });
    assert.equal(unavailable.isError, true);
    assert.equal(unavailable.structuredContent.error.code, "CAPABILITY_UNAVAILABLE");
  } finally {
    await client?.close().catch(() => {});
    await stopAndInspect(handle, userDataPath, (database) => {
      // 拒否された要求はProposalもTask変更も残さない。
      assert.equal(database.list("ai_proposal").length, 3);
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

test("Headless replica serves synced capture and task images over MCP", async (t) => {
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
  let client;
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
      ai_visibility: ["coding_agent"],
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
      ai_visibility: ["coding_agent"],
    });
    await hostSync.configure(shared);

    const handle = await startTaskenHeadlessCore({
      userDataPath: replicaUserData,
      syncDirectory: shared,
    });
    try {
      client = await connectMcp(replicaUserData, { TASKEN_MCP_READ_ONLY: "1" });
      const capture = await client.callTool({
        name: "tasken.get_capture_image",
        arguments: { capture_id: "capture-image", file_name: fileName },
      });
      assert.equal(capture.isError, undefined, JSON.stringify(capture));
      assert.equal(capture.structuredContent.sha256, manifest.sha256);
      const captureBlock = capture.content.find((block) => block.type === "image");
      assert.ok(captureBlock, "capture image content block");
      assert.equal(captureBlock.data, bytes.toString("base64"));
      const task = await client.callTool({
        name: "tasken.get_task_image",
        arguments: { task_id: "task-image", file_name: fileName },
      });
      assert.equal(task.isError, undefined, JSON.stringify(task));
      assert.equal(task.structuredContent.sha256, manifest.sha256);
    } finally {
      await client?.close().catch(() => {});
      client = undefined;
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
      client = await connectMcp(replicaUserData, { TASKEN_MCP_READ_ONLY: "1" });
      const tampered = await client.callTool({
        name: "tasken.get_capture_image",
        arguments: { capture_id: "capture-image", file_name: fileName },
      });
      assert.equal(tampered.isError, true);
    } finally {
      await client?.close().catch(() => {});
      client = undefined;
      await restarted.stop();
    }
  } finally {
    hostSync.stop();
    if (host.db.open) host.db.close();
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
  assert.equal(
    parseTaskenHeadlessCoreArgs([], { TASKEN_CORE_WRITE_MODE: "unknown" }).writeMode,
    "read-only",
  );
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--write-mode=write"]));
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--user-data-dir="]));
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--sync-directory="]));
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--unknown"]));
});
