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
  assert.doesNotMatch(todayPageSource, /TASK_SHELF_OPTIONS\.map/);
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

test("Today candidate shelf is limited to the three useful lanes", () => {
  assert.match(todayPageSource, /<h3>期限切れ<\/h3>/);
  assert.match(todayPageSource, /<h3>今週<\/h3>/);
  assert.match(todayPageSource, /<h3>いつか<\/h3>/);
  assert.doesNotMatch(todayPageSource, /<h3>\{option\.label\}<\/h3>/);
  assert.doesNotMatch(todayPageSource, /shelfTaskRows/);
  assert.doesNotMatch(todayPageSource, /handleMoveShelfTaskToday/);
});

test("Today removes duplicate risk and current-location sections from the main page", () => {
  assert.doesNotMatch(todayPageSource, /<h2>期限切れ<\/h2>/);
  assert.doesNotMatch(todayPageSource, /<h2>期限が近い待ち<\/h2>/);
  assert.doesNotMatch(todayPageSource, /<h2>最近の現在地<\/h2>/);
  assert.match(todayPageSource, /<h2>今日の候補棚<\/h2>/);
});

test("Today shows a lightweight waiting list beside nearby milestones", () => {
  assert.match(todayPageSource, /today-grid/);
  assert.match(todayPageSource, /近いマイルストーン/);
  assert.match(todayPageSource, /WaitingListRows/);
  assert.match(todayPageSource, /today-waiting-row/);
  assert.match(todayPageSource, /openWaitings/);
  assert.match(todayPageSource, /overdueWaitingCount/);
});

test("Today opens task rows directly in edit mode and shows lightweight reminder time", () => {
  assert.match(todayPageSource, /reminderMeta/);
  assert.match(todayPageSource, /IconClock/);
  assert.match(todayPageSource, /type: "task", mode: "edit"/);
});

test("Today period tasks can be completed and spawn dated daily work", () => {
  assert.match(todayPageSource, /onTogglePeriodComplete/);
  assert.match(todayPageSource, /handleTogglePeriodComplete/);
  assert.match(todayPageSource, /todo-check-circle/);
  assert.match(todayPageSource, /buildCompleteTaskOperations\(row\.task, row\.schedule\)/);
  assert.match(todayPageSource, /title: `\$\{row\.task\.title\}：\$\{formatDate\(today\)\}`/);
});
