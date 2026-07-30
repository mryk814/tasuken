import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";

function task(id, title, overrides = {}) {
  return {
    id,
    title,
    state: "todo",
    priority: "normal",
    ...overrides,
  };
}

function createPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-sync-test-"));
  const shared = path.join(root, "shared");
  const first = new WorkspaceDatabase(path.join(root, "first", "research-desk.sqlite"));
  const second = new WorkspaceDatabase(path.join(root, "second", "research-desk.sqlite"));
  const firstSync = new SharedFolderSyncService(first);
  const secondSync = new SharedFolderSyncService(second);
  return {
    root,
    shared,
    first,
    second,
    firstSync,
    secondSync,
    close() {
      first.db.close();
      second.db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("shared folder sync bootstraps an empty second device and exchanges later changes", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "Desktop task"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    assert.equal(pair.second.workspaceId, pair.first.workspaceId);
    assert.equal(pair.second.get("task", "task-a").title, "Desktop task");

    pair.second.save("task", task("task-b", "Notebook task"));
    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();
    assert.equal(pair.first.get("task", "task-b").title, "Notebook task");

    pair.second.remove("task", "task-b");
    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();
    assert.ok(pair.first.get("task", "task-b", true).deleted_at);
  } finally {
    pair.close();
  }
});

test("shared folder sync detects divergent edits and publishes an explicit resolution", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "Initial"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    pair.first.save("task", { ...pair.first.get("task", "task-a"), title: "Desktop edit" });
    pair.second.save("task", { ...pair.second.get("task", "task-a"), title: "Notebook edit" });
    await pair.firstSync.syncNow();
    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();

    assert.equal(pair.first.syncConflictCount(), 1);
    assert.equal(pair.second.syncConflictCount(), 1);
    const notebookConflict = pair.second.listSyncConflicts()[0];
    const resolution = pair.secondSync.resolveConflict(notebookConflict.id, "incoming");
    assert.equal(resolution.result.entity.title, "Desktop edit");

    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();
    assert.equal(pair.first.syncConflictCount(), 0);
    assert.equal(pair.second.syncConflictCount(), 0);
    assert.equal(pair.first.get("task", "task-a").title, "Desktop edit");
    assert.equal(pair.second.get("task", "task-a").title, "Desktop edit");
  } finally {
    pair.close();
  }
});

test("joining another workspace never overwrites a non-empty local database", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "Desktop task"));
    pair.second.save("task", task("task-b", "Notebook-only task"));
    await pair.firstSync.configure(pair.shared);
    assert.throws(
      () => pair.secondSync.configure(pair.shared),
      /空のTaskenから同期フォルダへ参加/,
    );
    assert.equal(pair.second.get("task", "task-b").title, "Notebook-only task");
  } finally {
    pair.close();
  }
});

test("later changes wait when an earlier shared-folder file has not arrived yet", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "First change"));
    pair.first.save("task", task("task-b", "Second change"));
    await pair.firstSync.configure(pair.shared);

    const deviceDirectory = path.join(pair.shared, "devices", pair.first.deviceId);
    const files = fs.readdirSync(deviceDirectory).sort();
    fs.unlinkSync(path.join(deviceDirectory, files[0]));

    await assert.rejects(
      () => pair.secondSync.configure(pair.shared),
      /同期差分 000000000001 を待っています/,
    );
    assert.equal(pair.second.get("task", "task-a"), null);
    assert.equal(pair.second.get("task", "task-b"), null);
  } finally {
    pair.close();
  }
});
