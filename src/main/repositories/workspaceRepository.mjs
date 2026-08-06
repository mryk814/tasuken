import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  artifactSourceEntityTypes,
  assertEntityType,
  assertItemParentAcyclic,
  hasPath,
  isKnowledgeDirectionalRelationType,
  normalizeEntity,
  validateEntity,
  workspaceEntityTypes,
} from "./domain.mjs";
import { applyRepositoryDeletePolicy } from "./repositoryDeletePolicy.mjs";
import { isThemeDeletable, planPersonalDefaultTheme } from "../../shared/personalTheme.mjs";
import { validateRepositoryGraph } from "./repositoryGraphPolicy.mjs";

const SCHEMA_VERSION = 2;

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectionKey(type) {
  if (type === "task_dependency") return "task_dependencies";
  if (type === "plan_dependency") return "plan_dependencies";
  if (type === "sketch") return "sketches";
  return `${type}s`;
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
      {
        version: 2,
        up: () => this.db.exec(`
          CREATE TABLE IF NOT EXISTS sync_entity_heads (
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            revision_id TEXT NOT NULL,
            PRIMARY KEY (entity_type, entity_id)
          );

          CREATE TABLE IF NOT EXISTS sync_outbox (
            change_id TEXT PRIMARY KEY,
            device_sequence INTEGER NOT NULL UNIQUE,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            published_at TEXT
          );

          CREATE TABLE IF NOT EXISTS sync_device_cursors (
            device_id TEXT PRIMARY KEY,
            last_sequence INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS sync_conflicts (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            local_revision_id TEXT NOT NULL,
            incoming_revision_id TEXT NOT NULL,
            packet_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(entity_type, entity_id)
          );
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
      activeGroups: this.getPreference("activeGroups"),
      activeGroup: this.getPreference("activeGroup"),
      entityCount: this.db.prepare("SELECT COUNT(*) AS count FROM entities WHERE deleted_at IS NULL").get().count,
      syncPendingCount: this.syncPendingCount(),
      syncConflictCount: this.syncConflictCount(),
    };
  }

  getPreference(key) {
    if (key === "themeMode") return this.ensureMeta("theme_mode", "light");
    if (key === "activeGroups") {
      const value = this.ensureMeta("active_groups", "[]");
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
      } catch {
        return [];
      }
    }
    if (key === "activeGroup") return this.ensureMeta("active_group", "");
    if (key === "activityLogDirectory") return this.ensureMeta("activity_log_directory", "");
    if (key === "activityLogAutoExportTime") return this.ensureMeta("activity_log_auto_export_time", "");
    if (key === "activityLogLastAutoExportDate") return this.ensureMeta("activity_log_last_auto_export_date", "");
    if (key === "artifactDirectory") return this.ensureMeta("artifact_directory", "");
    if (key === "sharedSyncDirectory") return this.ensureMeta("shared_sync_directory", "");
    if (key === "sharedSyncEnabled") return this.ensureMeta("shared_sync_enabled", "false") === "true";
    if (key === "sharedSyncLastAt") return this.ensureMeta("shared_sync_last_at", "");
    if (key === "sharedSyncLastError") return this.ensureMeta("shared_sync_last_error", "");
    throw new Error(`未対応の設定です: ${key}`);
  }

  setPreference(key, value) {
    if (key === "themeMode") {
      if (!["light", "dark"].includes(value)) throw new Error("カラーモードの値が不正です。");
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('theme_mode', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(value);
      return value;
    }
    if (key === "activeGroups") {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new Error("表示グループの値が不正です。");
      }
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('active_groups', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify(value));
      return value;
    }
    if (key === "activityLogDirectory") {
      const directory = typeof value === "string" ? value : "";
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('activity_log_directory', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(directory);
      return directory;
    }
    if (key === "activityLogAutoExportTime") {
      const time = typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('activity_log_auto_export_time', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(time);
      return time;
    }
    if (key === "activityLogLastAutoExportDate") {
      const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('activity_log_last_auto_export_date', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(date);
      return date;
    }
    if (key === "artifactDirectory") {
      const directory = typeof value === "string" ? value : "";
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('artifact_directory', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(directory);
      return directory;
    }
    if (key === "sharedSyncDirectory") {
      const directory = typeof value === "string" ? value : "";
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('shared_sync_directory', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(directory);
      return directory;
    }
    if (key === "sharedSyncEnabled") {
      const enabled = Boolean(value);
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('shared_sync_enabled', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(enabled ? "true" : "false");
      return enabled;
    }
    if (key === "sharedSyncLastAt" || key === "sharedSyncLastError") {
      const metaKey = key === "sharedSyncLastAt" ? "shared_sync_last_at" : "shared_sync_last_error";
      const text = typeof value === "string" ? value : "";
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES(?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(metaKey, text);
      return text;
    }
    if (key !== "activeGroup") throw new Error(`未対応の設定です: ${key}`);
    this.db.prepare(`
      INSERT INTO workspace_meta(key, value) VALUES('active_group', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(value || ""));
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

  /**
   * 常設の既定Theme「個人業務」を1件だけ用意する（#282）。
   * 起動のたびに呼ばれるので、存在すれば何もしない。既存データは書き換えない。
   */
  ensurePersonalDefaultTheme() {
    const plan = planPersonalDefaultTheme(this.list("theme"), now());
    if (!plan.create) return null;
    return this.save("theme", plan.create, { source: "system" });
  }

  loadWorkspace(includeDeleted = false) {
    this.ensurePersonalDefaultTheme();
    const result = {};
    for (const type of workspaceEntityTypes) result[collectionKey(type)] = this.list(type, includeDeleted);
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
    this.validateGraph(type, entity);

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
    const saved = this.get(type, id);
    if (!options.skipSync) this.enqueueSyncEntity(type, saved, options.syncParents);
    return saved;
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
    requireReference("source_record", entity.source_record_id, "source_record_id");
    requireReference("item", entity.parent_item_id, "parent_item_id");
    requireReference("field_definition", entity.field_definition_id, "field_definition_id");
    requireReference("note", entity.source_note_id, "source_note_id");
    requireReference("link", entity.source_link_id, "source_link_id");
    requireReference("item", entity.source_item_id, "source_item_id");

    if (type === "field_value" || type === "entity_source") {
      requireReference(entity.entity_type, entity.entity_id, "entity_id");
    }
    if (type === "entity_source") {
      requireReference("source_record", entity.source_record_id, "source_record_id");
    }

    // v2 domain references
    const requireV2 = (targetType, id, field) => {
      if (!id) return;
      // project_id は project と旧 theme の両方を許容する（移行期間中）
      if (field === "project_id" && (this.get("project", id) || this.get("theme", id))) return;
      if (field !== "project_id" && this.get(targetType, id)) return;
      throw new Error(`${type}.${field}が存在しない${targetType}を参照しています。`);
    };

    if (type === "task") {
      requireV2("project", entity.project_id, "project_id");
      requireV2("plan_node", entity.plan_node_id, "plan_node_id");
      requireV2("task", entity.parent_task_id, "parent_task_id");
    }
    if (type === "waiting") {
      requireV2("project", entity.project_id, "project_id");
      requireV2("task", entity.task_id, "task_id");
    }
    if (type === "plan_node") {
      requireV2("project", entity.project_id, "project_id");
      requireV2("plan_node", entity.parent_plan_node_id, "parent_plan_node_id");
    }
    if (type === "schedule") {
      const ownerType = entity.owner_type;
      if (ownerType && entity.owner_id) {
        requireV2(ownerType, entity.owner_id, "owner_id");
      }
    }
    if (type === "resource") {
      requireV2("project", entity.project_id, "project_id");
    }
    if (type === "reference") {
      requireV2(entity.source_type, entity.source_id, "source_id");
      requireV2(entity.target_type, entity.target_id, "target_id");
    }
    if (type === "task_dependency") {
      requireV2("task", entity.task_id, "task_id");
      requireV2("task", entity.depends_on_task_id, "depends_on_task_id");
    }
    if (type === "plan_dependency") {
      requireV2("plan_node", entity.plan_node_id, "plan_node_id");
      requireV2("plan_node", entity.depends_on_plan_node_id, "depends_on_plan_node_id");
    }
    if (type === "knowledge_edge") {
      requireV2("knowledge_node", entity.source_node_id, "source_node_id");
      requireV2("knowledge_node", entity.target_node_id, "target_node_id");
    }
    if (type === "capture_entry" && entity.triaged_to_type && entity.triaged_to_id) {
      requireV2(entity.triaged_to_type, entity.triaged_to_id, "triaged_to_id");
    }
    if (type === "artifact") {
      const sourceEntityType = artifactSourceEntityTypes[entity.source_type];
      requireV2(sourceEntityType, entity.source_id, "source_id");
      requireV2("note", entity.origin_note_id, "origin_note_id");
    }
  }

  validateGraph(type, entity) {
    validateRepositoryGraph(this, type, entity);
  }

  validateSnapshotWorkspace(snapshot) {
    if (!isPlainObject(snapshot)) throw new Error("Snapshotのworkspace構造が不正です。");
    const activeIds = new Map();
    for (const type of workspaceEntityTypes) {
      const records = snapshot[collectionKey(type)] || [];
      if (!Array.isArray(records)) throw new Error(`${collectionKey(type)}は配列で指定してください。`);
      const ids = new Set();
      for (const record of records) {
        if (!isPlainObject(record)) throw new Error(`${type}のレコード構造が不正です。`);
        if (typeof record.id !== "string" || !record.id.trim()) throw new Error(`${type}.idがありません。`);
        validateEntity(type, record);
        if (!record.deleted_at) ids.add(String(record.id));
      }
      activeIds.set(type, ids);
    }

    const requireSnapshotReference = (type, record, targetType, id, field) => {
      if (!id || record.deleted_at) return;
      if (!activeIds.get(targetType)?.has(String(id))) {
        throw new Error(`${type}.${field}がSnapshot内に存在しない${targetType}を参照しています。`);
      }
    };

    for (const type of workspaceEntityTypes) {
      for (const record of snapshot[collectionKey(type)] || []) {
        requireSnapshotReference(type, record, "theme", record.theme_id, "theme_id");
        requireSnapshotReference(type, record, "item", record.item_id, "item_id");
        requireSnapshotReference(type, record, "note", record.note_id, "note_id");
        requireSnapshotReference(type, record, "source_record", record.source_record_id, "source_record_id");
        requireSnapshotReference(type, record, "item", record.parent_item_id, "parent_item_id");
        requireSnapshotReference(type, record, "field_definition", record.field_definition_id, "field_definition_id");
        requireSnapshotReference(type, record, "note", record.source_note_id, "source_note_id");
        requireSnapshotReference(type, record, "link", record.source_link_id, "source_link_id");
        requireSnapshotReference(type, record, "item", record.source_item_id, "source_item_id");
        if (type === "field_value" || type === "entity_source") {
          if (!workspaceEntityTypes.includes(record.entity_type)) throw new Error(`${type}.entity_typeが不正です。`);
          requireSnapshotReference(type, record, record.entity_type, record.entity_id, "entity_id");
        }

        // v2 domain references
        const requireV2Ref = (targetType, id, field) => {
          if (!id || record.deleted_at) return;
          if (field === "project_id" && (activeIds.get("project")?.has(String(id)) || activeIds.get("theme")?.has(String(id)))) return;
          if (field !== "project_id" && activeIds.get(targetType)?.has(String(id))) return;
          throw new Error(`${type}.${field}がSnapshot内に存在しない${targetType}を参照しています。`);
        };
        if (type === "task") {
          requireV2Ref("project", record.project_id, "project_id");
          requireV2Ref("plan_node", record.plan_node_id, "plan_node_id");
          requireV2Ref("task", record.parent_task_id, "parent_task_id");
        }
        if (type === "waiting") {
          requireV2Ref("project", record.project_id, "project_id");
          requireV2Ref("task", record.task_id, "task_id");
        }
        if (type === "plan_node") {
          requireV2Ref("project", record.project_id, "project_id");
          requireV2Ref("plan_node", record.parent_plan_node_id, "parent_plan_node_id");
        }
        if (type === "schedule" && record.owner_type && record.owner_id) {
          requireV2Ref(record.owner_type, record.owner_id, "owner_id");
        }
        if (type === "resource") {
          requireV2Ref("project", record.project_id, "project_id");
        }
        if (type === "reference") {
          requireV2Ref(record.source_type, record.source_id, "source_id");
          requireV2Ref(record.target_type, record.target_id, "target_id");
        }
        if (type === "task_dependency") {
          requireV2Ref("task", record.task_id, "task_id");
          requireV2Ref("task", record.depends_on_task_id, "depends_on_task_id");
        }
        if (type === "plan_dependency") {
          requireV2Ref("plan_node", record.plan_node_id, "plan_node_id");
          requireV2Ref("plan_node", record.depends_on_plan_node_id, "depends_on_plan_node_id");
        }
        if (type === "knowledge_edge") {
          requireV2Ref("knowledge_node", record.source_node_id, "source_node_id");
          requireV2Ref("knowledge_node", record.target_node_id, "target_node_id");
        }
        if (type === "capture_entry" && record.triaged_to_type && record.triaged_to_id) {
          requireV2Ref(record.triaged_to_type, record.triaged_to_id, "triaged_to_id");
        }
        if (type === "artifact") {
          requireV2Ref(artifactSourceEntityTypes[record.source_type], record.source_id, "source_id");
          requireV2Ref("note", record.origin_note_id, "origin_note_id");
        }
      }
    }

    this.validateSnapshotItemParentGraph(snapshot.items || []);
    this.validateSnapshotTaskParentGraph(snapshot.tasks || []);
    this.validateSnapshotPlanNodeParentGraph(snapshot.plan_nodes || []);
    this.validateSnapshotTaskDependencyGraph(snapshot.task_dependencies || []);
    this.validateSnapshotPlanDependencyGraph(snapshot.plan_dependencies || []);
    this.validateSnapshotKnowledgeEdgeGraph(snapshot.knowledge_edges || []);
  }

  validateSnapshotItemParentGraph(items) {
    for (const item of items.filter((entry) => !entry.deleted_at)) {
      assertItemParentAcyclic(items, item, "Snapshot内のItem親子関係が循環しています。Import前に親Itemを修正してください。");
    }
  }

  validateSnapshotTaskParentGraph(tasks) {
    const active = tasks.filter((t) => !t.deleted_at);
    for (const task of active) {
      if (!task.parent_task_id) continue;
      const byId = new Map(active.map((t) => [String(t.id), t]));
      const seen = new Set([String(task.id)]);
      let currentId = String(task.parent_task_id);
      while (currentId) {
        if (seen.has(currentId)) throw new Error("Snapshot内のTask親子関係が循環しています。Import前に親Taskを修正してください。");
        seen.add(currentId);
        currentId = String(byId.get(currentId)?.parent_task_id || "");
      }
    }
  }

  validateSnapshotPlanNodeParentGraph(nodes) {
    const active = nodes.filter((n) => !n.deleted_at);
    for (const node of active) {
      if (!node.parent_plan_node_id) continue;
      const byId = new Map(active.map((n) => [String(n.id), n]));
      const seen = new Set([String(node.id)]);
      let currentId = String(node.parent_plan_node_id);
      while (currentId) {
        if (seen.has(currentId)) throw new Error("Snapshot内のPlanNode親子関係が循環しています。Import前に親PlanNodeを修正してください。");
        seen.add(currentId);
        currentId = String(byId.get(currentId)?.parent_plan_node_id || "");
      }
    }
  }

  validateSnapshotTaskDependencyGraph(deps) {
    for (const dep of deps.filter((d) => !d.deleted_at)) {
      if (!dep.task_id || !dep.depends_on_task_id) continue;
      const edges = deps
        .filter((d) => !d.deleted_at && String(d.id) !== String(dep.id))
        .map((d) => [String(d.task_id), String(d.depends_on_task_id)]);
      edges.push([String(dep.task_id), String(dep.depends_on_task_id)]);
      if (hasPath(edges, String(dep.depends_on_task_id), String(dep.task_id))) {
        throw new Error("Snapshot内のTaskDependencyが循環しています。Import前に依存関係を修正してください。");
      }
    }
  }

  validateSnapshotPlanDependencyGraph(deps) {
    for (const dep of deps.filter((d) => !d.deleted_at)) {
      if (!dep.plan_node_id || !dep.depends_on_plan_node_id) continue;
      const edges = deps
        .filter((d) => !d.deleted_at && String(d.id) !== String(dep.id))
        .map((d) => [String(d.plan_node_id), String(d.depends_on_plan_node_id)]);
      edges.push([String(dep.plan_node_id), String(dep.depends_on_plan_node_id)]);
      if (hasPath(edges, String(dep.depends_on_plan_node_id), String(dep.plan_node_id))) {
        throw new Error("Snapshot内のPlanDependencyが循環しています。Import前に依存関係を修正してください。");
      }
    }
  }

  validateSnapshotKnowledgeEdgeGraph(edges) {
    for (const edge of edges.filter((entry) => !entry.deleted_at && isKnowledgeDirectionalRelationType(entry.relation_type))) {
      if (!edge.source_node_id || !edge.target_node_id) continue;
      const graph = edges
        .filter((entry) => !entry.deleted_at && String(entry.id) !== String(edge.id) && isKnowledgeDirectionalRelationType(entry.relation_type))
        .map((entry) => [String(entry.source_node_id), String(entry.target_node_id)]);
      graph.push([String(edge.source_node_id), String(edge.target_node_id)]);
      if (hasPath(graph, String(edge.target_node_id), String(edge.source_node_id))) {
        throw new Error("Snapshot内のKnowledgeEdgeが循環しています。Import前にrelationの向きを修正してください。");
      }
    }
  }

  recordPlanRevision(oldItem, newItem, reason = "") {
    const fields = [
      "planned_start",
      "planned_end",
      "due_date",
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
      // 常設の既定Themeは削除させない。消えるとTheme未設定の解決先が失われる（#282）。
      if (type === "theme" && !isThemeDeletable(existing)) {
        throw new Error("既定Theme「個人業務」は削除できません。");
      }
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
      const restored = this.get(type, id);
      this.enqueueSyncEntity(type, restored);
      return restored;
    });
    return transaction();
  }

  applyDeletePolicy(type, id) {
    applyRepositoryDeletePolicy(this, type, id);
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
    this.enqueueSyncEntity(type, this.get(type, id, true));
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
        this.enqueueSyncEntity(entityType, this.get(entityType, entity.id, true));
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
        const records = legacyWorkspace?.[collectionKey(type)] || [];
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
    this.validateSnapshotWorkspace(snapshot);
    const changes = [];
    for (const type of workspaceEntityTypes) {
      for (const incoming of snapshot?.[collectionKey(type)] || []) {
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
          actions: category === "new" ? ["create", "ignore"] : ["update", "duplicate", "ignore"],
        });
      }
    }
    return changes;
  }

  applySnapshot(snapshot, decisions = {}, revisions = []) {
    this.validateSnapshotWorkspace(snapshot);
    const preview = this.previewSnapshot(snapshot);
    const applied = [];
    const transaction = this.db.transaction(() => {
      for (const change of preview) {
        const action = decisions[change.key] || change.action;
        if (!["create", "update", "ignore", "duplicate"].includes(action)) {
          throw new Error("Snapshotの取り込み操作が不正です。プレビューからやり直してください。");
        }
        if (action === "ignore") continue;
        if (action === "create" && change.local) {
          throw new Error("既存データがあるため、Snapshotのcreateでは上書きできません。updateまたはduplicateを選んでください。");
        }
        if (action === "update" && !change.local) {
          throw new Error("既存データがないため、Snapshotのupdateは実行できません。createを選んでください。");
        }
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

  nextSyncSequence() {
    const current = Number(this.ensureMeta("sync_device_sequence", "0")) || 0;
    const next = current + 1;
    this.db.prepare(`
      INSERT INTO workspace_meta(key, value) VALUES('sync_device_sequence', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(next));
    return next;
  }

  syncHead(type, id) {
    return this.db.prepare(
      "SELECT revision_id FROM sync_entity_heads WHERE entity_type = ? AND entity_id = ?",
    ).get(type, String(id))?.revision_id || "";
  }

  setSyncHead(type, id, revisionId) {
    this.db.prepare(`
      INSERT INTO sync_entity_heads(entity_type, entity_id, revision_id) VALUES(?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET revision_id = excluded.revision_id
    `).run(type, String(id), revisionId);
  }

  enqueueSyncEntity(type, entity, parentRevisionIds) {
    if (!entity) return null;
    const changeId = uuid();
    const sequence = this.nextSyncSequence();
    const currentHead = this.syncHead(type, entity.id);
    const parents = Array.isArray(parentRevisionIds)
      ? [...new Set(parentRevisionIds.filter((entry) => typeof entry === "string" && entry))]
      : currentHead ? [currentHead] : [];
    const timestamp = now();
    const packet = {
      format: "tasken-sync-change",
      formatVersion: 1,
      workspaceId: this.workspaceId,
      changeId,
      revisionId: changeId,
      parentRevisionIds: parents,
      deviceId: this.deviceId,
      deviceSequence: sequence,
      entityType: type,
      entityId: entity.id,
      entity,
      createdAt: timestamp,
    };
    this.db.prepare(`
      INSERT INTO sync_outbox(change_id, device_sequence, payload_json, created_at)
      VALUES(?, ?, ?, ?)
    `).run(changeId, sequence, JSON.stringify(packet), timestamp);
    this.setSyncHead(type, entity.id, changeId);
    return packet;
  }

  ensureSyncBaseline() {
    const transaction = this.db.transaction(() => {
      let count = 0;
      for (const type of workspaceEntityTypes) {
        for (const entity of this.list(type, true)) {
          if (this.syncHead(type, entity.id)) continue;
          this.enqueueSyncEntity(type, entity, []);
          count += 1;
        }
      }
      return count;
    });
    return transaction();
  }

  pendingSyncChanges() {
    return this.db.prepare(`
      SELECT change_id, device_sequence, payload_json
      FROM sync_outbox
      WHERE published_at IS NULL
      ORDER BY device_sequence
    `).all().map((row) => ({
      changeId: row.change_id,
      deviceSequence: row.device_sequence,
      packet: JSON.parse(row.payload_json),
    }));
  }

  markSyncPublished(changeId) {
    this.db.prepare("UPDATE sync_outbox SET published_at = ? WHERE change_id = ?")
      .run(now(), changeId);
  }

  syncPendingCount() {
    return Number(this.db.prepare(
      "SELECT COUNT(*) AS count FROM sync_outbox WHERE published_at IS NULL",
    ).get()?.count || 0);
  }

  syncConflictCount() {
    return Number(this.db.prepare("SELECT COUNT(*) AS count FROM sync_conflicts").get()?.count || 0);
  }

  syncCursor(deviceId) {
    return Number(this.db.prepare(
      "SELECT last_sequence FROM sync_device_cursors WHERE device_id = ?",
    ).get(deviceId)?.last_sequence || 0);
  }

  setSyncCursor(deviceId, sequence) {
    this.db.prepare(`
      INSERT INTO sync_device_cursors(device_id, last_sequence, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        last_sequence = MAX(sync_device_cursors.last_sequence, excluded.last_sequence),
        updated_at = excluded.updated_at
    `).run(deviceId, Number(sequence) || 0, now());
  }

  adoptSyncWorkspace(workspaceId) {
    if (!this.isEmpty()) {
      throw new Error("この端末には既存データがあります。空のTaskenから同期フォルダへ参加してください。");
    }
    if (typeof workspaceId !== "string" || !workspaceId.trim()) {
      throw new Error("同期先のWorkspace IDが不正です。");
    }
    this.db.prepare(`
      INSERT INTO workspace_meta(key, value) VALUES('workspace_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(workspaceId);
    this.workspaceId = workspaceId;
    return workspaceId;
  }

  applySyncPacket(packet) {
    if (!isPlainObject(packet) || packet.format !== "tasken-sync-change" || packet.formatVersion !== 1) {
      throw new Error("同期差分の形式が不正です。");
    }
    if (packet.workspaceId !== this.workspaceId) throw new Error("別のWorkspaceの同期差分です。");
    assertEntityType(packet.entityType);
    if (!isPlainObject(packet.entity) || String(packet.entity.id || "") !== String(packet.entityId || "")) {
      throw new Error("同期差分のEntityが不正です。");
    }
    validateEntity(packet.entityType, packet.entity);
    const transaction = this.db.transaction(() => {
      const type = packet.entityType;
      const id = String(packet.entityId);
      const revisionId = String(packet.revisionId || packet.changeId || "");
      const incomingParents = Array.isArray(packet.parentRevisionIds)
        ? packet.parentRevisionIds.filter((entry) => typeof entry === "string")
        : [];
      const currentHead = this.syncHead(type, id);
      if (currentHead === revisionId) return { status: "duplicate", entity: this.get(type, id, true) };
      const local = this.get(type, id, true);
      const canApply = !local || !currentHead || incomingParents.includes(currentHead);
      if (canApply) {
        this.insertImported(type, packet.entity, "sync");
        this.setSyncHead(type, id, revisionId);
        this.db.prepare("DELETE FROM sync_conflicts WHERE entity_type = ? AND entity_id = ?").run(type, id);
        return { status: "applied", type, entity: this.get(type, id, true) };
      }

      const existingConflict = this.db.prepare(
        "SELECT * FROM sync_conflicts WHERE entity_type = ? AND entity_id = ?",
      ).get(type, id);
      const existingIncomingRevision = existingConflict?.incoming_revision_id || "";
      const shouldAdvanceIncoming = !existingConflict || incomingParents.includes(existingIncomingRevision);
      if (shouldAdvanceIncoming) {
        const conflictId = existingConflict?.id || uuid();
        const timestamp = now();
        this.db.prepare(`
          INSERT INTO sync_conflicts(
            id, entity_type, entity_id, local_revision_id, incoming_revision_id,
            packet_json, created_at, updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(entity_type, entity_id) DO UPDATE SET
            incoming_revision_id = excluded.incoming_revision_id,
            packet_json = excluded.packet_json,
            updated_at = excluded.updated_at
        `).run(
          conflictId,
          type,
          id,
          currentHead,
          revisionId,
          JSON.stringify(packet),
          existingConflict?.created_at || timestamp,
          timestamp,
        );
      }
      return { status: "conflict", type, entity: local };
    });
    return transaction();
  }

  listSyncConflicts() {
    return this.db.prepare("SELECT * FROM sync_conflicts ORDER BY updated_at DESC").all().map((row) => {
      const packet = JSON.parse(row.packet_json);
      return {
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        localRevisionId: row.local_revision_id,
        incomingRevisionId: row.incoming_revision_id,
        local: this.get(row.entity_type, row.entity_id, true),
        incoming: packet.entity,
        incomingDeviceId: packet.deviceId,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  resolveSyncConflict(conflictId, choice) {
    if (!["local", "incoming"].includes(choice)) throw new Error("競合の解決方法が不正です。");
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM sync_conflicts WHERE id = ?").get(conflictId);
      if (!row) throw new Error("解決対象の競合が見つかりません。");
      const packet = JSON.parse(row.packet_json);
      const local = this.get(row.entity_type, row.entity_id, true);
      const chosen = choice === "incoming" ? packet.entity : local;
      if (!chosen) throw new Error("競合を解決するデータがありません。");
      if (choice === "incoming") this.insertImported(row.entity_type, chosen, "sync");
      const parents = [row.local_revision_id, row.incoming_revision_id].filter(Boolean);
      const resolution = this.enqueueSyncEntity(row.entity_type, this.get(row.entity_type, row.entity_id, true), parents);
      this.db.prepare("DELETE FROM sync_conflicts WHERE id = ?").run(conflictId);
      return {
        type: row.entity_type,
        entity: this.get(row.entity_type, row.entity_id, true),
        revisionId: resolution.revisionId,
      };
    });
    return transaction();
  }
}

export { workspaceEntityTypes };
export const workspaceSchemaVersion = SCHEMA_VERSION;
