import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { createSnapshot } from "../src/main/services/snapshotService.mjs";
import { validateEntity } from "../src/main/repositories/domain.mjs";
import { WorkspaceDatabase, workspaceEntityTypes } from "../src/main/repositories/workspaceRepository.mjs";

const taskContextCoreBundle = await build({
  stdin: {
    contents: 'export { createTaskenCore } from "./src/main/infrastructure/sqlite/public.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { createTaskenCore } = await import(
  `data:text/javascript;base64,${Buffer.from(taskContextCoreBundle.outputFiles[0].text).toString("base64")}`
);

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

test("Core Task context reads an empty SQLite snapshot without creating the default Theme", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-core-empty-workspace-"));
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  try {
    assert.equal(database.list("theme", true).length, 0);
    const result = createTaskenCore(database).getTaskContext.execute({ task_id: "missing" });
    assert.equal(result.error.code, "not_found");
    assert.equal(database.list("theme", true).length, 0);

    const workspace = database.loadWorkspace();
    assert.equal(database.list("theme", true).length, 1);
    assert.equal(workspace.themes.length, 1);
  } finally {
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

function fakeGraphRepository(records = {}) {
  const repo = Object.create(WorkspaceDatabase.prototype);
  repo.list = (type) => records[type] || [];
  return repo;
}

function fakePreferenceRepository() {
  const meta = new Map();
  const repo = Object.create(WorkspaceDatabase.prototype);
  repo.ensureMeta = (key, fallback) => {
    if (!meta.has(key)) meta.set(key, fallback);
    return meta.get(key);
  };
  repo.db = {
    prepare: (sql) => ({
      run: (value) => {
        const match = sql.match(/VALUES\('([^']+)', \?\)/);
        if (match) meta.set(match[1], value);
      },
    }),
  };
  return repo;
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

test("activity log export directory preference round-trips", () => {
  const repo = fakePreferenceRepository();
  const exportDir = "C:\\Users\\ootan\\Documents\\Tasken";

  assert.equal(repo.setPreference("activityLogDirectory", exportDir), exportDir);
  assert.equal(repo.getPreference("activityLogDirectory"), exportDir);
  assert.equal(repo.setPreference("activityLogDirectory", ""), "");
  assert.equal(repo.getPreference("activityLogDirectory"), "");
  assert.equal(repo.setPreference("activityLogAutoExportTime", "17:30"), "17:30");
  assert.equal(repo.getPreference("activityLogAutoExportTime"), "17:30");
  assert.equal(repo.setPreference("activityLogAutoExportTime", "25:00"), "");
  assert.equal(repo.setPreference("activityLogLastAutoExportDate", "2026-07-28"), "2026-07-28");
  assert.equal(repo.getPreference("activityLogLastAutoExportDate"), "2026-07-28");
  assert.equal(repo.setPreference("activityLogLastAutoExportDate", "28/07/2026"), "");
});

test("Tasken Root and automatic Snapshot preferences round-trip with bounded values", () => {
  const repo = fakePreferenceRepository();
  const shortcut = "CommandOrControl+Alt+Space";
  const usedAt = "2026-08-13T01:02:03.000Z";

  assert.equal(repo.getPreference("taskenRoot.globalShortcut"), "");
  assert.equal(repo.setPreference("taskenRoot.globalShortcut", shortcut), shortcut);
  assert.equal(repo.getPreference("taskenRoot.globalShortcut"), shortcut);
  assert.deepEqual(repo.setPreference("taskenRoot.usage.v1", {
    "task:one": { count: 4.8, lastUsedAt: usedAt },
    invalid: { count: -1, lastUsedAt: "not-a-date" },
  }), { "task:one": { count: 4, lastUsedAt: usedAt } });
  assert.deepEqual(repo.getPreference("taskenRoot.usage.v1"), { "task:one": { count: 4, lastUsedAt: usedAt } });

  assert.equal(repo.getPreference("automaticSnapshotBackupEnabled"), true);
  assert.equal(repo.setPreference("automaticSnapshotBackupEnabled", false), false);
  assert.equal(repo.getPreference("automaticSnapshotBackupEnabled"), false);
  assert.equal(repo.setPreference("automaticSnapshotBackupDirectory", " C:\\Tasken Backups "), "C:\\Tasken Backups");
  assert.equal(repo.getPreference("automaticSnapshotBackupDirectory"), "C:\\Tasken Backups");
  assert.equal(repo.setPreference("automaticSnapshotBackupGenerations", 99), 20);
  assert.equal(repo.getPreference("automaticSnapshotBackupGenerations"), 20);
  assert.equal(repo.setPreference("automaticSnapshotBackupGenerations", 0), 1);
});

test("link URL validation allows web and mailto but rejects file", () => {
  // Notes はタイトルだけで下書き作成でき、本文は中央エリアで後から書く。
  assert.doesNotThrow(() => validateEntity("note", { id: "note-draft", title: "下書き", body_markdown: "" }));
  assert.doesNotThrow(() => validateEntity("note", { id: "note-title-only", title: "タイトルだけ" }));
  assert.throws(() => validateEntity("note", { id: "note-no-title", title: "", body_markdown: "本文" }), /note\.title/);

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
  for (const type of ["project", "capture_entry", "task", "waiting", "plan_node", "schedule", "reference", "task_dependency", "plan_dependency", "knowledge_edge", "change_event", "sketch"]) {
    assert.equal(workspaceEntityTypes.includes(type), true);
  }

  const zip = createSnapshot({
    projects: [{ id: "project-1", name: "Project", state: "active" }],
    tasks: [{ id: "task-1", title: "Task", state: "todo", priority: "normal" }],
    schedules: [{ id: "schedule-1", owner_type: "task", owner_id: "task-1", date_kind: "deadline", confidence: "fixed", granularity: "day", end_date: "2026-06-19" }],
    knowledge_edges: [{ id: "edge-1", source_node_id: "node-1", target_node_id: "node-2", relation_type: "supports" }],
    change_events: [{ id: "change-1", entity_type: "task", entity_id: "task-1", changed_at: "2026-06-19T00:00:00.000Z", change_type: "created", source: "manual" }],
    sketches: [{
      id: "sketch-1",
      title: "Reaction map",
      document: {
        schema_version: 1,
        pages: [{ id: "page-1", width: 1200, height: 840, background: "dot", objects: [] }],
      },
    }],
    meta: {},
  });

  assert.ok(zip.getEntry("projects.json"));
  assert.ok(zip.getEntry("tasks.json"));
  assert.ok(zip.getEntry("schedules.json"));
  assert.ok(zip.getEntry("knowledge_edges.json"));
  assert.ok(zip.getEntry("change_events.json"));
  assert.ok(zip.getEntry("sketches.json"));
});

test("domain entity validation rejects invalid enum values", () => {
  assert.doesNotThrow(() => validateEntity("project", { id: "project-1", name: "Project", state: "active" }));
  assert.throws(() => validateEntity("task", { id: "task-1", title: "Task", state: "blocked" }), /task.state/);
  assert.throws(() => validateEntity("schedule", { id: "schedule-1", owner_type: "task", owner_id: "task-1", date_kind: "range", confidence: "fixed", granularity: "day", start_date: "2026-06-20", end_date: "2026-06-19" }), /schedule.end_date/);
  assert.throws(() => validateEntity("reference", { id: "ref-1", source_type: "task", source_id: "task-1", target_type: "task", target_id: "task-1", relation_type: "related_to" }), /自分自身/);
  assert.throws(() => validateEntity("knowledge_edge", { id: "edge-1", source_node_id: "node-1", target_node_id: "node-1", relation_type: "supports" }), /自分自身/);
});

test("sketch validation preserves editable page objects and rejects broken documents", () => {
  const valid = {
    id: "sketch-1",
    title: "Flow draft",
    document: {
      schema_version: 1,
      pages: [{
        id: "page-1",
        width: 1200,
        height: 840,
        background: "grid",
        objects: [{
          id: "stroke-1",
          type: "stroke",
          points: [{ x: 20, y: 30, pressure: 0.5 }, { x: 80, y: 90, pressure: 0.8 }],
          color: "#20232a",
          width: 2,
        }],
      }],
    },
  };
  assert.doesNotThrow(() => validateEntity("sketch", valid));
  assert.doesNotThrow(() => validateEntity("sketch", {
    ...valid,
    document: {
      ...valid.document,
      mode: "infinite",
      viewport: { x: -420, y: 180, zoom: 0.82 },
    },
  }));
  assert.throws(() => validateEntity("sketch", {
    ...valid,
    document: {
      ...valid.document,
      mode: "infinite",
      viewport: { x: 0, y: 0, zoom: 0 },
    },
  }), /viewport/);
  assert.throws(() => validateEntity("sketch", { ...valid, document: { schema_version: 2, pages: valid.document.pages } }), /schema_version/);
  assert.throws(() => validateEntity("sketch", { ...valid, document: { schema_version: 1, pages: [] } }), /1件以上/);
  assert.throws(() => validateEntity("sketch", {
    ...valid,
    document: {
      schema_version: 1,
      pages: [{ ...valid.document.pages[0], width: 0 }],
    },
  }), /ページ幅・高さ/);
});

test("saved sketches reload under the canonical sketches collection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-sketch-test-"));
  const repo = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  try {
    repo.save("sketch", {
      id: "sketch-reload",
      title: "Reload me",
      document: {
        schema_version: 1,
        pages: [{
          id: "page-1",
          width: 1200,
          height: 840,
          background: "dot",
          objects: [{ id: "text-1", type: "text", x: 40, y: 60, text: "editable" }],
        }],
      },
    });
    const workspace = repo.loadWorkspace();
    assert.equal(workspace.sketches.length, 1);
    assert.equal(workspace.sketches[0].document.pages[0].objects[0].text, "editable");
    assert.equal(workspace.sketchs, undefined);
  } finally {
    repo.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("new Reference writes canonical assertions and endpoint deletion keeps lineage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-reference-assertion-test-"));
  const repo = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  try {
    repo.save("note", { id: "note-lineage", title: "Lineage" });
    repo.save("task", { id: "task-lineage", title: "Implement", state: "todo" });
    const saved = repo.save("reference", {
      id: "assertion-lineage",
      subject: { type: "note", id: "note-lineage" },
      predicate: "links_to",
      object: { type: "task", id: "task-lineage" },
      layer: "operational",
      status: "asserted",
      origin: "user",
      metadata: { raw_alias: "Implement", source_span: { start: 4, end: 13 } },
    });
    assert.equal(saved.assertion_id, "assertion-lineage");
    assert.deepEqual(saved.subject, { type: "note", id: "note-lineage" });
    assert.deepEqual(saved.object, { type: "task", id: "task-lineage" });
    assert.equal(saved.source_type, "note");
    assert.equal(saved.relation_type, "links_to");

    repo.insertImported("reference", {
      id: "legacy-lineage",
      source_type: "note",
      source_id: "note-lineage",
      target_type: "task",
      target_id: "task-lineage",
      relation_type: "derived_from",
    }, "legacy");
    const legacyRead = repo.get("reference", "legacy-lineage");
    assert.deepEqual(legacyRead.subject, { type: "note", id: "note-lineage" });
    assert.equal(legacyRead.assertion_id, "legacy-lineage");
    assert.equal(legacyRead.legacy_read, true);

    repo.remove("task", "task-lineage");
    assert.equal(repo.get("reference", "assertion-lineage")?.status, "asserted");
  } finally {
    repo.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ink capture atomically creates its sketch before linking the capture", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-ink-capture-test-"));
  const repo = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  try {
    repo.saveMany([
      {
        action: "save",
        type: "sketch",
        entity: {
          id: "sketch-ink",
          title: "Ink Capture",
          origin_capture_id: "capture-ink",
          document: {
            schema_version: 1,
            pages: [{ id: "page-1", width: 1200, height: 840, background: "dot", objects: [] }],
          },
        },
      },
      {
        action: "save",
        type: "capture_entry",
        entity: {
          id: "capture-ink",
          text: "手書きで記録",
          captured_at: "2026-08-02T00:00:00.000Z",
          state: "triaged",
          triaged_to_type: "sketch",
          triaged_to_id: "sketch-ink",
        },
      },
    ]);
    assert.equal(repo.get("capture_entry", "capture-ink").triaged_to_id, "sketch-ink");
    assert.equal(repo.get("sketch", "sketch-ink").origin_capture_id, "capture-ink");
  } finally {
    repo.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("file capture keeps its Artifact valid while it is retargeted to a Note", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-file-capture-test-"));
  const repo = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  try {
    repo.saveMany([
      {
        action: "save",
        type: "capture_entry",
        entity: {
          id: "capture-file",
          title: "chart.png",
          text: "chart.png",
          kind: "file_capture",
          content_type: "image",
          captured_at: "2026-08-02T00:00:00.000Z",
          state: "untriaged",
        },
      },
      {
        action: "save",
        type: "artifact",
        entity: {
          id: "artifact-file",
          title: "chart",
          filename: "chart.png",
          stored_path: "",
          storage_mode: "linked",
          link_type: "local_path",
          target: "C:/data/chart.png",
          link_status: "unknown",
          source_type: "capture_entry",
          source_id: "capture-file",
        },
      },
    ]);

    repo.saveMany([
      {
        action: "save",
        type: "note",
        entity: {
          id: "note-from-capture",
          title: "Chart note",
          body_markdown: "chart.png",
          content_format: "markdown",
        },
      },
      {
        action: "save",
        type: "artifact",
        entity: {
          ...repo.get("artifact", "artifact-file"),
          source_type: "note",
          source_id: "note-from-capture",
        },
      },
      {
        action: "save",
        type: "capture_entry",
        entity: {
          ...repo.get("capture_entry", "capture-file"),
          state: "triaged",
          triaged_to_type: "note",
          triaged_to_id: "note-from-capture",
        },
      },
    ]);

    assert.equal(repo.get("artifact", "artifact-file").source_type, "note");
    assert.equal(repo.get("artifact", "artifact-file").source_id, "note-from-capture");
    assert.equal(repo.get("capture_entry", "capture-file").triaged_to_id, "note-from-capture");
  } finally {
    repo.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("directional knowledge edges reject cycles but weak relations do not", () => {
  const repo = fakeGraphRepository({
    knowledge_edge: [
      { id: "ab", source_node_id: "a", target_node_id: "b", relation_type: "depends_on" },
      { id: "bc", source_node_id: "b", target_node_id: "c", relation_type: "causes" },
    ],
  });
  assert.throws(
    () => repo.validateGraph("knowledge_edge", { id: "ca", source_node_id: "c", target_node_id: "a", relation_type: "leads_to" }),
    /KnowledgeEdgeが循環/,
  );
  assert.doesNotThrow(
    () => repo.validateGraph("knowledge_edge", { id: "weak", source_node_id: "c", target_node_id: "a", relation_type: "supports" }),
  );
});

test("snapshot validation rejects directional knowledge edge cycles", () => {
  const repo = fakeGraphRepository();
  assert.throws(
    () => repo.validateSnapshotWorkspace({
      knowledge_nodes: [
        { id: "a", node_type: "claim", title: "A" },
        { id: "b", node_type: "claim", title: "B" },
      ],
      knowledge_edges: [
        { id: "ab", source_node_id: "a", target_node_id: "b", relation_type: "depends_on" },
        { id: "ba", source_node_id: "b", target_node_id: "a", relation_type: "depends_on" },
      ],
    }),
    /Snapshot内のKnowledgeEdgeが循環/,
  );
  assert.doesNotThrow(() => repo.validateSnapshotWorkspace({
    knowledge_nodes: [
      { id: "a", node_type: "claim", title: "A" },
      { id: "b", node_type: "claim", title: "B" },
    ],
    knowledge_edges: [
      { id: "ab", source_node_id: "a", target_node_id: "b", relation_type: "supports" },
      { id: "ba", source_node_id: "b", target_node_id: "a", relation_type: "similar_to" },
    ],
  }));
});

test("snapshot validation follows Registry Theme fields and keeps Schedule owner-scoped", () => {
  const repo = fakeGraphRepository();
  assert.throws(
    () => repo.validateSnapshotWorkspace({
      notes: [{ id: "note-project-ref", title: "Canonical Note", project_id: "missing-project" }],
    }),
    /note\.project_idがSnapshot内に存在しないprojectを参照しています/,
  );

  assert.doesNotThrow(() => repo.validateSnapshotWorkspace({
    projects: [{ id: "project-1", name: "Project", state: "active" }],
    tasks: [{ id: "task-1", title: "Task", state: "todo", project_id: "project-1" }],
    schedules: [{
      id: "schedule-owner-scoped",
      owner_type: "task",
      owner_id: "task-1",
      date_kind: "deadline",
      confidence: "fixed",
      granularity: "day",
      end_date: "2026-08-08",
    }],
  }));
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
