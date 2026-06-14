import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "electron";

import { WorkspaceDatabase } from "../electron/database.mjs";
import { createSnapshot, readSnapshot } from "../electron/snapshots.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-desk-model-test-"));

try {
  const db = new WorkspaceDatabase(path.join(dir, "test.sqlite"));
  db.setPreference("themeMode", "dark");
  const theme = db.save("theme", { id: "theme-1", name: "Test" });
  const item = db.save("item", {
    id: "item-1",
    title: "Plan",
    theme_id: theme.id,
    status: "todo",
    progress: 10,
    planned_start: "2026-06-01",
    planned_end: "2026-06-10",
  });
  const statusUpdate = db.save("status_update", {
    id: "status-1",
    theme_id: theme.id,
    summary: "On track",
    date: "2026-06-01",
  });
  const child = db.save("item", {
    id: "item-child",
    title: "Child",
    theme_id: theme.id,
    parent_item_id: item.id,
    status: "todo",
    progress: 0,
  });
  const dependency = db.save("dependency", {
    id: "dependency-1",
    source_item_id: item.id,
    target_item_id: child.id,
  });
  db.save("item", { ...item, planned_end: "2026-06-12", progress: 20 }, { reason: "test revision" });
  db.remove("theme", theme.id);
  const detachedTheme = db.get("item", item.id)?.theme_id === null;
  const cascadedStatus = Boolean(db.get("status_update", statusUpdate.id, true)?.deleted_at);
  db.restore("theme", theme.id);
  const restoredThemeReference = db.get("item", item.id)?.theme_id === theme.id;
  const restoredStatus = !db.get("status_update", statusUpdate.id, true)?.deleted_at;

  db.remove("item", item.id);
  const detachedParent = db.get("item", child.id)?.parent_item_id === null;
  const cascadedDependency = Boolean(db.get("dependency", dependency.id, true)?.deleted_at);
  db.restore("item", item.id);
  const restoredParent = db.get("item", child.id)?.parent_item_id === item.id;
  const restoredDependency = !db.get("dependency", dependency.id, true)?.deleted_at;
  const deletedTheme = db.save("theme", { id: "theme-deleted", name: "Deleted" });
  db.remove("theme", deletedTheme.id);

  let rejected = false;
  try {
    db.save("item", { title: "", progress: 120 });
  } catch {
    rejected = true;
  }
  let rejectedReference = false;
  try {
    db.save("note", {
      id: "bad-reference",
      title: "Bad reference",
      body_markdown: "Body",
      item_id: "missing-item",
    });
  } catch {
    rejectedReference = true;
  }

  let rolledBack = false;
  try {
    db.saveMany([
      {
        action: "save",
        type: "note",
        entity: { id: "note-ok", title: "Valid", body_markdown: "Body" },
      },
      {
        action: "save",
        type: "link",
        entity: { id: "link-bad", title: "Missing URL", url: "" },
      },
    ]);
  } catch {
    rolledBack = db.get("note", "note-ok", true) === null;
  }

  const zipPath = path.join(dir, "snapshot.zip");
  createSnapshot(db.loadWorkspace(true)).writeZip(zipPath);
  const parsed = readSnapshot(zipPath);
  const tombstone = parsed.workspace.themes.find((entry) => entry.id === deletedTheme.id)?.deleted_at;

  const imported = new WorkspaceDatabase(path.join(dir, "imported.sqlite"));
  const decisions = Object.fromEntries(
    imported.previewSnapshot(parsed.workspace).map((change) => [change.key, change.action]),
  );
  imported.applySnapshot(parsed.workspace, decisions, parsed.workspace.plan_revisions);

  const result = {
    rejected,
    rejectedReference,
    rolledBack,
    detachedTheme,
    cascadedStatus,
    restoredThemeReference,
    restoredStatus,
    detachedParent,
    cascadedDependency,
    restoredParent,
    restoredDependency,
    tombstone: Boolean(tombstone),
    exportedRevisions: parsed.workspace.plan_revisions.length,
    importedRevisions: imported.loadWorkspace(true).plan_revisions.length,
    persistedPreference: db.getPreference("themeMode") === "dark",
    schemaVersion: db.getMeta().schemaVersion,
  };
  const passed = Object.entries(result).every(([key, value]) =>
    key === "schemaVersion" ? value === 1 : key.includes("Revisions") ? value === 1 : value === true);
  console.log(JSON.stringify(result));
  app.exit(passed ? 0 : 1);
} catch (error) {
  console.error(error);
  app.exit(1);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
