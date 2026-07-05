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

const timeboxing = await importBundled("src/renderer/src/features/workspace/lib/timeboxing.ts");

function row(id, overrides = {}, schedule = undefined) {
  return {
    task: {
      id,
      title: id,
      state: "todo",
      priority: "normal",
      ...overrides,
    },
    schedule,
  };
}

test("timeboxed today rows sort timed tasks first and keep untimed tasks separate", () => {
  const result = timeboxing.buildTimeboxView([
    row("untimed", {}, { end_date: "2026-07-05" }),
    row("late", { planned_start_time: "14:00", planned_duration_minutes: 45 }, { end_date: "2026-07-05" }),
    row("early", { planned_start_time: "09:30", planned_duration_minutes: 30 }, { end_date: "2026-07-05" }),
    row("tomorrow", { planned_start_time: "08:00", planned_duration_minutes: 30 }, { end_date: "2026-07-06" }),
  ], "2026-07-05");

  assert.deepEqual(result.timed.map((entry) => entry.task.id), ["early", "late"]);
  assert.deepEqual(result.untimed.map((entry) => entry.task.id), ["untimed"]);
});

test("timeboxed today rows flag overlapping time ranges", () => {
  const result = timeboxing.buildTimeboxView([
    row("first", { planned_start_time: "10:00", planned_duration_minutes: 60 }, { end_date: "2026-07-05" }),
    row("overlap", { planned_start_time: "10:30", planned_duration_minutes: 30 }, { end_date: "2026-07-05" }),
    row("clear", { planned_start_time: "11:15", planned_duration_minutes: 30 }, { end_date: "2026-07-05" }),
  ], "2026-07-05");

  assert.deepEqual(result.conflicts.map((entry) => entry.task.id), ["first", "overlap"]);
  assert.equal(result.timed.find((entry) => entry.task.id === "first")?.overlaps, true);
  assert.equal(result.timed.find((entry) => entry.task.id === "clear")?.overlaps, false);
});

test("timebox inputs normalize invalid values without breaking Today", () => {
  assert.equal(timeboxing.normalizeStartTime("9:00"), "09:00");
  assert.equal(timeboxing.normalizeStartTime("25:00"), "");
  assert.equal(timeboxing.normalizeDurationMinutes("45"), 45);
  assert.equal(timeboxing.normalizeDurationMinutes("-1"), null);
});

test("Timeboxing is wired through Today, task drawer, and save form", () => {
  const todaySource = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const appSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

  assert.match(todaySource, /buildTimeboxView/);
  assert.match(todaySource, /時間割/);
  assert.match(todaySource, /timebox-conflict/);
  assert.match(drawerSource, /name="planned_start_time"/);
  assert.match(drawerSource, /name="planned_duration_minutes"/);
  assert.match(appSource, /normalizeStartTime\(formText\(values, "planned_start_time"\)\)/);
  assert.match(appSource, /normalizeDurationMinutes\(formText\(values, "planned_duration_minutes"\)\)/);
});
