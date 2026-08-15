import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Buffer } from "node:buffer";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildActivityEvent,
  migrateChangeEvent,
} from "../src/shared/activityEvent.mjs";
import {
  projectActivityJson,
  projectActivityMarkdown,
  queryActivityEvents,
} from "../src/shared/activityProjection.mjs";
import { buildActivityRootRegistry, publicActivityRootStatus } from "../src/shared/activityRootRegistry.mjs";
import { resolveActivityCanonicalLocalPath } from "../src/main/services/activityCanonicalResolver.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

test("structured Activity contract uses completed_at for Task completion and distinguishes reopen", () => {
  const completed = buildActivityEvent({
    id: "event-complete",
    entityType: "task",
    entityId: "task-1",
    changeType: "completed",
    occurredAt: "2026-08-08T01:00:00.000Z",
    after: {
      id: "task-1",
      title: "確認",
      state: "done",
      completed_at: "2026-08-08T02:00:00.000Z",
    },
  });
  assert.equal(completed.occurred_at, "2026-08-08T02:00:00.000Z");
  assert.equal(completed.event_kind, "task_completed");
  assert.deepEqual(Object.keys(completed.entity_ref), ["type", "id"]);
  assert.ok(completed.metadata.schema_version);

  const reopened = buildActivityEvent({
    id: "event-reopen",
    entityType: "task",
    entityId: "task-1",
    commandName: "ReopenTask",
    before: { id: "task-1", state: "done" },
    after: { id: "task-1", state: "todo", updated_at: "2026-08-08T03:00:00.000Z" },
  });
  assert.equal(reopened.event_kind, "task_reopened");
});

test("Note, Resource, and Artifact event kinds are fixed and typed", () => {
  assert.equal(buildActivityEvent({
    entityType: "note",
    entityId: "note-1",
    changeType: "created",
    after: { id: "note-1", title: "メモ" },
  }).event_kind, "note_created");
  assert.equal(buildActivityEvent({
    entityType: "note",
    entityId: "note-1",
    changeType: "updated",
    before: { id: "note-1", title: "メモ" },
    after: { id: "note-1", title: "メモ2" },
  }).event_kind, "note_updated");
  assert.equal(buildActivityEvent({
    entityType: "resource",
    entityId: "resource-1",
    changeType: "created",
    after: { id: "resource-1", title: "会話ログ" },
  }).event_kind, "resource_added");
  assert.equal(buildActivityEvent({
    entityType: "resource",
    entityId: "resource-1",
    changeType: "updated",
    before: { id: "resource-1", title: "会話ログ" },
    after: { id: "resource-1", title: "会話ログ2" },
  }).event_kind, "resource_updated");
  assert.equal(buildActivityEvent({
    entityType: "artifact",
    entityId: "artifact-1",
    after: { id: "artifact-1", title: "出力" },
  }).event_kind, "artifact_added");
  assert.equal(buildActivityEvent({
    entityType: "artifact",
    entityId: "artifact-1",
    before: { id: "artifact-1", title: "出力" },
    after: { id: "artifact-1", title: "出力2" },
  }).event_kind, "artifact_updated");
});

test("default Activity excludes Task create/title-only edit but keeps meaningful events", () => {
  const taskCreate = buildActivityEvent({
    id: "task-create",
    entityType: "task",
    entityId: "task-1",
    changeType: "created",
    occurredAt: "2026-08-08T01:00:00.000Z",
    after: { id: "task-1", title: "作成", state: "todo" },
  });
  const titleEdit = buildActivityEvent({
    id: "task-title",
    entityType: "task",
    entityId: "task-1",
    changeType: "updated",
    occurredAt: "2026-08-08T01:01:00.000Z",
    before: { id: "task-1", title: "作成", state: "todo" },
    after: { id: "task-1", title: "改題", state: "todo" },
  });
  const completed = buildActivityEvent({
    id: "task-complete",
    entityType: "task",
    entityId: "task-1",
    changeType: "completed",
    occurredAt: "2026-08-08T01:02:00.000Z",
    after: { id: "task-1", title: "改題", state: "done", completed_at: "2026-08-08T01:02:00.000Z" },
  });
  const noteEdit = buildActivityEvent({
    id: "note-edit",
    entityType: "note",
    entityId: "note-1",
    changeType: "updated",
    occurredAt: "2026-08-08T01:03:00.000Z",
    before: { id: "note-1", title: "メモ", body_markdown: "a" },
    after: { id: "note-1", title: "メモ", body_markdown: "b" },
  });
  const result = queryActivityEvents({
    events: [taskCreate, titleEdit, completed, noteEdit],
    workspace: {
      tasks: [{ id: "task-1", title: "改題", state: "done" }],
      notes: [{ id: "note-1", title: "メモ", body_markdown: "b" }],
    },
    date: "2026-08-08",
  });
  assert.deepEqual(result.events.map((event) => event.id), ["task-complete", "note-edit"]);
});

test("renderer autosave dedupe has a five-second session boundary", async () => {
  const persistence = await importBundled("src/renderer/src/features/workspace/domain-model/persistence.ts");
  const first = persistence.buildChangeEventOperation(
    "note",
    "note-session-test",
    "updated",
    { now: "2026-08-08T01:00:00.000Z" },
    { id: "note-session-test", body_markdown: "old" },
    { id: "note-session-test", body_markdown: "a" },
  ).entity;
  const rapid = persistence.buildChangeEventOperation(
    "note",
    "note-session-test",
    "updated",
    { now: "2026-08-08T01:00:04.000Z" },
    { id: "note-session-test", body_markdown: "a" },
    { id: "note-session-test", body_markdown: "b" },
  ).entity;
  const nextSession = persistence.buildChangeEventOperation(
    "note",
    "note-session-test",
    "updated",
    { now: "2026-08-08T01:00:10.000Z" },
    { id: "note-session-test", body_markdown: "b" },
    { id: "note-session-test", body_markdown: "c" },
  ).entity;
  assert.equal(first.metadata.dedupe_key, rapid.metadata.dedupe_key);
  assert.notEqual(first.metadata.dedupe_key, nextSession.metadata.dedupe_key);

  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-activity-dedupe-"));
  const repository = new WorkspaceDatabase(path.join(directory, "dedupe.sqlite"));
  repository.save("note", { id: "note-session-test", title: "session", body_markdown: "a" });
  repository.saveMany([
    { action: "save", type: "change_event", entity: first },
    { action: "save", type: "change_event", entity: rapid },
  ]);
  assert.equal(repository.list("change_event", true).length, 1);
  assert.equal(repository.get("change_event", first.id, true).after_json.body_markdown, "b");
  assert.equal(repository.get("change_event", first.id, true).before_json.body_markdown, "old");
  repository.save("change_event", nextSession);
  assert.equal(repository.list("change_event", true).length, 2);
  assert.equal(repository.get("change_event", nextSession.id, true).after_json.body_markdown, "c");
  repository.db.close();
  await rm(directory, { recursive: true, force: true });
});

test("canonical refs are root-relative, private absolute paths stay out, and policy is projection-time", () => {
  const event = buildActivityEvent({
    id: "event-canonical",
    entityType: "note",
    entityId: "note-local",
    changeType: "created",
    occurredAt: "2026-08-08T06:30:00.000Z",
    after: {
      id: "note-local",
      title: "local",
      ai_visibility: [],
      canonical_refs: [{ kind: "canonical_document", storage_root_id: "root-a", relative_path: "Notes/local.md" }],
      ai_source_refs: [{ kind: "canonical_document", storage_root_id: "root-a", locator: "Notes/local.md" }],
      source_refs: [{ type: "file", absolute_path: "C:\\Users\\private\\secret.md" }],
    },
  });
  const result = queryActivityEvents({
    events: [event],
    workspace: { notes: [{ id: "note-local", title: "local", ai_visibility: [] }] },
    audience: "m365",
    workspaceDefault: ["coding_agent"],
    roots: { "root-a": "C:\\Users\\private\\sync" },
  });
  assert.equal(result.events.length, 0);
  assert.equal(result.excluded_count, 1);

  const coding = queryActivityEvents({
    events: [event],
    workspace: { notes: [{ id: "note-local", title: "local", ai_visibility: ["coding_agent"] }] },
    audience: "coding_agent",
    roots: { "root-a": "C:\\Users\\private\\sync" },
  });
  assert.equal(coding.events.length, 1);
  assert.deepEqual(coding.events[0].canonical_refs[0], {
    kind: "canonical_document",
    storage_root_id: "root-a",
    relative_path: "Notes/local.md",
    status: "ok",
  });
  assert.equal(coding.events[0].source_refs.some((ref) => ref.absolute_path), false);
  assert.equal(JSON.stringify(coding).includes("C:\\\\Users\\\\private"), false);
});

test("canonical root identity survives root changes and public status never exposes paths", () => {
  const ref = { kind: "canonical_document", storage_root_id: "sync", relative_path: "Notes/measure.md" };
  const oldRegistry = buildActivityRootRegistry({ artifactDirectory: "C:/tasken-old" });
  const newRegistry = buildActivityRootRegistry({ artifactDirectory: "D:/tasken-new" });
  const oldResolved = queryActivityEvents({
    events: [buildActivityEvent({ id: "root-change-event", entityType: "note", entityId: "note-root", changeType: "created", after: { id: "note-root", title: "root" }, canonical_refs: [ref] })],
    workspace: { notes: [{ id: "note-root", title: "root" }] },
    roots: oldRegistry,
  });
  const newResolved = queryActivityEvents({
    events: [buildActivityEvent({ id: "root-change-event", entityType: "note", entityId: "note-root", changeType: "created", after: { id: "note-root", title: "root" }, canonical_refs: [ref] })],
    workspace: { notes: [{ id: "note-root", title: "root" }] },
    roots: newRegistry,
  });
  assert.equal(oldResolved.events[0].id, newResolved.events[0].id);
  assert.equal(oldResolved.events[0].canonical_refs[0].status, "ok");
  assert.equal(newResolved.events[0].canonical_refs[0].status, "ok");
  const publicStatus = publicActivityRootStatus(newRegistry, () => true);
  assert.deepEqual(publicStatus.sync, { status: "ok" });
  assert.equal(JSON.stringify(publicStatus).includes("tasken-new"), false);
  const broken = queryActivityEvents({
    events: [buildActivityEvent({ id: "root-change-event", entityType: "note", entityId: "note-root", changeType: "created", after: { id: "note-root", title: "root" }, canonical_refs: [ref] })],
    workspace: { notes: [{ id: "note-root", title: "root" }] },
    roots: { sync: { status: "broken" } },
  });
  assert.equal(broken.events[0].canonical_refs[0].status, "broken");
});

test("canonical web URL remains openable when local root is missing, while invalid local paths stay blocked", async () => {
  const webRef = {
    kind: "canonical_document",
    storage_root_id: "sync",
    relative_path: "Notes/missing.md",
    web_url: "https://example.com/canonical/missing",
  };
  const webProjection = queryActivityEvents({
    events: [buildActivityEvent({ id: "web-fallback-event", entityType: "note", entityId: "note-web", changeType: "created", after: { id: "note-web", title: "web", canonical_refs: [webRef] } })],
    workspace: { notes: [{ id: "note-web", title: "web" }] },
    roots: { sync: { status: "broken" } },
  });
  assert.deepEqual(webProjection.events[0].canonical_refs[0], { ...webRef, status: "ok", local_status: "broken" });
  assert.equal(resolveActivityCanonicalLocalPath(webRef, {}).status, "missing");

  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-activity-boundary-"));
  const root = path.join(directory, "root");
  const outside = path.join(directory, "outside");
  await mkdir(root);
  await mkdir(outside);
  const outsideFile = path.join(outside, "secret.md");
  await writeFile(outsideFile, "private");
  const traversal = resolveActivityCanonicalLocalPath({ ...webRef, web_url: "", relative_path: "../outside/secret.md" }, { sync: root });
  assert.equal(traversal.status, "missing");
  const link = path.join(root, "link");
  try {
    await symlink(outside, link, "junction");
    const symlinkEscape = resolveActivityCanonicalLocalPath({ ...webRef, web_url: "", relative_path: "link/secret.md" }, { sync: root });
    assert.equal(symlinkEscape.status, "outside_root");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workspace root resolver follows artifactDirectory changes without rewriting stored events", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-activity-root-"));
  const firstRoot = path.join(directory, "first");
  const secondRoot = path.join(directory, "second");
  await mkdir(firstRoot);
  await mkdir(secondRoot);
  const repository = new WorkspaceDatabase(path.join(directory, "roots.sqlite"));
  repository.setPreference("artifactDirectory", firstRoot);
  const event = buildActivityEvent({
    id: "root-resolver-event",
    entityType: "note",
    entityId: "note-root-resolver",
    changeType: "created",
    after: {
      id: "note-root-resolver",
      title: "root resolver",
      canonical_refs: [{ kind: "canonical_document", storage_root_id: "sync", relative_path: "Notes/root.md" }],
    },
  });
  repository.save("change_event", event);
  const storedBefore = repository.get("change_event", event.id, true);
  assert.equal(repository.getActivityCanonicalRootStatus().sync.status, "ok");
  repository.setPreference("artifactDirectory", secondRoot);
  assert.equal(repository.getActivityCanonicalRootStatus().sync.status, "ok");
  assert.deepEqual(repository.get("change_event", event.id, true), storedBefore);
  repository.db.close();
  await rm(directory, { recursive: true, force: true });
});

test("Today Activity opens current entities and keeps deleted history as history-only", async () => {
  const source = await readFile("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
  assert.match(source, /ThemePickerSelect/);
  assert.match(source, /const entityOpenable = Boolean\(entity\)/);
  assert.match(source, /openDrawer\(\{ type: ref\.type/);
  assert.match(source, /現在のEntityがないため、履歴のみ表示しています/);
  assert.doesNotMatch(source, /\{ id: ref\.id, title \}/);
});

test("JSON and Markdown Activity projections share the same event query and timezone", () => {
  const event = buildActivityEvent({
    id: "event-jst",
    entityType: "resource",
    entityId: "resource-jst",
    changeType: "created",
    occurredAt: "2026-08-07T15:30:00.000Z",
    after: { id: "resource-jst", title: "JST resource" },
  });
  const result = queryActivityEvents({
    events: [event],
    workspace: { resources: [{ id: "resource-jst", title: "JST resource" }] },
    date: "2026-08-08",
    timezone: "invalid/timezone",
  });
  const json = projectActivityJson(result);
  const markdown = projectActivityMarkdown(result);
  assert.equal(json.timezone, "Asia/Tokyo");
  assert.equal(json.events[0].local_date, "2026-08-08");
  assert.match(markdown, /2026-08-08/);
  assert.match(markdown, /resource_added/);
  assert.match(markdown, /resource-jst/);
});

test("schema v3 migrates a real legacy row idempotently without parsing plain after entity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-activity-migration-"));
  const file = path.join(directory, "legacy.sqlite");
  const stamp = "2026-08-08T00:00:00.000Z";
  const legacyAfter = { id: "task-legacy", title: "legacy", state: "todo" };
  const db = new Database(file);
  db.exec(
    "CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
    "INSERT INTO workspace_meta(key, value) VALUES ('schema_version', '2');" +
    "CREATE TABLE entities (" +
    "entity_type TEXT NOT NULL, id TEXT NOT NULL, data_json TEXT NOT NULL," +
    "created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT," +
    "device_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual'," +
    "version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (entity_type, id));" +
    "CREATE TABLE sync_entity_heads (entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, revision_id TEXT NOT NULL, PRIMARY KEY (entity_type, entity_id));" +
    "CREATE TABLE sync_outbox (change_id TEXT PRIMARY KEY, device_sequence INTEGER NOT NULL UNIQUE, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT);" +
    "CREATE TABLE sync_device_cursors (device_id TEXT PRIMARY KEY, last_sequence INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);" +
    "CREATE TABLE sync_conflicts (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, local_revision_id TEXT NOT NULL, incoming_revision_id TEXT NOT NULL, packet_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(entity_type, entity_id));",
  );
  const insert = db.prepare(
    "INSERT INTO entities(entity_type, id, data_json, created_at, updated_at, deleted_at, device_id, source, version) " +
    "VALUES (?, ?, ?, ?, ?, NULL, 'device-1', 'manual', 1)",
  );
  insert.run("task", "task-legacy", JSON.stringify({ title: "legacy", state: "todo" }), stamp, stamp);
  insert.run("change_event", "legacy-event", JSON.stringify({
    entity_type: "task",
    entity_id: "task-legacy",
    changed_at: stamp,
    change_type: "updated",
    source: "manual",
    before_json: null,
    after_json: JSON.stringify(legacyAfter),
  }), stamp, stamp);
  db.close();

  const first = new WorkspaceDatabase(file);
  const migrated = first.get("change_event", "legacy-event", true);
  assert.equal(first.getMeta().schemaVersion, 4);
  assert.equal(migrated.event_kind, "task_created");
  assert.deepEqual(migrated.entity_ref, { type: "task", id: "task-legacy" });
  assert.equal(migrated.metadata.migrated_from, "legacy_change_event");
  assert.equal(migrated.after_json, JSON.stringify(legacyAfter));
  first.db.close();

  const second = new WorkspaceDatabase(file);
  assert.deepEqual(second.get("change_event", "legacy-event", true), migrated);
  second.db.close();
  await rm(directory, { recursive: true, force: true });
});
