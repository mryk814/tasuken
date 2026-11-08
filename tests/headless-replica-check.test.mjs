import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkSyncPackets,
  errorDigest,
  isWaitingSyncError,
  probeMcp,
  readReplicaState,
  runReplicaCheck,
} from "../src/main/headless/replicaCheck.ts";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  SharedFolderSyncService,
  SYNC_PACKET_FILE_PATTERN,
} from "../src/main/services/sharedFolderSync.mjs";

// NASのreplicaを入れ替えるときの版ずれの検査。Desktop役とreplica役を同じ共有フォルダで
// 本物の同期にかけ、取り込めない差分を「この版では読めない」と判定できるかを確かめる。

function task(id, title) {
  return { id, title, state: "todo", priority: "normal" };
}

async function createDesktopAndReplica() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-replica-check-"));
  const shared = path.join(root, "sync");
  const open = (name) => {
    const database = new WorkspaceDatabase(path.join(root, name, "research-desk.sqlite"));
    const service = new SharedFolderSyncService(
      database,
      () => {},
      path.join(root, name, "attachments", "markdown-images"),
      path.join(root, name, "attachments", "capture-images"),
    );
    return { database, service, databasePath: path.join(root, name, "research-desk.sqlite") };
  };
  const desktop = open("desktop");
  const replica = open("replica");
  desktop.database.save("task", task("task-a", "架空のTask"));
  await desktop.service.configure(shared);
  await replica.service.configure(shared);
  const deviceDirectory = path.join(shared, "devices", desktop.database.deviceId);
  return {
    root,
    shared,
    desktop,
    replica,
    deviceDirectory,
    /** Desktopの最新の差分ファイル（未来の版が書いたことにして中身を変える）。 */
    latestDesktopPacket() {
      const files = fs
        .readdirSync(deviceDirectory)
        .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name));
      return path.join(deviceDirectory, files.sort().at(-1));
    },
    close() {
      for (const node of [desktop, replica]) if (node.database.db.open) node.database.db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function rewriteJson(filePath, change) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  change(value);
  fs.writeFileSync(filePath, JSON.stringify(value));
}

test("packets: 今の版が書いた差分は読める", async () => {
  const world = await createDesktopAndReplica();
  try {
    const result = checkSyncPackets(world.shared);
    assert.equal(result.compatible, true);
    assert.equal(result.manifest_ok, true);
    assert.ok(result.checked >= 1);
    assert.deepEqual(result.rejected, []);
  } finally {
    world.close();
  }
});

test("packets: この版の知らないEntityの差分を版ずれとし、中身を出さない", async () => {
  const world = await createDesktopAndReplica();
  try {
    world.desktop.database.save("task", task("task-b", "秘密の本文を含む題"));
    await world.desktop.service.syncNow();
    rewriteJson(world.latestDesktopPacket(), (packet) => {
      packet.entityType = "future_kind";
    });
    const result = checkSyncPackets(world.shared);
    assert.equal(result.compatible, false);
    assert.equal(result.rejected_total, 1);
    assert.equal(result.rejected[0].entity_type, "future_kind");
    assert.equal(result.rejected[0].device, world.desktop.database.deviceId.slice(0, 8));
    assert.doesNotMatch(JSON.stringify(result), /秘密の本文/);
  } finally {
    world.close();
  }
});

test("packets: 取り込み済みの古い差分の拒否では止めず、数だけ出す", async () => {
  const world = await createDesktopAndReplica();
  try {
    // いちばん古い差分（task-a）を、この版では読めない形にする
    const oldest = fs
      .readdirSync(world.deviceDirectory)
      .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
      .sort()[0];
    for (let i = 0; i < 3; i += 1) world.desktop.database.save("task", task(`task-n${i}`, "架空"));
    await world.desktop.service.syncNow();
    rewriteJson(path.join(world.deviceDirectory, oldest), (packet) => {
      packet.entityType = "retired_kind";
    });
    const result = checkSyncPackets(world.shared, { blocking: 2 });
    assert.equal(result.compatible, true);
    assert.equal(result.rejected_total, 0);
    assert.equal(result.rejected_old, 1);
    // 最新の数件に入っていれば止める
    assert.equal(checkSyncPackets(world.shared, { blocking: 10 }).compatible, false);
  } finally {
    world.close();
  }
});

test("packets: replica 自身の端末は見ない。ほかの端末を一つも読めなければ合格にしない", async () => {
  const world = await createDesktopAndReplica();
  try {
    world.replica.database.save("task", task("task-r", "replica が作った"));
    await world.replica.service.syncNow();
    const replicaDirectory = path.join(world.shared, "devices", world.replica.database.deviceId);
    for (const name of fs
      .readdirSync(replicaDirectory)
      .filter((n) => SYNC_PACKET_FILE_PATTERN.test(n))) {
      rewriteJson(path.join(replicaDirectory, name), (packet) => {
        packet.entityType = "retired_kind";
      });
    }
    assert.equal(checkSyncPackets(world.shared).compatible, false);
    const excluded = checkSyncPackets(world.shared, {
      excludeDevice: world.replica.database.deviceId,
    });
    assert.equal(excluded.compatible, true);
    assert.equal(excluded.excluded_device, world.replica.database.deviceId.slice(0, 8));
    for (const name of fs
      .readdirSync(world.deviceDirectory)
      .filter((n) => SYNC_PACKET_FILE_PATTERN.test(n))) {
      fs.writeFileSync(path.join(world.deviceDirectory, name), "{");
    }
    const unreadable = checkSyncPackets(world.shared, {
      excludeDevice: world.replica.database.deviceId,
    });
    assert.equal(unreadable.compatible, false);
    assert.equal(unreadable.checked, 0);
  } finally {
    world.close();
  }
});

test("waiting: 差分・添付画像・写真の到着待ちの文を、版のせいではない失敗とみなす", () => {
  // 文は services/sharedFolderSync.mjs と sharedFolderAttachments.mjs が返すもの
  for (const message of [
    "端末 の同期差分 000000000003 を待っています。共有フォルダの同期完了後に再試行します。",
    "端末 の添付画像 a.png の到着を待っています。共有フォルダの同期完了後に再試行します。",
    "写真の到着を待っています。共有フォルダーの同期後に再試行してください。",
  ]) {
    assert.equal(isWaitingSyncError(message), true, message);
  }
  assert.equal(isWaitingSyncError("同期差分の形式が不正です。"), false);
});

test("packets: 共有フォルダの形式の版が上がったら読めないとする", async () => {
  const world = await createDesktopAndReplica();
  try {
    rewriteJson(path.join(world.shared, "tasken-sync.json"), (manifest) => {
      manifest.formatVersion = 2;
    });
    const result = checkSyncPackets(world.shared);
    assert.equal(result.compatible, false);
    assert.equal(result.manifest_ok, false);
  } finally {
    world.close();
  }
});

test("packets: 途中までしか届いていない差分は版ずれに数えない", async () => {
  const world = await createDesktopAndReplica();
  try {
    world.desktop.database.save("task", task("task-c", "架空"));
    await world.desktop.service.syncNow();
    fs.writeFileSync(world.latestDesktopPacket(), '{"format":"tasken-sync-ch');
    const result = checkSyncPackets(world.shared);
    assert.equal(result.compatible, true);
    assert.equal(result.unreadable, 1);
  } finally {
    world.close();
  }
});

test("state: 起動の後に同期が通っていれば synced", async () => {
  const world = await createDesktopAndReplica();
  try {
    const since = new Date(Date.now() - 60_000).toISOString();
    await world.replica.service.syncNow();
    const result = readReplicaState({
      databasePath: world.replica.databasePath,
      syncDirectory: world.shared,
      since,
    });
    assert.equal(result.verdict, "synced");
    assert.equal(result.sync.enabled, true);
    assert.equal(result.sync.directory_matches, true);
    assert.equal(result.sync.behind, 0);
    assert.equal(result.sync.synced_since, true);
    assert.equal(result.db_schema_version > 0, true);
    // 起動より前の成功しか無ければ、まだ通っていない
    const later = readReplicaState({
      databasePath: world.replica.databasePath,
      syncDirectory: world.shared,
      since: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(later.verdict, "pending");
  } finally {
    world.close();
  }
});

test("state: 取り込めない差分で同期が止まったら incompatible（本物の同期の失敗から）", async () => {
  const world = await createDesktopAndReplica();
  try {
    world.desktop.database.save("task", task("task-d", "架空"));
    await world.desktop.service.syncNow();
    rewriteJson(world.latestDesktopPacket(), (packet) => {
      packet.entityType = "future_kind";
    });
    await assert.rejects(world.replica.service.syncNow());
    const result = readReplicaState({
      databasePath: world.replica.databasePath,
      syncDirectory: world.shared,
      since: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(result.verdict, "incompatible");
    assert.equal(result.sync.behind, 1);
    assert.equal(result.sync.pending_invalid.entity_type, "future_kind");
    assert.notEqual(result.sync.last_error, "");
    assert.equal(
      result.sync.last_error_sha256,
      createHash("sha256")
        .update(world.replica.database.getPreference("sharedSyncLastError"), "utf8")
        .digest("hex")
        .slice(0, 16),
    );
  } finally {
    world.close();
  }
});

test("state: 差分の連番が抜けて待っているだけなら waiting", async () => {
  const world = await createDesktopAndReplica();
  try {
    world.desktop.database.save("task", task("task-e", "架空"));
    world.desktop.database.save("task", task("task-f", "架空"));
    await world.desktop.service.syncNow();
    const files = fs
      .readdirSync(world.deviceDirectory)
      .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
      .sort();
    // 二つ届いたうちの先の一つが、まだ共有フォルダに来ていない
    fs.rmSync(path.join(world.deviceDirectory, files.at(-2)));
    await assert.rejects(world.replica.service.syncNow());
    const result = readReplicaState({
      databasePath: world.replica.databasePath,
      syncDirectory: world.shared,
      since: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(result.verdict, "waiting");
    assert.equal(result.sync.waiting, true);
    assert.equal(result.sync.pending_invalid, null);
  } finally {
    world.close();
  }
});

test("state: 同期を切ってあれば disabled", async () => {
  const world = await createDesktopAndReplica();
  try {
    world.replica.service.disable();
    const result = readReplicaState({
      databasePath: world.replica.databasePath,
      syncDirectory: world.shared,
    });
    assert.equal(result.verdict, "disabled");
  } finally {
    world.close();
  }
});

test("errorDigest: 空は空、それ以外は SHA-256 の先頭16桁", () => {
  assert.equal(errorDigest(""), "");
  assert.equal(
    errorDigest("同期の失敗"),
    createHash("sha256").update("同期の失敗", "utf8").digest("hex").slice(0, 16),
  );
});

test("mcp: bridgeが無ければ不合格", async () => {
  const result = await probeMcp({
    userDataPath: os.tmpdir(),
    serverPath: path.join(os.tmpdir(), "tasken-no-such-bridge.mjs"),
  });
  assert.equal(result.ok, false);
});

test("CLI: 最後の1行に TASKEN_REPLICA_CHECK と結果を出し、合否を終了コードにする", async () => {
  const world = await createDesktopAndReplica();
  const lines = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    const ok = await runReplicaCheck(["packets", `--sync-dir=${world.shared}`]);
    rewriteJson(path.join(world.shared, "tasken-sync.json"), (manifest) => {
      manifest.formatVersion = 2;
    });
    const ng = await runReplicaCheck(["packets", `--sync-dir=${world.shared}`]);
    const usage = await runReplicaCheck(["unknown"]);
    process.stdout.write = write;
    assert.equal(ok, 0);
    assert.equal(ng, 3);
    assert.equal(usage, 2);
    const parsed = lines
      .filter((line) => line.startsWith("TASKEN_REPLICA_CHECK "))
      .map((line) => JSON.parse(line.slice("TASKEN_REPLICA_CHECK ".length)));
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].check, "packets");
    assert.equal(parsed[0].schema_version, 1);
    assert.equal(parsed[0].compatible, true);
    assert.equal(parsed[1].compatible, false);
  } finally {
    process.stdout.write = write;
    world.close();
  }
});
