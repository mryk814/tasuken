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

test("Today mini can snap to the top right and fades only while inactive", () => {
  assert.match(mainSource, /function pinTodayMiniTopRight/);
  assert.match(mainSource, /screen\.getDisplayMatching/);
  assert.match(mainSource, /today-mini:pin-top-right/);
  assert.match(mainSource, /TODAY_MINI_INACTIVE_OPACITY/);
  assert.match(mainSource, /setOpacity\(1\)/);
  assert.match(mainSource, /setOpacity\(TODAY_MINI_INACTIVE_OPACITY\)/);
  assert.match(preloadSource, /pinTopRight/);
  assert.match(contractsSource, /pinTopRight/);
  assert.match(htmlSource, /id="pin-top-right"/);
  assert.match(htmlSource, /window\.todayMiniApi\.pinTopRight/);
});
