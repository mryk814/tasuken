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

const planning = await importBundled("src/renderer/src/features/workspace/lib/dailyPlanning.ts");

function row(id, state = "todo", schedule = undefined) {
  return {
    task: { id, title: id, state, priority: "normal" },
    schedule,
  };
}

test("daily planning candidates classify open work without completed tasks", () => {
  const candidates = planning.buildDailyPlanningCandidates([
    row("overdue", "todo", { end_date: "2026-07-04" }),
    row("due-today", "todo", { end_date: "2026-07-05" }),
    row("range-started-today", "todo", { start_date: "2026-07-05", end_date: "2026-07-10" }),
    row("ongoing-period-this-week", "todo", { start_date: "2026-07-03", end_date: "2026-07-10", date_kind: "range" }),
    row("this-week", "todo", { end_date: "2026-07-12" }),
    row("later", "todo", { end_date: "2026-07-13" }),
    row("unscheduled", "todo"),
    row("done", "done", { end_date: "2026-07-04" }),
  ], "2026-07-05");

  assert.deepEqual(candidates.overdue.map((entry) => entry.task.id), ["overdue"]);
  assert.deepEqual(candidates.thisWeek.map((entry) => entry.task.id), ["ongoing-period-this-week", "this-week"]);
  assert.deepEqual(candidates.someday.map((entry) => entry.task.id), ["unscheduled"]);
});

test("Today page uses the Today mini window instead of the daily planning wizard", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");

  assert.match(source, /buildDailyPlanningCandidates/);
  assert.match(source, /workspaceApi\.showTodayMiniWindow/);
  assert.match(source, /今日やること/);
  assert.doesNotMatch(source, /今日の計画/);
  assert.doesNotMatch(source, /DailyPlanWizard/);
  assert.doesNotMatch(source, /confirmDailyPlan/);
  assert.doesNotMatch(source, /status: "daily_plan"/);
  assert.match(source, /今週/);
  assert.match(source, /いつか/);
  assert.match(source, /TASK_SHELF_OPTIONS/);
  assert.match(source, /planning_shelf: null/);
});
