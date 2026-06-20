import assert from "node:assert/strict";
import test from "node:test";

import { createSnapshot } from "../src/main/services/snapshotService.mjs";
import { validateEntity } from "../src/main/repositories/domain.mjs";
import { WorkspaceDatabase, workspaceEntityTypes } from "../src/main/repositories/workspaceRepository.mjs";

function item(overrides = {}) {
  return {
    id: "item-1",
    title: "Local item",
    kind: "task",
    level: "task",
    status: "todo",
    progress: 0,
    ...overrides,
  };
}

function fakeRepository(preview) {
  const inserted = [];
  const repo = Object.create(WorkspaceDatabase.prototype);
  repo.db = { transaction: (fn) => () => fn() };
  repo.validateSnapshotWorkspace = () => {};
  repo.previewSnapshot = () => preview;
  repo.insertImported = (type, entity) => inserted.push({ type, entity });
  repo.insertPlanRevision = () => {};
  repo.loadWorkspace = () => ({ items: inserted.filter((entry) => entry.type === "item").map((entry) => entry.entity) });
  return { repo, inserted };
}

test("workspace entity types and snapshots exclude person records", () => {
  assert.equal(workspaceEntityTypes.includes("person"), false);
  assert.equal(workspaceEntityTypes.includes("item"), true);

  const zip = createSnapshot({
    items: [item()],
    people: [{ id: "p1", name: "Legacy person" }],
    meta: {},
  });
  assert.equal(zip.getEntry("people.json"), null);
  assert.ok(zip.getEntry("items.json"));
});

test("link URL validation allows web and mailto but rejects file", () => {
  assert.doesNotThrow(() => validateEntity("link", { id: "https", title: "Web", url: "https://example.com", link_type: "other" }));
  assert.doesNotThrow(() => validateEntity("link", { id: "http", title: "Web", url: "http://example.com", link_type: "other" }));
  assert.doesNotThrow(() => validateEntity("link", { id: "mail", title: "Mail", url: "mailto:test@example.com", link_type: "other" }));
  assert.throws(() => validateEntity("link", { id: "file", title: "File", url: "file:///C:/tmp/a.txt", link_type: "other" }), /https、http、mailto/);
});

test("knowledge entity validation rejects invalid enums", () => {
  assert.doesNotThrow(() => validateEntity("knowledge_node", { id: "kn-1", node_type: "claim", title: "Claim" }));
  assert.throws(() => validateEntity("knowledge_node", { id: "kn-2", node_type: "unknown", title: "Bad" }), /node_type/);
  assert.doesNotThrow(() => validateEntity("knowledge_edge", { id: "ke-1", source_node_id: "a", target_node_id: "b", relation_type: "supports" }));
  assert.throws(() => validateEntity("knowledge_edge", { id: "ke-invalid", source_node_id: "a", target_node_id: "b", relation_type: "unknown" }), /relation_type/);
  assert.throws(() => validateEntity("knowledge_edge", { id: "ke-2", source_node_id: "a", target_node_id: "a", relation_type: "supports" }), /自分自身/);
});

test("workspace entity types and snapshots include v2 domain records", () => {
  for (const type of ["project", "capture_entry", "task", "waiting", "plan_node", "schedule", "reference", "task_dependency", "plan_dependency", "knowledge_edge", "change_event"]) {
    assert.equal(workspaceEntityTypes.includes(type), true);
  }

  const zip = createSnapshot({
    projects: [{ id: "project-1", name: "Project", state: "active" }],
    tasks: [{ id: "task-1", title: "Task", state: "todo", priority: "normal" }],
    schedules: [{ id: "schedule-1", owner_type: "task", owner_id: "task-1", date_kind: "deadline", confidence: "fixed", granularity: "day", end_date: "2026-06-19" }],
    knowledge_edges: [{ id: "edge-1", source_node_id: "node-1", target_node_id: "node-2", relation_type: "supports" }],
    change_events: [{ id: "change-1", entity_type: "task", entity_id: "task-1", changed_at: "2026-06-19T00:00:00.000Z", change_type: "created", source: "manual" }],
    meta: {},
  });

  assert.ok(zip.getEntry("projects.json"));
  assert.ok(zip.getEntry("tasks.json"));
  assert.ok(zip.getEntry("schedules.json"));
  assert.ok(zip.getEntry("knowledge_edges.json"));
  assert.ok(zip.getEntry("change_events.json"));
});

test("v2 entity validation rejects invalid enum values", () => {
  assert.doesNotThrow(() => validateEntity("project", { id: "project-1", name: "Project", state: "active" }));
  assert.throws(() => validateEntity("task", { id: "task-1", title: "Task", state: "blocked" }), /task.state/);
  assert.throws(() => validateEntity("schedule", { id: "schedule-1", owner_type: "task", owner_id: "task-1", date_kind: "range", confidence: "fixed", granularity: "day", start_date: "2026-06-20", end_date: "2026-06-19" }), /schedule.end_date/);
  assert.throws(() => validateEntity("reference", { id: "ref-1", source_type: "task", source_id: "task-1", target_type: "task", target_id: "task-1", relation_type: "related_to" }), /自分自身/);
  assert.throws(() => validateEntity("knowledge_edge", { id: "edge-1", source_node_id: "node-1", target_node_id: "node-1", relation_type: "supports" }), /自分自身/);
});


test("snapshot create never overwrites an existing local record", () => {
  const change = {
    key: "item:item-1",
    type: "item",
    incoming: item({ title: "Snapshot item", version: 2 }),
    local: item(),
    category: "update",
    action: "update",
    actions: ["update", "duplicate", "ignore"],
  };
  assert.deepEqual(change.actions, ["update", "duplicate", "ignore"]);
  assert.throws(() => fakeRepository([change]).repo.applySnapshot({}, { "item:item-1": "create" }), /createでは上書きできません/);

  const { repo, inserted } = fakeRepository([change]);
  repo.applySnapshot({}, { "item:item-1": "update" });
  assert.equal(inserted[0].entity.title, "Snapshot item");
});

test("snapshot duplicate creates a separate id and update requires local record", () => {
  const existingChange = {
    key: "item:item-1",
    type: "item",
    incoming: item({ title: "Snapshot duplicate", version: 2 }),
    local: item(),
    category: "update",
    action: "update",
    actions: ["update", "duplicate", "ignore"],
  };
  const { repo, inserted } = fakeRepository([existingChange]);
  repo.applySnapshot({}, { "item:item-1": "duplicate" });
  assert.equal(inserted[0].type, "item");
  assert.notEqual(inserted[0].entity.id, "item-1");
  assert.equal(inserted[0].entity.version, 1);

  const newChange = {
    key: "item:new-item",
    type: "item",
    incoming: item({ id: "new-item", title: "New item" }),
    local: null,
    category: "new",
    action: "create",
    actions: ["create", "ignore"],
  };
  assert.deepEqual(newChange.actions, ["create", "ignore"]);
  assert.throws(() => fakeRepository([newChange]).repo.applySnapshot({}, { "item:new-item": "update" }), /updateは実行できません/);
});
