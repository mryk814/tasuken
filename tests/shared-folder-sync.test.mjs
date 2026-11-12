import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { aiItemPacketFlags } from "../src/shared/contracts/sync/aiItemPacketContract.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  SharedFolderSyncService,
  SYNC_PACKET_FILE_PATTERN,
} from "../src/main/services/sharedFolderSync.mjs";
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
  // first は Desktop 役（鮮度を追わない）、second は NAS replica 役（追う）。
  const secondSync = new SharedFolderSyncService(
    second,
    () => {},
    secondAttachments,
    secondPhotos,
    {
      role: "replica",
    },
  );
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

test("shared folder sync allows a freshly started device with only the personal default theme", async () => {
  const pair = createPair();
  try {
    pair.first.ensurePersonalDefaultTheme();
    pair.second.ensurePersonalDefaultTheme();
    pair.first.save("task", task("task-a", "Desktop task"));

    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    assert.equal(pair.second.workspaceId, pair.first.workspaceId);
    assert.equal(pair.second.get("task", "task-a").title, "Desktop task");
    await pair.firstSync.syncNow();
    pair.second.save("task", task("joined-task", "Created after joining"));
    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();
    assert.equal(pair.first.get("task", "joined-task").title, "Created after joining");
  } finally {
    pair.close();
  }
});

for (const recovery of ["automatic", "manual"]) {
  test(`legacy default-theme packets recover after restart through ${recovery} publication`, async () => {
    const pair = createPair();
    let reopened;
    try {
      const previousWorkspaceId = pair.second.workspaceId;
      pair.first.ensurePersonalDefaultTheme();
      pair.second.ensurePersonalDefaultTheme();
      pair.first.save("task", task("host-task", "Host task"));
      await pair.firstSync.configure(pair.shared);
      await pair.secondSync.configure(pair.shared);
      const entry = pair.second.allSyncPackets()[0];
      const legacy = { ...entry.packet, workspaceId: previousWorkspaceId };
      const filePath = path.join(
        pair.shared,
        "devices",
        pair.second.deviceId,
        `${String(legacy.deviceSequence).padStart(12, "0")}-${legacy.changeId}.json`,
      );
      pair.second.db
        .prepare("UPDATE sync_outbox SET payload_json = ? WHERE change_id = ?")
        .run(JSON.stringify(legacy), legacy.changeId);
      fs.writeFileSync(filePath, JSON.stringify(legacy));
      pair.second.save("task", task("participant-task", "Participant task"));
      await assert.rejects(() => pair.firstSync.syncNow(), /別のWorkspaceの同期差分/);
      assert.equal(pair.first.syncCursor(pair.second.deviceId), 0);

      pair.second.db.close();
      reopened = new WorkspaceDatabase(path.join(pair.root, "second", "research-desk.sqlite"));
      const service = new SharedFolderSyncService(reopened);
      if (recovery === "manual") await service.republishMissing();
      else await service.syncNow();
      assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), entry.packet);
      await pair.firstSync.syncNow();
      assert.equal(pair.first.get("task", "participant-task").title, "Participant task");
      assert.equal(reopened.get("task", "host-task").title, "Host task");
      await service.syncNow();
      assert.equal(service.status().lastAutoRepublished, 0);
    } finally {
      reopened?.db.close();
      pair.close();
    }
  });
}

test("publication preserves a shared packet whose content differs from local history", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "Local content"));
    await pair.firstSync.configure(pair.shared);
    const packet = pair.first.allSyncPackets()[0].packet;
    const filePath = path.join(
      pair.shared,
      "devices",
      pair.first.deviceId,
      `${String(packet.deviceSequence).padStart(12, "0")}-${packet.changeId}.json`,
    );
    const different = { ...packet, entity: { ...packet.entity, title: "Different content" } };
    fs.writeFileSync(filePath, JSON.stringify(different));
    await assert.rejects(() => pair.firstSync.republishMissing(), /ローカル履歴と一致しません/);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), different);
    assert.equal(pair.first.get("task", "task-a").title, "Local content");
  } finally {
    pair.close();
  }
});

test("foreign ordinary data is neither relabelled nor accepted", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("foreign-task", "Keep private"));
    const original = pair.first.allSyncPackets()[0].packet;
    const foreign = { ...original, workspaceId: pair.second.workspaceId };
    pair.first.db
      .prepare("UPDATE sync_outbox SET payload_json = ? WHERE change_id = ?")
      .run(JSON.stringify(foreign), original.changeId);
    assert.throws(() => pair.first.repairSyncWorkspacePackets(), /別のWorkspaceのデータ/);
    assert.deepEqual(pair.first.allSyncPackets()[0].packet, foreign);
    assert.throws(() => pair.second.applySyncPacket(original), /別のWorkspaceの同期差分/);
    assert.equal(pair.second.get("task", "foreign-task"), null);
    assert.equal(pair.first.get("task", "foreign-task").title, "Keep private");
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
    assert.equal(pair.secondSync.sourceStatus().state, "waiting_image");
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

test("photo sync rejects invalid manifest paths, size, hash and linked roots", async () => {
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
    await assert.rejects(() => sync("../image.jpg", entry), /manifest/);
    await assert.rejects(() => sync(fileName, { ...entry, size: 13 * 1024 * 1024 }), /manifest/);
    await assert.rejects(() => sync(fileName, { ...entry, sha256: "invalid" }), /manifest/);
    fs.mkdirSync(path.dirname(pair.firstPhotos), { recursive: true });
    const outside = path.join(pair.root, "private");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, pair.firstPhotos, "junction");
    await assert.rejects(() => sync(fileName, entry), /リンク/);
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
    assert.deepEqual(pair.secondSync.status().waitingImage, {
      deviceId: pair.first.deviceId,
      fileName,
    });
  } finally {
    pair.close();
  }
});

test("periodic sync skips re-reading verified images and re-verifies after a change", async () => {
  const pair = createPair();
  const fileName = "123e4567-e89b-42d3-a456-426614174002.png";
  const imageReads = [];
  const originalReadFile = fs.promises.readFile;
  try {
    writeMarkdownImage(pair.firstAttachments, fileName, "verified-image");
    pair.first.save("note", {
      id: "verified-image-note",
      title: "Verified image",
      body_markdown: `![diagram](tasken-attachment://local/${fileName}/diagram)`,
    });
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    const remoteImagePath = path.join(
      pair.shared,
      "devices",
      pair.first.deviceId,
      "attachments",
      "markdown-images",
      fileName,
    );
    const stableTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(remoteImagePath, stableTime, stableTime);
    await pair.firstSync.syncNow();
    await pair.secondSync.syncNow();
    const verifiedStat = fs.statSync(remoteImagePath);

    // OneDrive/NASでは中身の読み出しがダウンロードになる。変化がなければ読まない。
    fs.promises.readFile = (filePath, ...rest) => {
      if (String(filePath).endsWith(fileName)) imageReads.push(String(filePath));
      return originalReadFile.call(fs.promises, filePath, ...rest);
    };
    await pair.firstSync.syncNow();
    await pair.secondSync.syncNow();
    assert.deepEqual(imageReads, []);

    fs.writeFileSync(remoteImagePath, "changed--image");
    fs.utimesSync(remoteImagePath, verifiedStat.atime, verifiedStat.mtime);
    assert.equal(fs.statSync(remoteImagePath).mtimeMs, verifiedStat.mtimeMs);
    await assert.rejects(() => pair.secondSync.syncNow(), /同期途中か破損しています/);
    assert.ok(imageReads.includes(remoteImagePath));
  } finally {
    fs.promises.readFile = originalReadFile;
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

// NASがAI ReadyのTaskを開始するのと同時に、本人がDesktopで依頼先を自分に戻す。本人が「この端末」を
// 選んだ解決を、作業中のNASが「作業中の再割当」として断ると、NASの同期は同じ差分で止まり続けた。
test("a conflict resolution that takes back an in-progress AI Task reaches the replica", async () => {
  const pair = createPair();
  try {
    pair.first.save(
      "task",
      task("task-delegated", "Delegated", {
        intended_executor: "ai_agent",
        work_state: "ready_for_agent",
      }),
    );
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    // NAS役が開始し、同時にDesktop役が依頼先を自分に戻す。
    pair.second.save("task", {
      ...pair.second.get("task", "task-delegated"),
      work_state: "in_progress",
      work_started_at: "2026-11-11T09:00:00.000Z",
    });
    pair.first.save("task", {
      ...pair.first.get("task", "task-delegated"),
      intended_executor: "self",
    });
    await pair.firstSync.syncNow();
    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();
    assert.equal(pair.first.syncConflictCount(), 1);

    const conflict = pair.first.listSyncConflicts()[0];
    pair.firstSync.resolveConflict(conflict.id, "local");
    await pair.firstSync.syncNow();
    await pair.secondSync.syncNow();

    assert.equal(pair.secondSync.status().lastError, "");
    assert.equal(pair.second.syncConflictCount(), 0);
    const replica = pair.second.get("task", "task-delegated");
    const desktop = pair.first.get("task", "task-delegated");
    assert.equal(replica.intended_executor, "self");
    assert.equal(replica.work_state, desktop.work_state);
    assert.equal(replica.version, desktop.version);

    // 止まっていないので、Desktopの後の変更も届く。
    pair.first.save("task", { ...pair.first.get("task", "task-delegated"), title: "After" });
    await pair.firstSync.syncNow();
    await pair.secondSync.syncNow();
    assert.equal(pair.second.get("task", "task-delegated").title, "After");
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

// 競合した二つは同じ版の数を持つ。解決で版を上げないと、競合の前の版での照合（AIの取り消しなど）が通り、
// 本人が選んだ中身を黙って戻してしまう（#688のレビュー）。
test("a conflict resolution gets a version neither device has seen, on both devices", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "Initial"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    pair.first.save("task", { ...pair.first.get("task", "task-a"), title: "AI edit" });
    pair.second.save("task", { ...pair.second.get("task", "task-a"), title: "My edit" });
    const seen = Math.max(
      pair.first.get("task", "task-a").version,
      pair.second.get("task", "task-a").version,
    );
    await pair.firstSync.syncNow();
    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();

    const conflict = pair.second.listSyncConflicts()[0];
    const resolution = pair.secondSync.resolveConflict(conflict.id, "local");
    assert.equal(resolution.result.entity.title, "My edit");
    assert.equal(resolution.result.entity.version, seen + 1);

    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();
    assert.equal(pair.first.syncConflictCount(), 0);
    assert.equal(pair.first.get("task", "task-a").title, "My edit");
    assert.equal(pair.first.get("task", "task-a").version, seen + 1);
  } finally {
    pair.close();
  }
});

// 両端末で同じTaskを消すと、連鎖して消える作業報告どうしが競合する。相手端末の側を選んだ解決は、
// 受け手には「中身が同じ」に見える。そこで競合を閉じないと、画面の無いNASがconflictのまま止まる。
test("a receipt conflict resolved with the other device's side closes on both devices", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-receipt", "Initial"));
    pair.first.save("work_receipt", {
      id: "receipt-a",
      task_id: "task-receipt",
      executor_kind: "ai_agent",
      executor_label: "AI",
      reported_at: "2026-08-10T00:14:25.900Z",
      summary: "first",
      completed_items: [],
      changed_or_created_items: [],
      source: "ai",
    });
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    pair.first.remove("work_receipt", "receipt-a");
    const started = Date.now();
    while (Date.now() - started < 5);
    pair.second.remove("work_receipt", "receipt-a");
    await pair.firstSync.syncNow();
    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();
    assert.equal(pair.first.syncConflictCount(), 1);
    assert.equal(pair.second.syncConflictCount(), 1);

    const conflict = pair.first.listSyncConflicts()[0];
    pair.firstSync.resolveConflict(conflict.id, "incoming");
    await pair.firstSync.syncNow();
    await pair.secondSync.syncNow();
    assert.equal(pair.first.syncConflictCount(), 0);
    assert.equal(pair.second.syncConflictCount(), 0);
    assert.equal(
      pair.second.get("work_receipt", "receipt-a", true).version,
      pair.first.get("work_receipt", "receipt-a", true).version,
    );
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
    await assert.rejects(
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

test("republishing deleted packets lets a new device join from the middle", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "First change"));
    pair.first.save("task", task("task-b", "Second change"));
    pair.first.save("task", task("task-c", "Third change"));
    await pair.firstSync.configure(pair.shared);

    const deviceDirectory = path.join(pair.shared, "devices", pair.first.deviceId);
    const files = fs.readdirSync(deviceDirectory).sort();
    assert.ok(files.length >= 3);
    fs.unlinkSync(path.join(deviceDirectory, files[0]));
    fs.unlinkSync(path.join(deviceDirectory, files[1]));

    await assert.rejects(
      () => pair.secondSync.configure(pair.shared),
      /同期差分 000000000001 を待っています/,
    );

    const repair = await pair.firstSync.republishMissing();
    assert.equal(repair.republished, 2);

    await pair.secondSync.configure(pair.shared);
    assert.equal(pair.second.get("task", "task-a").title, "First change");
    assert.equal(pair.second.get("task", "task-b").title, "Second change");
    assert.equal(pair.second.get("task", "task-c").title, "Third change");

    const repeat = await pair.firstSync.republishMissing();
    assert.equal(repeat.republished, 0);
  } finally {
    pair.close();
  }
});

test("syncNow automatically republishes deleted packets without manual republish", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "First change"));
    pair.first.save("task", task("task-b", "Second change"));
    await pair.firstSync.configure(pair.shared);

    const deviceDirectory = path.join(pair.shared, "devices", pair.first.deviceId);
    const files = fs.readdirSync(deviceDirectory).sort();
    assert.ok(files.length >= 2);
    fs.unlinkSync(path.join(deviceDirectory, files[0]));

    const status = await pair.firstSync.syncNow();
    assert.equal(status.lastAutoRepublished, 1);

    await pair.secondSync.configure(pair.shared);
    assert.equal(pair.second.get("task", "task-a").title, "First change");
    assert.equal(pair.second.get("task", "task-b").title, "Second change");
  } finally {
    pair.close();
  }
});

test("an unreadable packet file is reported as waiting instead of corrupt", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "First change"));
    pair.first.save("task", task("task-b", "Second change"));
    await pair.firstSync.configure(pair.shared);

    const deviceDirectory = path.join(pair.shared, "devices", pair.first.deviceId);
    const files = fs.readdirSync(deviceDirectory).sort();
    fs.writeFileSync(path.join(deviceDirectory, files[1]), "{partial");

    await assert.rejects(() => pair.secondSync.configure(pair.shared), /到着を待っています/);
    assert.deepEqual(pair.secondSync.status().waitingFor, {
      deviceId: pair.first.deviceId,
      sequence: 2,
    });
  } finally {
    pair.close();
  }
});

/** 正本が公開した後継revisionを、replica側の公開済み差分として書き足す。 */
function appendReceiptRevision(pair, entityId, overrides, revisionSuffix) {
  const deviceDirectory = path.join(pair.shared, "devices", pair.first.deviceId);
  const packets = fs
    .readdirSync(deviceDirectory)
    .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(deviceDirectory, name), "utf8")));
  const published = packets.find((packet) => packet.entityId === entityId);
  assert.ok(published, `${entityId} の公開済み差分が見つかりません。`);
  const sequence =
    packets.reduce((max, packet) => Math.max(max, Number(packet.deviceSequence) || 0), 0) + 1;
  const revisionId = `00000000-0000-4000-8000-0000000000${revisionSuffix}`;
  fs.writeFileSync(
    path.join(deviceDirectory, `${String(sequence).padStart(12, "0")}-${revisionId}.json`),
    JSON.stringify({
      ...published,
      changeId: revisionId,
      revisionId,
      deviceSequence: sequence,
      parentRevisionIds: [published.revisionId],
      entity: { ...published.entity, ...overrides },
    }),
  );
}

function receiptInput(overrides = {}) {
  return {
    id: "receipt-revision",
    task_id: "task-receipt",
    executor_kind: "ai_agent",
    executor_label: "AI agent",
    reported_at: "2026-08-10T00:14:25.900Z",
    summary: "first",
    completed_items: [],
    changed_or_created_items: [],
    source: "ai",
    ...overrides,
  };
}

/**
 * 正本が同じReceiptの後継revisionを公開しても、replicaはそこで止まらない。
 * 実機NASは seq197 のReceipt更新で append-only 例外を毎回投げ、2週間停止した（#588）。
 */
test("a later Work Receipt revision is applied instead of stalling the replica", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-receipt", "Receipt task"));
    pair.first.save("work_receipt", receiptInput());
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);
    assert.equal(pair.second.get("work_receipt", "receipt-revision").summary, "first");

    appendReceiptRevision(
      pair,
      "receipt-revision",
      { summary: "revised", version: 2, updated_at: "2026-08-10T00:16:07.980Z" },
      "aa",
    );

    await pair.secondSync.syncNow();
    assert.equal(pair.second.get("work_receipt", "receipt-revision").summary, "revised");
    assert.equal(pair.secondSync.status().lastError, "");
    assert.equal(pair.secondSync.status().conflictCount, 0);
  } finally {
    pair.close();
  }
});

/** 内容が同じ再公開では書き換えず、headだけ進める。 */
test("republishing an identical Work Receipt writes nothing and keeps syncing", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-receipt", "Receipt task"));
    pair.first.save("work_receipt", receiptInput());
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    appendReceiptRevision(
      pair,
      "receipt-revision",
      { version: 2, updated_at: "2026-08-10T00:20:00.000Z" },
      "bb",
    );

    await pair.secondSync.syncNow();
    const stored = pair.second.get("work_receipt", "receipt-revision");
    assert.equal(stored.summary, "first");
    assert.equal(stored.version, 1);
    assert.equal(pair.secondSync.status().lastError, "");
    assert.equal(pair.secondSync.status().conflictCount, 0);
  } finally {
    pair.close();
  }
});

function addReplacementDevice(pair) {
  const root = path.join(pair.root, "replacement");
  const database = new WorkspaceDatabase(path.join(root, "research-desk.sqlite"));
  const sync = new SharedFolderSyncService(
    database,
    () => {},
    path.join(root, "attachments", "markdown-images"),
    path.join(root, "attachments", "capture-images"),
  );
  return { database, sync };
}

/** 作成端末のリセットや同期フォルダの作り直しで、記録が持ち主の端末にしか残らない状態。 */
test("records whose author directory vanished are relayed to a replacement device", async () => {
  const pair = createPair();
  const replacement = addReplacementDevice(pair);
  try {
    pair.first.save("task", task("task-desktop", "Desktop task"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);
    pair.second.save("task", task("task-notebook", "Notebook task"));
    pair.second.save("task", {
      ...pair.second.get("task", "task-desktop"),
      title: "Desktop task edited on notebook",
    });
    await pair.secondSync.syncNow();
    await pair.firstSync.syncNow();
    assert.equal(pair.first.get("task", "task-notebook").title, "Notebook task");

    // ノート端末をリセットし、その送信履歴も共有フォルダから消えた。
    pair.second.db.close();
    fs.rmSync(path.join(pair.shared, "devices", pair.second.deviceId), { recursive: true });

    await pair.firstSync.syncNow();
    await replacement.sync.configure(pair.shared);
    assert.equal(replacement.database.get("task", "task-notebook").title, "Notebook task");
    assert.equal(
      replacement.database.get("task", "task-desktop").title,
      "Desktop task edited on notebook",
    );
    assert.equal(replacement.database.syncConflictCount(), 0);

    // 中継後の編集は通常の後継Revisionとして戻る。
    replacement.database.save("task", {
      ...replacement.database.get("task", "task-notebook"),
      title: "Edited after reset",
    });
    await replacement.sync.syncNow();
    await pair.firstSync.syncNow();
    assert.equal(pair.first.get("task", "task-notebook").title, "Edited after reset");
    assert.equal(pair.first.syncConflictCount(), 0);

    // 中継済みのRevisionは二度送らず、受け取った端末も再び中継しない。
    const present = new Set(fs.readdirSync(path.join(pair.shared, "devices")));
    assert.equal(pair.first.enqueueOrphanSyncRelays(present), 0);
    assert.equal(replacement.database.enqueueOrphanSyncRelays(present), 0);
  } finally {
    if (replacement.database.db.open) replacement.database.db.close();
    pair.close();
  }
});

test("a relay never overwrites or conflicts with a newer local revision", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "Original"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);
    pair.second.save("task", { ...pair.second.get("task", "task-a"), title: "Newer on notebook" });

    const result = pair.second.applySyncPacket({
      format: "tasken-sync-change",
      formatVersion: 1,
      workspaceId: pair.first.workspaceId,
      changeId: "relay-change",
      revisionId: "stale-revision",
      parentRevisionIds: [],
      deviceId: pair.first.deviceId,
      deviceSequence: 99,
      entityType: "task",
      entityId: "task-a",
      entity: { ...pair.first.get("task", "task-a"), title: "Stale relay" },
      createdAt: new Date().toISOString(),
      relay: true,
    });
    assert.equal(result.status, "duplicate");
    assert.equal(pair.second.get("task", "task-a").title, "Newer on notebook");
    assert.equal(pair.second.syncConflictCount(), 0);
  } finally {
    pair.close();
  }
});

test("更新前の端末の同期差分が運ぶ ai_visibility / default_ai_visibility は、拒否せず捨てて取り込む", () => {
  // 廃止した概念。拒否するとNAS replicaの同期が止まるので、受け取って保存せずに捨てる。
  const pair = createPair();
  try {
    const packet = (type, entity, sequence) => ({
      format: "tasken-sync-change",
      formatVersion: 1,
      workspaceId: pair.second.workspaceId,
      changeId: `legacy-${type}-${sequence}`,
      revisionId: `legacy-${type}-${sequence}`,
      parentRevisionIds: [],
      deviceId: pair.first.deviceId,
      deviceSequence: sequence,
      entityType: type,
      entityId: entity.id,
      entity: {
        created_at: "2026-11-01T00:00:00.000Z",
        updated_at: "2026-11-01T00:00:00.000Z",
        deleted_at: null,
        version: 1,
        ...entity,
      },
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    const taskResult = pair.second.applySyncPacket(
      packet("task", task("task-legacy", "旧形式", { ai_visibility: ["m365", "external_ai"] }), 1),
    );
    const nullResult = pair.second.applySyncPacket(
      packet("task", task("task-legacy-null", "旧形式の未設定", { ai_visibility: null }), 2),
    );
    const themeResult = pair.second.applySyncPacket(
      packet(
        "theme",
        {
          id: "theme-legacy",
          name: "旧Theme",
          default_ai_visibility: [],
          ai_visibility: ["slack"],
        },
        3,
      ),
    );
    assert.deepEqual(
      [taskResult.status, nullResult.status, themeResult.status],
      ["applied", "applied", "applied"],
    );
    for (const [type, id] of [
      ["task", "task-legacy"],
      ["task", "task-legacy-null"],
      ["theme", "theme-legacy"],
    ]) {
      const stored = pair.second.get(type, id);
      assert.ok(stored, `${id} は取り込まれる`);
      assert.equal("ai_visibility" in stored, false, `${id} の ai_visibility は捨てる`);
      assert.equal(
        "default_ai_visibility" in stored,
        false,
        `${id} の default_ai_visibility は捨てる`,
      );
    }
    assert.equal(pair.second.get("task", "task-legacy").title, "旧形式");
  } finally {
    pair.close();
  }
});

// ---- 鮮度（#701）: devices/<id>/status.json と sourceStatus ----

const T0 = Date.parse("2026-11-01T00:00:00.000Z");
const MINUTE = 60_000;

function statusFile(pair, device) {
  return path.join(pair.shared, "devices", device.deviceId, "status.json");
}

function readStatus(pair, device) {
  return JSON.parse(fs.readFileSync(statusFile(pair, device), "utf8"));
}

function packetFiles(pair, device) {
  return fs
    .readdirSync(path.join(pair.shared, "devices", device.deviceId))
    .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
    .sort();
}

test("各端末は公開の進みを status.json に置き、進みが無ければ10分は書き直さない", async () => {
  const pair = createPair();
  try {
    let now = T0;
    pair.firstSync.clock = () => now;
    assert.equal(pair.firstSync.sourceStatus().state, "off");

    pair.first.save("task", task("task-a", "Desktop task"));
    await pair.firstSync.configure(pair.shared);
    const published = packetFiles(pair, pair.first).length;
    assert.deepEqual(readStatus(pair, pair.first), {
      format: "tasken-device-status",
      formatVersion: 1,
      deviceId: pair.first.deviceId,
      role: "desktop",
      publishedThrough: published,
      at: new Date(T0).toISOString(),
      // この版の Desktop が取り込める形（印の最後）。replica が書き込みを断る判定に使う。
      syncShape: aiItemPacketFlags.at(-1).shape_sha256,
    });

    now = T0 + 5 * MINUTE;
    await pair.firstSync.syncNow();
    assert.equal(readStatus(pair, pair.first).at, new Date(T0).toISOString(), "書き直さない");

    now = T0 + 11 * MINUTE;
    await pair.firstSync.syncNow();
    assert.equal(readStatus(pair, pair.first).at, new Date(now).toISOString(), "10分後に書き直す");

    now = T0 + 12 * MINUTE;
    pair.first.save("task", task("task-b", "Second"));
    await pair.firstSync.syncNow();
    assert.equal(readStatus(pair, pair.first).publishedThrough, published + 1, "進めば直ちに書く");
    assert.equal(readStatus(pair, pair.first).at, new Date(now).toISOString());
  } finally {
    pair.close();
  }
});

test("replica は Desktop の status.json から as_of を出し、取り込めば ok になる", async () => {
  const pair = createPair();
  try {
    pair.firstSync.clock = () => T0;
    pair.secondSync.clock = () => T0 + MINUTE;
    pair.first.save("task", task("task-a", "Desktop task"));
    await pair.firstSync.configure(pair.shared);
    assert.equal(pair.secondSync.sourceStatus().state, "off");
    await pair.secondSync.configure(pair.shared);

    assert.deepEqual(pair.secondSync.sourceStatus("replica"), {
      node: "replica",
      state: "ok",
      as_of: new Date(T0).toISOString(),
      desktop_seen_at: new Date(T0).toISOString(),
    });
  } finally {
    pair.close();
  }
});

test("replica は syncShape を出す Desktop の status だけを数え、syncShape の無い Desktop は数えない", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "Desktop task"));
    await pair.firstSync.configure(pair.shared);

    // この仕組みより前の版の Desktop が置く、syncShape の無い status.json。
    const legacy = path.join(pair.shared, "devices", "legacy-desktop");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, "status.json"),
      JSON.stringify({
        format: "tasken-device-status",
        formatVersion: 1,
        deviceId: "legacy-desktop",
        role: "desktop",
        publishedThrough: 0,
        at: new Date().toISOString(),
      }),
    );
    await pair.secondSync.configure(pair.shared);

    const counted = pair.secondSync.desktopStatuses();
    assert.deepEqual(
      counted.map((status) => status.deviceId),
      [pair.first.deviceId],
    );
    assert.equal(counted[0].syncShape, aiItemPacketFlags.at(-1).shape_sha256);
    assert.equal(
      "syncShape" in readStatus(pair, pair.second),
      false,
      "replica の status には付けない",
    );
  } finally {
    pair.close();
  }
});

test("鮮度を追わない端末（Desktop）は、他端末の status.json を読まない", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "Desktop task"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);
    await pair.firstSync.syncNow();

    assert.equal(fs.existsSync(statusFile(pair, pair.second)), true, "replica も自分の分は書く");
    assert.deepEqual(pair.firstSync.sourceStatus("desktop"), {
      node: "desktop",
      state: "ok",
      as_of: null,
      desktop_seen_at: null,
    });
  } finally {
    pair.close();
  }
});

test("status.json を書けなくても差分の同期は止まらず、失敗は一度だけ出す", async (t) => {
  const pair = createPair();
  const errors = t.mock.method(console, "error", () => {});
  try {
    // 同じ名前のディレクトリがあると、上書きの rename が失敗する（OneDrive 等が掴んでいる場面の代わり）。
    const blocked = statusFile(pair, pair.first);
    fs.mkdirSync(blocked, { recursive: true });
    pair.first.save("task", task("task-a", "Desktop task"));

    await pair.firstSync.configure(pair.shared);
    await pair.firstSync.syncNow();
    await pair.secondSync.configure(pair.shared);

    assert.equal(pair.second.get("task", "task-a")?.title, "Desktop task", "差分は届く");
    assert.equal(pair.firstSync.sourceStatus().state, "ok");
    const leftovers = fs.readdirSync(path.dirname(blocked)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, [], "一時ファイルを残さない");
    const statusErrors = errors.mock.calls.filter((call) =>
      String(call.arguments[0]).includes("status.json"),
    );
    assert.equal(statusErrors.length, 1);
  } finally {
    pair.close();
  }
});

test("差分が届いていない間の as_of は前に追いついた時刻のままで、waiting_packet になる", async () => {
  const pair = createPair();
  try {
    pair.firstSync.clock = () => T0;
    pair.secondSync.clock = () => T0;
    pair.first.save("task", task("task-a", "A"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);
    const caughtUp = pair.second.syncCursor(pair.first.deviceId);

    const later = T0 + 2 * MINUTE;
    pair.firstSync.clock = () => later;
    pair.secondSync.clock = () => later;
    pair.first.save("task", task("task-b", "B"));
    pair.first.save("task", task("task-c", "C"));
    await pair.firstSync.syncNow();
    const missing = packetFiles(pair, pair.first).filter(
      (name) => Number(name.slice(0, 12)) > caughtUp,
    );
    assert.ok(missing.length >= 2);
    fs.unlinkSync(path.join(pair.shared, "devices", pair.first.deviceId, missing[0]));

    await assert.rejects(() => pair.secondSync.syncNow(), /を待っています/);
    assert.deepEqual(pair.secondSync.sourceStatus(), {
      node: "replica",
      state: "waiting_packet",
      as_of: new Date(T0).toISOString(),
      desktop_seen_at: new Date(later).toISOString(),
    });

    // 再公開で届けば、as_of は新しい status.json の時刻まで進み ok に戻る。
    await pair.firstSync.republishMissing();
    await pair.secondSync.syncNow();
    const state = pair.secondSync.sourceStatus();
    assert.equal(state.state, "ok");
    assert.equal(state.as_of, new Date(later).toISOString());
  } finally {
    pair.close();
  }
});

test("検査で拒否された差分は blocked になる", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "A"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    const directory = path.join(pair.shared, "devices", pair.first.deviceId);
    const files = packetFiles(pair, pair.first);
    const latest = JSON.parse(fs.readFileSync(path.join(directory, files.at(-1)), "utf8"));
    const sequence = latest.deviceSequence + 1;
    const rejected = {
      ...latest,
      changeId: "00000000-0000-4000-8000-000000000a01",
      revisionId: "00000000-0000-4000-8000-000000000a01",
      deviceSequence: sequence,
      entityType: "retired_kind",
    };
    fs.writeFileSync(
      path.join(directory, `${String(sequence).padStart(12, "0")}-${rejected.changeId}.json`),
      JSON.stringify(rejected),
    );
    await assert.rejects(() => pair.secondSync.syncNow());
    assert.equal(pair.secondSync.sourceStatus().state, "blocked");
    assert.equal(pair.second.syncCursor(pair.first.deviceId), sequence - 1);
  } finally {
    pair.close();
  }
});

test("端末情報の不一致も blocked で、直って同期できれば ok に戻る", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "A"));
    await pair.firstSync.configure(pair.shared);
    const directory = path.join(pair.shared, "devices", pair.first.deviceId);
    const [name] = packetFiles(pair, pair.first);
    const original = fs.readFileSync(path.join(directory, name), "utf8");
    const packet = JSON.parse(original);
    fs.writeFileSync(
      path.join(directory, name),
      JSON.stringify({ ...packet, deviceId: "another-device" }),
    );
    await assert.rejects(() => pair.secondSync.configure(pair.shared), /端末情報が一致しません/);
    assert.equal(pair.secondSync.sourceStatus().state, "blocked");

    fs.writeFileSync(path.join(directory, name), original);
    await pair.secondSync.syncNow();
    assert.equal(pair.secondSync.sourceStatus().state, "ok");
  } finally {
    pair.close();
  }
});

test("競合があれば conflict、それ以外の失敗は io_error", async () => {
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
    assert.equal(pair.firstSync.sourceStatus().state, "conflict");

    fs.writeFileSync(path.join(pair.shared, "tasken-sync.json"), "{broken");
    await assert.rejects(() => pair.firstSync.syncNow());
    assert.equal(pair.firstSync.sourceStatus().state, "io_error");
  } finally {
    pair.close();
  }
});

test("14日より古い status.json の端末は Desktop として数えない", async () => {
  const pair = createPair();
  try {
    pair.firstSync.clock = () => T0;
    pair.secondSync.clock = () => T0 + 15 * 24 * 60 * MINUTE;
    pair.first.save("task", task("task-a", "A"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);

    assert.deepEqual(pair.secondSync.sourceStatus(), {
      node: "replica",
      state: "ok",
      as_of: null,
      desktop_seen_at: null,
    });
    assert.equal(pair.second.get("task", "task-a").title, "A", "取り込み自体は止まらない");
  } finally {
    pair.close();
  }
});

test("読めない・形が違う status.json は無視し、status.json があっても取り込みと再公開は変わらない", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "A"));
    pair.first.save("task", task("task-b", "B"));
    await pair.firstSync.configure(pair.shared);

    const stranger = path.join(pair.shared, "devices", "stranger-device");
    fs.mkdirSync(stranger, { recursive: true });
    fs.writeFileSync(path.join(stranger, "status.json"), "{partial");
    const shaky = path.join(pair.shared, "devices", "shaky-device");
    fs.mkdirSync(shaky, { recursive: true });
    fs.writeFileSync(
      path.join(shaky, "status.json"),
      JSON.stringify({ format: "tasken-device-status", formatVersion: 1, publishedThrough: "x" }),
    );

    const directory = path.join(pair.shared, "devices", pair.first.deviceId);
    fs.unlinkSync(path.join(directory, packetFiles(pair, pair.first)[0]));
    assert.equal((await pair.firstSync.republishMissing()).republished, 1);
    assert.equal(fs.existsSync(path.join(directory, "status.json")), true);

    await pair.secondSync.configure(pair.shared);
    assert.equal(pair.second.get("task", "task-a").title, "A");
    assert.equal(pair.second.get("task", "task-b").title, "B");
    const source = pair.secondSync.sourceStatus();
    assert.equal(source.state, "ok");
    assert.ok(source.as_of, "壊れた status.json があっても Desktop の as_of は出る");
  } finally {
    pair.close();
  }
});

// ---- 鮮度の取りこぼし（reviewer の指摘） ----

/** createPair の共有フォルダに、もう一台参加させる。 */
function extraNode(pair, name, options) {
  const dir = path.join(pair.root, name);
  const db = new WorkspaceDatabase(path.join(dir, "research-desk.sqlite"));
  const sync = new SharedFolderSyncService(
    db,
    () => {},
    path.join(dir, "attachments", "markdown-images"),
    path.join(dir, "attachments", "capture-images"),
    options,
  );
  return { db, sync };
}

test("追いついていない Desktop の status.json が一度読めなくても、as_of は進まない", async () => {
  const pair = createPair();
  const b = extraNode(pair, "desktop-b");
  try {
    pair.firstSync.clock = () => T0;
    b.sync.clock = () => T0;
    pair.secondSync.clock = () => T0 + MINUTE;
    pair.first.save("task", task("task-a", "A"));
    await pair.firstSync.configure(pair.shared);
    await b.sync.configure(pair.shared);
    // B は replica がまだ受け取っていない差分まで公開した、と status.json が言う。
    const bStatusPath = path.join(pair.shared, "devices", b.db.deviceId, "status.json");
    const bStatus = JSON.parse(fs.readFileSync(bStatusPath, "utf8"));
    fs.writeFileSync(
      bStatusPath,
      JSON.stringify({ ...bStatus, publishedThrough: bStatus.publishedThrough + 5 }),
    );
    await pair.secondSync.configure(pair.shared);
    assert.equal(pair.secondSync.sourceStatus().as_of, null);

    fs.writeFileSync(bStatusPath, "{partial");
    await pair.secondSync.syncNow();
    assert.equal(
      pair.secondSync.sourceStatus().as_of,
      null,
      "前に読めた status で遅れを覚えている",
    );
  } finally {
    b.db.db.close();
    pair.close();
  }
});

test("status.json を出さない端末に取り込めていない差分があれば as_of は null、取り込めば数えない", async () => {
  const pair = createPair();
  const old = extraNode(pair, "old-desktop");
  try {
    pair.firstSync.clock = () => T0;
    pair.secondSync.clock = () => T0;
    old.sync.clock = () => T0;
    pair.first.save("task", task("task-a", "A"));
    await pair.firstSync.configure(pair.shared);
    await old.sync.configure(pair.shared);
    // 旧版の Desktop のように status.json を出さない（replica は一度も読めていない）。
    fs.rmSync(path.join(pair.shared, "devices", old.db.deviceId, "status.json"));
    await pair.secondSync.configure(pair.shared);
    assert.equal(pair.secondSync.sourceStatus().as_of, new Date(T0).toISOString());

    old.db.save("task", task("task-o1", "O1"));
    old.db.save("task", task("task-o2", "O2"));
    await old.sync.syncNow();
    const directory = path.join(pair.shared, "devices", old.db.deviceId);
    const published = fs.readdirSync(directory).filter((n) => SYNC_PACKET_FILE_PATTERN.test(n));
    const cursor = pair.second.syncCursor(old.db.deviceId);
    const ahead = published.filter((n) => Number(n.slice(0, 12)) > cursor).sort();
    assert.ok(ahead.length >= 2);
    fs.renameSync(path.join(directory, ahead[0]), path.join(directory, `${ahead[0]}.away`));
    fs.rmSync(path.join(directory, "status.json"));

    await assert.rejects(() => pair.secondSync.syncNow(), /を待っています/);
    assert.equal(pair.secondSync.sourceStatus().as_of, null);

    fs.renameSync(path.join(directory, `${ahead[0]}.away`), path.join(directory, ahead[0]));
    await pair.secondSync.syncNow();
    assert.equal(pair.secondSync.sourceStatus().as_of, new Date(T0).toISOString());
  } finally {
    old.db.db.close();
    pair.close();
  }
});

test("replica の status.json は数えない。残った replica の個体が as_of を張り付かせない", async () => {
  const pair = createPair();
  const other = extraNode(pair, "other-replica", { role: "replica" });
  try {
    pair.firstSync.clock = () => T0;
    pair.secondSync.clock = () => T0 + MINUTE;
    other.sync.clock = () => T0 + 2 * MINUTE;
    pair.first.save("task", task("task-a", "A"));
    await pair.firstSync.configure(pair.shared);
    await pair.secondSync.configure(pair.shared);
    await other.sync.configure(pair.shared);
    pair.second.save("task", task("task-s1", "S1"));
    pair.second.save("task", task("task-s2", "S2"));
    await pair.secondSync.syncNow();
    const directory = path.join(pair.shared, "devices", pair.second.deviceId);
    const own = fs.readdirSync(directory).filter((n) => SYNC_PACKET_FILE_PATTERN.test(n));
    assert.equal(readStatus(pair, pair.second).role, "replica");
    // other はまだ replica の差分を受け取っていない（status.json は先へ進んでいる）。
    fs.rmSync(path.join(directory, own.sort()[0]));
    await assert.rejects(() => other.sync.syncNow(), /を待っています/);

    assert.deepEqual(other.sync.sourceStatus(), {
      node: "replica",
      state: "waiting_packet",
      as_of: new Date(T0).toISOString(),
      desktop_seen_at: new Date(T0).toISOString(),
    });
  } finally {
    other.db.db.close();
    pair.close();
  }
});

test("14日を超えた status.json でも、追いついていなければ as_of は null", async () => {
  const pair = createPair();
  try {
    pair.firstSync.clock = () => T0;
    pair.secondSync.clock = () => T0 + 15 * 24 * 60 * MINUTE;
    pair.first.save("task", task("task-a", "A"));
    pair.first.save("task", task("task-b", "B"));
    await pair.firstSync.configure(pair.shared);
    const directory = path.join(pair.shared, "devices", pair.first.deviceId);
    fs.rmSync(path.join(directory, packetFiles(pair, pair.first)[0]));
    await assert.rejects(() => pair.secondSync.configure(pair.shared), /を待っています/);

    const source = pair.secondSync.sourceStatus();
    assert.equal(source.as_of, null);
    assert.equal(source.desktop_seen_at, new Date(T0).toISOString());
  } finally {
    pair.close();
  }
});

test("この版で取り込めない差分は、code の無い例外でも blocked。DBの失敗は io_error", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "A"));
    await pair.firstSync.configure(pair.shared);
    const apply = pair.second.applySyncPacket.bind(pair.second);
    pair.second.applySyncPacket = () => {
      throw new Error("append-only の規則に反します");
    };
    await assert.rejects(() => pair.secondSync.configure(pair.shared), /append-only/);
    assert.equal(pair.secondSync.sourceStatus().state, "blocked");

    pair.second.applySyncPacket = () => {
      throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    };
    await assert.rejects(() => pair.secondSync.syncNow(), /locked/);
    assert.equal(pair.secondSync.sourceStatus().state, "io_error");

    pair.second.applySyncPacket = apply;
    await pair.secondSync.syncNow();
    assert.equal(pair.secondSync.sourceStatus().state, "ok");
  } finally {
    pair.close();
  }
});

test("status.json を書けなかったら、1分は書きに行かない", async () => {
  const pair = createPair();
  try {
    let now = T0;
    pair.firstSync.clock = () => now;
    pair.first.save("task", task("task-a", "A"));
    await pair.firstSync.configure(pair.shared);
    const target = statusFile(pair, pair.first);
    fs.rmSync(target);
    fs.mkdirSync(target); // rename が失敗する
    pair.first.save("task", task("task-b", "B"));
    now = T0 + 5_000;
    await pair.firstSync.syncNow();
    fs.rmSync(target, { recursive: true });
    now = T0 + 20_000;
    await pair.firstSync.syncNow();
    assert.equal(fs.existsSync(target), false, "1分たつまで書き直さない");
    now = T0 + 70_000;
    await pair.firstSync.syncNow();
    assert.equal(readStatus(pair, pair.first).role, "desktop");
  } finally {
    pair.close();
  }
});

test("同期の途中で呼ばれた syncNow は、呼ばれる前に保存した変更も公開してから終わる", async () => {
  const pair = createPair();
  try {
    await pair.firstSync.configure(pair.shared);
    // 定期の同期が、新しい変更を保存する前に始まり、取り込みの段で止まっている状況を作る。
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const receive = pair.firstSync.receiveChanges.bind(pair.firstSync);
    pair.firstSync.receiveChanges = async (directory) => {
      await gate;
      return receive(directory);
    };
    const inFlight = pair.firstSync.syncNow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    pair.first.save("task", task("task-late", "同期の途中で保存したTask"));
    const requested = pair.firstSync.syncNow();
    release();
    await inFlight;
    await requested;
    pair.firstSync.receiveChanges = receive;
    await pair.secondSync.configure(pair.shared);
    assert.equal(pair.second.get("task", "task-late")?.title, "同期の途中で保存したTask");
  } finally {
    pair.close();
  }
});

test("古い写しへ戻したDBは、連番が重なる前に公開と取り込みを止める（blocked）", async () => {
  const pair = createPair();
  try {
    pair.first.save("task", task("task-a", "公開済み1"));
    await pair.firstSync.configure(pair.shared);
    const deviceIdBefore = pair.first.deviceId;
    const snapshot = path.join(pair.root, "old-snapshot.sqlite");
    await pair.first.backupTo(snapshot);
    // 写しを取った後も、連番は先へ進み、共有フォルダへ公開される。
    pair.first.save("task", task("task-b", "写しの後の変更"));
    await pair.firstSync.syncNow();
    const deviceDirectory = path.join(pair.shared, "devices", pair.first.deviceId);
    const published = fs
      .readdirSync(deviceDirectory)
      .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name));
    assert.ok(published.length >= 2);
    const publishedSequence = pair.first.syncDeviceSequence();

    // 本人が古い写しをDBの場所へ戻した状況（同じdevice ID、連番は後戻り）。
    pair.first.db.close();
    fs.copyFileSync(snapshot, path.join(pair.root, "first", "research-desk.sqlite"));
    const restored = new WorkspaceDatabase(path.join(pair.root, "first", "research-desk.sqlite"));
    const restoredSync = new SharedFolderSyncService(
      restored,
      () => {},
      pair.firstAttachments,
      pair.firstPhotos,
      {
        role: "replica",
      },
    );
    try {
      assert.equal(restored.deviceId, deviceIdBefore);
      assert.ok(restored.syncDeviceSequence() < publishedSequence);
      restored.save("task", task("task-c", "戻した後の別の変更"));
      await restoredSync.syncNow().then(
        () => assert.fail("連番の後戻りは止まるはず"),
        (error) => assert.equal(error.code, "SYNC_SEQUENCE_ROLLBACK"),
      );
      assert.equal(restoredSync.isPublishBlocked(), true);
      assert.equal(restoredSync.sourceStatus("replica").state, "blocked");
      // 共有フォルダには、連番を使い回した差分を書いていない。
      const after = fs
        .readdirSync(deviceDirectory)
        .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name));
      assert.deepEqual(after.sort(), published.sort());
    } finally {
      await restoredSync.stop();
      restored.db.close();
    }
  } finally {
    pair.close();
  }
});
