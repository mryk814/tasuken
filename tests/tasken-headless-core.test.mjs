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
    assert.equal(fs.existsSync(handle.discoveryPath), true);
    const inspected = await new TaskenCoreClient({ userDataPath }).inspect();
    assert.equal(inspected.status, "ok");
    for (const capability of TASKEN_MCP_REQUIRED_CORE_CAPABILITIES) {
      assert.ok(inspected.capabilities.includes(capability), capability);
    }

    client = await connectMcp(userDataPath);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 43);
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
      assert.ok(listed.tools.length < 43, String(listed.tools.length));
      for (const writeTool of [
        "tasken.start_task_work",
        "tasken.append_work_receipt",
        "tasken.report_task_done",
        "tasken.report_task_blocked",
        "tasken.propose_note",
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
  assert.deepEqual(parseTaskenHeadlessCoreArgs([]), { help: false });
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
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--user-data-dir="]));
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--sync-directory="]));
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--unknown"]));
});
