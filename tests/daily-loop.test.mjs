import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const dailyLoop = await importBundled("src/renderer/src/features/workspace/lib/dailyLoop.ts");

test("daily loop summary connects planning, execution, learning, log, and weekly review", () => {
  const summary = dailyLoop.buildDailyLoopSummary({
    todayTaskCount: 3,
    timedTaskCount: 2,
    timeboxConflictCount: 1,
    reminderCount: 1,
    completedTodayCount: 2,
    learningTodayCount: 1,
    activityLogItemCount: 5,
    weeklyThemeCount: 2,
  });

  assert.deepEqual(summary.steps.map((step) => step.id), ["morning", "daytime", "learning", "evening", "weekly"]);
  assert.equal(summary.steps.find((step) => step.id === "morning")?.state, "active");
  assert.equal(summary.steps.find((step) => step.id === "daytime")?.metric, "3件を進める");
  assert.equal(summary.steps.find((step) => step.id === "learning")?.metric, "学び1件");
  assert.equal(summary.steps.find((step) => step.id === "evening")?.metric, "5件をログ化");
  assert.equal(summary.steps.find((step) => step.id === "weekly")?.metric, "2 Theme");
});

test("daily loop summary stays usable when optional counts are empty", () => {
  const summary = dailyLoop.buildDailyLoopSummary({
    todayTaskCount: 0,
    timedTaskCount: 0,
    timeboxConflictCount: 0,
    reminderCount: 0,
    completedTodayCount: 0,
    learningTodayCount: 0,
    activityLogItemCount: 0,
    weeklyThemeCount: 0,
  });

  assert.equal(summary.steps.find((step) => step.id === "morning")?.state, "ready");
  assert.equal(summary.steps.find((step) => step.id === "daytime")?.metric, "未計画");
  assert.equal(summary.steps.find((step) => step.id === "evening")?.state, "ready");
});

test("Today wires the daily operation loop to existing Tasken flows", () => {
  const todaySource = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
  const loopSource = readFileSync("src/renderer/src/features/workspace/lib/dailyLoop.ts", "utf8");
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const activityLogSource = readFileSync("src/renderer/src/features/workspace/lib/activityLog.ts", "utf8");
  const themeSource = readFileSync("src/renderer/src/features/workspace/pages/ThemePage.tsx", "utf8");

  assert.match(todaySource, /DailyLoopPanel/);
  assert.match(todaySource, /buildDailyLoopSummary/);
  assert.match(todaySource, /openTodayMini/);
  assert.match(loopSource, /showTodayMiniWindow/);
  assert.match(todaySource, /openDailyPlan/);
  assert.match(todaySource, /setShowActivityLog\(true\)/);
  assert.match(drawerSource, /完了して学びを書く/);
  assert.match(drawerSource, /Knowledge化/);
  assert.match(activityLogSource, /作成・更新したNotes/);
  assert.match(activityLogSource, /Knowledge/);
  assert.match(themeSource, /報告書/);
});
