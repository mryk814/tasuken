import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { seed } from "../scripts/seed-materials-informatics-workspace.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

test("materials demo seeds the representative 2026-08-28 Activity day", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-materials-demo-"));
  const databasePath = path.join(root, "fixture.sqlite");
  try {
    const result = seed(databasePath);
    assert.equal(result.counts.project, 2);
    assert.equal(result.counts.repository_context, 4);
    assert.equal(result.counts.working_copy, 4);
    assert.equal(result.counts.agent_session, 4);
    assert.equal(result.counts.reference, 18);
    assert.equal(result.counts.change_event, 18);
    const database = new WorkspaceDatabase(databasePath);
    const loaded = database.loadWorkspace();
    database.db.close();
    const themesByCode = Object.fromEntries(loaded.themes.map((theme) => [theme.code, theme]));
    const projectsByCode = Object.fromEntries(
      loaded.projects.map((project) => [project.code, project]),
    );
    assert.equal(themesByCode["MI-LLZO-26"].repository_context_ids.length, 2);
    assert.equal(
      themesByCode["MI-LLZO-26"].primary_repository_context_id,
      themesByCode["MI-LLZO-26"].repository_context_ids[0],
    );
    assert.equal(themesByCode["CIRC-AL-07"].repository_context_ids.length, 2);
    assert.equal(
      themesByCode["CIRC-AL-07"].primary_repository_context_id,
      themesByCode["CIRC-AL-07"].repository_context_ids[0],
    );
    assert.deepEqual(
      projectsByCode["MI-LLZO-26"].repository_context_ids,
      themesByCode["MI-LLZO-26"].repository_context_ids,
    );
    assert.deepEqual(
      projectsByCode["CIRC-AL-07"].repository_context_ids,
      themesByCode["CIRC-AL-07"].repository_context_ids,
    );
    assert.deepEqual(result.representativeActivity.session_times, [
      ["08:30", "11:00"],
      ["10:20", "10:50"],
      ["13:30", "15:00"],
      ["14:10", "14:40"],
    ]);
    assert.equal(result.representativeActivity.session_event_count, 3);
    assert.deepEqual(result.representativeActivity.event_kind_counts, {
      task_work_recorded: 9,
      task_checklist_checked: 1,
    });
    assert.deepEqual(result.representativeActivity.event_times, [
      "07:55",
      "09:45",
      "11:30",
      "12:15",
      "15:10",
      "15:12",
      "15:18",
      "15:24",
      "16:30",
      "18:00",
    ]);
    assert.deepEqual(result.representativeActivity.event_theme_counts, [3, 7]);
    assert.equal(result.representativeActivity.max_session_overlap, 2);
    assert.equal(result.representativeActivity.session_reference_count, 8);
    assert.deepEqual(result.representativeActivity.session_reference_types.sort(), [
      "project",
      "repository_context",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
