import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertEntityType, normalizeEntity, validateEntity, workspaceEntityTypes } from "./domain.mjs";

const SCHEMA_VERSION = 1;

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function parseRow(row) {
  if (!row) return null;
  return {
    ...JSON.parse(row.data_json),
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    device_id: row.device_id,
    source: row.source,
    version: row.version,
  };
}

function contentOf(entity) {
  const {
    id,
    created_at,
    updated_at,
    deleted_at,
    device_id,
    source,
    version,
    ...data
  } = entity;
  return data;
}

export class WorkspaceDatabase {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.deviceId = this.ensureMeta("device_id", uuid());
    this.workspaceId = this.ensureMeta("workspace_id", uuid());
    this.ensureMeta("theme_mode", "light");
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const current = Number(
      this.db.prepare("SELECT value FROM workspace_meta WHERE key = 'schema_version'").get()?.value || 0,
    );
    if (current > SCHEMA_VERSION) {
      throw new Error(`DB schema version ${current}は、このアプリでは読み込めません。`);
    }
    const migrations = [
      {
        version: 1,
        up: () => this.db.exec(`
          CREATE TABLE IF NOT EXISTS entities (
            entity_type TEXT NOT NULL,
            id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            device_id TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            version INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (entity_type, id)
          );

          CREATE INDEX IF NOT EXISTS idx_entities_type_updated
            ON entities(entity_type, updated_at);
          CREATE INDEX IF NOT EXISTS idx_entities_deleted
            ON entities(entity_type, deleted_at);

          CREATE TABLE IF NOT EXISTS plan_revisions (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            changed_at TEXT NOT NULL,
            changed_by_device_id TEXT NOT NULL,
            old_json TEXT NOT NULL,
            new_json TEXT NOT NULL,
            reason TEXT,
            related_note_id TEXT,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_plan_revisions_item
            ON plan_revisions(item_id, changed_at DESC);
        `),
      },
    ];
    const applyMigrations = this.db.transaction(() => {
      for (const migration of migrations) {
        if (migration.version <= current) continue;
        migration.up();
        this.db.prepare(`
          INSERT INTO workspace_meta(key, value) VALUES('schema_version', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(String(migration.version));
      }
    });
    applyMigrations();
  }

  ensureMeta(key, fallback) {
    const existing = this.db.prepare("SELECT value FROM workspace_meta WHERE key = ?").get(key);
    if (existing) return existing.value;
    this.db.prepare("INSERT INTO workspace_meta(key, value) VALUES(?, ?)").run(key, fallback);
    return fallback;
  }

  getMeta() {
    return {
      schemaVersion: SCHEMA_VERSION,
      workspaceId: this.workspaceId,
      deviceId: this.deviceId,
      themeMode: this.getPreference("themeMode"),
      entityCount: this.db.prepare("SELECT COUNT(*) AS count FROM entities WHERE deleted_at IS NULL").get().count,
    };
  }

  getPreference(key) {
    if (key !== "themeMode") throw new Error(`未対応の設定です: ${key}`);
    const metaKey = "theme_mode";
    return this.ensureMeta(metaKey, "light");
  }

  setPreference(key, value) {
    if (key !== "themeMode") throw new Error(`未対応の設定です: ${key}`);
    if (!["light", "dark"].includes(value)) throw new Error("カラーモードの値が不正です。");
    this.db.prepare(`
      INSERT INTO workspace_meta(key, value) VALUES('theme_mode', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(value);
    return value;
  }

  isEmpty() {
    return this.db.prepare("SELECT COUNT(*) AS count FROM entities").get().count === 0;
  }

  list(type, includeDeleted = false) {
    assertEntityType(type);
    const sql = includeDeleted
      ? "SELECT * FROM entities WHERE entity_type = ? ORDER BY updated_at DESC"
      : "SELECT * FROM entities WHERE entity_type = ? AND deleted_at IS NULL ORDER BY updated_at DESC";
    return this.db.prepare(sql).all(type).map(parseRow);
  }

  loadWorkspace(includeDeleted = false) {
    const result = {};
    for (const type of workspaceEntityTypes) result[`${type}s`] = this.list(type, includeDeleted);
    result.plan_revisions = this.db.prepare(
      "SELECT * FROM plan_revisions ORDER BY changed_at DESC",
    ).all().map((row) => ({
      ...row,
      old: JSON.parse(row.old_json),
      next: JSON.parse(row.new_json),
    }));
    result.meta = this.getMeta();
    return result;
  }

  get(type, id, includeDeleted = false) {
    const row = this.db.prepare(
      `SELECT * FROM entities WHERE entity_type = ? AND id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
    ).get(type, String(id));
    return parseRow(row);
  }

  save(type, input, options = {}) {
    const transaction = this.db.transaction(() => this.saveWithinTransaction(type, input, options));
    return transaction();
  }

  saveMany(operations) {
    if (!Array.isArray(operations) || !operations.length) {
      throw new Error("保存するデータがありません。");
    }
    const transaction = this.db.transaction(() => operations.map((operation) => {
      if (!operation || operation.action !== "save") {
        throw new Error("saveManyではaction=saveのみ利用できます。");
      }
      return this.saveWithinTransaction(operation.type, operation.entity, operation.options || {});
    }));
    return transaction();
  }

  saveWithinTransaction(type, input, options = {}) {
    assertEntityType(type);
    const id = String(input.id || uuid());
    const existing = this.get(type, id, true);
    const timestamp = now();
    const entity = normalizeEntity(type, {
      ...input,
      id,
      created_at: existing?.created_at || input.created_at || timestamp,
      updated_at: timestamp,
      deleted_at: null,
      device_id: this.deviceId,
      source: input.source || existing?.source || options.source || "manual",
      version: (existing?.version || Number(input.version) || 0) + 1,
    });
    this.validateReferences(type, entity);

    if (type === "item" && existing) this.recordPlanRevision(existing, entity, options.reason);
    this.db.prepare(`
      INSERT INTO entities(
        entity_type, id, data_json, created_at, updated_at, deleted_at, device_id, source, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, id) DO UPDATE SET
        data_json = excluded.data_json,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id,
        source = excluded.source,
        version = excluded.version
    `).run(
      type,
      id,
      JSON.stringify(contentOf(entity)),
      entity.created_at,
      entity.updated_at,
      entity.deleted_at,
      entity.device_id,
      entity.source,
      entity.version,
    );
    return this.get(type, id);
  }

  validateReferences(type, entity) {
    const requireReference = (targetType, id, field) => {
      if (!id) return;
      if (!this.get(targetType, id)) {
        throw new Error(`${type}.${field}が存在しない${targetType}を参照しています。`);
      }
    };

    requireReference("theme", entity.theme_id, "theme_id");
    requireReference("item", entity.item_id, "item_id");
    requireReference("note", entity.note_id, "note_id");
    requireReference("person", entity.owner_person_id, "owner_person_id");
    requireReference("person", entity.waiting_for_person_id, "waiting_for_person_id");
    requireReference("source_record", entity.source_record_id, "source_record_id");
    requireReference("item", entity.parent_item_id, "parent_item_id");
    requireReference("field_definition", entity.field_definition_id, "field_definition_id");

    if (type === "dependency") {
      requireReference("item", entity.source_item_id, "source_item_id");
      requireReference("item", entity.target_item_id, "target_item_id");
    }
    if (type === "relation") {
      requireReference(entity.source_entity_type, entity.source_entity_id, "source_entity_id");
      requireReference(entity.target_entity_type, entity.target_entity_id, "target_entity_id");
    }
    if (type === "field_value" || type === "entity_source") {
      requireReference(entity.entity_type, entity.entity_id, "entity_id");
    }
    if (type === "entity_source") {
      requireReference("source_record", entity.source_record_id, "source_record_id");
    }
  }

  recordPlanRevision(oldItem, newItem, reason = "") {
    const fields = [
      "planned_start",
      "planned_end",
      "due_date",
      "schedule_status",
      "schedule_confidence",
      "progress",
    ];
    const oldValues = Object.fromEntries(fields.map((field) => [field, oldItem[field] ?? null]));
    const newValues = Object.fromEntries(fields.map((field) => [field, newItem[field] ?? null]));
    if (JSON.stringify(oldValues) === JSON.stringify(newValues)) return;
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO plan_revisions(
        id, item_id, changed_at, changed_by_device_id, old_json, new_json, reason, related_note_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(),
      newItem.id,
      timestamp,
      this.deviceId,
      JSON.stringify(oldValues),
      JSON.stringify(newValues),
      reason || null,
      newItem.related_note_id || null,
      timestamp,
    );
  }

  remove(type, id) {
    assertEntityType(type);
    const transaction = this.db.transaction(() => {
      const existing = this.get(type, id);
      if (!existing) return null;
      this.applyDeletePolicy(type, String(id));
      this.markRemoved(type, String(id));
      return this.get(type, id, true);
    });
    return transaction();
  }

  restore(type, id) {
    assertEntityType(type);
    const transaction = this.db.transaction(() => {
      const existing = this.get(type, id, true);
      if (!existing) return null;
      const timestamp = now();
      this.db.prepare(`
        UPDATE entities
        SET deleted_at = NULL, updated_at = ?, device_id = ?, version = version + 1
        WHERE entity_type = ? AND id = ?
      `).run(timestamp, this.deviceId, type, String(id));
      this.restoreCascadeChildren(type, String(id));
      return this.get(type, id);
    });
    return transaction();
  }

  applyDeletePolicy(type, id) {
    if (type === "theme") {
      this.nullifyReferences(type, [
        ["item", "theme_id"],
        ["note", "theme_id"],
        ["link", "theme_id"],
        ["field_definition", "theme_id"],
        ["log_entry", "theme_id"],
        ["view", "theme_id"],
      ], id);
      this.cascadeWhere("status_update", (entry) => entry.theme_id === id, type, id);
    }

    if (type === "item") {
      this.nullifyReferences(type, [
        ["item", "parent_item_id"],
        ["note", "item_id"],
        ["link", "item_id"],
        ["log_entry", "item_id"],
      ], id);
      this.cascadeWhere("dependency", (entry) => entry.source_item_id === id || entry.target_item_id === id, type, id);
    }

    if (type === "note") {
      this.nullifyReferences(type, [["link", "note_id"], ["log_entry", "related_note_id"]], id);
    }

    if (type === "person") {
      this.nullifyReferences(type, [
        ["item", "owner_person_id"],
        ["item", "waiting_for_person_id"],
        ["log_entry", "owner_person_id"],
      ], id);
    }

    if (type === "source_record") {
      this.nullifyReferences(type, [
        ["item", "source_record_id"],
        ["note", "source_record_id"],
        ["link", "source_record_id"],
        ["log_entry", "source_record_id"],
      ], id);
    }

    if (type === "field_definition") {
      this.cascadeWhere("field_value", (entry) => entry.field_definition_id === id, type, id);
    }

    if (["theme", "item", "note", "link", "source_record"].includes(type)) {
      this.cascadeWhere(
        "relation",
        (entry) => (entry.source_entity_type === type && entry.source_entity_id === id)
          || (entry.target_entity_type === type && entry.target_entity_id === id),
        type,
        id,
      );
      this.cascadeWhere(
        "entity_source",
        (entry) => (entry.entity_type === type && entry.entity_id === id)
          || (type === "source_record" && entry.source_record_id === id),
        type,
        id,
      );
      this.cascadeWhere(
        "field_value",
        (entry) => entry.entity_type === type && entry.entity_id === id,
        type,
        id,
      );
    }
  }

  nullifyReferences(parentType, targets, removedId) {
    for (const [entityType, field] of targets) {
      for (const entity of this.list(entityType)) {
        if (entity[field] !== removedId) continue;
        const detached = Array.isArray(entity.detached_references) ? entity.detached_references : [];
        this.saveWithinTransaction(entityType, {
          ...entity,
          [field]: null,
          detached_references: [
            ...detached.filter((entry) => entry.field !== field),
            { field, parentType, parentId: removedId },
          ],
        });
      }
    }
  }

  cascadeWhere(entityType, predicate, parentType, parentId) {
    for (const entity of this.list(entityType)) {
      if (!predicate(entity)) continue;
      this.markRemoved(entityType, entity.id, { parentType, parentId });
    }
  }

  markRemoved(type, id, cascade = null) {
    const existing = this.get(type, id, true);
    if (!existing || existing.deleted_at) return;
    const timestamp = now();
    const data = contentOf(existing);
    if (cascade) data.cascade_deleted_by = cascade;
    this.db.prepare(`
      UPDATE entities
      SET data_json = ?, deleted_at = ?, updated_at = ?, device_id = ?, version = version + 1
      WHERE entity_type = ? AND id = ?
    `).run(JSON.stringify(data), timestamp, timestamp, this.deviceId, type, id);
  }

  restoreCascadeChildren(parentType, parentId) {
    for (const entityType of workspaceEntityTypes) {
      for (const entity of this.list(entityType, true)) {
        if (!entity.deleted_at) continue;
        const marker = entity.cascade_deleted_by;
        if (marker?.parentType !== parentType || marker?.parentId !== parentId) continue;
        const { cascade_deleted_by: _marker, ...data } = contentOf(entity);
        const timestamp = now();
        this.db.prepare(`
          UPDATE entities
          SET data_json = ?, deleted_at = NULL, updated_at = ?, device_id = ?, version = version + 1
          WHERE entity_type = ? AND id = ?
        `).run(JSON.stringify(data), timestamp, this.deviceId, entityType, entity.id);
      }
    }
    this.restoreDetachedReferences(parentType, parentId);
  }

  restoreDetachedReferences(parentType, parentId) {
    for (const entityType of workspaceEntityTypes) {
      for (const entity of this.list(entityType)) {
        const detached = Array.isArray(entity.detached_references) ? entity.detached_references : [];
        const matching = detached.filter((entry) => entry.parentType === parentType && entry.parentId === parentId);
        if (!matching.length) continue;
        const next = { ...entity };
        for (const entry of matching) {
          if (!next[entry.field]) next[entry.field] = parentId;
        }
        const remaining = detached.filter((entry) => !matching.includes(entry));
        if (remaining.length) next.detached_references = remaining;
        else delete next.detached_references;
        this.saveWithinTransaction(entityType, next);
      }
    }
  }

  bootstrap(legacyWorkspace) {
    if (!this.isEmpty()) return this.loadWorkspace();
    const transaction = this.db.transaction(() => {
      for (const type of workspaceEntityTypes) {
        const records = legacyWorkspace?.[`${type}s`] || [];
        for (const record of records) this.insertImported(type, record, "legacy");
      }
    });
    transaction();
    return this.loadWorkspace();
  }

  insertImported(type, input, fallbackSource = "imported") {
    assertEntityType(type);
    validateEntity(type, input);
    const timestamp = now();
    const entity = {
      ...input,
      id: String(input.id || uuid()),
      created_at: input.created_at || timestamp,
      updated_at: input.updated_at || timestamp,
      deleted_at: input.deleted_at || null,
      device_id: input.device_id || this.deviceId,
      source: input.source || fallbackSource,
      version: Number(input.version) || 1,
    };
    this.db.prepare(`
      INSERT OR REPLACE INTO entities(
        entity_type, id, data_json, created_at, updated_at, deleted_at, device_id, source, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      type,
      entity.id,
      JSON.stringify(contentOf(entity)),
      entity.created_at,
      entity.updated_at,
      entity.deleted_at,
      entity.device_id,
      entity.source,
      entity.version,
    );
  }

  previewSnapshot(snapshot) {
    const changes = [];
    for (const type of workspaceEntityTypes) {
      for (const incoming of snapshot?.[`${type}s`] || []) {
        const local = this.get(type, incoming.id, true);
        let category = "new";
        if (local) {
          const sameContent = JSON.stringify(contentOf(local)) === JSON.stringify(contentOf(incoming))
            && Boolean(local.deleted_at) === Boolean(incoming.deleted_at);
          if (sameContent) category = "same";
          else if (Number(incoming.version || 1) > Number(local.version || 1)) category = "update";
          else if (Number(incoming.version || 1) < Number(local.version || 1)) category = "local_newer";
          else category = "conflict";
        }
        changes.push({
          key: `${type}:${incoming.id}`,
          type,
          incoming,
          local,
          category,
          action: category === "new" ? "create" : category === "update" ? "update" : "ignore",
        });
      }
    }
    return changes;
  }

  applySnapshot(snapshot, decisions = {}, revisions = []) {
    const preview = this.previewSnapshot(snapshot);
    const applied = [];
    const transaction = this.db.transaction(() => {
      for (const change of preview) {
        const action = decisions[change.key] || change.action;
        if (action === "ignore") continue;
        if (action === "duplicate") {
          this.insertImported(change.type, {
            ...change.incoming,
            id: uuid(),
            source: "snapshot",
            version: 1,
          }, "snapshot");
        } else {
          this.insertImported(change.type, change.incoming, "snapshot");
        }
        applied.push({ key: change.key, action });
      }
      for (const revision of revisions) this.insertPlanRevision(revision);
      this.insertImported("import_batch", {
        id: uuid(),
        source: "snapshot",
        status: "completed",
        count: applied.length,
        created_at: now(),
      }, "snapshot");
    });
    transaction();
    return { applied, workspace: this.loadWorkspace() };
  }

  insertPlanRevision(revision) {
    if (!revision?.id || !revision.item_id || !revision.changed_at) return;
    this.db.prepare(`
      INSERT OR IGNORE INTO plan_revisions(
        id, item_id, changed_at, changed_by_device_id, old_json, new_json, reason, related_note_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.id,
      revision.item_id,
      revision.changed_at,
      revision.changed_by_device_id || this.deviceId,
      JSON.stringify(revision.old || {}),
      JSON.stringify(revision.next || {}),
      revision.reason || null,
      revision.related_note_id || null,
      revision.created_at || revision.changed_at,
    );
  }
}

export { workspaceEntityTypes };
export const workspaceSchemaVersion = SCHEMA_VERSION;
