import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const todayPageSource = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");

test("Today page stays focused on daily decisions instead of utility controls", () => {
  assert.doesNotMatch(todayPageSource, /showTodayMiniWindow/);
  assert.doesNotMatch(todayPageSource, /IconFlag/);
  assert.doesNotMatch(todayPageSource, /onTogglePriority/);
  assert.doesNotMatch(todayPageSource, />\+7d</);
});

test("Today page demotes inbox and unscheduled work to metric links instead of row sections", () => {
  assert.doesNotMatch(todayPageSource, /<h2>Inbox未整理<\/h2>/);
  assert.doesNotMatch(todayPageSource, /<h2>予定なし<\/h2>/);
  assert.match(todayPageSource, /navigate\("inbox"\)/);
  assert.match(todayPageSource, /navigate\("todo"\)/);
});
