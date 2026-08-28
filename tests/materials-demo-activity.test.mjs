import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { queryActivityEvents } from "../src/shared/activityProjection.mjs";
import { seed } from "../scripts/seed-materials-informatics-workspace.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

test("materials demo seeds the representative 2026-08-28 Activity day", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-materials-demo-"));
  const databasePath = path.join(root, "fixture.sqlite");
  let repository;
  try {
    const result = seed(databasePath);
    assert.equal(result.counts.project, 2);
    assert.equal(result.counts.repository_context, 4);
    assert.equal(result.counts.working_copy, 4);
    assert.equal(result.counts.agent_session, 4);
    assert.equal(result.counts.reference, 18);
    assert.equal(result.counts.change_event, 15);

    repository = new WorkspaceDatabase(databasePath);
    const workspace = repository.loadWorkspace(true);
    const sessions = workspace.agent_sessions
      .filter((session) => session.started_at.startsWith("2026-08-28"))
      .sort((left, right) => left.started_at.localeCompare(right.started_at));
    assert.deepEqual(
      sessions.map((session) => [session.started_at.slice(11, 16), session.ended_at.slice(11, 16)]),
      [
        ["08:30", "11:00"],
        ["10:20", "10:50"],
        ["13:30", "15:00"],
        ["14:10", "14:40"],
      ],
    );

    const day = queryActivityEvents({
      events: workspace.change_events,
      workspace,
      date: "2026-08-28",
      timezone: "Asia/Tokyo",
    });
    assert.equal(day.events.length, 7);
    assert.equal(day.events.filter((event) => event.origin?.session_id).length, 3);
    assert.equal(day.events.filter((event) => event.event_kind === "task_work_recorded").length, 6);
    assert.equal(
      day.events.filter((event) => event.event_kind === "task_checklist_checked").length,
      1,
    );
    assert.deepEqual(
      day.events.map((event) => event.local_time),
      ["07:55", "09:45", "11:30", "12:15", "15:10", "16:30", "18:00"],
    );
    const eventThemeCounts = [...new Set(day.events.map((event) => event.theme_ref?.id))]
      .filter(Boolean)
      .map((projectId) => day.events.filter((event) => event.theme_ref?.id === projectId).length)
      .sort((left, right) => left - right);
    assert.deepEqual(eventThemeCounts, [3, 4]);

    const sessionRanges = sessions.map((session) => [
      Date.parse(session.started_at),
      Date.parse(session.ended_at),
    ]);
    const maxOverlap = [...new Set(sessionRanges.flat())].reduce((maximum, timestamp) => {
      const active = sessionRanges.filter(
        ([start, end]) => start <= timestamp && timestamp < end,
      ).length;
      return Math.max(maximum, active);
    }, 0);
    assert.equal(maxOverlap, 2);

    const sessionReferences = workspace.references.filter(
      (reference) =>
        reference.subject?.type === "agent_session" && reference.predicate === "worked_on",
    );
    assert.equal(sessionReferences.length, 8);
    assert.equal(new Set(sessionReferences.map((reference) => reference.object?.type)).size, 2);
  } finally {
    repository?.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
