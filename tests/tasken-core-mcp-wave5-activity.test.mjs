import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { ReadOnlyTaskenContext } from "./fixtures/legacyReadOnlyContext.mjs";

const workspaceRepositoryModule = "../src/main/repositories/" + "workspaceRepository.mjs";
const { WorkspaceDatabase } = await import(workspaceRepositoryModule);

const bundled = await build({
  stdin: {
    contents: `
      export { ActivityEntriesQueryService } from "./src/main/core/services/activityEntriesQueryService.ts";
      export { AgentWorkspaceQueryService } from "./src/main/core/services/agentWorkspaceQueryService.ts";
      export { WorkspaceActivityEntriesReadAdapter } from "./src/main/infrastructure/sqlite/workspaceActivityEntriesReadAdapter.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const {
  ActivityEntriesQueryService,
  AgentWorkspaceQueryService,
  WorkspaceActivityEntriesReadAdapter,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const occurredAt = (index) => new Date(Date.UTC(2026, 7, 20, 0, 0, index)).toISOString();

function activityFixture() {
  const visibleTheme = {
    id: "theme-visible",
    name: "Visible",
    default_ai_visibility: ["coding_agent"],
  };
  const hiddenTheme = {
    id: "theme-hidden",
    name: "Hidden",
    default_ai_visibility: [],
  };
  const task = {
    id: "task-visible",
    title: "Visible Task",
    state: "doing",
    project_id: visibleTheme.id,
  };
  const hiddenTask = {
    id: "task-hidden",
    title: "Hidden",
    state: "todo",
    project_id: hiddenTheme.id,
  };
  const events = Array.from({ length: 101 }, (_, index) =>
    buildActivityEvent({
      id: `event-${String(index).padStart(3, "0")}`,
      entity_type: "task",
      entity_id: task.id,
      event_kind: "task_work_recorded",
      occurred_at: occurredAt(index),
      after: task,
      summary: index === 100 ? `Latest ${"X".repeat(30_000)}` : `Work ${index}`,
      metadata: { dedupe_key: `work-${index}` },
      canonical_refs:
        index === 100
          ? [
              {
                kind: "canonical_markdown",
                storage_root_id: "activity_artifacts",
                relative_path: "safe/report.md",
              },
              { kind: "canonical_markdown", locator: "C:\\Users\\private\\report.md" },
            ]
          : [],
      source_refs:
        index === 100
          ? [
              { type: "source_record", id: "source-safe" },
              { kind: "url", locator: "https://example.com/source" },
              { kind: "canonical_document", locator: "/home/private/source.md" },
            ]
          : [],
      relation_refs:
        index === 100 ? [{ type: "artifact", id: "artifact-safe", relation: "generated" }] : [],
      work_receipt_ref: index === 100 ? { type: "work_receipt", id: "receipt-safe" } : null,
    }),
  );
  events.push({
    id: "legacy-event",
    entity_type: "task",
    entity_id: task.id,
    changed_at: "2026-08-19T00:00:00.000Z",
    change_type: "completed",
    after_json: JSON.stringify({ ...task, state: "done" }),
    summary: "Legacy completion",
  });
  // Same dedupe key: only the later event may survive projection.
  events.push(
    buildActivityEvent({
      id: "dedupe-older",
      entity_type: "task",
      entity_id: task.id,
      event_kind: "task_work_recorded",
      occurred_at: "2026-08-18T00:00:00.000Z",
      after: task,
      summary: "Older duplicate",
      metadata: { dedupe_key: "same-work" },
    }),
  );
  events.push(
    buildActivityEvent({
      id: "dedupe-newer",
      entity_type: "task",
      entity_id: task.id,
      event_kind: "task_work_recorded",
      occurred_at: "2026-08-18T01:00:00.000Z",
      after: task,
      summary: "Newer duplicate",
      metadata: { dedupe_key: "same-work" },
    }),
  );
  events.push(
    buildActivityEvent({
      id: "hidden-day-event",
      entity_type: "task",
      entity_id: hiddenTask.id,
      event_kind: "task_work_recorded",
      occurred_at: "2026-08-20T12:00:00.000Z",
      after: hiddenTask,
      summary: "Hidden day activity",
    }),
  );
  return {
    themes: [visibleTheme, hiddenTheme],
    tasks: [
      task,
      hiddenTask,
      {
        id: "task-deleted",
        title: "Deleted",
        state: "done",
        project_id: visibleTheme.id,
        deleted_at: "2026-08-20T00:00:00.000Z",
      },
    ],
    change_events: events,
    references: [
      {
        id: "reference-safe",
        source_type: "task",
        source_id: task.id,
        target_type: "note",
        target_id: "note-safe",
        relation_type: "context",
      },
    ],
    canonical_root_status: { activity_artifacts: { status: "ok" } },
  };
}

class FixturePort {
  constructor(workspace) {
    this.workspace = workspace;
  }

  readActivityEntriesSnapshot(includeArchived) {
    const filter = (records) => records.filter((record) => includeArchived || !record.deleted_at);
    return {
      workspace: {
        ...this.workspace,
        tasks: filter(this.workspace.tasks),
        themes: filter(this.workspace.themes),
        change_events: filter(this.workspace.change_events),
      },
      visibilityThemes: this.workspace.themes,
      workspaceAiVisibilityDefault: ["coding_agent"],
    };
  }
}

test("Task Activity Core query preserves legacy projection, visibility, refs, and public bounds", () => {
  const service = new ActivityEntriesQueryService(new FixturePort(activityFixture()));

  const page = service.execute({ task_id: "task-visible", limit: 100 });
  assert.equal(page.events.length, 100);
  assert.equal(page.events[0].id, "event-100");
  assert.equal(page.events[0].summary.length > 30_000, true);
  assert.equal(
    page.events.some((event) => event.id === "legacy-event"),
    false,
  );
  assert.equal(
    page.events.some((event) => event.id === "dedupe-older"),
    false,
  );
  assert.equal(
    page.events.some((event) => event.id === "dedupe-newer"),
    false,
  );
  assert.deepEqual(page.events[0].work_receipt_ref, { type: "work_receipt", id: "receipt-safe" });
  assert.equal(
    page.events[0].relation_refs.some(
      (ref) => ref.type === "artifact" && ref.id === "artifact-safe",
    ),
    true,
  );
  assert.equal(
    page.events[0].relation_refs.some((ref) => ref.type === "note" && ref.id === "note-safe"),
    true,
  );
  assert.equal(
    page.events[0].source_refs.some((ref) => ref.web_url === "https://example.com/source"),
    true,
  );
  assert.equal(JSON.stringify(page).includes("Users\\private"), false);
  assert.equal(JSON.stringify(page).includes("/home/private"), false);
  assert.deepEqual(page.result_meta, {
    contract_version: 1,
    returned_count: 100,
    matched_visible_count: 103,
    truncated: true,
  });

  const defaults = service.execute({ task_id: "task-visible" });
  assert.equal(defaults.limit, 50);
  assert.equal(defaults.events.length, 50);
  const missing = service.execute({ task_id: "missing" });
  const hidden = service.execute({ task_id: "task-hidden" });
  assert.equal(missing.error.code, "not_found");
  assert.equal(hidden.error.code, missing.error.code);
  assert.equal(hidden.error.message, missing.error.message);
  assert.equal(service.execute({ task_id: "task-deleted" }).error.code, "not_found");
  assert.equal(
    service.execute({ task_id: "task-deleted", include_archived: true }).events.length,
    0,
  );
});

test("Daily Activity Core query uses the canonical local day and retains AI visibility bounds", () => {
  const service = new ActivityEntriesQueryService(new FixturePort(activityFixture()));

  const page = service.execute({ date: "2026-08-20", limit: 100 });
  assert.equal(page.date, "2026-08-20");
  assert.equal(page.events.length, 100);
  assert.equal(
    page.events.every((event) => event.local_date === "2026-08-20"),
    true,
  );
  assert.equal(
    page.events.some((event) => event.id === "hidden-day-event"),
    false,
  );
  assert.equal(JSON.stringify(page).includes("Users\\private"), false);
  assert.deepEqual(page.next_tools, []);
  assert.throws(() => service.execute({}), /task_id|date/);
  assert.throws(
    () => service.execute({ task_id: "task-visible", date: "2026-08-20" }),
    /task_id|date/,
  );
});

test("daily Activity and Session queries use the runtime local day without changing Task Activity", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const workspace = activityFixture();
    workspace.change_events = [
      "2026-08-30T23:59:59.000Z",
      "2026-08-31T16:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    ].map((occurredAt, index) =>
      buildActivityEvent({
        id: `boundary-${index}`,
        entity_type: "task",
        entity_id: "task-visible",
        event_kind: "task_work_recorded",
        occurred_at: occurredAt,
        after: workspace.tasks[0],
        summary: `Boundary ${index}`,
        metadata: { dedupe_key: `boundary-${index}` },
      }),
    );
    const activity = new ActivityEntriesQueryService(new FixturePort(workspace));
    assert.deepEqual(
      activity.execute({ date: "2026-08-31" }).events.map((event) => [event.id, event.local_date]),
      [["boundary-1", "2026-08-31"]],
    );
    assert.equal(
      activity
        .execute({ task_id: "task-visible" })
        .events.find((event) => event.id === "boundary-1").local_date,
      "2026-09-01",
    );

    const sessions = new AgentWorkspaceQueryService({
      listTasks: () => [],
      listThemes: () => [],
      listRepositoryContexts: () => [],
      listWorkReceipts: () => [],
      listAiProposals: () => [],
      listWorkingCopies: () => [],
      listReferences: () => [],
      workspaceAiVisibilityDefault: () => ["coding_agent"],
      listAgentSessions: () =>
        workspace.change_events.map((event) => ({
          id: event.id,
          started_at: event.occurred_at,
          status: "active",
          client_kind: "codex",
          intent: { summary: event.summary },
        })),
    });
    assert.deepEqual(
      sessions
        .getAgentSessionContext({ date: "2026-08-31", source_session: "daily-boundary" })
        .sessions.map((session) => session.id),
      ["boundary-1"],
    );
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("Task work ending at midnight is not returned on the next local day", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  try {
    const service = new AgentWorkspaceQueryService({
      listTasks: () => [{ id: "task-midnight", title: "Midnight", state: "todo" }],
      listThemes: () => [],
      listRepositoryContexts: () => [],
      listAiProposals: () => [],
      listWorkingCopies: () => [],
      listReferences: () => [],
      listAgentSessions: () => [],
      workspaceAiVisibilityDefault: () => ["coding_agent"],
      listWorkReceipts: () => [
        {
          id: "receipt-midnight",
          task_id: "task-midnight",
          started_at: "2026-09-04T14:00:00.000Z",
          reported_at: "2026-09-04T15:00:00.000Z",
          runtime_metadata: { report_kind: "done" },
        },
      ],
    });
    assert.equal(
      service.getAgentSessionContext({ date: "2026-09-04", source_session: "daily-boundary" })
        .task_work.length,
      1,
    );
    assert.equal(
      service.getAgentSessionContext({ date: "2026-09-05", source_session: "daily-boundary" })
        .task_work.length,
      0,
    );
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("Activity adapter reads an empty WorkspaceDatabase without creating the default Theme", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-wave5-activity-db-"));
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  try {
    assert.equal(database.list("theme", true).length, 0);
    const adapter = new WorkspaceActivityEntriesReadAdapter(database);
    const snapshot = adapter.readActivityEntriesSnapshot(false);
    assert.equal(snapshot.workspace.tasks.length, 0);
    assert.equal(database.list("theme", true).length, 0);
  } finally {
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function legacyActivityContext(count) {
  const theme = { id: "theme", name: "Theme", default_ai_visibility: ["coding_agent"] };
  const task = { id: "task", title: "Task", state: "doing", project_id: theme.id };
  const hiddenTask = {
    id: "task-hidden",
    title: "Hidden",
    state: "doing",
    project_id: theme.id,
    ai_visibility: [],
  };
  const deletedTask = {
    id: "task-deleted",
    title: "Deleted",
    state: "done",
    project_id: theme.id,
    deleted_at: "2026-08-21T00:00:00.000Z",
  };
  const events = Array.from({ length: count }, (_, index) =>
    buildActivityEvent({
      id:
        index === count - 1
          ? "tie-z"
          : index === count - 2
            ? "tie-a"
            : `event-${String(index).padStart(3, "0")}`,
      entity_type: "task",
      entity_id: task.id,
      event_kind: "task_work_recorded",
      occurred_at: index >= count - 2 ? "2026-08-21T12:00:00.000Z" : occurredAt(index),
      after: task,
      summary: `Activity ${index}`,
      metadata: { dedupe_key: `legacy-work-${index}` },
    }),
  );
  events.unshift(
    buildActivityEvent({
      id: "hidden-newest",
      entity_type: "task",
      entity_id: hiddenTask.id,
      event_kind: "task_work_recorded",
      occurred_at: "2026-08-22T00:00:00.000Z",
      after: hiddenTask,
      metadata: { dedupe_key: "hidden-newest" },
    }),
  );
  events.push(
    buildActivityEvent({
      id: "deleted-event",
      entity_type: "task",
      entity_id: deletedTask.id,
      event_kind: "task_completed",
      occurred_at: "2026-08-21T00:00:00.000Z",
      after: deletedTask,
      metadata: { dedupe_key: "deleted-event" },
    }),
  );
  return new ReadOnlyTaskenContext("ignored", {
    workspace: { themes: [theme], tasks: [task, hiddenTask, deletedTask], change_events: events },
  });
}

test("#423 legacy Task Activity applies visibility and descending order before its public limit", () => {
  for (const count of [0, 50, 100, 101]) {
    const context = legacyActivityContext(count);
    try {
      const result = context.toolGetActivityEntries({ task_id: "task", limit: 100 });
      assert.equal(result.events.length, Math.min(count, 100), `${count} returned`);
      assert.deepEqual(result.result_meta, {
        contract_version: 1,
        returned_count: Math.min(count, 100),
        matched_visible_count: count,
        truncated: count > 100,
      });
      if (count >= 2)
        assert.deepEqual(
          result.events.slice(0, 2).map((event) => event.id),
          ["tie-z", "tie-a"],
        );
      assert.equal(JSON.stringify(result).includes("hidden-newest"), false);
    } finally {
      context.close();
    }
  }

  const context = legacyActivityContext(50);
  try {
    const defaults = context.toolGetActivityEntries({ task_id: "task" });
    assert.equal(defaults.limit, 50);
    assert.equal(defaults.result_meta.returned_count, 50);
    assert.equal(defaults.result_meta.truncated, false);
    assert.equal(
      context.toolGetActivityEntries({ task_id: "task-hidden" }).error.code,
      "not_found",
    );
    assert.equal(
      context.toolGetActivityEntries({ task_id: "task-deleted" }).error.code,
      "not_found",
    );
    const archived = context.toolGetActivityEntries({
      task_id: "task-deleted",
      include_archived: true,
    });
    assert.equal(archived.events.length, 1);
    assert.equal(archived.events[0].metadata.entity_status, "deleted");
  } finally {
    context.close();
  }
});
