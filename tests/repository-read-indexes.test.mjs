import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  activityEventDedupeKey,
  buildActivityEvent,
  changeEventCommandIdsWithPrefix,
  changeEventsForCommand,
} from "../src/shared/activityEvent.mjs";
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

test("command_id で引くActivity Eventは、全件走査のfilterと同じ行を同じ順で返す", async () => {
  await withRepository(async (repository) => {
    repository.save("note", { id: "note-1", title: "Note", body_markdown: "a" });
    const base = buildActivityEvent({
      entityType: "note",
      entityId: "note-1",
      changeType: "updated",
      after: { id: "note-1" },
      source: "manual",
      metadata: { session_id: "s" },
    });
    const at = (second) => `2026-11-05T00:00:0${second}.000Z`;
    insertRawChangeEvent(repository, "c1", { ...base, command_id: "cmd-a" }, at(1));
    insertRawChangeEvent(repository, "c2", { ...base, command_id: "cmd-b" }, at(2));
    insertRawChangeEvent(repository, "c3", { ...base, command_id: "cmd-a" }, at(3));
    insertRawChangeEvent(repository, "c4", { ...base, command_id: "cmd-a" }, at(3));
    insertRawChangeEvent(repository, "c5", { ...base, command_id: 7 }, at(4));
    insertRawChangeEvent(repository, "c6", { ...base, command_id: "sub-1-command-x" }, at(5));
    insertRawChangeEvent(repository, "c7", { ...base, command_id: "sub-1-command-y" }, at(5));
    insertRawChangeEvent(repository, "c8", { ...base, command_id: "sub-10-command-z" }, at(6));
    repository.db
      .prepare(
        "UPDATE entities SET deleted_at = ? WHERE entity_type = 'change_event' AND id = 'c3'",
      )
      .run(at(9));

    const scan = (commandId) =>
      repository
        .list("change_event", true)
        .filter((event) => event.command_id === commandId)
        .map((event) => event.id);
    for (const commandId of ["cmd-a", "cmd-b", "7", "none"]) {
      assert.deepEqual(
        changeEventsForCommand(repository, commandId).map((event) => event.id),
        scan(commandId),
        commandId,
      );
    }
    // 同時刻は rowid の大きい順、削除済みも含む。
    assert.deepEqual(scan("cmd-a"), ["c4", "c3", "c1"]);
    // 数値のIDは文字列の "7" に一致しない（=== と同じ）。数値で問われたら従来の走査になる。
    assert.deepEqual(
      changeEventsForCommand(repository, 7).map((event) => event.id),
      ["c5"],
    );
    const prefixScan = new Set(
      repository
        .list("change_event", true)
        .map((event) => String(event.command_id || ""))
        .filter((id) => id.startsWith("sub-1-command-")),
    );
    assert.deepEqual(
      [...changeEventCommandIdsWithPrefix(repository, "sub-1-command-")].sort(),
      [...prefixScan].sort(),
    );
    assert.deepEqual([...prefixScan].sort(), ["sub-1-command-x", "sub-1-command-y"]);

    // list() しか持たない入れ物（transactionの窓口など）でも同じ結果になる。
    const listOnly = { list: (type, deleted) => repository.list(type, deleted) };
    assert.deepEqual(
      changeEventsForCommand(listOnly, "cmd-a").map((event) => event.id),
      scan("cmd-a"),
    );
    assert.deepEqual(
      [...changeEventCommandIdsWithPrefix(listOnly, "sub-1-command-")].sort(),
      [...prefixScan].sort(),
    );
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
      "idx_change_event_command_id_v1",
      "idx_change_event_dedupe_key_v1",
      "idx_change_event_irregular_dedupe_key_v1",
      "idx_change_event_occurred_at_v1",
      "idx_change_event_changed_at_v1",
      "idx_change_event_irregular_time_v1",
      "idx_change_event_session_id_v1",
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

// #755 束0b: 画面は来歴を全件で受け取らず、開いた範囲だけを読む。
function insertDeletedChangeEvent(repository, id, data, updatedAt) {
  insertRawChangeEvent(repository, id, data, updatedAt);
  repository.db
    .prepare("UPDATE entities SET deleted_at = ? WHERE entity_type = 'change_event' AND id = ?")
    .run(updatedAt, id);
}

function seedActivityHistory(repository) {
  const note = { id: "note-1", title: "Note", body_markdown: "a" };
  const task = {
    id: "task-1",
    title: "Task",
    state: "done",
    completed_at: "2026-11-10T05:00:00.000Z",
  };
  repository.save("note", note);
  const noteEvent = (occurredAt, extra = {}) =>
    buildActivityEvent({
      entityType: "note",
      entityId: "note-1",
      changeType: "created",
      after: note,
      occurredAt,
      source: "manual",
      origin: { kind: "manual", session_id: extra.session || "" },
      metadata: { session_id: extra.session || "", dedupe_key: extra.key },
    });
  const at = (minute) => `2026-11-20T00:${String(minute).padStart(2, "0")}:00.000Z`;
  // その日の中（UTCの日付は前の日）。
  insertRawChangeEvent(
    repository,
    "e-in",
    noteEvent("2026-11-10T03:00:00.000Z", { key: "k-in", session: "s-a" }),
    at(1),
  );
  insertRawChangeEvent(
    repository,
    "e-early",
    noteEvent("2026-11-09T16:30:00.000Z", { key: "k-early" }),
    at(2),
  );
  // 次の日（JST）。前後1日の候補には入るが、その日の表示には出ない。
  insertRawChangeEvent(
    repository,
    "e-late",
    noteEvent("2026-11-10T15:30:00.000Z", { key: "k-late", session: "s-b" }),
    at(3),
  );
  insertRawChangeEvent(
    repository,
    "e-old",
    noteEvent("2026-11-05T03:00:00.000Z", { key: "k-old", session: "s-a" }),
    at(4),
  );
  // 同じ重複判定のキーで別の日にある行。重複判定は日付で絞った後なので、範囲の外の行は要らない。
  insertRawChangeEvent(
    repository,
    "e-dup-a",
    noteEvent("2026-11-10T04:00:00.000Z", { key: "k-dup" }),
    at(5),
  );
  insertRawChangeEvent(
    repository,
    "e-dup-b",
    noteEvent("2026-11-25T04:00:00.000Z", { key: "k-dup" }),
    at(6),
  );
  // 同時刻の updated_at（並びは rowid の大きい順）。
  insertRawChangeEvent(
    repository,
    "e-tie-1",
    noteEvent("2026-11-10T06:00:00.000Z", { key: "k-tie-1" }),
    at(7),
  );
  insertRawChangeEvent(
    repository,
    "e-tie-2",
    noteEvent("2026-11-10T06:00:00.000Z", { key: "k-tie-2" }),
    at(7),
  );
  insertDeletedChangeEvent(
    repository,
    "e-deleted",
    noteEvent("2026-11-10T07:00:00.000Z", { key: "k-del", session: "s-a" }),
    at(8),
  );
  // 古い形（occurred_at が無く changed_at だけ）。範囲で絞れないので、いつも候補に入る。
  insertRawChangeEvent(
    repository,
    "e-legacy",
    {
      entity_type: "note",
      entity_id: "note-1",
      changed_at: "2026-11-10T09:00:00+09:00",
      change_type: "updated",
      source: "manual",
      after_json: JSON.stringify({ ...note, body_markdown: "b" }),
    },
    at(9),
  );
  // 完了の時刻（occurred_at）と記録の時刻（changed_at）が別の日。
  insertRawChangeEvent(
    repository,
    "e-completed",
    {
      ...buildActivityEvent({
        entityType: "task",
        entityId: "task-1",
        changeType: "completed",
        before: { ...task, state: "todo" },
        after: task,
        source: "manual",
        metadata: { dedupe_key: "k-completed" },
      }),
      changed_at: "2026-11-21T00:00:00.000Z",
    },
    at(10),
  );
  // スライドは changed_at の日付で並べる。
  insertRawChangeEvent(
    repository,
    "e-changed-only",
    {
      ...noteEvent("2026-10-01T00:00:00.000Z", { key: "k-changed" }),
      changed_at: "2026-11-15T00:00:00.000Z",
    },
    at(11),
  );
  return { note, task };
}

function activityIds(events, date, workspace) {
  return queryActivityEvents({ events, workspace, date, timezone: "Asia/Tokyo" }).events.map(
    (event) => event.id,
  );
}

test("日付の範囲で読んだ来歴は、全件で読んだ時と同じ日の表示になる（索引あり・なし）", async () => {
  await withRepository(async (repository) => {
    const { note, task } = seedActivityHistory(repository);
    const workspace = { notes: [note], tasks: [task] };
    const all = repository.list("change_event");
    const order = all.map((event) => event.id);
    const fallback = () => {
      const saved = repository.performanceIndexes;
      repository.performanceIndexes = { ...saved, changeEventTime: false };
      try {
        return repository.listChangeEventsForDates({ from: "2026-11-10", to: "2026-11-10" });
      } finally {
        repository.performanceIndexes = saved;
      }
    };
    for (const date of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-25", "2026-12-01"]) {
      const ranged = repository.listChangeEventsForDates({ from: date, to: date });
      assert.deepEqual(
        activityIds(ranged, date, workspace),
        activityIds(all, date, workspace),
        date,
      );
      // 並びは list("change_event") のまま（重複判定で同時刻の行から同じ1件を選ぶため）。
      assert.deepEqual(
        ranged.map((event) => event.id),
        order.filter((id) => ranged.some((event) => event.id === id)),
        date,
      );
    }
    const day = activityIds(all, "2026-11-10", workspace);
    assert.ok(day.includes("e-in") && day.includes("e-early") && day.includes("e-legacy"));
    assert.ok(day.includes("e-completed"));
    assert.ok(day.includes("e-dup-a"));
    assert.equal(day.includes("e-deleted"), false);

    const indexed = repository.listChangeEventsForDates({ from: "2026-11-10", to: "2026-11-10" });
    assert.deepEqual(
      fallback().map((event) => event.id),
      indexed.map((event) => event.id),
    );
    for (const outside of ["e-old", "e-dup-b", "e-deleted"]) {
      assert.equal(
        indexed.some((event) => event.id === outside),
        false,
        outside,
      );
    }

    // スライドの範囲（changed_at の日付）も、全件から絞った時と同じ行を含む。
    const slideDate = (event) => String(event.changed_at || "").slice(0, 10);
    const inSlide = (events) =>
      events
        .filter((event) => slideDate(event) >= "2026-11-12" && slideDate(event) <= "2026-11-30")
        .map((event) => event.id);
    assert.deepEqual(
      inSlide(repository.listChangeEventsForDates({ from: "2026-11-12", to: "2026-11-30" })),
      inSlide(all),
    );
    assert.ok(inSlide(all).includes("e-changed-only"));

    assert.throws(() =>
      repository.listChangeEventsForDates({ from: "2026-11-31", to: "2026-12-01" }),
    );
    assert.throws(() =>
      repository.listChangeEventsForDates({ from: "2026-11-10", to: "2026-11-09" }),
    );
    assert.throws(() => repository.listChangeEventsForDates({ from: "2026-11-10" }));
  });
});

test("Sessionで読んだ来歴は、全件を origin.session_id で絞った時と同じ行を同じ順で返す", async () => {
  await withRepository(async (repository) => {
    seedActivityHistory(repository);
    const all = repository.list("change_event");
    for (const ids of [["s-a"], ["s-a", "s-b"], ["missing"], []]) {
      const expected = all
        .filter((event) => ids.includes(event.origin?.session_id))
        .map((event) => event.id);
      assert.deepEqual(
        repository.listChangeEventsForSessions(ids).map((event) => event.id),
        expected,
        ids.join(","),
      );
    }
    assert.deepEqual(
      repository.listChangeEventsForSessions(["s-a"]).map((event) => event.id),
      ["e-old", "e-in"],
    );
  });
});

test("画面への読み込みは来歴を読まず、Main内の読み込みは今までどおり来歴を持つ", async () => {
  await withRepository(async (repository) => {
    const { note } = seedActivityHistory(repository);
    const forRenderer = repository.loadWorkspace(false, { withoutChangeEvents: true });
    assert.equal("change_events" in forRenderer, false);
    assert.deepEqual(
      forRenderer.notes.map((entry) => entry.id),
      [note.id],
    );
    // MCP・同期・Snapshot などMainの読み込みは変えない。
    const full = repository.loadWorkspace(false);
    assert.equal(full.change_events.length, repository.list("change_event").length);
    assert.equal(
      repository.loadWorkspace(true).change_events.length,
      full.change_events.length + 1,
    );
  });
});
