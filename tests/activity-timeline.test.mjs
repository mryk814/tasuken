import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { build } from "esbuild";
import path from "node:path";
import test from "node:test";

const {
  activityDisplayKind,
  activitySessionInterval,
  activityThemeIds,
  buildActivityTimeline,
  buildDailyAgentSessionContexts,
  groupFocusSessionActivity,
  projectActivitySessionLogEntries,
  reviewableActivityEvents,
} = await importBundled("src/renderer/src/features/workspace/lib/activityTimeline.ts");

test("Focus sessions replace their lifecycle events with one work period, preserving unrelated activity", () => {
  const note = {
    id: "focus-1",
    title: "Focus Session: 実験条件の確認",
    project_id: "theme-1",
    properties_json: {
      document_role: "focus_session",
      session_state: "ended",
      task_id: "task-1",
      started_at: "2026-09-08T01:00:00Z",
      ended_at: "2026-09-08T02:15:00Z",
      summary: "条件表を確認した",
    },
  };
  const events = [
    {
      id: "start",
      entity_ref: { type: "note", id: "focus-1" },
      origin: { session_id: "old-start" },
    },
    { id: "autosave", entity_ref: { type: "note", id: "focus-1" } },
    {
      id: "end",
      entity_ref: { type: "note", id: "focus-1" },
      origin: { session_id: "shared", command_id: "end-command", command_name: "EndFocusSession" },
    },
    { id: "reference", entity_ref: { type: "reference", id: "ref-1" } },
    { id: "done", entity_ref: { type: "task", id: "task-1" } },
    {
      id: "status",
      entity_ref: { type: "status_update", id: "status-1" },
      origin: { session_id: "shared", command_id: "end-command", command_name: "EndFocusSession" },
    },
    {
      id: "unrelated",
      entity_ref: { type: "task", id: "task-2" },
      event_kind: "task_completed",
      origin: { session_id: "shared", command_id: "other-command", command_name: "CompleteTask" },
    },
  ];
  const changes = [
    ...events.slice(0, 3),
    {
      id: "reference",
      entity_type: "reference",
      after_json: JSON.stringify({ source_type: "note", source_id: "focus-1" }),
    },
    {
      id: "done",
      entity_type: "task",
      entity_id: "task-1",
      reason: "focus_session_completed_task",
      after_json: { completed_at: note.properties_json.ended_at },
    },
  ];
  const result = groupFocusSessionActivity(events, [note], changes, "2026-09-08");
  assert.equal(result.length, 2);
  assert.equal(result[0], events.at(-1));
  assert.equal(result[1].id, "focus:focus-1");
  assert.equal(result[1].occurred_at, "2026-09-08T01:00:00.000Z");
  assert.equal(result[1].metadata.end_at, "2026-09-08T02:15:00.000Z");
  assert.equal(result[1].summary, "条件表を確認した");
  assert.equal(events.length, 7);
  assert.equal(activityDisplayKind({ eventKind: result[1].event_kind }), "record");
});

test("Focus activity spans midnight and keeps active, separate, and invalid sessions distinct", () => {
  const session = (id, started_at, ended_at) => ({
    id,
    properties_json: {
      document_role: "focus_session",
      task_id: "same-task",
      session_state: ended_at ? "ended" : "active",
      started_at,
      ended_at,
    },
  });
  const notes = [
    session("overnight", "2026-09-07T14:30:00Z", "2026-09-07T15:30:00Z"),
    session("active", "2026-09-08T01:00:00Z"),
    session("invalid", "invalid"),
    { id: "ordinary", properties_json: {} },
  ];
  const result = groupFocusSessionActivity([], notes, [], "2026-09-08", "2026-09-08T02:00:00Z");
  assert.equal(result.length, 2);
  assert.equal(result[0].occurred_at, "2026-09-07T15:00:00.000Z");
  assert.equal(result[0].metadata.end_at, "2026-09-07T15:30:00.000Z");
  assert.equal(result[1].metadata.session_state, "active");
  assert.equal(result[1].metadata.end_at, "2026-09-08T02:00:00.000Z");
  const previous = groupFocusSessionActivity([], notes, [], "2026-09-07");
  assert.equal(previous.length, 1);
  assert.equal(previous[0].id, result[0].id);
});
const { appendActivitySessionsToLog } = await importBundled(
  "src/renderer/src/features/workspace/lib/activityLog.ts",
);

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64")
  );
}

test("Activity display separates AI work, outcomes, records, and organization", () => {
  assert.equal(activityDisplayKind({ entityType: "agent_session" }), "ai_work");
  assert.equal(activityDisplayKind({ actorKind: "agent", eventKind: "note_created" }), "record");
  assert.equal(activityDisplayKind({ originKind: "mcp", eventKind: "task_completed" }), "outcome");
  assert.equal(activityDisplayKind({ eventKind: "task_completed" }), "outcome");
  assert.equal(activityDisplayKind({ eventKind: "note_updated" }), "record");
  assert.equal(activityDisplayKind({ eventKind: "plan_node_updated" }), "organize");
});

test("Activity includes a cross-day AI session in each overlapping JST day", () => {
  const session = {
    started_at: "2026-08-28T14:00:00.000Z",
    ended_at: "2026-08-28T16:00:00.000Z",
  };
  assert.deepEqual(activitySessionInterval(session, "2026-08-28"), {
    start_at: "2026-08-28T14:00:00.000Z",
    end_at: "2026-08-28T15:00:00.000Z",
  });
  assert.deepEqual(activitySessionInterval(session, "2026-08-29"), {
    start_at: "2026-08-28T15:00:00.000Z",
    end_at: "2026-08-28T16:00:00.000Z",
  });
  assert.equal(activitySessionInterval(session, "2026-08-30"), null);
});

test("AI session aggregation keeps related Activity kinds and effective Themes", () => {
  const sessionRow = {
    session: {
      id: "session-a",
      source_session_id: "source-a",
      started_at: "2026-08-28T00:00:00.000Z",
      ended_at: "2026-08-28T01:00:00.000Z",
      client_kind: "codex",
      intent: { summary: "振り返りを整える" },
      outcome: { summary: "完了", remaining_work: [] },
    },
    themes: [{ id: "theme-a" }],
    repositories: [{ label: "tasuken" }],
  };
  const events = reviewableActivityEvents([
    {
      event_kind: "task_completed",
      entity_ref: { type: "task" },
      origin: { session_id: "source-a" },
      theme_ref: { kind: "theme", id: "theme-b" },
    },
    {
      event_kind: "schedule_updated",
      entity_ref: { type: "schedule" },
      origin: { session_id: "source-a" },
    },
  ]);
  const contexts = buildDailyAgentSessionContexts([sessionRow], "2026-08-28", events);
  assert.deepEqual(contexts[0].themeIds, ["theme-a", "theme-b"]);
  assert.equal(contexts[0].events.length, 1);
  assert.equal(activityDisplayKind({ eventKind: contexts[0].events[0].event_kind }), "outcome");
  assert.deepEqual(
    projectActivitySessionLogEntries(contexts, [
      { id: "theme-a", name: "Tasken" },
      { id: "theme-b", name: "Activity" },
    ])[0].theme_names,
    ["Tasken", "Activity"],
  );
});

test("Activity Markdown appends the AI work visible in the daily review", () => {
  const markdown = appendActivitySessionsToLog("# Activity\n", [
    {
      time_label: "09:00–10:00",
      client_label: "Codex",
      theme_names: ["Tasken"],
      intent: "Activityを読みやすくする",
      outcome: "時系列表示を実装",
      repository_names: ["tasuken"],
      remaining_work: ["実描画確認"],
    },
  ]);
  assert.match(markdown, /## AI作業/);
  assert.match(markdown, /09:00–10:00 \[Codex\] Activityを読みやすくする/);
  assert.match(markdown, /Theme: Tasken/);
  assert.match(markdown, /結果: 時系列表示を実装/);
  assert.match(markdown, /残作業: 実描画確認/);
});

test("Activity Theme chips include canonical and related Theme references once", () => {
  assert.deepEqual(
    activityThemeIds({
      theme_ref: { kind: "theme", id: "theme-a" },
      relation_refs: [
        { type: "project", id: "theme-a" },
        { type: "project", id: "theme-b" },
        { type: "task", id: "task-a" },
      ],
    }),
    ["theme-a", "theme-b"],
  );
});

test("Activity timeline uses proportional empty space without adding explanatory gap rows", () => {
  const rows = buildActivityTimeline([
    {
      id: "later",
      start_at: "2026-08-28T13:00:00.000Z",
    },
    {
      id: "session",
      start_at: "2026-08-28T09:00:00.000Z",
      end_at: "2026-08-28T11:30:00.000Z",
    },
    {
      id: "inside-session",
      start_at: "2026-08-28T10:00:00.000Z",
    },
    {
      id: "much-later",
      start_at: "2026-08-28T20:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    rows.map((row) => [row.id, row.gap_size]),
    [
      ["session", 0],
      ["inside-session", 0],
      ["later", 27],
      ["much-later", 90],
    ],
  );
  assert.equal(
    rows.some((row) => row.kind === "gap"),
    false,
  );
});
