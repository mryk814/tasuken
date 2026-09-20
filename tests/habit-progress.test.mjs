import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  habitEntryId,
  habitProgress,
  habitScheduleLabel,
  habitStateAfter,
  nextEntrySequence,
  weekRangeOf,
} from "../src/shared/contracts/habit/progress.ts";

/** Habitの最小実験（#454後半 / O単位）。記録の重複と週の区切りを固定する。 */

test("週は利用者のローカル日付で月曜始まりにする", () => {
  // 2026-09-20 は日曜。その週は 9/14(月)〜9/20(日)。
  assert.deepEqual(weekRangeOf("2026-09-20"), { start: "2026-09-14", end: "2026-09-20" });
  // 月曜自身はその週の先頭。
  assert.deepEqual(weekRangeOf("2026-09-14"), { start: "2026-09-14", end: "2026-09-20" });
  // 翌日は次の週へ移る（日曜で終わる）。
  assert.deepEqual(weekRangeOf("2026-09-21"), { start: "2026-09-21", end: "2026-09-27" });
  assert.equal(addDays("2026-09-20", 1), "2026-09-21");
});

test("今日1回・今週2/3回を導出し、連続日数や達成率は出さない", () => {
  const entries = [
    { id: "e1", performed_on: "2026-09-15", sequence: 1 },
    { id: "e2", performed_on: "2026-09-20", sequence: 1 },
    { id: "e3", performed_on: "2026-09-20", sequence: 2 },
    // 先週の記録は今週へ数えない。
    { id: "e4", performed_on: "2026-09-13", sequence: 1 },
  ];
  const progress = habitProgress({
    schedule: { kind: "weekly", weeklyTarget: 3 },
    entries,
    today: "2026-09-20",
  });

  assert.equal(progress.todayCount, 2);
  assert.equal(progress.todayLabel, "今日2回");
  assert.equal(progress.weekCount, 3);
  assert.equal(progress.weekLabel, "今週3/3回");
  assert.equal(progress.met, true);
  assert.equal(progress.weekStart, "2026-09-14");
  // 継続日数・達成率のような指標は返さない。
  assert.deepEqual(Object.keys(progress).sort(), [
    "met",
    "todayCount",
    "todayLabel",
    "weekCount",
    "weekEnd",
    "weekLabel",
    "weekStart",
    "weekTarget",
  ]);
});

test("毎日のHabitは7回を今週の目標にする", () => {
  const progress = habitProgress({
    schedule: { kind: "daily", weeklyTarget: null },
    entries: [{ id: "e1", performed_on: "2026-09-20", sequence: 1 }],
    today: "2026-09-20",
  });

  assert.equal(progress.weekTarget, 7);
  assert.equal(progress.weekLabel, "今週1/7回");
  assert.equal(progress.met, false);
  assert.equal(habitScheduleLabel({ kind: "daily", weeklyTarget: null }), "毎日1回");
  assert.equal(habitScheduleLabel({ kind: "weekly", weeklyTarget: 3 }), "週3回");
});

test("連打と再送は同じ記録へ畳み、意図した2回目は別の記録にする", () => {
  const first = habitEntryId("habit-reading", "2026-09-20", 1);
  const again = habitEntryId("habit-reading", "2026-09-20", 1);
  const second = habitEntryId("habit-reading", "2026-09-20", 2);

  // 同じ入力は同じID。二重送信で記録が増えない。
  assert.equal(first, again);
  assert.notEqual(first, second);
  assert.match(first, /^habit-entry:habit-reading:2026-09-20:1$/);
  // 別の日・別のHabitとも衝突しない。
  assert.notEqual(first, habitEntryId("habit-reading", "2026-09-21", 1));
  assert.notEqual(first, habitEntryId("habit-exercise", "2026-09-20", 1));
});

test("次の順番はその日の既存記録の次になる", () => {
  const entries = [
    { id: "e1", performed_on: "2026-09-20", sequence: 1 },
    { id: "e2", performed_on: "2026-09-20", sequence: 2 },
    { id: "e3", performed_on: "2026-09-19", sequence: 1 },
  ];

  assert.equal(nextEntrySequence(entries, "2026-09-20"), 3);
  assert.equal(nextEntrySequence(entries, "2026-09-19"), 2);
  assert.equal(nextEntrySequence(entries, "2026-09-18"), 1);
  // 順番のない旧記録があっても、次の番号は1から始まる。
  assert.equal(nextEntrySequence([{ id: "e4", performed_on: "2026-09-20" }], "2026-09-20"), 1);
});

test("一時停止と再開は状態だけを変え、過去の実績を書き換えない", () => {
  const paused = habitStateAfter({
    state: "active",
    action: "pause",
    at: "2026-09-20T10:00:00.000Z",
  });
  assert.deepEqual(paused, {
    state: "paused",
    paused_at: "2026-09-20T10:00:00.000Z",
    resumed_at: null,
  });
  const resumed = habitStateAfter({
    state: "paused",
    action: "resume",
    at: "2026-09-21T09:00:00.000Z",
  });
  assert.deepEqual(resumed, {
    state: "active",
    paused_at: null,
    resumed_at: "2026-09-21T09:00:00.000Z",
  });
});

test("不正な日付と順番は受け付けない", () => {
  assert.throws(() => habitEntryId("habit-reading", "2026/09/20", 1), /YYYY-MM-DD/u);
  assert.throws(() => habitEntryId("habit-reading", "2026-09-20", 0), /1〜50/u);
  assert.throws(() => habitEntryId("", "2026-09-20", 1), /1〜120/u);
  assert.throws(() => weekRangeOf("2026-9-20"), /YYYY-MM-DD/u);
});
