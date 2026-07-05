import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const todaySource = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
const mainSource = readFileSync("src/main/index.ts", "utf8");
const preloadSource = readFileSync("src/preload/todayMini.ts", "utf8");
const htmlSource = readFileSync("src/renderer/today-mini.html", "utf8");
const contractsSource = readFileSync("src/shared/ipc/global.d.ts", "utf8");

test("Today no longer exposes the daily loop shelf or morning planning flow", () => {
  assert.doesNotMatch(todaySource, /DailyLoopPanel/);
  assert.doesNotMatch(todaySource, /buildDailyLoopSummary/);
  assert.doesNotMatch(todaySource, /handleDailyLoopStep/);
  assert.doesNotMatch(todaySource, /openDailyPlan/);
  assert.doesNotMatch(todaySource, /日次ループ/);
  assert.doesNotMatch(todaySource, /朝の計画/);
});

test("Today mini can snap and resize to the top right and fades strongly while inactive", () => {
  assert.match(mainSource, /function pinTodayMiniTopRight/);
  assert.match(mainSource, /screen\.getDisplayMatching/);
  assert.match(mainSource, /TODAY_MINI_PINNED_WIDTH\s*=\s*360/);
  assert.match(mainSource, /TODAY_MINI_PINNED_HEIGHT\s*=\s*560/);
  assert.match(mainSource, /setBounds\(/);
  assert.match(mainSource, /today-mini:pin-top-right/);
  assert.match(mainSource, /TODAY_MINI_INACTIVE_OPACITY\s*=\s*0\.5/);
  assert.match(mainSource, /setOpacity\(1\)/);
  assert.match(mainSource, /setOpacity\(TODAY_MINI_INACTIVE_OPACITY\)/);
  assert.match(mainSource, /frame:\s*false/);
  assert.match(mainSource, /autoHideMenuBar:\s*true/);
  assert.match(preloadSource, /pinTopRight/);
  assert.match(preloadSource, /hide/);
  assert.match(contractsSource, /pinTopRight/);
  assert.match(contractsSource, /hide/);
  assert.match(htmlSource, /id="pin-top-right"/);
  assert.match(htmlSource, /id="close-window"/);
  assert.match(htmlSource, /window\.todayMiniApi\.pinTopRight/);
  assert.match(htmlSource, /window\.todayMiniApi\.hide/);
});

test("Today mini keeps the clean surface but uses Tasken tone and compact task metadata", () => {
  assert.match(htmlSource, /class="app-shell"/);
  assert.match(htmlSource, /class="mini-hero"/);
  assert.match(htmlSource, /id="today-date"/);
  assert.match(htmlSource, /--color-accent:\s*#8a2f3b/i);
  assert.match(htmlSource, /--color-bg-top:\s*#8a2f3b/i);
  assert.doesNotMatch(htmlSource, /--color-bg-top:\s*#2f6f73/i);
  assert.match(htmlSource, /aria-label="画面右上へ移動"/);
  assert.match(htmlSource, /aria-label="更新"/);
  assert.doesNotMatch(htmlSource, />右上へ<\/button>/);
  assert.doesNotMatch(htmlSource, />更新<\/button>/);
  assert.match(htmlSource, /class="add-task-bar"/);
  assert.match(htmlSource, /class="theme-dot"/);
  assert.match(htmlSource, /--theme-color/);
  assert.match(htmlSource, /function scheduleHint/);
  assert.match(htmlSource, /task\.scheduleLabel\s*!==\s*todayKey/);
  assert.match(htmlSource, /task\.hasReminder/);
  assert.match(htmlSource, /class="reminder-clock"/);
  assert.match(htmlSource, /window\.todayMiniApi\.addTask/);
  assert.match(preloadSource, /addTask/);
  assert.match(contractsSource, /addTask/);
  assert.match(readFileSync("src/shared/ipc/contracts.ts", "utf8"), /themeColor: string/);
  assert.match(readFileSync("src/shared/ipc/contracts.ts", "utf8"), /hasReminder: boolean/);
  assert.match(mainSource, /today-mini:add-task/);
  assert.match(mainSource, /themeColor:/);
  assert.match(mainSource, /hasReminder:/);
});
