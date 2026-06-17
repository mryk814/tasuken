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
