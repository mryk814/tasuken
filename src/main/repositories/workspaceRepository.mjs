import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertEntityType,
  assertItemParentAcyclic,
  hasPath,
  isKnowledgeDirectionalRelationType,
  normalizeEntity,
  validateEntity,
  workspaceEntityTypes,
} from "./domain.mjs";

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectionKey(type) {
  if (type === "task_dependency") return "task_dependencies";
  if (type === "plan_dependency") return "plan_dependencies";
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
  }

  validateGraph(type, entity) {
    if (type === "item") this.validateItemParentGraph(entity);
    if (type === "task" && entity.parent_task_id) this.validateTaskParentGraph(entity);
    if (type === "plan_node" && entity.parent_plan_node_id) this.validatePlanNodeParentGraph(entity);
    if (type === "task_dependency") this.validateTaskDependencyGraph(entity);
    if (type === "plan_dependency") this.validatePlanDependencyGraph(entity);
    if (type === "knowledge_edge") this.validateKnowledgeEdgeGraph(entity);
  }

  validateItemParentGraph(entity) {
    assertItemParentAcyclic(this.list("item"), entity);
  }

  validateTaskParentGraph(entity) {
    const tasks = this.list("task");
    const byId = new Map(tasks.filter((t) => !t.deleted_at).map((t) => [String(t.id), t]));
    byId.set(String(entity.id), entity);
    const seen = new Set([String(entity.id)]);
    let currentId = String(entity.parent_task_id || "");
    while (currentId) {
      if (seen.has(currentId)) throw new Error("Taskの親子関係が循環しています。別の親Taskを選んでください。");
      seen.add(currentId);
      currentId = String(byId.get(currentId)?.parent_task_id || "");
    }
  }

  validatePlanNodeParentGraph(entity) {
    const nodes = this.list("plan_node");
    const byId = new Map(nodes.filter((n) => !n.deleted_at).map((n) => [String(n.id), n]));
    byId.set(String(entity.id), entity);
    const seen = new Set([String(entity.id)]);
    let currentId = String(entity.parent_plan_node_id || "");
    while (currentId) {
      if (seen.has(currentId)) throw new Error("PlanNodeの親子関係が循環しています。別の親PlanNodeを選んでください。");
      seen.add(currentId);
      currentId = String(byId.get(currentId)?.parent_plan_node_id || "");
    }
  }

  validateTaskDependencyGraph(entity) {
    if (!entity.task_id || !entity.depends_on_task_id) return;
    const deps = this.list("task_dependency")
      .filter((d) => !d.deleted_at && String(d.id) !== String(entity.id))
      .map((d) => [String(d.task_id), String(d.depends_on_task_id)]);
    deps.push([String(entity.task_id), String(entity.depends_on_task_id)]);
    if (hasPath(deps, String(entity.depends_on_task_id), String(entity.task_id))) {
      throw new Error("TaskDependencyが循環します。依存関係の向きを見直してください。");
    }
  }

  validatePlanDependencyGraph(entity) {
    if (!entity.plan_node_id || !entity.depends_on_plan_node_id) return;
    const deps = this.list("plan_dependency")
      .filter((d) => !d.deleted_at && String(d.id) !== String(entity.id))
      .map((d) => [String(d.plan_node_id), String(d.depends_on_plan_node_id)]);
    deps.push([String(entity.plan_node_id), String(entity.depends_on_plan_node_id)]);
    if (hasPath(deps, String(entity.depends_on_plan_node_id), String(entity.plan_node_id))) {
      throw new Error("PlanDependencyが循環します。依存関係の向きを見直してください。");
    }
  }

  validateKnowledgeEdgeGraph(entity) {
    if (!entity.source_node_id || !entity.target_node_id) return;
    if (!isKnowledgeDirectionalRelationType(entity.relation_type)) return;
    const edges = this.list("knowledge_edge")
      .filter((edge) => !edge.deleted_at && String(edge.id) !== String(entity.id) && isKnowledgeDirectionalRelationType(edge.relation_type))
      .map((edge) => [String(edge.source_node_id), String(edge.target_node_id)]);
    edges.push([String(entity.source_node_id), String(entity.target_node_id)]);
    if (hasPath(edges, String(entity.target_node_id), String(entity.source_node_id))) {
      throw new Error("KnowledgeEdgeが循環します。relationの向きを見直してください。");
    }
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
        ["knowledge_node", "theme_id"],
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
        ["knowledge_node", "source_item_id"],
        ["log_entry", "item_id"],
      ], id);
    }

    if (type === "note") {
      this.nullifyReferences(type, [["link", "note_id"], ["knowledge_node", "source_note_id"], ["log_entry", "related_note_id"]], id);
    }

    if (type === "link") {
      this.nullifyReferences(type, [["knowledge_node", "source_link_id"]], id);
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

    if (type === "knowledge_node") {
      this.cascadeWhere(
        "knowledge_edge",
        (entry) => entry.source_node_id === id || entry.target_node_id === id,
        type,
        id,
      );
    }

    if (["theme", "item", "note", "link", "source_record", "knowledge_node"].includes(type)) {
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
    this.validateSnapshotWorkspace(snapshot);
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
}

export { workspaceEntityTypes };
export const workspaceSchemaVersion = SCHEMA_VERSION;
