import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  SharedFolderSyncService,
  SYNC_PACKET_FILE_PATTERN,
} from "../src/main/services/sharedFolderSync.mjs";

// 同期フォルダの引っ越し（段 5・#813／設計 #803 2.1）の受け入れ試験。
// 架空の端末・Workspace だけで確かめる。

function task(id, title, overrides = {}) {
  return {
    id,
    title,
    state: "todo",
    priority: "normal",
    ...overrides,
  };
}

function createSetup({ secondRole = "desktop" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-sync-relocation-test-"));
  const shared = path.join(root, "old-shared");
  const taskenRoot = path.join(root, "tasken-root");
  const firstRoot = path.join(root, "first");
  const secondRoot = path.join(root, "second");
  const first = new WorkspaceDatabase(path.join(firstRoot, "research-desk.sqlite"));
  const second = new WorkspaceDatabase(path.join(secondRoot, "research-desk.sqlite"));
  const firstSync = new SharedFolderSyncService(
    first,
    () => {},
    path.join(firstRoot, "attachments", "markdown-images"),
    path.join(firstRoot, "attachments", "capture-images"),
  );
  const secondSync = new SharedFolderSyncService(
    second,
    () => {},
    path.join(secondRoot, "attachments", "markdown-images"),
    path.join(secondRoot, "attachments", "capture-images"),
    secondRole === "replica" ? { role: "replica" } : {},
  );
  // 引っ越しを実行する端末（first）だけ Tasken ルートを持つ。
  first.setPreference("artifactDirectory", taskenRoot);
  return {
    root,
    shared,
    taskenRoot,
    newShared: path.join(taskenRoot, "Sync"),
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function packetFiles(directory, deviceId) {
  const deviceDirectory = path.join(directory, "devices", deviceId);
  if (!fs.existsSync(deviceDirectory)) return [];
  return fs
    .readdirSync(deviceDirectory)
    .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
    .sort();
}

test("relocation gate stops while a replica participates, naming the NAS reason", async () => {
  const setup = createSetup({ secondRole: "replica" });
  try {
    setup.first.save("task", task("task-a", "Desktop task"));
    await setup.firstSync.configure(setup.shared);
    await setup.secondSync.configure(setup.shared);

    await assert.rejects(setup.firstSync.relocateSyncFolder(), /TASKEN_SYNC_DIRECTORY/);
    // 止まったので、古い場所の manifest は移行の印に変わっていない。
    assert.equal(readJson(path.join(setup.shared, "tasken-sync.json")).formatVersion, 1);
    assert.equal(setup.first.getPreference("sharedSyncDirectory"), setup.shared);
  } finally {
    setup.close();
  }
});

test("relocation gate stops and names a device without the relocatable mark", async () => {
  const setup = createSetup();
  try {
    setup.first.save("task", task("task-a", "Desktop task"));
    await setup.firstSync.configure(setup.shared);
    await setup.secondSync.configure(setup.shared);

    // 古い版の端末が置いた status.json（引っ越しの印が無い）を再現する。
    const legacyId = "legacy-device-xyz";
    const legacyDirectory = path.join(setup.shared, "devices", legacyId);
    fs.mkdirSync(legacyDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDirectory, "status.json"),
      `${JSON.stringify(
        {
          format: "tasken-device-status",
          formatVersion: 1,
          deviceId: legacyId,
          role: "desktop",
          publishedThrough: 0,
          at: new Date().toISOString(),
          syncShape: "0".repeat(64),
        },
        null,
        2,
      )}\n`,
    );

    await assert.rejects(setup.firstSync.relocateSyncFolder(), new RegExp(legacyId));
    assert.equal(readJson(path.join(setup.shared, "tasken-sync.json")).formatVersion, 1);
    assert.equal(setup.first.getPreference("sharedSyncDirectory"), setup.shared);
  } finally {
    setup.close();
  }
});

test("relocation moves the sync folder, peers follow, and sync continues at the new location", async () => {
  const setup = createSetup();
  try {
    setup.first.save("task", task("task-a", "Desktop task"));
    await setup.firstSync.configure(setup.shared);
    await setup.secondSync.configure(setup.shared);
    assert.equal(setup.second.get("task", "task-a").title, "Desktop task");

    const result = await setup.firstSync.relocateSyncFolder();
    assert.equal(result.to, setup.newShared);
    assert.equal(setup.first.getPreference("sharedSyncDirectory"), setup.newShared);

    // 古い場所には道しるべが残り、場所自体は消えていない。
    const marker = readJson(path.join(setup.shared, "tasken-sync.json"));
    assert.equal(marker.formatVersion, 2);
    assert.equal(marker.relocatedTo.workspaceId, setup.first.workspaceId);
    assert.equal(path.resolve(setup.shared, marker.relocatedTo.relativePath), setup.newShared);
    assert.ok(packetFiles(setup.shared, setup.first.deviceId).length > 0);
    assert.ok(
      fs.existsSync(path.join(setup.shared, "devices", setup.second.deviceId, "status.json")),
    );

    // 新しい場所には移行前の manifest と端末フォルダがそろっている。
    assert.equal(readJson(path.join(setup.newShared, "tasken-sync.json")).formatVersion, 1);
    assert.ok(packetFiles(setup.newShared, setup.first.deviceId).length > 0);
    assert.ok(
      fs.existsSync(path.join(setup.newShared, "devices", setup.second.deviceId, "status.json")),
    );

    // 相手端末は次の同期で道しるべに従って切り替える。
    await setup.secondSync.syncNow();
    assert.equal(setup.second.getPreference("sharedSyncDirectory"), setup.newShared);

    // 切り替え後も新しい場所で同期が続く。
    setup.first.save("task", task("task-b", "After relocation"));
    await setup.firstSync.syncNow();
    await setup.secondSync.syncNow();
    assert.equal(setup.second.get("task", "task-b").title, "After relocation");
  } finally {
    setup.close();
  }
});

test("a diff written to the old location during the copy still arrives at the new location", async () => {
  const setup = createSetup();
  try {
    setup.first.save("task", task("task-a", "Desktop task"));
    await setup.firstSync.configure(setup.shared);
    await setup.secondSync.configure(setup.shared);

    await setup.firstSync.relocateSyncFolder({
      // 写している最中に、相手端末が古い場所へ新しい差分を書く。
      afterCopyPass: async () => {
        setup.second.save("task", task("task-during", "Written during copy"));
        await setup.secondSync.syncNow();
      },
    });

    // 2 回目の写しで拾われ、新しい場所の相手端末フォルダに届いている。
    const arrived = packetFiles(setup.newShared, setup.second.deviceId).some((name) =>
      fs
        .readFileSync(path.join(setup.newShared, "devices", setup.second.deviceId, name), "utf8")
        .includes("task-during"),
    );
    assert.ok(arrived);
    // 引っ越しを実行した端末も、切り替え後の同期で取り込めている。
    assert.equal(setup.first.get("task", "task-during").title, "Written during copy");
  } finally {
    setup.close();
  }
});

test("an old-version device stops on the relocated marker instead of writing to the old location", async () => {
  const setup = createSetup();
  try {
    setup.first.save("task", task("task-a", "Desktop task"));
    await setup.firstSync.configure(setup.shared);
    await setup.secondSync.configure(setup.shared);
    await setup.firstSync.relocateSyncFolder();

    // 古い版の端末は manifest の formatVersion !== 1 を「壊れています」で止める
    // （readManifest は旧版も使う検査そのもの）。
    await assert.rejects(setup.firstSync.readManifest(setup.shared), /壊れています/);
  } finally {
    setup.close();
  }
});

test("a peer that cannot verify the new location stops and keeps its pending changes local", async () => {
  const setup = createSetup();
  try {
    setup.first.save("task", task("task-a", "Desktop task"));
    await setup.firstSync.configure(setup.shared);
    await setup.secondSync.configure(setup.shared);
    await setup.firstSync.relocateSyncFolder();

    // 新しい場所がそろっていない（相手の status.json が届いていない）状態にする。
    fs.rmSync(path.join(setup.newShared, "devices", setup.second.deviceId, "status.json"));

    const before = packetFiles(setup.shared, setup.second.deviceId);
    setup.second.save("task", task("task-pending", "Stays local"));
    await assert.rejects(setup.secondSync.syncNow(), /移りました/);

    // 黙って古い場所へ書かず、送信待ちは手元に残り、向き先も変わっていない。
    assert.deepEqual(packetFiles(setup.shared, setup.second.deviceId), before);
    assert.ok(setup.second.syncPendingCount() > 0);
    assert.equal(setup.second.getPreference("sharedSyncDirectory"), setup.shared);
    assert.match(setup.second.getPreference("sharedSyncLastError"), /移りました/);
  } finally {
    setup.close();
  }
});
