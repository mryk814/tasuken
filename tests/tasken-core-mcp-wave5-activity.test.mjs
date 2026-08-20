import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

const bundled = await build({
  stdin: {
    contents: `
      export { ActivityEntriesQueryService } from "./src/main/core/services/activityEntriesQueryService.ts";
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
const { ActivityEntriesQueryService, WorkspaceActivityEntriesReadAdapter } = await import(
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
  const events = Array.from({ length: 101 }, (_, index) => buildActivityEvent({
    id: `event-${String(index).padStart(3, "0")}`,
    entity_type: "task",
    entity_id: task.id,
    event_kind: "task_work_recorded",
    occurred_at: occurredAt(index),
    after: task,
    summary: index === 100 ? `Latest ${"X".repeat(30_000)}` : `Work ${index}`,
    metadata: { dedupe_key: `work-${index}` },
    canonical_refs: index === 100 ? [
      { kind: "canonical_markdown", storage_root_id: "activity_artifacts", relative_path: "safe/report.md" },
      { kind: "canonical_markdown", locator: "C:\\Users\\private\\report.md" },
    ] : [],
    source_refs: index === 100 ? [
      { type: "source_record", id: "source-safe" },
      { kind: "url", locator: "https://example.com/source" },
      { kind: "canonical_document", locator: "/home/private/source.md" },
    ] : [],
    relation_refs: index === 100 ? [{ type: "artifact", id: "artifact-safe", relation: "generated" }] : [],
    work_receipt_ref: index === 100 ? { type: "work_receipt", id: "receipt-safe" } : null,
  }));
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
  events.push(buildActivityEvent({
    id: "dedupe-older",
    entity_type: "task",
    entity_id: task.id,
    event_kind: "task_work_recorded",
    occurred_at: "2026-08-18T00:00:00.000Z",
    after: task,
    summary: "Older duplicate",
    metadata: { dedupe_key: "same-work" },
  }));
  events.push(buildActivityEvent({
    id: "dedupe-newer",
    entity_type: "task",
    entity_id: task.id,
    event_kind: "task_work_recorded",
    occurred_at: "2026-08-18T01:00:00.000Z",
    after: task,
    summary: "Newer duplicate",
    metadata: { dedupe_key: "same-work" },
  }));
  return {
    themes: [visibleTheme, hiddenTheme],
    tasks: [
      task,
      { id: "task-hidden", title: "Hidden", state: "todo", project_id: hiddenTheme.id },
      { id: "task-deleted", title: "Deleted", state: "done", project_id: visibleTheme.id, deleted_at: "2026-08-20T00:00:00.000Z" },
    ],
    change_events: events,
    references: [{
      id: "reference-safe",
      source_type: "task",
      source_id: task.id,
      target_type: "note",
      target_id: "note-safe",
      relation_type: "context",
    }],
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
  assert.equal(page.events.some((event) => event.id === "legacy-event"), false);
  assert.equal(page.events.some((event) => event.id === "dedupe-older"), false);
  assert.equal(page.events.some((event) => event.id === "dedupe-newer"), false);
  assert.deepEqual(page.events[0].work_receipt_ref, { type: "work_receipt", id: "receipt-safe" });
  assert.equal(page.events[0].relation_refs.some((ref) => ref.type === "artifact" && ref.id === "artifact-safe"), true);
  assert.equal(page.events[0].relation_refs.some((ref) => ref.type === "note" && ref.id === "note-safe"), true);
  assert.equal(page.events[0].source_refs.some((ref) => ref.web_url === "https://example.com/source"), true);
  assert.equal(JSON.stringify(page).includes("Users\\private"), false);
  assert.equal(JSON.stringify(page).includes("/home/private"), false);
  assert.deepEqual(page.result_meta, {
    contract_version: 1,
    returned: 100,
    matched_visible: 103,
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
  assert.equal(service.execute({ task_id: "task-deleted", include_archived: true }).events.length, 0);
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
