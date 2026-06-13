import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;
const ENTITY_TYPES = [
  "theme",
  "item",
  "note",
  "link",
  "person",
  "dependency",
  "view",
  "status_update",
  "source_record",
  "entity_source",
  "relation",
  "field_definition",
  "field_value",
  "log_entry",
  "import_batch",
];

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
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

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
    `);
    this.db.prepare(`
      INSERT INTO workspace_meta(key, value) VALUES('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(SCHEMA_VERSION));
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
      entityCount: this.db.prepare("SELECT COUNT(*) AS count FROM entities WHERE deleted_at IS NULL").get().count,
    };
  }

  isEmpty() {
    return this.db.prepare("SELECT COUNT(*) AS count FROM entities").get().count === 0;
  }

  list(type, includeDeleted = false) {
    if (!ENTITY_TYPES.includes(type)) throw new Error(`未対応のデータ種別です: ${type}`);
    const sql = includeDeleted
      ? "SELECT * FROM entities WHERE entity_type = ? ORDER BY updated_at DESC"
      : "SELECT * FROM entities WHERE entity_type = ? AND deleted_at IS NULL ORDER BY updated_at DESC";
    return this.db.prepare(sql).all(type).map(parseRow);
  }

  loadWorkspace() {
    const result = {};
    for (const type of ENTITY_TYPES) result[`${type}s`] = this.list(type);
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
    if (!ENTITY_TYPES.includes(type)) throw new Error(`未対応のデータ種別です: ${type}`);
    const id = String(input.id || uuid());
    const existing = this.get(type, id, true);
    const timestamp = now();
    const entity = {
      ...input,
      id,
      created_at: existing?.created_at || input.created_at || timestamp,
      updated_at: timestamp,
      deleted_at: null,
      device_id: this.deviceId,
      source: input.source || existing?.source || options.source || "manual",
      version: (existing?.version || Number(input.version) || 0) + 1,
    };

    const transaction = this.db.transaction(() => {
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
    });
    transaction();
    return this.get(type, id);
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
    const existing = this.get(type, id);
    if (!existing) return null;
    const timestamp = now();
    this.db.prepare(`
      UPDATE entities
      SET deleted_at = ?, updated_at = ?, device_id = ?, version = version + 1
      WHERE entity_type = ? AND id = ?
    `).run(timestamp, timestamp, this.deviceId, type, String(id));
    return this.get(type, id, true);
  }

  restore(type, id) {
    const existing = this.get(type, id, true);
    if (!existing) return null;
    const timestamp = now();
    this.db.prepare(`
      UPDATE entities
      SET deleted_at = NULL, updated_at = ?, device_id = ?, version = version + 1
      WHERE entity_type = ? AND id = ?
    `).run(timestamp, this.deviceId, type, String(id));
    return this.get(type, id);
  }

  bootstrap(legacyWorkspace) {
    if (!this.isEmpty()) return this.loadWorkspace();
    const transaction = this.db.transaction(() => {
      for (const type of ENTITY_TYPES) {
        const records = legacyWorkspace?.[`${type}s`] || [];
        for (const record of records) this.insertImported(type, record, "legacy");
      }
    });
    transaction();
    return this.loadWorkspace();
  }

  insertImported(type, input, fallbackSource = "imported") {
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
    for (const type of ENTITY_TYPES) {
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

  applySnapshot(snapshot, decisions = {}) {
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
          this.insertImported(change.type, { ...change.incoming, source: "snapshot" }, "snapshot");
        }
        applied.push({ key: change.key, action });
      }
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
}

export const workspaceEntityTypes = ENTITY_TYPES;
export const workspaceSchemaVersion = SCHEMA_VERSION;
