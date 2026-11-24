import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  assertSyncPacket,
  isUnknownEntityTypePacket,
} from "../src/main/repositories/syncPacketContract.mjs";
import { WORKSPACE_DESIGNATION_ID } from "../src/shared/workspaceDesignation.mjs";

function createDatabase(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-designation-test-"));
  const database = new WorkspaceDatabase(path.join(base, "tasken.sqlite"));
  t.after(() => {
    if (database.db.open) database.db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });
  return database;
}

test("本体の指定は固定 ID の 1 件として保存され、差分に乗る", (t) => {
  const database = createDatabase(t);
  const saved = database.setWorkspaceDesignation(database.deviceId);

  assert.equal(saved.id, WORKSPACE_DESIGNATION_ID);
  assert.equal(saved.main_device_id, database.deviceId);
  const designation = database.workspaceDesignation();
  assert.equal(designation.id, WORKSPACE_DESIGNATION_ID);
  assert.equal(designation.main_device_id, database.deviceId);

  const packets = database
    .allSyncPackets()
    .map((entry) => entry.packet)
    .filter((packet) => packet.entityType === "workspace_designation");
  assert.equal(packets.length, 1);
  assert.equal(packets[0].entityId, WORKSPACE_DESIGNATION_ID);
  assert.equal(packets[0].entity.main_device_id, database.deviceId);
});

test("本体の指定には指定先の端末が要り、変えると同じ 1 件が更新され、やめると墓標になる", (t) => {
  const database = createDatabase(t);
  assert.throws(() => database.setWorkspaceDesignation(""), /本体にする端末/);
  assert.throws(
    () => database.save("workspace_designation", { id: WORKSPACE_DESIGNATION_ID }),
    /main_device_id/,
  );

  database.setWorkspaceDesignation("device-a");
  database.setWorkspaceDesignation("device-b");
  const all = database.list("workspace_designation", true);
  assert.equal(all.length, 1);
  assert.equal(database.workspaceDesignation().main_device_id, "device-b");

  database.clearWorkspaceDesignation();
  assert.equal(database.workspaceDesignation(), null);
  const tombstone = database.get("workspace_designation", WORKSPACE_DESIGNATION_ID, true);
  assert.ok(tombstone.deleted_at);
});

test("本体の指定は同期で相手に届く", (t) => {
  const first = createDatabase(t);
  const second = createDatabase(t);
  second.adoptSyncWorkspace(first.workspaceId);

  first.setWorkspaceDesignation(first.deviceId);
  const packet = first
    .allSyncPackets()
    .map((entry) => entry.packet)
    .find((candidate) => candidate.entityType === "workspace_designation");
  const result = second.applySyncPacket(packet);

  assert.equal(result.status, "applied");
  assert.equal(second.workspaceDesignation().main_device_id, first.deviceId);
});

function unknownPacket(database, overrides = {}) {
  return {
    format: "tasken-sync-change",
    formatVersion: 1,
    workspaceId: database.workspaceId,
    changeId: "00000000-0000-4000-8000-000000000101",
    revisionId: "00000000-0000-4000-8000-000000000101",
    parentRevisionIds: [],
    deviceId: "another-device",
    deviceSequence: 1,
    entityType: "future_kind",
    entityId: "future-1",
    entity: { id: "future-1", note: "この版は知らない種類" },
    createdAt: "2026-11-24T00:00:00.000Z",
    ...overrides,
  };
}

test("知らない種類の差分は、中身を書かずに受けて head だけが進む", (t) => {
  const database = createDatabase(t);
  const packet = unknownPacket(database);

  assert.equal(isUnknownEntityTypePacket(packet), true);
  assert.equal(isUnknownEntityTypePacket({ ...packet, entityType: "task" }), false);
  assert.doesNotThrow(() => assertSyncPacket(packet, database.workspaceId));

  const result = database.applySyncPacket(packet);
  assert.equal(result.status, "unknown");
  assert.equal(database.syncHead("future_kind", "future-1"), packet.revisionId);
  const rows = database.db
    .prepare("SELECT COUNT(*) AS count FROM entities WHERE entity_type = ?")
    .get("future_kind");
  assert.equal(rows.count, 0);

  // 同じ差分がもう一度届いても、競合や失敗にせず重複として受ける。
  assert.equal(database.applySyncPacket(packet).status, "duplicate");
});

test("知らない種類でも封筒の形が壊れていれば断る", (t) => {
  const database = createDatabase(t);
  const broken = unknownPacket(database, {
    entity: { id: "future-2", note: "封筒の ID と一致しない" },
  });
  assert.throws(() => assertSyncPacket(broken, database.workspaceId), /Entityが不正/);
  assert.throws(() => database.applySyncPacket(broken), /Entityが不正/);
});
