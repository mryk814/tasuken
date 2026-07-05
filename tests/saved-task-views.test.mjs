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

const savedViews = await importBundled("src/renderer/src/features/workspace/lib/savedTaskViews.ts");

function row(id, overrides = {}, schedule = undefined) {
  return {
    task: {
      id,
      project_id: overrides.project_id ?? null,
      title: overrides.title ?? id,
      state: overrides.state ?? "todo",
      priority: overrides.priority ?? "normal",
      created_at: "2026-07-01T00:00:00.000Z",
      checklist_items: overrides.checklist_items,
    },
    schedule,
  };
}

test("saved task view filters combine tab, theme, state, priority, and schedule", () => {
  const filters = {
    tab: "open",
    themeId: "theme-a",
    state: "doing",
    priority: "high",
    schedule: "this-week",
  };
  const rows = [
    row("match", { project_id: "theme-a", state: "doing", priority: "high" }, { end_date: "2026-07-08" }),
    row("other-theme", { project_id: "theme-b", state: "doing", priority: "high" }, { end_date: "2026-07-08" }),
    row("done", { project_id: "theme-a", state: "done", priority: "high" }, { end_date: "2026-07-08" }),
    row("late", { project_id: "theme-a", state: "doing", priority: "high" }, { end_date: "2026-07-20" }),
  ];

  assert.deepEqual(savedViews.filterTodoRows(rows, filters, "2026-07-05").map((entry) => entry.task.id), ["match"]);
});

test("saved task views ignore malformed filters and tolerate deleted themes", () => {
  const view = savedViews.normalizeSavedTaskView({
    id: "view-1",
    title: "Missing theme",
    view_type: "task",
    filters: { tab: "open", themeId: "deleted-theme", schedule: "no-schedule", priority: "urgent" },
  });

  assert.equal(view.title, "Missing theme");
  assert.equal(view.filters.priority, "");
  assert.equal(savedViews.countTodoRowsForView(view, [row("personal")], "2026-07-05"), 0);
});

test("ToDo page wires saved task view create, rename, open, and delete actions", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/TodoPage.tsx", "utf8");

  assert.match(source, /保存済みビュー/);
  assert.match(source, /view_type: "task"/);
  assert.match(source, /filterTodoRows/);
  assert.match(source, /countTodoRowsForView/);
  assert.match(source, /openSavedView/);
  assert.match(source, /renameSavedView/);
  assert.match(source, /deleteSavedView/);
});
