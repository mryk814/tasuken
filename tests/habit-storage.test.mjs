import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  habitEntryId,
  habitProgress,
  nextEntrySequence,
} from "../src/shared/contracts/habit/progress.ts";
import { requiredFieldsForEntityType } from "../src/shared/entityRegistry.mjs";

/**
 * Habitの最小実験の保存契約（#454後半 / O単位）。
 *
 * 記録・取消・削除とUndo・Export/Importまでを実SQLiteで確かめる。
 * 日付ごとのTaskを自動生成しないことも確認する。
 */

async function withDatabase(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-habit-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    return await run(database);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function habit(overrides = {}) {
  return {
    id: "habit-reading",
    title: "読書",
    schedule_kind: "weekly",
    weekly_target: 3,
    state: "active",
    started_on: "2026-09-14",
    ...overrides,
  };
}

function entry(database, performedOn, overrides = {}) {
  const entries = database
    .list("habit_entry", true)
    .filter((row) => row.habit_id === "habit-reading");
  const sequence = nextEntrySequence(entries, performedOn);
  return {
    id: habitEntryId("habit-reading", performedOn, sequence),
    habit_id: "habit-reading",
    performed_on: performedOn,
    sequence,
    recorded_at: `${performedOn}T09:00:00.000Z`,
    source: "manual",
    ...overrides,
  };
}

test("Habitと実施記録を保存し、Taskを自動生成しない", async () => {
  await withDatabase((database) => {
    // Registryの必須fieldとdomainの検証が一致している。
    // `sequence` は数値なので、文字列だけを扱う汎用の必須fieldには入れずdomain側で検証する。
    assert.deepEqual(requiredFieldsForEntityType("habit"), ["title", "schedule_kind", "state"]);
    assert.deepEqual(requiredFieldsForEntityType("habit_entry"), [
      "habit_id",
      "performed_on",
      "recorded_at",
    ]);

    database.save("habit", habit());
    database.save("habit_entry", entry(database, "2026-09-20"));
    database.save("habit_entry", entry(database, "2026-09-20"));

    const stored = database.get("habit", "habit-reading");
    assert.equal(stored.title, "読書");
    assert.equal(stored.schedule_kind, "weekly");
    assert.equal(stored.weekly_target, 3);
    const entries = database.list("habit_entry", true);
    assert.equal(entries.length, 2, "同じ日の2回目は別の記録になる");
    assert.deepEqual(entries.map((row) => row.sequence).sort(), [1, 2]);

    const progress = habitProgress({
      schedule: { kind: "weekly", weeklyTarget: stored.weekly_target },
      entries,
      today: "2026-09-20",
    });
    assert.equal(progress.todayLabel, "今日2回");
    assert.equal(progress.weekLabel, "今週2/3回");

    // 日付ごとのTaskを作らない。
    assert.equal(database.list("task", true).length, 0);
  });
});

test("連打と再送は同じ記録を増やさない", async () => {
  await withDatabase((database) => {
    database.save("habit", habit());
    const first = entry(database, "2026-09-20");
    database.save("habit_entry", first);
    // 同じIDをもう一度保存する（連打・再送）。
    database.save("habit_entry", { ...first, recorded_at: "2026-09-20T09:00:01.000Z" });

    const entries = database.list("habit_entry", true);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].sequence, 1);
    // 同じ日の次の番号は2。明示的な「もう1回」は別の記録になる。
    assert.equal(nextEntrySequence(entries, "2026-09-20"), 2);
  });
});

test("実施日の修正は記録を増やさず、元のIDのまま更新する", async () => {
  await withDatabase((database) => {
    database.save("habit", habit());
    const record = entry(database, "2026-09-20");
    const saved = database.save("habit_entry", record);

    const corrected = database.save("habit_entry", {
      ...saved,
      performed_on: "2026-09-19",
      corrected_at: "2026-09-20T21:00:00.000Z",
    });

    const entries = database.list("habit_entry", true);
    assert.equal(entries.length, 1, "修正で記録を増やさない");
    assert.equal(corrected.id, record.id, "IDは作り直さない");
    assert.equal(corrected.performed_on, "2026-09-19");
    assert.equal(corrected.corrected_at, "2026-09-20T21:00:00.000Z");
  });
});

test("Habitを削除すると実施記録も消え、復元で一緒に戻る", async () => {
  await withDatabase((database) => {
    database.save("habit", habit());
    database.save("habit_entry", entry(database, "2026-09-20"));

    database.remove("habit", "habit-reading");
    assert.equal(database.get("habit", "habit-reading"), null);
    assert.deepEqual(database.list("habit_entry"), [], "実施記録も一緒に外れる");
    // 論理削除なので、includeDeletedでは残っている。
    assert.equal(database.list("habit_entry", true).length, 1);

    database.restore("habit", "habit-reading");
    assert.equal(database.get("habit", "habit-reading")?.state, "active");
    assert.equal(database.list("habit_entry").length, 1, "復元で実施記録も戻る");
  });
});

test("一時停止と再開は過去の実施記録を書き換えない", async () => {
  await withDatabase((database) => {
    database.save("habit", habit());
    const record = entry(database, "2026-09-20");
    database.save("habit_entry", record);

    const paused = database.save("habit", {
      ...database.get("habit", "habit-reading"),
      state: "paused",
      paused_at: "2026-09-20T10:00:00.000Z",
    });
    assert.equal(paused.state, "paused");
    assert.equal(database.list("habit_entry", true)[0].performed_on, "2026-09-20");

    const resumed = database.save("habit", {
      ...paused,
      state: "active",
      paused_at: null,
      resumed_at: "2026-09-21T09:00:00.000Z",
    });
    assert.equal(resumed.state, "active");
    assert.equal(resumed.resumed_at, "2026-09-21T09:00:00.000Z");
    assert.equal(database.list("habit_entry", true).length, 1);
  });
});

test("不正なHabitと実施記録は保存しない", async () => {
  await withDatabase((database) => {
    assert.throws(() => database.save("habit", habit({ title: "" })), /habit.title/u);
    assert.throws(
      () => database.save("habit", habit({ schedule_kind: "monthly" })),
      /schedule_kind/u,
    );
    assert.throws(
      () => database.save("habit", habit({ schedule_kind: "daily", weekly_target: 3 })),
      /weekly_target/u,
    );
    assert.throws(() => database.save("habit", habit({ state: "done" })), /habit.state/u);
    assert.throws(() => database.save("habit", habit({ started_on: "2026/09/14" })), /YYYY-MM-DD/u);

    database.save("habit", habit());
    const valid = entry(database, "2026-09-20");
    assert.throws(() => database.save("habit_entry", { ...valid, sequence: 0 }), /sequence/u);
    assert.throws(
      () =>
        database.save("habit_entry", {
          ...valid,
          id: "habit-entry:bad",
          performed_on: "2026/09/20",
        }),
      /performed_on/u,
    );
    assert.throws(
      () =>
        database.save("habit_entry", {
          ...valid,
          id: "habit-entry:bad-2",
          recorded_at: "2026-09-20",
        }),
      /recorded_at/u,
    );
    // Habitが無い実施記録は保存できない（参照の検証）。
    assert.throws(() =>
      database.save("habit_entry", {
        ...valid,
        id: "habit-entry:orphan",
        habit_id: "habit-missing",
      }),
    );
  });
});
