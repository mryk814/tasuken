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
    row("carryover", "doing", { start_date: "2026-07-03", end_date: "2026-07-08" }),
    row("due-today", "todo", { end_date: "2026-07-05" }),
    row("unscheduled", "todo"),
    row("done", "done", { end_date: "2026-07-04" }),
  ], "2026-07-05");

  assert.deepEqual(candidates.overdue.map((entry) => entry.task.id), ["overdue"]);
  assert.deepEqual(candidates.carryover.map((entry) => entry.task.id), ["carryover"]);
  assert.deepEqual(candidates.dueToday.map((entry) => entry.task.id), ["due-today"]);
  assert.deepEqual(candidates.unscheduled.map((entry) => entry.task.id), ["unscheduled"]);
});

test("daily planning defaults select overdue and due-today work only", () => {
  const candidates = planning.buildDailyPlanningCandidates([
    row("overdue", "todo", { end_date: "2026-07-04" }),
    row("carryover", "doing", { start_date: "2026-07-03", end_date: "2026-07-08" }),
    row("due-today", "todo", { end_date: "2026-07-05" }),
    row("unscheduled", "todo"),
  ], "2026-07-05");
  assert.deepEqual([...planning.defaultDailyPlanSelection(candidates)].sort(), ["due-today", "overdue"]);
});

test("Today page wires daily planning wizard, memo save, and schedule application", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");

  assert.match(source, /今日の計画/);
  assert.match(source, /buildDailyPlanningCandidates/);
  assert.match(source, /confirmDailyPlan/);
  assert.match(source, /type: "status_update"/);
  assert.match(source, /status: "daily_plan"/);
  assert.match(source, /planning_shelf: null/);
});
