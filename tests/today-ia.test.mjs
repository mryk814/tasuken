import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const todayPageSource = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");

test("Today page stays focused on daily tasks instead of utility controls", () => {
  assert.match(todayPageSource, /openTodayTasksWindow/);
  assert.match(todayPageSource, /showTodayMiniWindow/);
  assert.match(todayPageSource, /今日やること/);
  assert.doesNotMatch(todayPageSource, /IconFlag/);
  assert.doesNotMatch(todayPageSource, /onTogglePriority/);
  assert.doesNotMatch(todayPageSource, />\+7d</);
  assert.doesNotMatch(todayPageSource, /ReminderPanel/);
  assert.doesNotMatch(todayPageSource, /TimeboxPanel/);
  assert.doesNotMatch(todayPageSource, /時間割/);
  assert.doesNotMatch(todayPageSource, /TASK_SHELF_OPTIONS/);
});

test("Today page removes low-read metric cards from the main scan path", () => {
  assert.doesNotMatch(todayPageSource, /today-metrics/);
  assert.doesNotMatch(todayPageSource, /<Metric label="今日"/);
  assert.doesNotMatch(todayPageSource, /<Metric label="期限切れ"/);
  assert.doesNotMatch(todayPageSource, /metric-card panel metric-button/);
});

test("Today page keeps inbox and unscheduled work out of row sections", () => {
  assert.doesNotMatch(todayPageSource, /<h2>Inbox未整理<\/h2>/);
  assert.doesNotMatch(todayPageSource, /<h2>予定なし<\/h2>/);
});

test("Today opens task rows directly in edit mode and shows lightweight reminder time", () => {
  assert.match(todayPageSource, /reminderMeta/);
  assert.match(todayPageSource, /IconClock/);
  assert.match(todayPageSource, /type: "task", mode: "edit"/);
});
