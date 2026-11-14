import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { formatRecordCountsMarkdown } from "../src/main/services/recordCounts.mjs";
import { createSnapshot, readSnapshot } from "../src/main/services/snapshotService.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";
import { validateEntity } from "../src/main/repositories/domain.mjs";
import {
  WorkspaceDatabase,
  workspaceEntityTypes,
} from "../src/main/repositories/workspaceRepository.mjs";
import { TASKEN_MOBILE_SCOPES } from "../src/shared/contracts/mobile/public.mjs";
import { runRetiredOutputCleanupOnce } from "../src/main/services/retiredOutputCleanup.mjs";
import {
  fixture as retiredOutputFixture,
  writeAiPack,
  writeDailyContext,
  writeThemeFolder,
} from "./helpers/retired-output-fixture.mjs";

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

test("board order persists through SQLite restart, snapshot import/export, delete/restore and shared-folder sync", async () => {
  const task = (extra = {}) => ({
    id: "board-task",
    title: "Ordered task",
    state: "todo",
    priority: "normal",
    ...extra,
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-board-order-"));
  const filename = path.join(root, "first.sqlite");
  let first = new WorkspaceDatabase(filename);
  const second = new WorkspaceDatabase(path.join(root, "second.sqlite"));
  const imported = new WorkspaceDatabase(path.join(root, "imported.sqlite"));
  try {
    first.save("task", task({ board_order: 3 }));
    first.save("task", task({ id: "old-task" }));
    first.db.close();
    first = new WorkspaceDatabase(filename);
    assert.equal(first.get("task", "board-task").board_order, 3);
    assert.equal(first.get("task", "old-task").board_order, undefined);
    const snapshotPath = path.join(root, "snapshot.zip");
    createSnapshot(first.loadWorkspace()).writeZip(snapshotPath);
    const { workspace } = readSnapshot(snapshotPath);
    imported.previewSnapshot(workspace);
    imported.applySnapshot(workspace);
    assert.equal(imported.get("task", "board-task").board_order, 3);
    imported.remove("task", "board-task");
    imported.restore("task", "board-task");
    assert.equal(imported.get("task", "board-task").board_order, 3);

    const firstSync = new SharedFolderSyncService(first, () => {}, path.join(root, "a-images"));
    const secondSync = new SharedFolderSyncService(second, () => {}, path.join(root, "b-images"));
    const shared = path.join(root, "shared");
    await firstSync.configure(shared);
    await secondSync.configure(shared);
    assert.equal(second.get("task", "board-task").board_order, 3);
    second.save("task", { ...second.get("task", "board-task"), board_order: 0, state: "doing" });
    await secondSync.syncNow();
    await firstSync.syncNow();
    assert.equal(first.get("task", "board-task").board_order, 0);
    assert.equal(first.get("task", "board-task").state, "doing");
  } finally {
    for (const database of [first, second, imported]) if (database.db.open) database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WorkingCopy and AgentSession survive canonical SQLite save and reload", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-agent-session-"));
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  const session = {
    id: "session-1",
    started_at: "2026-08-25T08:00:00.000Z",
    status: "active",
    client_kind: "codex",
    source_session_id: "codex-thread-1",
    intent: { summary: "Issue #498のsession provenanceを接続する" },
  };
  try {
    database.save("repository_context", {
      id: "repo-1",
      label: "tasuken",
      provider: "github",
      canonical_url: "https://github.com/mryk814/tasuken",
    });
    const workingCopy = database.save("working_copy", {
      id: "wc-1",
      repository_context_id: "repo-1",
      device_id: "device-home",
      storage_root_id: "root-tasuken",
      absolute_path: "C:\\private\\tasuken",
    });
    database.save("agent_session", session);
    for (const [id, targetType, targetId, relationType] of [
      ["ref-session-repo", "repository_context", "repo-1", "worked_on"],
      ["ref-session-working-copy", "working_copy", workingCopy.id, "executed_in"],
    ]) {
      database.save("reference", {
        id,
        source_type: "agent_session",
        source_id: session.id,
        target_type: targetType,
        target_id: targetId,
        relation_type: relationType,
        layer: "provenance",
        origin: "system_action",
      });
    }

    assert.equal(database.get("working_copy", "wc-1").storage_root_id, "root-tasuken");
    assert.equal("absolute_path" in database.get("working_copy", "wc-1"), false);
    assert.equal(database.get("agent_session", "session-1").intent.summary, session.intent.summary);
    assert.equal(
      database.list("reference").filter((entry) => entry.source_id === session.id).length,
      2,
    );

    database.remove("repository_context", "repo-1");
    assert.equal(database.get("working_copy", "wc-1"), null);
    database.restore("repository_context", "repo-1");
    assert.equal(database.get("working_copy", "wc-1").repository_context_id, "repo-1");
  } finally {
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mobile persistence accepts every scope granted by the pairing registry", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-mobile-scope-workspace-"));
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  const scopes = Object.values(TASKEN_MOBILE_SCOPES);
  try {
    const device = database.pairMobileDevice({
      id: "device-all-current-scopes",
      label: "Current mobile scope fixture",
      tokenHash: "c".repeat(64),
      scopes,
      pairedAt: "2026-08-30T04:00:00.000Z",
    });

    assert.deepEqual(device.scopes, scopes);
  } finally {
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("revoked mobile devices can pair again without clearing Android data", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-mobile-repair-workspace-"));
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  const firstTokenHash = "a".repeat(64);
  const secondTokenHash = "b".repeat(64);
  const firstPairingAt = "2026-08-21T04:00:00.000Z";
  const secondPairingAt = "2026-08-22T04:00:00.000Z";
  try {
    const first = database.pairMobileDevice({
      id: "device-s23",
      label: "Galaxy S23",
      tokenHash: firstTokenHash,
      scopes: ["mobile:read", "mobile:task-write", "mobile:proposal-review"],
      pairedAt: firstPairingAt,
    });
    assert.equal(first.version, 1);
    assert.throws(
      () =>
        database.pairMobileDevice({
          id: "device-s23",
          label: "Galaxy S23",
          tokenHash: secondTokenHash,
          scopes: ["mobile:read", "mobile:task-write", "mobile:proposal-review"],
          pairedAt: secondPairingAt,
        }),
      /Mobile device already exists/,
    );

    const revoked = database.revokeMobileDevice("device-s23", secondPairingAt);
    assert.equal(revoked.revokedAt, secondPairingAt);
    const repaired = database.pairMobileDevice({
      id: "device-s23",
      label: "Galaxy S23 re-paired",
      tokenHash: secondTokenHash,
      scopes: ["mobile:read", "mobile:task-write", "mobile:proposal-review"],
      pairedAt: secondPairingAt,
    });

    assert.equal(repaired.createdAt, firstPairingAt);
    assert.equal(repaired.updatedAt, secondPairingAt);
    assert.equal(repaired.revokedAt, "");
    assert.equal(repaired.label, "Galaxy S23 re-paired");
    assert.equal(repaired.version, 3);
    assert.equal(database.findMobileDeviceByTokenHash(firstTokenHash), null);
    assert.equal(database.findMobileDeviceByTokenHash(secondTokenHash)?.id, "device-s23");
  } finally {
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
  repo.loadWorkspace = () => ({
    items: inserted.filter((entry) => entry.type === "item").map((entry) => entry.entity),
  });
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
      run: (value, boundValue) => {
        const match = sql.match(/VALUES\('([^']+)', \?\)/);
        if (match) meta.set(match[1], value);
        else if (/VALUES\(\?, \?\)/.test(sql)) meta.set(value, boundValue);
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

test("snapshot round-trips feed manual-paste replies with question, source, and comment", () => {
  // 外部AIクリップボード往復の手動貼付は `feed_reply` の任意メタデータで保つ。
  assert.equal(workspaceEntityTypes.includes("feed_reply"), true);
  const manual = {
    id: "reply-manual-snapshot",
    post_id: "feed-post:proposal-external",
    body: "3回以下のときは幅だけを見てください。",
    created_at: "2026-09-21T10:00:00.000Z",
    author_kind: "self",
    origin: "manual_paste",
    question: "サンプル数が少ないときも同じ見方でよい？",
    external_source: "M365 Copilot",
    external_url: "https://example.com/chat/1",
    comment: "次も同じ表で見たい。",
  };
  validateEntity("feed_reply", { ...manual });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-feed-manual-snapshot-"));
  try {
    const filePath = path.join(directory, "workspace.zip");
    createSnapshot({ feed_replies: [manual], meta: {} }).writeZip(filePath);
    const { workspace } = readSnapshot(filePath);
    assert.equal(workspace.feed_replies.length, 1);
    assert.deepEqual(workspace.feed_replies[0], manual);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
  assert.equal(repo.setPreference("activityLogLastFinalizedDate", "2026-07-27"), "2026-07-27");
  assert.equal(repo.getPreference("activityLogLastFinalizedDate"), "2026-07-27");
});

test("Tasken Root and automatic Snapshot preferences round-trip with bounded values", () => {
  const repo = fakePreferenceRepository();
  const shortcut = "CommandOrControl+Alt+Space";
  const usedAt = "2026-08-13T01:02:03.000Z";

  assert.equal(repo.getPreference("taskenRoot.globalShortcut"), "");
  assert.equal(repo.setPreference("taskenRoot.globalShortcut", shortcut), shortcut);
  assert.equal(repo.getPreference("taskenRoot.globalShortcut"), shortcut);
  assert.deepEqual(
    repo.setPreference("taskenRoot.usage.v1", {
      "task:one": { count: 4.8, lastUsedAt: usedAt },
      invalid: { count: -1, lastUsedAt: "not-a-date" },
    }),
    { "task:one": { count: 4, lastUsedAt: usedAt } },
  );
  assert.deepEqual(repo.getPreference("taskenRoot.usage.v1"), {
    "task:one": { count: 4, lastUsedAt: usedAt },
  });

  assert.equal(repo.getPreference("automaticSnapshotBackupEnabled"), true);
  assert.equal(repo.setPreference("automaticSnapshotBackupEnabled", false), false);
  assert.equal(repo.getPreference("automaticSnapshotBackupEnabled"), false);
  assert.equal(
    repo.setPreference("automaticSnapshotBackupDirectory", " C:\\Tasken Backups "),
    "C:\\Tasken Backups",
  );
  assert.equal(repo.getPreference("automaticSnapshotBackupDirectory"), "C:\\Tasken Backups");
  assert.equal(repo.setPreference("automaticSnapshotBackupGenerations", 99), 20);
  assert.equal(repo.getPreference("automaticSnapshotBackupGenerations"), 20);
  assert.equal(repo.setPreference("automaticSnapshotBackupGenerations", 0), 1);
});

test("link URL validation allows web and mailto but rejects file", () => {
  // Notes はタイトルだけで下書き作成でき、本文は中央エリアで後から書く。
  assert.doesNotThrow(() =>
    validateEntity("note", { id: "note-draft", title: "下書き", body_markdown: "" }),
  );
  assert.doesNotThrow(() =>
    validateEntity("note", { id: "note-title-only", title: "タイトルだけ" }),
  );
  assert.throws(
    () => validateEntity("note", { id: "note-no-title", title: "", body_markdown: "本文" }),
    /note\.title/,
  );

  assert.doesNotThrow(() =>
    validateEntity("link", {
      id: "https",
      title: "Web",
      url: "https://example.com",
      link_type: "other",
    }),
  );
  assert.doesNotThrow(() =>
    validateEntity("link", {
      id: "http",
      title: "Web",
      url: "http://example.com",
      link_type: "other",
    }),
  );
  assert.doesNotThrow(() =>
    validateEntity("link", {
      id: "mail",
      title: "Mail",
      url: "mailto:test@example.com",
      link_type: "other",
    }),
  );
  assert.throws(
    () =>
      validateEntity("link", {
        id: "file",
        title: "File",
        url: "file:///C:/tmp/a.txt",
        link_type: "other",
      }),
    /https、http、mailto/,
  );
});

test("knowledge entity validation rejects invalid enums", () => {
  assert.doesNotThrow(() =>
    validateEntity("knowledge_node", { id: "kn-1", node_type: "claim", title: "Claim" }),
  );
  assert.throws(
    () => validateEntity("knowledge_node", { id: "kn-2", node_type: "unknown", title: "Bad" }),
    /node_type/,
  );
  assert.doesNotThrow(() =>
    validateEntity("knowledge_edge", {
      id: "ke-1",
      source_node_id: "a",
      target_node_id: "b",
      relation_type: "supports",
    }),
  );
  assert.throws(
    () =>
      validateEntity("knowledge_edge", {
        id: "ke-invalid",
        source_node_id: "a",
        target_node_id: "b",
        relation_type: "unknown",
      }),
    /relation_type/,
  );
  assert.throws(
    () =>
      validateEntity("knowledge_edge", {
        id: "ke-2",
        source_node_id: "a",
        target_node_id: "a",
        relation_type: "supports",
      }),
    /自分自身/,
  );
});

test("workspace entity types and snapshots include v2 domain records", () => {
  for (const type of [
    "project",
    "capture_entry",
    "task",
    "waiting",
    "plan_node",
    "schedule",
    "reference",
    "task_dependency",
    "plan_dependency",
    "knowledge_edge",
    "change_event",
    "sketch",
  ]) {
    assert.equal(workspaceEntityTypes.includes(type), true);
  }

  const zip = createSnapshot({
    projects: [{ id: "project-1", name: "Project", state: "active" }],
    tasks: [{ id: "task-1", title: "Task", state: "todo", priority: "normal" }],
    schedules: [
      {
        id: "schedule-1",
        owner_type: "task",
        owner_id: "task-1",
        date_kind: "deadline",
        confidence: "fixed",
        granularity: "day",
        end_date: "2026-06-19",
      },
    ],
    knowledge_edges: [
      {
        id: "edge-1",
        source_node_id: "node-1",
        target_node_id: "node-2",
        relation_type: "supports",
      },
    ],
    change_events: [
      {
        id: "change-1",
        entity_type: "task",
        entity_id: "task-1",
        changed_at: "2026-06-19T00:00:00.000Z",
        change_type: "created",
        source: "manual",
      },
    ],
    sketches: [
      {
        id: "sketch-1",
        title: "Reaction map",
        document: {
          schema_version: 1,
          pages: [{ id: "page-1", width: 1200, height: 840, background: "dot", objects: [] }],
        },
      },
    ],
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
  assert.doesNotThrow(() =>
    validateEntity("project", { id: "project-1", name: "Project", state: "active" }),
  );
  assert.throws(
    () => validateEntity("task", { id: "task-1", title: "Task", state: "blocked" }),
    /task.state/,
  );
  assert.throws(
    () =>
      validateEntity("schedule", {
        id: "schedule-1",
        owner_type: "task",
        owner_id: "task-1",
        date_kind: "range",
        confidence: "fixed",
        granularity: "day",
        start_date: "2026-06-20",
        end_date: "2026-06-19",
      }),
    /schedule.end_date/,
  );
  assert.throws(
    () =>
      validateEntity("reference", {
        id: "ref-1",
        source_type: "task",
        source_id: "task-1",
        target_type: "task",
        target_id: "task-1",
        relation_type: "related_to",
      }),
    /自分自身/,
  );
  assert.throws(
    () =>
      validateEntity("knowledge_edge", {
        id: "edge-1",
        source_node_id: "node-1",
        target_node_id: "node-1",
        relation_type: "supports",
      }),
    /自分自身/,
  );
});

test("sketch validation preserves editable page objects and rejects broken documents", () => {
  const valid = {
    id: "sketch-1",
    title: "Flow draft",
    document: {
      schema_version: 1,
      pages: [
        {
          id: "page-1",
          width: 1200,
          height: 840,
          background: "grid",
          objects: [
            {
              id: "stroke-1",
              type: "stroke",
              points: [
                { x: 20, y: 30, pressure: 0.5 },
                { x: 80, y: 90, pressure: 0.8 },
              ],
              color: "#20232a",
              width: 2,
            },
          ],
        },
      ],
    },
  };
  assert.doesNotThrow(() => validateEntity("sketch", valid));
  assert.doesNotThrow(() =>
    validateEntity("sketch", {
      ...valid,
      document: {
        ...valid.document,
        mode: "infinite",
        viewport: { x: -420, y: 180, zoom: 0.82 },
      },
    }),
  );
  assert.throws(
    () =>
      validateEntity("sketch", {
        ...valid,
        document: {
          ...valid.document,
          mode: "infinite",
          viewport: { x: 0, y: 0, zoom: 0 },
        },
      }),
    /viewport/,
  );
  assert.throws(
    () =>
      validateEntity("sketch", {
        ...valid,
        document: { schema_version: 2, pages: valid.document.pages },
      }),
    /schema_version/,
  );
  assert.throws(
    () => validateEntity("sketch", { ...valid, document: { schema_version: 1, pages: [] } }),
    /1件以上/,
  );
  assert.throws(
    () =>
      validateEntity("sketch", {
        ...valid,
        document: {
          schema_version: 1,
          pages: [{ ...valid.document.pages[0], width: 0 }],
        },
      }),
    /ページ幅・高さ/,
  );
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
        pages: [
          {
            id: "page-1",
            width: 1200,
            height: 840,
            background: "dot",
            objects: [{ id: "text-1", type: "text", x: 40, y: 60, text: "editable" }],
          },
        ],
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

    repo.insertImported(
      "reference",
      {
        id: "legacy-lineage",
        source_type: "note",
        source_id: "note-lineage",
        target_type: "task",
        target_id: "task-lineage",
        relation_type: "derived_from",
      },
      "legacy",
    );
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

test("removing a Note does not delete its exported Markdown file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-note-export-delete-test-"));
  const exportedPath = path.join(root, "exported-note.md");
  const repo = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  try {
    const content = "# Keep this export\n";
    fs.writeFileSync(exportedPath, content, "utf8");
    repo.save("note", { id: "note-export", title: "Exported note" });
    repo.save("artifact", {
      id: "artifact-note-export",
      title: "Exported note",
      filename: "exported-note.md",
      file_type: "md",
      mime_type: "text/markdown",
      file_size: Buffer.byteLength(content),
      stored_path: exportedPath,
      storage_mode: "managed",
      source_type: "note",
      source_id: "note-export",
      origin_note_id: "note-export",
      export_format: "markdown",
    });

    repo.remove("note", "note-export");

    assert.equal(repo.get("artifact", "artifact-note-export"), null);
    assert.equal(fs.existsSync(exportedPath), true);
    assert.equal(fs.readFileSync(exportedPath, "utf8"), content);
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
    () =>
      repo.validateGraph("knowledge_edge", {
        id: "ca",
        source_node_id: "c",
        target_node_id: "a",
        relation_type: "leads_to",
      }),
    /KnowledgeEdgeが循環/,
  );
  assert.doesNotThrow(() =>
    repo.validateGraph("knowledge_edge", {
      id: "weak",
      source_node_id: "c",
      target_node_id: "a",
      relation_type: "supports",
    }),
  );
});

test("snapshot validation rejects directional knowledge edge cycles", () => {
  const repo = fakeGraphRepository();
  assert.throws(
    () =>
      repo.validateSnapshotWorkspace({
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
  assert.doesNotThrow(() =>
    repo.validateSnapshotWorkspace({
      knowledge_nodes: [
        { id: "a", node_type: "claim", title: "A" },
        { id: "b", node_type: "claim", title: "B" },
      ],
      knowledge_edges: [
        { id: "ab", source_node_id: "a", target_node_id: "b", relation_type: "supports" },
        { id: "ba", source_node_id: "b", target_node_id: "a", relation_type: "similar_to" },
      ],
    }),
  );
});

test("snapshot validation follows Registry Theme fields and keeps Schedule owner-scoped", () => {
  const repo = fakeGraphRepository();
  assert.throws(
    () =>
      repo.validateSnapshotWorkspace({
        notes: [{ id: "note-project-ref", title: "Canonical Note", project_id: "missing-project" }],
      }),
    /note\.project_idがSnapshot内に存在しないprojectを参照しています/,
  );

  assert.doesNotThrow(() =>
    repo.validateSnapshotWorkspace({
      projects: [{ id: "project-1", name: "Project", state: "active" }],
      tasks: [{ id: "task-1", title: "Task", state: "todo", project_id: "project-1" }],
      schedules: [
        {
          id: "schedule-owner-scoped",
          owner_type: "task",
          owner_id: "task-1",
          date_kind: "deadline",
          confidence: "fixed",
          granularity: "day",
          end_date: "2026-08-08",
        },
      ],
    }),
  );
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
  assert.throws(
    () => fakeRepository([change]).repo.applySnapshot({}, { "item:item-1": "create" }),
    /createでは上書きできません/,
  );

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
  assert.throws(
    () => fakeRepository([newChange]).repo.applySnapshot({}, { "item:new-item": "update" }),
    /updateは実行できません/,
  );
});

const RECORD_COUNT_MARK = "HIMITSU-MARK";

test("記録の数の表は、種類・件数・削除済み・最後に作られた日だけで、中身と ID を出さない (#755)", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), `tasken-record-counts-${RECORD_COUNT_MARK}-`),
  );
  const db = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    db.save("theme", { id: `theme-${RECORD_COUNT_MARK}`, name: `${RECORD_COUNT_MARK} のテーマ` });
    const ids = [];
    for (const [index, day] of ["2026-03-01", "2026-03-05", "2026-03-03"].entries()) {
      const task = db.save("task", {
        id: `task-${RECORD_COUNT_MARK}-${index}`,
        title: `${RECORD_COUNT_MARK} の題名 ${index}`,
        description: `${RECORD_COUNT_MARK} の本文`,
        state: "todo",
        priority: "normal",
        project_id: `theme-${RECORD_COUNT_MARK}`,
        created_at: `${day}T09:00:00.000Z`,
      });
      ids.push(task.id);
    }
    db.save("note", {
      id: `note-${RECORD_COUNT_MARK}`,
      title: `${RECORD_COUNT_MARK} のノート`,
      body_markdown: `${RECORD_COUNT_MARK} の本文\n\n![](C:/Users/${RECORD_COUNT_MARK}/picture.png)`,
      project_id: `theme-${RECORD_COUNT_MARK}`,
      created_at: "2026-04-02T23:30:00.000Z",
    });
    db.remove("task", ids[2]);

    const rows = db.countRecordsByType();
    // Repository の時点で、種類・数・日付の 4 つ以外を持ち出さない。
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ["count", "deleted", "lastCreatedAt", "type"]);
    }
    assert.equal(JSON.stringify(rows).includes(RECORD_COUNT_MARK), false);
    const byType = Object.fromEntries(rows.map((row) => [row.type, row]));
    assert.deepEqual(byType.task, {
      type: "task",
      count: 2,
      deleted: 1,
      lastCreatedAt: "2026-03-05T09:00:00.000Z",
    });
    assert.equal(byType.note.count, 1);
    assert.equal(byType.note.deleted, 0);
    assert.ok(byType.theme.count >= 1);
    // 表の合計が、表を通さずに数えた全件と合う（種類の取りこぼしが無い）。
    const total = db.db.prepare("SELECT COUNT(*) AS n FROM entities").get().n;
    assert.ok(total >= 5);
    assert.equal(
      rows.reduce((sum, row) => sum + row.count + row.deleted, 0),
      total,
    );

    const markdown = formatRecordCountsMarkdown(rows, {
      version: "9.9.9",
      generatedAt: "2026-11-14T00:00:00.000Z",
    });
    assert.ok(rows.length >= 3);
    const lines = markdown.trim().split("\n");
    assert.equal(lines.length, rows.length + 4);
    assert.ok(lines.includes("| task | 2 | 1 | 2026-03-05 |"));
    assert.ok(lines.includes("| note | 1 | 0 | 2026-04-02 |"));
    assert.match(lines[0], /9\.9\.9/);

    // 題名・本文・ID・パス・Theme の名前・Workspace と端末の ID が出ない。
    assert.equal(markdown.includes(RECORD_COUNT_MARK), false);
    const meta = db.getMeta();
    for (const secret of [meta.workspaceId, meta.deviceId, directory, os.userInfo().username]) {
      assert.equal(markdown.includes(String(secret)), false);
    }
    // 行は「種類の名前 | 数 | 数 | 日付」の形だけ。
    for (const line of lines.slice(4)) {
      assert.match(line, /^\| [a-z_]+ \| \d+ \| \d+ \| (\d{4}-\d{2}-\d{2}|-) \|$/);
    }
  } finally {
    db.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// #755 束2 で外した AI Pack・日別 Context の、前の版の出力の片付け（retired-output-cleanup.test.mjs）。
// 前の版が残した workspace_meta の値から保存先を拾い、済んだ印を残すところは本物の DB で確かめる。
test("前の版の出力の起動時の片付けは一度だけ走り、済んだ印を DB に残す。ごみ箱へ移せなければ次の起動でやり直す", async () => {
  const item = retiredOutputFixture();
  const databasePath = path.join(item.root, "workspace.sqlite");
  let database = new WorkspaceDatabase(databasePath);
  try {
    const syncRoot = path.join(item.root, "Sync");
    fs.mkdirSync(syncRoot);
    database.setPreference("artifactDirectory", syncRoot);
    database.save("theme", { id: "theme-a", name: "Materials", code: "MAT" });
    const themeFolder = path.join(syncRoot, "Themes", "MAT");
    writeThemeFolder(themeFolder, "theme-a");
    writeAiPack(themeFolder, "theme-a");
    const publishRoot = path.join(item.root, "Publish");
    const dailyDirectory = writeDailyContext(publishRoot, database.workspaceId);
    // 前の版が残した日別 Context の設定（読む所は消したが値は残っている）。
    database.db
      .prepare("INSERT INTO workspace_meta(key, value) VALUES('daily_context_publication', ?)")
      .run(JSON.stringify({ root: publishRoot, timezone: "Asia/Tokyo", refreshPending: false }));

    const logs = [];
    const log = (level, message) => logs.push({ level, message });
    const refusing = async () => {
      throw Object.assign(new Error(`EBUSY ${themeFolder}`), { code: "EBUSY" });
    };
    const first = await runRetiredOutputCleanupOnce({ repository: database, trash: refusing, log });
    assert.equal(first.state, "retry");
    assert.equal(database.readRetiredOutputLocations().cleanedAt, null);
    assert.equal(
      logs.some(({ message }) => message.includes(item.root)),
      false,
      "ログにパスを出さない",
    );

    const second = await runRetiredOutputCleanupOnce({
      repository: database,
      trash: item.trash,
      log,
      now: () => "2026-11-14T00:00:00.000Z",
    });
    assert.equal(second.state, "done");
    assert.equal(fs.existsSync(path.join(themeFolder, "AI Pack")), false);
    assert.equal(fs.existsSync(dailyDirectory), false);

    // 再起動の後。前の版の出力がまた現れても（古い版の別の端末など）、二度目は何もしない。
    database.db.close();
    database = new WorkspaceDatabase(databasePath);
    assert.equal(database.readRetiredOutputLocations().cleanedAt, "2026-11-14T00:00:00.000Z");
    const pack = writeAiPack(themeFolder, "theme-a");
    const count = item.trashed.length;
    const third = await runRetiredOutputCleanupOnce({
      repository: database,
      trash: item.trash,
      log,
    });
    assert.equal(third.state, "already_done");
    assert.equal(item.trashed.length, count);
    assert.equal(fs.readdirSync(pack).length, 8);
  } finally {
    database.db.close();
    item.close();
  }
});
