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

const shelves = await importBundled("src/renderer/src/features/workspace/lib/taskShelves.ts");

test("task shelf values normalize to known operational shelves only", () => {
  assert.equal(shelves.normalizeTaskShelf("maybe_today"), "maybe_today");
  assert.equal(shelves.normalizeTaskShelf("backlog"), "backlog");
  assert.equal(shelves.normalizeTaskShelf("urgent"), null);
  assert.equal(shelves.taskShelfLabel("this_evening"), "夜/後で");
  assert.equal(shelves.taskShelfLabel("missing"), "棚なし");
});

test("task shelf status keeps due and overdue shelf tasks visible", () => {
  const task = { id: "t1", title: "Shelf task", state: "todo", priority: "normal", planning_shelf: "backlog" };
  assert.equal(shelves.taskShelfStatus({ task, schedule: { end_date: "2026-07-04" } }, "2026-07-05"), "overdue");
  assert.equal(shelves.taskShelfStatus({ task, schedule: { end_date: "2026-07-05" } }, "2026-07-05"), "due-today");
  assert.equal(shelves.taskShelfStatus({ task, schedule: { end_date: "2026-07-08" } }, "2026-07-05"), "");
});

test("task shelves are wired through Today candidates and the task drawer", () => {
  const todoSource = readFileSync("src/renderer/src/features/workspace/pages/TodoPage.tsx", "utf8");
  const todaySource = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");

  assert.doesNotMatch(todoSource, /moveTaskToShelf/);
  assert.match(todaySource, /buildDailyPlanningCandidates/);
  assert.match(todaySource, /handleMoveCandidateTaskToday/);
  assert.match(todaySource, /task-shelf-lane/);
  assert.match(drawerSource, /name="planning_shelf"/);
});
