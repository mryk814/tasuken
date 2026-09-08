import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";
import { syncCaptureImageAttachments } from "../src/main/services/sharedFolderAttachments.mjs";

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
  const firstPhotos = path.join(firstRoot, "attachments", "capture-images");
  const secondPhotos = path.join(secondRoot, "attachments", "capture-images");
  const firstSync = new SharedFolderSyncService(first, () => {}, firstAttachments, firstPhotos);
  const secondSync = new SharedFolderSyncService(second, () => {}, secondAttachments, secondPhotos);
  return {
    root,
    shared,
    firstAttachments,
    secondAttachments,
    firstPhotos,
    secondPhotos,
    first,
    second,
    firstSync,
    secondSync,
    close() {
      if (first.db.open) first.db.close();
      if (second.db.open) second.db.close();
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

test("photo Capture and Task retain source text, manifests and bytes across two devices and restart", async () => {
  const pair = createPair();
  const bytes = Buffer.from("photo canonical bytes");
  const fileName = "123e4567-e89b-02d3-0456-426614174001.jpg";
  const orphan = "123e4567-e89b-02d3-0456-426614174099.jpg";
  const manifest = {
    reference_id: "photo",
    file_name: fileName,
    mime_type: "image/jpeg",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: `tasken-attachment://local/${fileName}/photo.jpg`,
  };
  try {
    writeMarkdownImage(pair.firstPhotos, fileName, bytes);
    writeMarkdownImage(pair.firstPhotos, orphan, "private orphan");
    pair.first.save("capture_entry", {
      id: "photo-source",
      title: "source",
      text: "original source text",
      kind: "inbox",
      content_type: "image",
      state: "untriaged",
      captured_at: new Date().toISOString(),
      images: [manifest],
    });
    pair.first.save(
      "task",
      task("photo-task", "photo task", {
        description: "unchanged instruction",
        images: [manifest],
      }),
    );
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);
    assert.equal(pair.second.get("capture_entry", "photo-source").text, "original source text");
    assert.deepEqual(pair.second.get("task", "photo-task").images, [manifest]);
    assert.equal(pair.second.get("task", "photo-task").description, "unchanged instruction");
    assert.deepEqual(fs.readFileSync(path.join(pair.secondPhotos, fileName)), bytes);
    assert.equal(
      fs.existsSync(
        path.join(
          pair.shared,
          "devices",
          pair.first.deviceId,
          "attachments",
          "capture-images",
          orphan,
        ),
      ),
      false,
    );
    pair.second.db.close();
    const reopened = new WorkspaceDatabase(path.join(pair.root, "second", "research-desk.sqlite"));
    try {
      const restarted = new SharedFolderSyncService(
        reopened,
        () => {},
        pair.secondAttachments,
        pair.secondPhotos,
      );
      await restarted.syncNow();
      assert.deepEqual(reopened.get("capture_entry", "photo-source").images, [manifest]);
      assert.deepEqual(fs.readFileSync(path.join(pair.secondPhotos, fileName)), bytes);
      fs.writeFileSync(path.join(pair.secondPhotos, fileName), Buffer.alloc(bytes.length, 1));
      await assert.rejects(restarted.syncNow(), /一致|変わ/);
    } finally {
      reopened.db.close();
    }
    assert.equal(
      fs.existsSync(
        path.join(
          pair.shared,
          "devices",
          pair.second.deviceId,
          "attachments",
          "capture-images",
          fileName,
        ),
      ),
      false,
    );
  } finally {
    pair.close();
  }
});

test("photo sync reports missing bytes and recovers on the next poll", async () => {
  const pair = createPair();
  const notifications = [];
  pair.secondSync.notifyWorkspaceChanged = () =>
    notifications.push({
      title: pair.second.get("task", "unrelated-task")?.title,
      photos: fs.existsSync(pair.secondPhotos)
        ? fs.readdirSync(pair.secondPhotos).filter((name) => name.endsWith(".jpg")).length
        : 0,
    });
  const fileName = "123e4567-e89b-02d3-0456-426614174001.jpg";
  const bytes = Buffer.from("delayed photo");
  const manifest = {
    reference_id: "photo",
    file_name: fileName,
    mime_type: "image/jpeg",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: `tasken-attachment://local/${fileName}/photo.jpg`,
  };
  try {
    pair.first.save("task", task("unrelated-task", "Before edit"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);
    notifications.length = 0;
    pair.first.save("task", task("unrelated-task", "Updated without photo"));
    writeMarkdownImage(pair.firstPhotos, fileName, bytes);
    const firstFileName = "123e4567-e89b-02d3-0456-426614174000.jpg";
    writeMarkdownImage(pair.firstPhotos, firstFileName, bytes);
    pair.first.save(
      "task",
      task("delayed-photo", "Keep original", {
        images: [
          {
            ...manifest,
            reference_id: "first-photo",
            file_name: firstFileName,
            url: `tasken-attachment://local/${firstFileName}/photo.jpg`,
          },
          manifest,
        ],
      }),
    );
    await pair.firstSync.syncNow();
    const remote = path.join(
      pair.shared,
      "devices",
      pair.first.deviceId,
      "attachments",
      "capture-images",
      fileName,
    );
    fs.renameSync(remote, `${remote}.delayed`);
    await assert.rejects(pair.secondSync.syncNow(), /到着/);
    assert.equal(pair.second.get("task", "delayed-photo").title, "Keep original");
    assert.equal(pair.secondSync.status().state, "error");
    assert.ok(notifications.some((entry) => entry.title === "Updated without photo"));
    assert.ok(notifications.some((entry) => entry.photos === 1));
    notifications.length = 0;
    fs.renameSync(`${remote}.delayed`, remote);
    await pair.secondSync.syncNow();
    assert.equal(pair.secondSync.status().state, "idle");
    assert.deepEqual(fs.readFileSync(path.join(pair.secondPhotos, fileName)), bytes);
    assert.ok(notifications.some((entry) => entry.photos === 2));
  } finally {
    pair.close();
  }
});

test("photo sync rejects invalid manifest paths, size, hash and linked roots", () => {
  const pair = createPair();
  try {
    const fileName = "123e4567-e89b-02d3-0456-426614174001.jpg";
    const entry = { mime_type: "image/jpeg", size: 1, sha256: "a".repeat(64) };
    const sync = (name, image) =>
      syncCaptureImageAttachments({
        sharedDirectory: pair.shared,
        localDirectory: pair.firstPhotos,
        deviceId: pair.first.deviceId,
        photoManifests: new Map([[name, image]]),
      });
    assert.throws(() => sync("../image.jpg", entry), /manifest/);
    assert.throws(() => sync(fileName, { ...entry, size: 13 * 1024 * 1024 }), /manifest/);
    assert.throws(() => sync(fileName, { ...entry, sha256: "invalid" }), /manifest/);
    fs.mkdirSync(path.dirname(pair.firstPhotos), { recursive: true });
    const outside = path.join(pair.root, "private");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, pair.firstPhotos, "junction");
    assert.throws(() => sync(fileName, entry), /リンク/);
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
    assert.match(
      pair.second.get("note", "note-with-image").body_markdown,
      /tasken-attachment:\/\/local\//,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          pair.shared,
          "devices",
          pair.first.deviceId,
          "attachments",
          "markdown-images",
          orphanFileName,
        ),
      ),
      false,
    );

    await pair.secondSync.syncNow();
    assert.equal(
      fs.existsSync(
        path.join(
          pair.shared,
          "devices",
          pair.second.deviceId,
          "attachments",
          "markdown-images",
          fileName,
        ),
      ),
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

    await assert.rejects(() => pair.secondSync.configure(pair.shared), /同期途中か破損しています/);
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
    assert.equal(
      fs.readFileSync(path.join(pair.firstAttachments, fileName), "utf8"),
      "offline-image",
    );

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
    assert.throws(() => pair.secondSync.configure(pair.shared), /空のTaskenから同期フォルダへ参加/);
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
