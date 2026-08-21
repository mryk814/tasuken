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
  normalizeTaskAssignment,
  validateEntity,
  workspaceEntityTypes,
} from "./domain.mjs";
import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../shared/aiMetadata.mjs";
import { DATA_HEALTH_STATE_SCHEMA, normalizeDataHealthState } from "../../shared/dataHealth.mjs";
import { applyRepositoryDeletePolicy } from "./repositoryDeletePolicy.mjs";
import { isThemeDeletable, planPersonalDefaultTheme } from "../../shared/personalTheme.mjs";
import { validateRepositoryGraph } from "./repositoryGraphPolicy.mjs";
import {
  collectionKeyForEntityType,
  legacyThemeFieldsForEntityType,
  themeFieldForEntityType,
} from "../../shared/entityRegistry.mjs";
import { buildActivityEvent, migrateChangeEvent, normalizeActivityEvent, activityEventDedupeKey } from "../../shared/activityEvent.mjs";
import { buildActivityRootRegistry, publicActivityRootStatus } from "../../shared/activityRootRegistry.mjs";
import { normalizeReferenceAssertion, referenceAssertionIdentity } from "../../shared/relationAssertion.mjs";

const SCHEMA_VERSION = 4;

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function parseRow(row) {
  if (!row) return null;
  const entity = {
    ...JSON.parse(row.data_json),
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    device_id: row.device_id,
    source: row.source,
    version: row.version,
  };
  return row.entity_type === "reference"
    ? normalizeReferenceAssertion(entity, { legacyRead: true })
    : entity;
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

function normalizeTaskenRootUsage(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 500).flatMap(([key, record]) => {
    if (!key || key.length > 240 || !isPlainObject(record)) return [];
    const count = Number(record.count);
    const lastUsedAt = typeof record.lastUsedAt === "string" ? record.lastUsedAt : "";
    if (!Number.isFinite(count) || count < 0 || !lastUsedAt || Number.isNaN(Date.parse(lastUsedAt))) return [];
    return [[key, { count: Math.min(1_000_000, Math.floor(count)), lastUsedAt }]];
  }));
}

function automaticSnapshotGenerations(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(20, Math.round(parsed)));
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
      {
        version: 3,
        up: () => {
          // Activity migration is intentionally idempotent. The old columns
          // remain in data_json so snapshots and older readers retain access
          // to the original record while structured fields become canonical.
          const rows = this.db.prepare(
            "SELECT * FROM entities WHERE entity_type = 'change_event'",
          ).all();
          const target = this.db.prepare(
            "SELECT * FROM entities WHERE entity_type = ? AND id = ?",
          );
          const update = this.db.prepare(
            "UPDATE entities SET data_json = ? WHERE entity_type = 'change_event' AND id = ?",
          );
          for (const row of rows) {
            const event = parseRow(row);
            const after = (() => {
              if (event.after_json && typeof event.after_json === "object") return event.after_json;
              try { return event.after_json ? JSON.parse(event.after_json) : null; } catch { return null; }
            })();
            const targetRow = after || target.get(event.entity_type, event.entity_id);
            // after_json is already a plain entity. Only SQLite rows need
            // parseRow; parsing the plain object used to throw during v3.
            const entity = after || (targetRow ? parseRow(targetRow) : null);
            const migrated = migrateChangeEvent(event, { entity });
            update.run(JSON.stringify(contentOf(migrated)), event.id);
          }
        },
      },
      {
        version: 4,
        up: () => this.db.exec(`
          CREATE TABLE IF NOT EXISTS transcription_operations (
            operation_id TEXT PRIMARY KEY,
            artifact_id TEXT NOT NULL,
            revision_id TEXT NOT NULL,
            attempt_key TEXT NOT NULL UNIQUE,
            preview_fingerprint TEXT NOT NULL,
            status TEXT NOT NULL,
            lease_token TEXT,
            lease_expires_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(artifact_id, revision_id)
          );

          CREATE INDEX IF NOT EXISTS idx_transcription_operations_artifact
            ON transcription_operations(artifact_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_transcription_operations_lease
            ON transcription_operations(status, lease_expires_at);
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

  getViewPreferences() {
    const raw = this.ensureMeta("view_preferences", JSON.stringify({ schemaVersion: 1, revision: 0, values: {} }));
    try {
      const parsed = JSON.parse(raw);
      const values = isPlainObject(parsed?.values) ? parsed.values : {};
      return {
        schemaVersion: 1,
        revision: Number.isFinite(Number(parsed?.revision)) ? Number(parsed.revision) : 0,
        values,
      };
    } catch {
      return { schemaVersion: 1, revision: 0, values: {} };
    }
  }

  setViewPreference(id, scopeKey, value, schemaVersion) {
    const current = this.getViewPreferences();
    const next = {
      schemaVersion: 1,
      revision: current.revision + 1,
      values: {
        ...current.values,
        [`${id}::${scopeKey || ""}`]: { schemaVersion: Number(schemaVersion) || 1, value },
      },
    };
    this.db.prepare(`
      INSERT INTO workspace_meta(key, value) VALUES('view_preferences', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(next));
    return {
      id,
      scopeKey: scopeKey || "",
      schemaVersion: Number(schemaVersion) || 1,
      value,
      revision: next.revision,
    };
  }

  getDataHealthState() {
    const raw = this.ensureMeta("data_health_issue_states", JSON.stringify({
      schema: DATA_HEALTH_STATE_SCHEMA,
      revision: 0,
      updatedAt: "",
      issues: {},
    }));
    try {
      return normalizeDataHealthState(JSON.parse(raw));
    } catch {
      return normalizeDataHealthState(null);
    }
  }

  setDataHealthState(expectedRevision, value) {
    const transaction = this.db.transaction(() => {
      const fallback = JSON.stringify({ schema: DATA_HEALTH_STATE_SCHEMA, revision: 0, updatedAt: "", issues: {} });
      this.db.prepare("INSERT INTO workspace_meta(key, value) VALUES('data_health_issue_states', ?) ON CONFLICT(key) DO NOTHING").run(fallback);
      const row = this.db.prepare("SELECT value FROM workspace_meta WHERE key = 'data_health_issue_states'").get();
      let parsed;
      try {
        parsed = normalizeDataHealthState(JSON.parse(row.value));
      } catch {
        parsed = normalizeDataHealthState(null);
      }
      if (parsed.revision !== expectedRevision) throw new Error("Data Health state revision conflict");
      const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const next = normalizeDataHealthState({
        schema: DATA_HEALTH_STATE_SCHEMA,
        revision: expectedRevision + 1,
        updatedAt: source.updatedAt,
        issues: source.issues,
      });
      const result = this.db.prepare("UPDATE workspace_meta SET value = ? WHERE key = 'data_health_issue_states' AND value = ?")
        .run(JSON.stringify(next), row.value);
      if (result.changes !== 1) throw new Error("Data Health state revision conflict");
      return next;
    });
    return transaction.immediate();
  }

  getMeta() {
    return {
      schemaVersion: SCHEMA_VERSION,
      workspaceId: this.workspaceId,
      deviceId: this.deviceId,
      themeMode: this.readPreference("themeMode"),
      activeGroups: this.readPreference("activeGroups"),
      activeGroup: this.readPreference("activeGroup"),
      aiVisibilityDefault: this.readPreference("aiVisibilityDefault"),
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
    if (key === "taskenRoot.globalShortcut") return this.ensureMeta("tasken_root_global_shortcut", "");
    if (key === "taskenRoot.usage.v1") {
      const raw = this.ensureMeta("tasken_root_usage_v1", "{}");
      try {
        return normalizeTaskenRootUsage(JSON.parse(raw));
      } catch {
        return {};
      }
    }
    if (key === "automaticSnapshotBackupEnabled") return this.ensureMeta("automatic_snapshot_backup_enabled", "true") === "true";
    if (key === "automaticSnapshotBackupDirectory") return this.ensureMeta("automatic_snapshot_backup_directory", "");
    if (key === "automaticSnapshotBackupGenerations") {
      return automaticSnapshotGenerations(this.ensureMeta("automatic_snapshot_backup_generations", "5"));
    }
    // AI公開範囲のworkspace既定（#294）。Entity・Themeが未設定のときだけ使う。
    if (key === "aiVisibilityDefault") {
      const raw = this.ensureMeta("ai_visibility_default", JSON.stringify(DEFAULT_AI_VISIBILITY));
      try {
        return normalizeAiVisibility(JSON.parse(raw)) || [];
      } catch {
        return [...DEFAULT_AI_VISIBILITY];
      }
    }
    throw new Error(`未対応の設定です: ${key}`);
  }

  /** Read a Core query preference without materializing its default in workspace_meta. */
  readPreference(key) {
    const readMeta = (metaKey) => this.db.prepare("SELECT value FROM workspace_meta WHERE key = ?").get(metaKey)?.value;
    if (key === "themeMode") return readMeta("theme_mode") ?? "light";
    if (key === "activeGroups") {
      const value = readMeta("active_groups");
      if (value === undefined) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
      } catch {
        return [];
      }
    }
    if (key === "activeGroup") return readMeta("active_group") ?? "";
    if (key === "artifactDirectory") return readMeta("artifact_directory") ?? "";
    if (key === "aiVisibilityDefault") {
      const value = readMeta("ai_visibility_default");
      if (value === undefined) return [...DEFAULT_AI_VISIBILITY];
      try {
        return normalizeAiVisibility(JSON.parse(value)) || [];
      } catch {
        return [...DEFAULT_AI_VISIBILITY];
      }
    }
    throw new Error(`未対応のread-only設定です: ${key}`);
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
    if (key === "taskenRoot.globalShortcut") {
      const shortcut = typeof value === "string" ? value.trim().slice(0, 160) : "";
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('tasken_root_global_shortcut', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(shortcut);
      return shortcut;
    }
    if (key === "taskenRoot.usage.v1") {
      const usage = normalizeTaskenRootUsage(value);
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('tasken_root_usage_v1', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify(usage));
      return usage;
    }
    if (key === "automaticSnapshotBackupEnabled") {
      const enabled = Boolean(value);
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('automatic_snapshot_backup_enabled', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(enabled ? "true" : "false");
      return enabled;
    }
    if (key === "automaticSnapshotBackupDirectory") {
      const directory = typeof value === "string" ? value.trim() : "";
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('automatic_snapshot_backup_directory', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(directory);
      return directory;
    }
    if (key === "automaticSnapshotBackupGenerations") {
      const generations = automaticSnapshotGenerations(value);
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('automatic_snapshot_backup_generations', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(generations));
      return generations;
    }
    if (key === "aiVisibilityDefault") {
      const audiences = normalizeAiVisibility(value) || [];
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('ai_visibility_default', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify(audiences));
      return audiences;
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
    return this.readWorkspaceSnapshot(includeDeleted);
  }

  /** Read the current persisted workspace without creating or updating records. */
  readWorkspaceSnapshot(includeDeleted = false) {
    const result = {};
    for (const type of workspaceEntityTypes) result[collectionKeyForEntityType(type)] = this.list(type, includeDeleted);
    result.plan_revisions = this.db.prepare(
      "SELECT * FROM plan_revisions ORDER BY changed_at DESC",
    ).all().map((row) => ({
      ...row,
      old: JSON.parse(row.old_json),
      next: JSON.parse(row.new_json),
    }));
    result.meta = this.getMeta();
    result.canonical_root_status = this.getActivityCanonicalRootStatus();
    return result;
  }

  getActivityCanonicalRootPaths() {
    return buildActivityRootRegistry({
      artifactDirectory: this.readPreference("artifactDirectory"),
      themes: this.list("theme", true),
    });
  }

  getActivityCanonicalRootStatus() {
    return publicActivityRootStatus(this.getActivityCanonicalRootPaths(), (root) => fs.existsSync(root));
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

  ensureMcpPackageSmokeFixture() {
    const themeId = "theme-mcp-package-smoke";
    const taskId = "task-mcp-package-smoke";
    if (!this.get("theme", themeId, true)) {
      this.save("theme", {
        id: themeId,
        name: "MCP Package Smoke",
        code: "MCPSMOKE",
        default_ai_visibility: ["coding_agent"],
      });
    }
    if (!this.get("task", taskId, true)) {
      this.save("task", {
        id: taskId,
        title: "Canonical packaged MCP task",
        description: "Read through packaged Desktop Core and bundled MCP.",
        state: "todo",
        priority: "high",
        project_id: themeId,
        ai_visibility: ["coding_agent"],
      });
    }
    return { themeId, taskId };
  }

  verifyMcpPackageSmokeProposal(proposalId) {
    const proposal = this.get("ai_proposal", proposalId, true);
    const matching = this.list("ai_proposal", true).filter((entry) => (
      entry.source_app === "package-smoke"
      && entry.request?.idempotency_key === "package-smoke-note-v1"
    ));
    const verified = proposal
      && proposal.status === "pending"
      && proposal.source === "mcp"
      && proposal.source_app === "package-smoke"
      && proposal.payload_type === "notes"
      && proposal.payload?.notes?.[0]?.title === "Packaged MCP Smoke Proposal"
      && proposal.payload?.notes?.[0]?.body === "Pending review from the packaged MCP smoke."
      && matching.length === 1;
    if (!verified) throw new Error("packaged Desktopのcanonical ai_proposalを検証できませんでした。");
    return { proposal_id: proposal.id, status: proposal.status, matching_count: matching.length };
  }

  saveMany(operations) {
    if (!Array.isArray(operations) || !operations.length) {
      throw new Error("保存するデータがありません。");
    }
    const transaction = this.db.transaction(() => {
      const beforeByKey = new Map();
      for (const operation of operations) {
        if (!operation || operation.action !== "save" || operation.type === "change_event") continue;
        const id = String(operation.entity?.id || "");
        if (!id) continue;
        beforeByKey.set(`${operation.type}:${id}`, this.get(operation.type, id, true));
      }
      return operations.map((operation) => {
      if (!operation || operation.action !== "save") {
        throw new Error("saveManyではaction=saveのみ利用できます。");
      }
      if (operation.type !== "change_event") {
        return this.saveWithinTransaction(operation.type, operation.entity, operation.options || {});
      }
      const raw = operation.entity || {};
      const type = String(raw.entity_ref?.type || raw.entity_type || "");
      const id = String(raw.entity_ref?.id || raw.entity_id || "");
      const before = beforeByKey.get(`${type}:${id}`) || null;
      const after = (() => {
        try { return raw.after_json ? JSON.parse(raw.after_json) : null; } catch { return null; }
      })();
      const event = buildActivityEvent({
        ...raw,
        before: raw.before_json ?? before,
        after: raw.after_json ?? after,
        before_json: raw.before_json ?? (before ? JSON.stringify(before) : null),
        after_json: raw.after_json ?? (after ? JSON.stringify(after) : null),
        // Direct renderer saves have no command identity, so their event kind
        // is recalculated with the pre-save record (create vs update).
        event_kind: raw.command_id || raw.command_name ? raw.event_kind : undefined,
      });
      return this.saveWithinTransaction("change_event", event, operation.options || {});
      });
    });
    return transaction();
  }

  /** Application Command専用。読み取りとsaveWithinTransactionを同じtransactionへ束ねる。 */
  runTransaction(callback) {
    const transaction = this.db.transaction(() => callback({
      list: (type, includeDeleted = false) => this.list(type, includeDeleted),
      get: (type, id, includeDeleted = false) => this.get(type, id, includeDeleted),
      save: (type, entity, options = {}) => this.saveWithinTransaction(type, entity, options),
      saveMany: (operations) => operations.map((operation) => {
        if (!operation || operation.action !== "save") throw new Error("Application Commandの保存内容が不正です。");
        return this.saveWithinTransaction(operation.type, operation.entity, operation.options || {});
      }),
      remove: (type, id) => this.removeWithinTransaction(type, id),
    }));
    return transaction();
  }

  saveWithinTransaction(type, input, options = {}) {
    assertEntityType(type);
    const id = String(input.id || uuid());
    const normalizedActivityInput = type === "change_event" ? normalizeActivityEvent(input) : input;
    const requestedDedupeKey = type === "change_event" ? activityEventDedupeKey(normalizedActivityInput) : "";
    const dedupedExisting = type === "change_event" && requestedDedupeKey
      ? this.list("change_event", true).find((candidate) => activityEventDedupeKey(candidate) === requestedDedupeKey)
      : null;
    const existing = dedupedExisting || this.get(type, id, true);
    if (type === "work_receipt" && existing) throw new Error("Work Receiptはappend-onlyです。既存Receiptを更新できません。");
    const persistedId = existing?.id || id;
    const canAggregateActivity = type === "change_event" && dedupedExisting
      && !normalizedActivityInput.command_id
      && !normalizedActivityInput.command_name
      && normalizedActivityInput.origin?.kind === "renderer_save";
    const activityInput = canAggregateActivity
      ? buildActivityEvent({
        ...normalizedActivityInput,
        id: persistedId,
        // A session event is an aggregate: keep the session-start before and
        // replace only its latest after/occurred_at fields.
        before_json: dedupedExisting.before_json !== undefined
          ? dedupedExisting.before_json
          : normalizedActivityInput.before_json,
        after_json: normalizedActivityInput.after_json,
      })
      : normalizedActivityInput;
    const requestedTimestamp = typeof options.__canonicalOperationAt === "string" && !Number.isNaN(Date.parse(options.__canonicalOperationAt))
      ? options.__canonicalOperationAt
      : "";
    const timestamp = requestedTimestamp || now();
    let protectedInput = activityInput;
    if (type === "resource" && options.__conversationContextPublicationWrite !== true) {
      protectedInput = { ...activityInput };
      if (existing && Object.prototype.hasOwnProperty.call(existing, "conversation_context_publication")) {
        protectedInput.conversation_context_publication = existing.conversation_context_publication;
      } else {
        delete protectedInput.conversation_context_publication;
      }
    }
    const normalizedInput = type === "task" ? normalizeTaskAssignment(protectedInput, existing) : protectedInput;
    const entity = normalizeEntity(type, {
      ...normalizedInput,
      id: persistedId,
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
      persistedId,
      JSON.stringify(contentOf(entity)),
      entity.created_at,
      entity.updated_at,
      entity.deleted_at,
      entity.device_id,
      entity.source,
      entity.version,
    );
    const saved = this.get(type, persistedId);
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

    // Theme参照の正本はRegistryのcanonical field。legacyThemeFieldsは
    // migration境界からまだ届くraw recordだけを検証し、独自type mappingは持たない。
    const themeField = themeFieldForEntityType(type);
    if (themeField === "project_id") {
      requireV2("project", entity[themeField], themeField);
    } else if (themeField) {
      requireReference("theme", entity[themeField], themeField);
    }
    for (const legacyField of legacyThemeFieldsForEntityType(type)) {
      if (legacyField !== themeField) requireReference("theme", entity[legacyField], legacyField);
    }

    if (type === "theme" || type === "project" || type === "task") {
      for (const contextId of entity.repository_context_ids || []) {
        requireReference("repository_context", contextId, "repository_context_ids");
      }
      requireReference("repository_context", entity.primary_repository_context_id, "primary_repository_context_id");
    }

    if (type === "task") {
      requireV2("plan_node", entity.plan_node_id, "plan_node_id");
      requireV2("task", entity.parent_task_id, "parent_task_id");
    }
    if (type === "work_receipt") requireV2("task", entity.task_id, "task_id");
    if (type === "waiting") {
      requireV2("task", entity.task_id, "task_id");
    }
    if (type === "plan_node") {
      requireV2("plan_node", entity.parent_plan_node_id, "parent_plan_node_id");
    }
    if (type === "schedule") {
      const ownerType = entity.owner_type;
      if (ownerType && entity.owner_id) {
        requireV2(ownerType, entity.owner_id, "owner_id");
      }
    }
    if (type === "reference") {
      const { subject, object } = referenceAssertionIdentity(entity);
      requireV2(subject.type, subject.id, "subject.id");
      requireV2(object.type, object.id, "object.id");
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
    const allIds = new Map();
    for (const type of workspaceEntityTypes) {
      const records = snapshot[collectionKeyForEntityType(type)] || [];
      if (!Array.isArray(records)) throw new Error(`${collectionKeyForEntityType(type)}は配列で指定してください。`);
      const ids = new Set();
      const everyId = new Set();
      for (const record of records) {
        if (!isPlainObject(record)) throw new Error(`${type}のレコード構造が不正です。`);
        if (typeof record.id !== "string" || !record.id.trim()) throw new Error(`${type}.idがありません。`);
        validateEntity(type, record);
        everyId.add(String(record.id));
        if (!record.deleted_at) ids.add(String(record.id));
      }
      activeIds.set(type, ids);
      allIds.set(type, everyId);
    }

    const requireSnapshotReference = (type, record, targetType, id, field) => {
      if (!id || record.deleted_at) return;
      if (!activeIds.get(targetType)?.has(String(id))) {
        throw new Error(`${type}.${field}がSnapshot内に存在しない${targetType}を参照しています。`);
      }
    };

    for (const type of workspaceEntityTypes) {
      for (const record of snapshot[collectionKeyForEntityType(type)] || []) {
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

        // Snapshotも同じRegistry契約を使う。canonical project_idと、
        // compatibility boundaryのlegacy theme_idを混同しない。
        const themeField = themeFieldForEntityType(type);
        if (themeField === "project_id") {
          requireV2Ref("project", record[themeField], themeField);
        } else if (themeField) {
          requireSnapshotReference(type, record, "theme", record[themeField], themeField);
        }
        for (const legacyField of legacyThemeFieldsForEntityType(type)) {
          if (legacyField !== themeField) {
            requireSnapshotReference(type, record, "theme", record[legacyField], legacyField);
          }
        }
        if (type === "theme" || type === "project" || type === "task") {
          for (const contextId of record.repository_context_ids || []) {
            requireSnapshotReference(type, record, "repository_context", contextId, "repository_context_ids");
          }
          requireSnapshotReference(type, record, "repository_context", record.primary_repository_context_id, "primary_repository_context_id");
          for (const marker of record.repository_context_detachments || []) {
            if (!allIds.get("repository_context")?.has(String(marker.contextId))) {
              throw new Error(`${type}.repository_context_detachmentsがSnapshot内に存在しないrepository_contextを記録しています。`);
            }
          }
        }
        if (type === "task") {
          requireV2Ref("plan_node", record.plan_node_id, "plan_node_id");
          requireV2Ref("task", record.parent_task_id, "parent_task_id");
        }
        if (type === "waiting") {
          requireV2Ref("task", record.task_id, "task_id");
        }
        if (type === "plan_node") {
          requireV2Ref("plan_node", record.parent_plan_node_id, "parent_plan_node_id");
        }
        if (type === "schedule" && record.owner_type && record.owner_id) {
          requireV2Ref(record.owner_type, record.owner_id, "owner_id");
        }
        if (type === "reference") {
          const { subject, object } = referenceAssertionIdentity(record);
          requireV2Ref(subject.type, subject.id, "subject.id");
          requireV2Ref(object.type, object.id, "object.id");
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
    const transaction = this.db.transaction(() => this.removeWithinTransaction(type, id));
    return transaction();
  }

  removeWithinTransaction(type, id) {
    assertEntityType(type);
    const existing = this.get(type, id);
    if (!existing) return null;
    // 常設の既定Themeは削除させない。消えるとTheme未設定の解決先が失われる（#282）。
    if (type === "theme" && !isThemeDeletable(existing)) {
      throw new Error("既定Theme「個人業務」は削除できません。");
    }
    this.applyDeletePolicy(type, String(id));
    this.markRemoved(type, String(id));
    return this.get(type, id, true);
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
      if (type === "repository_context") this.restoreRepositoryContextReferences(String(id));
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

  nullifyRepositoryContextReferences(removedId) {
    const contextId = String(removedId);
    for (const entityType of ["project", "theme", "task"]) {
      for (const entity of this.list(entityType)) {
        const previousContextIds = Array.isArray(entity.repository_context_ids)
          ? [...new Set(entity.repository_context_ids.map(String).filter(Boolean))]
          : [];
        const previousPrimaryContextId = entity.primary_repository_context_id
          ? String(entity.primary_repository_context_id)
          : null;
        const previousIndex = previousContextIds.indexOf(contextId);
        const wasPrimary = previousPrimaryContextId === contextId;
        if (previousIndex < 0 && !wasPrimary) continue;

        const detachments = Array.isArray(entity.repository_context_detachments)
          ? entity.repository_context_detachments
          : [];
        const marker = {
          kind: "repository_context_detachment",
          contextId,
          previousIndex: previousIndex < 0 ? null : previousIndex,
          wasPrimary,
        };
        this.saveWithinTransaction(entityType, {
          ...entity,
          repository_context_ids: previousContextIds.filter((id) => id !== contextId),
          primary_repository_context_id: wasPrimary ? null : previousPrimaryContextId,
          repository_context_detachments: [
            ...detachments.filter((entry) => String(entry?.contextId || "") !== contextId),
            marker,
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

  restoreRepositoryContextReferences(contextId) {
    for (const entityType of ["project", "theme", "task"]) {
      for (const entity of this.list(entityType)) {
        const detachments = Array.isArray(entity.repository_context_detachments)
          ? entity.repository_context_detachments
          : [];
        const matching = detachments.filter((entry) => (
          entry?.kind === "repository_context_detachment"
          && String(entry.contextId || "") === String(contextId)
        ));
        if (!matching.length) continue;

        let restoredIds = [...new Set((entity.repository_context_ids || []).map(String).filter(Boolean))];
        for (const entry of matching) {
          if (restoredIds.includes(String(entry.contextId))) continue;
          const index = Number.isInteger(entry.previousIndex)
            ? Math.max(0, Math.min(entry.previousIndex, restoredIds.length))
            : restoredIds.length;
          restoredIds.splice(index, 0, String(entry.contextId));
        }
        const restoredPrimary = entity.primary_repository_context_id
          || (matching.some((entry) => entry.wasPrimary) ? String(contextId) : null);
        const remaining = detachments.filter((entry) => !matching.includes(entry));
        const next = {
          ...entity,
          repository_context_ids: restoredIds,
          primary_repository_context_id: restoredPrimary,
        };
        if (remaining.length) next.repository_context_detachments = remaining;
        else delete next.repository_context_detachments;
        this.saveWithinTransaction(entityType, next);
      }
    }
  }

  bootstrap(legacyWorkspace) {
    if (!this.isEmpty()) return this.loadWorkspace();
    const transaction = this.db.transaction(() => {
      for (const type of workspaceEntityTypes) {
        const records = legacyWorkspace?.[collectionKeyForEntityType(type)] || [];
        for (const record of records) this.insertImported(type, record, "legacy");
      }
    });
    transaction();
    return this.loadWorkspace();
  }

  insertImported(type, input, fallbackSource = "imported", previous = null) {
    assertEntityType(type);
    const normalizedInput = type === "task" ? normalizeTaskAssignment(input, previous) : input;
    if (type === "work_receipt" && normalizedInput.id && this.get(type, normalizedInput.id, true)) {
      throw new Error("Work Receiptはappend-onlyです。既存Receiptを取り込みで更新できません。");
    }
    validateEntity(type, normalizedInput);
    const timestamp = now();
    const entity = {
      ...normalizedInput,
      id: String(normalizedInput.id || uuid()),
      created_at: normalizedInput.created_at || timestamp,
      updated_at: normalizedInput.updated_at || timestamp,
      deleted_at: normalizedInput.deleted_at || null,
      device_id: normalizedInput.device_id || this.deviceId,
      source: normalizedInput.source || fallbackSource,
      version: Number(normalizedInput.version) || 1,
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
      for (const incoming of snapshot?.[collectionKeyForEntityType(type)] || []) {
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
          this.insertImported(change.type, change.incoming, "snapshot", change.local);
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
        this.insertImported(type, packet.entity, "sync", local);
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
      if (choice === "incoming") this.insertImported(row.entity_type, chosen, "sync", local);
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
