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

const taskSections = await importBundled("src/renderer/src/features/workspace/lib/taskSections.ts");

function task(id, sectionId = null, state = "todo", projectId = "theme-1") {
  return {
    id,
    title: id,
    project_id: projectId,
    section_id: sectionId,
    state,
    priority: "normal",
  };
}

test("task sections group theme tasks and keep unset or cross-theme references visible", () => {
  const sections = taskSections.listTaskSections([
    { id: "s2", title: "レビュー", view_type: "task_section", theme_id: "theme-1", sort_order: 2 },
    { id: "other", title: "別Theme", view_type: "task_section", theme_id: "theme-2", sort_order: 1 },
    { id: "s1", title: "実験", view_type: "task_section", theme_id: "theme-1", sort_order: 1 },
  ], "theme-1");

  assert.deepEqual(sections.map((section) => section.id), ["s1", "s2"]);

  const groups = taskSections.groupTasksBySection([
    task("experiment", "s1"),
    task("review", "s2", "done"),
    task("unset", null),
    task("cross-theme", "other"),
    task("other-theme-task", "other", "todo", "theme-2"),
  ], sections, "theme-1");

  assert.deepEqual(groups.map((group) => group.id), ["s1", "s2", "unsectioned"]);
  assert.deepEqual(groups.find((group) => group.id === "s1")?.tasks.map((entry) => entry.id), ["experiment"]);
  assert.deepEqual(groups.find((group) => group.id === "unsectioned")?.tasks.map((entry) => entry.id), ["cross-theme", "unset"]);
  assert.equal(groups.find((group) => group.id === "s2")?.openCount, 0);
  assert.equal(groups.find((group) => group.id === "s2")?.doneCount, 1);
});

test("task section drafts normalize names, theme references, and stable order", () => {
  const section = taskSections.buildTaskSection({
    title: "  連絡  ",
    themeId: "theme-1",
    sortOrder: 3,
    now: "2026-07-05T09:00:00.000Z",
  });

  assert.equal(section.view_type, "task_section");
  assert.equal(section.title, "連絡");
  assert.equal(section.theme_id, "theme-1");
  assert.equal(section.sort_order, 3);
  assert.equal(section.created_at, "2026-07-05T09:00:00.000Z");
});

test("task sections are wired through Theme detail, task drawer, and save form", () => {
  const themeSource = readFileSync("src/renderer/src/features/workspace/pages/ThemePage.tsx", "utf8");
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const appSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

  assert.match(themeSource, /TaskSectionBoard/);
  assert.match(themeSource, /buildTaskSection/);
  assert.match(themeSource, /collapsedSections/);
  // 編集UIからは非表示だが、既存 section_id は hidden で保持して保存時に消えない（#137）
  assert.match(drawerSource, /name="section_id"/);
  assert.doesNotMatch(drawerSource, /Field label="セクション"/);
  assert.match(appSource, /section_id: normalizeTaskSectionId/);
});
