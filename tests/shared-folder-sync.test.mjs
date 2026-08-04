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
  const firstRoot = path.join(root, "first");
  const secondRoot = path.join(root, "second");
  const firstAttachments = path.join(firstRoot, "attachments", "markdown-images");
  const secondAttachments = path.join(secondRoot, "attachments", "markdown-images");
  const first = new WorkspaceDatabase(path.join(firstRoot, "research-desk.sqlite"));
  const second = new WorkspaceDatabase(path.join(secondRoot, "research-desk.sqlite"));
  const firstSync = new SharedFolderSyncService(first, () => {}, firstAttachments);
  const secondSync = new SharedFolderSyncService(second, () => {}, secondAttachments);
  return {
    root,
    shared,
    firstAttachments,
    secondAttachments,
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

function writeMarkdownImage(directory, fileName, content = "tasken-image") {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, fileName), Buffer.from(content));
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

test("shared folder sync publishes existing Markdown images and caches them on another device", async () => {
  const pair = createPair();
  const fileName = "123e4567-e89b-42d3-a456-426614174000.png";
  const orphanFileName = "123e4567-e89b-42d3-a456-426614174099.png";
  try {
    writeMarkdownImage(pair.firstAttachments, fileName);
    writeMarkdownImage(pair.firstAttachments, orphanFileName, "unreferenced");
    pair.first.save("note", {
      id: "note-with-image",
      title: "Image note",
      body_markdown: `![diagram](tasken-attachment://local/${fileName}/diagram)`,
    });

    const firstStatus = await pair.firstSync.configure(pair.shared);
    const secondStatus = await pair.secondSync.configure(pair.shared);

    assert.equal(firstStatus.lastMarkdownImagesPublished, 1);
    assert.equal(secondStatus.lastMarkdownImagesReceived, 1);
    assert.equal(secondStatus.markdownImageCount, 1);
    assert.equal(
      fs.readFileSync(path.join(pair.secondAttachments, fileName), "utf8"),
      "tasken-image",
    );
    assert.match(pair.second.get("note", "note-with-image").body_markdown, /tasken-attachment:\/\/local\//);
    assert.equal(
      fs.existsSync(path.join(
        pair.shared,
        "devices",
        pair.first.deviceId,
        "attachments",
        "markdown-images",
        orphanFileName,
      )),
      false,
    );

    await pair.secondSync.syncNow();
    assert.equal(
      fs.existsSync(path.join(
        pair.shared,
        "devices",
        pair.second.deviceId,
        "attachments",
        "markdown-images",
        fileName,
      )),
      false,
    );

    const descriptorPath = path.join(
      pair.shared,
      "devices",
      pair.first.deviceId,
      "attachments",
      "markdown-images",
      `${fileName}.json`,
    );
    fs.unlinkSync(descriptorPath);
    const repaired = await pair.firstSync.syncNow();
    assert.equal(repaired.lastMarkdownImagesPublished, 1);
    assert.equal(fs.existsSync(descriptorPath), true);
  } finally {
    pair.close();
  }
});

test("shared folder sync never confirms an incomplete or corrupted Markdown image", async () => {
  const pair = createPair();
  const fileName = "123e4567-e89b-42d3-a456-426614174001.png";
  try {
    writeMarkdownImage(pair.firstAttachments, fileName, "complete-image");
    pair.first.save("note", {
      id: "corrupt-image-note",
      title: "Corrupt image test",
      body_markdown: `![diagram](tasken-attachment://local/${fileName}/diagram)`,
    });
    await pair.firstSync.configure(pair.shared);

    const remoteImagePath = path.join(
      pair.shared,
      "devices",
      pair.first.deviceId,
      "attachments",
      "markdown-images",
      fileName,
    );
    fs.writeFileSync(remoteImagePath, "partial");

    await assert.rejects(
      () => pair.secondSync.configure(pair.shared),
      /同期途中か破損しています/,
    );
    assert.equal(fs.existsSync(path.join(pair.secondAttachments, fileName)), false);
  } finally {
    pair.close();
  }
});

test("Markdown images remain local when the shared folder is unavailable and publish after recovery", async () => {
  const pair = createPair();
  const fileName = "123e4567-e89b-42d3-a456-426614174002.webp";
  try {
    await pair.firstSync.configure(pair.shared);
    writeMarkdownImage(pair.firstAttachments, fileName, "offline-image");
    pair.first.save("note", {
      id: "offline-image-note",
      title: "Offline image",
      body_markdown: `![offline](tasken-attachment://local/${fileName}/offline)`,
    });
    fs.renameSync(pair.shared, `${pair.shared}-offline`);

    await assert.rejects(() => pair.firstSync.syncNow(), /Tasken設定が見つかりません/);
    assert.equal(fs.readFileSync(path.join(pair.firstAttachments, fileName), "utf8"), "offline-image");

    fs.renameSync(`${pair.shared}-offline`, pair.shared);
    const recovered = await pair.firstSync.syncNow();
    assert.equal(recovered.lastMarkdownImagesPublished, 1);
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
