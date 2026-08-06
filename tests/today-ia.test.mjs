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

test("Today and related lists share overdue urgency styling", () => {
  assert.match(todayPageSource, /function dateUrgency/);
  assert.match(todayPageSource, /is-\$\{urgency\}/);
  assert.match(todayPageSource, /markDueToday=\{false\}/);
  assert.match(todayPageSource, /today-focus-hero.*is-overdue|is-overdue.*today-focus-hero|className=\{`today-focus-hero panel\$\{/);
});

test("Today opens task rows directly in edit mode and shows lightweight reminder time", () => {
  assert.match(todayPageSource, /reminderMeta/);
  assert.match(todayPageSource, /IconClock/);
  assert.match(todayPageSource, /type: "task", mode: "edit"/);
});

test("Todayは日付範囲の意味ごとに扱いを分ける（#309）", () => {
  // 期間内に一度やるTaskと、継続中Taskを別のセクションで見せる。
  assert.match(todayPageSource, /<h2>期間内に対応<\/h2>/);
  assert.match(todayPageSource, /<h2>継続中<\/h2>/);
  assert.match(todayPageSource, /buildExecutionWindowTaskView/);
  assert.match(todayPageSource, /buildOngoingPeriodTaskView/);

  // 期間内に一度やるTaskは、一回の完了でTask全体が終わるのでcheckboxを残す。
  assert.match(todayPageSource, /todo-check-circle/);
  assert.match(todayPageSource, /handleCompleteExecutionWindow/);

  // 継続Taskは、今日の実施記録とTask全体の完了を別操作にする。
  assert.match(todayPageSource, /今日取り組んだ/);
  assert.match(todayPageSource, /継続を終了/);
  assert.match(todayPageSource, /handleRecordOngoingWork/);
  assert.match(todayPageSource, /handleFinishOngoingPeriod/);
  assert.match(todayPageSource, /title: `\$\{row\.task\.title\}：\$\{formatDate\(today\)\}`/);
  // 終了予定日が来ただけで自動完了させず、延長という逃げ道を出す。
  assert.match(todayPageSource, /期間を延長/);
  assert.match(todayPageSource, /handleExtendOngoingPeriod/);
  // 継続Taskの行に、Task全体を一度で完了させるcheckboxを置かない。
  assert.doesNotMatch(todayPageSource, /handleTogglePeriodComplete/);
});

test("Today surfaces generated Activity and configures automatic daily export", () => {
  assert.match(todayPageSource, /id="daily-activity"/);
  assert.match(todayPageSource, /collectActivityLogEntries/);
  assert.match(todayPageSource, /毎日自動出力/);
  assert.match(todayPageSource, /activityLogAutoExportTime/);
  assert.match(todayPageSource, /Activity Logの自動出力先を選択/);
  assert.match(todayPageSource, /アプリ停止中の未出力分は、次回起動時に日ごとに補完します/);
});

test("Settings exposes shared-folder sync status, manual sync, and conflict resolution", () => {
  const settingsSource = readFileSync(
    "src/renderer/src/features/workspace/pages/SettingsPage.tsx",
    "utf8",
  );
  assert.match(settingsSource, /端末間同期/);
  assert.match(settingsSource, /configureSharedSync/);
  assert.match(settingsSource, /runSharedSync/);
  assert.match(settingsSource, /resolveSharedSyncConflict/);
  assert.match(settingsSource, /同じデータが両端末で変更されています/);
  assert.match(settingsSource, /Note内のMarkdown画像を交換します/);
  assert.match(settingsSource, /lastMarkdownImagesReceived/);
});
