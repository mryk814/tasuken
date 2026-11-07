import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { activityEventDedupeKey, buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { queryActivityEvents } from "../src/shared/activityProjection.mjs";
import {
  WorkspaceDatabase,
  workspaceSchemaVersion,
} from "../src/main/repositories/workspaceRepository.mjs";

async function withRepository(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-read-indexes-"));
  const repository = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    await run(repository, directory);
  } finally {
    repository.db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function insertRawChangeEvent(repository, id, data, updatedAt) {
  repository.db
    .prepare(
      `INSERT INTO entities(entity_type, id, data_json, created_at, updated_at, deleted_at, device_id, source, version)
       VALUES('change_event', ?, ?, ?, ?, NULL, ?, 'manual', 1)`,
    )
    .run(id, JSON.stringify(data), updatedAt, updatedAt, repository.deviceId);
}

function scanAll(repository, key) {
  return (
    repository
      .list("change_event", true)
      .find((candidate) => activityEventDedupeKey(candidate) === key) || null
  );
}

test("change_eventの重複判定は、索引で引いても全件走査と同じ行を返す", async () => {
  await withRepository(async (repository) => {
    assert.equal(repository.performanceIndexes.changeEventDedupe, true);
    repository.save("note", { id: "note-1", title: "Note", body_markdown: "a" });
    const event = (session, body) =>
      buildActivityEvent({
        entityType: "note",
        entityId: "note-1",
        changeType: "updated",
        after: { id: "note-1", body_markdown: body },
        source: "manual",
        origin: { kind: "renderer_save", session_id: session },
        metadata: { session_id: session },
      });
    repository.save("change_event", event("s-1", "a"));
    repository.save("change_event", event("s-2", "b"));
    const regularKey = activityEventDedupeKey(repository.list("change_event", true)[0]);

    // 保存済みキーをそのまま使えない行。JSの activityEventDedupeKey で計算し直す側に入る。
    const base = event("s-raw", "c");
    insertRawChangeEvent(
      repository,
      "padded",
      { ...base, metadata: { ...base.metadata, dedupe_key: "　padded-key " } },
      "2026-11-01T00:00:00.000Z",
    );
    const { dedupe_key: _removed, ...withoutKey } = base.metadata;
    insertRawChangeEvent(
      repository,
      "missing",
      { ...base, metadata: withoutKey },
      "2026-11-02T00:00:00.000Z",
    );
    insertRawChangeEvent(
      repository,
      "numeric",
      { ...base, metadata: { ...base.metadata, dedupe_key: 42 } },
      "2026-11-03T00:00:00.000Z",
    );
    const computedKey = activityEventDedupeKey(repository.get("change_event", "missing", true));

    for (const key of [regularKey, "padded-key", computedKey, "42", "no-such-key"]) {
      const expected = scanAll(repository, key)?.id ?? null;
      assert.equal(repository.findChangeEventByDedupeKey(key)?.id ?? null, expected, key);
    }
    assert.equal(repository.findChangeEventByDedupeKey("padded-key")?.id, "padded");
    assert.equal(repository.findChangeEventByDedupeKey("42")?.id, "numeric");

    // 同じキーで updated_at まで同じ行が並ぶと、従来は後から入った行（rowidの大きい行）を選んだ。
    // 索引経由でも同じ1件を選ぶ（保存済みキーの行と計算し直す行が混ざっても）。
    const tie = "2026-11-04T00:00:00.000Z";
    insertRawChangeEvent(
      repository,
      "tie-1",
      { ...base, metadata: { ...base.metadata, dedupe_key: "tie-key" } },
      tie,
    );
    insertRawChangeEvent(
      repository,
      "tie-2",
      { ...base, metadata: { ...base.metadata, dedupe_key: " tie-key" } },
      tie,
    );
    insertRawChangeEvent(
      repository,
      "tie-3",
      { ...base, metadata: { ...base.metadata, dedupe_key: "tie-key" } },
      tie,
    );
    assert.equal(scanAll(repository, "tie-key")?.id, "tie-3");
    assert.equal(repository.findChangeEventByDedupeKey("tie-key")?.id, "tie-3");

    // 索引がない（作成に失敗した）ときは全件走査に戻り、同じ結果になる。
    repository.performanceIndexes.changeEventDedupe = false;
    assert.equal(repository.findChangeEventByDedupeKey("padded-key")?.id, "padded");
  });
});

test("読み取り用の索引はschema_versionを上げずに作り、開き直しても作り直さない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-read-indexes-"));
  const file = path.join(directory, "workspace.sqlite");
  try {
    const first = new WorkspaceDatabase(file);
    first.db.close();
    const second = new WorkspaceDatabase(file);
    const indexes = second.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
      .all()
      .map((row) => row.name);
    for (const name of [
      "idx_sync_outbox_publish_state_v1",
      "idx_change_event_dedupe_key_v1",
      "idx_change_event_irregular_dedupe_key_v1",
    ]) {
      assert.ok(indexes.includes(name), name);
    }
    // versionを上げると旧版のアプリがDBを開けなくなる。
    assert.equal(
      second.db.prepare("SELECT value FROM workspace_meta WHERE key = 'schema_version'").get()
        .value,
      String(workspaceSchemaVersion),
    );
    const plan = second.db
      .prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM sync_outbox WHERE published_at IS NULL")
      .all()
      .map((row) => row.detail)
      .join(" ");
    assert.match(plan, /COVERING INDEX idx_sync_outbox_publish_state_v1/);
    second.db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ensureSyncBaselineはheadのない行と空のheadの行だけを積む", async () => {
  await withRepository(async (repository) => {
    repository.save("note", { id: "note-a", title: "A", body_markdown: "a" });
    repository.save("note", { id: "note-b", title: "B", body_markdown: "b" });
    repository.save("note", { id: "note-c", title: "C", body_markdown: "c" });
    assert.equal(repository.ensureSyncBaseline(), 0);

    repository.db
      .prepare("DELETE FROM sync_entity_heads WHERE entity_type = 'note' AND entity_id = 'note-a'")
      .run();
    repository.db
      .prepare(
        "UPDATE sync_entity_heads SET revision_id = '' WHERE entity_type = 'note' AND entity_id = 'note-b'",
      )
      .run();
    const before = repository.syncPacketHeaders().length;
    assert.equal(repository.ensureSyncBaseline(), 2);
    const added = repository
      .allSyncPackets()
      .slice(before)
      .map((entry) => entry.packet.entityId)
      .sort();
    assert.deepEqual(added, ["note-a", "note-b"]);
    assert.equal(repository.ensureSyncBaseline(), 0);
    assert.equal(repository.syncPendingCount(), repository.syncPacketHeaders().length);
  });
});

test("queryActivityEventsは入力のEventを書き換えない（複製せずに使うため）", () => {
  const deepFreeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
  };
  const note = { id: "note-1", title: "Note", body_markdown: "a", theme_id: "theme-1" };
  const theme = { id: "theme-1", name: "Theme", ai_visibility: ["m365"] };
  const events = [
    buildActivityEvent({
      entityType: "note",
      entityId: "note-1",
      changeType: "created",
      after: note,
      occurredAt: "2026-11-01T01:00:00.000Z",
      source: "manual",
      metadata: { session_id: "s-1" },
    }),
  ];
  const input = () => ({
    events: structuredClone(events),
    workspace: { notes: [structuredClone(note)], themes: [structuredClone(theme)] },
  });
  // 書き換えようとすると凍結したobjectで投げる。結果は生成時刻を除いて同じになる。
  const query = (value, options = {}) => {
    const result = queryActivityEvents({ ...value, ...options });
    return { ...result, page: { ...result.page, generated_at: "" } };
  };
  const recall = { profile: "recall", audience: "m365" };
  const frozen = deepFreeze(input());
  assert.ok(query(frozen).events.length > 0);
  assert.deepEqual(query(frozen, recall), query(input(), recall));
  assert.deepEqual(query(frozen), query(input()));
});
