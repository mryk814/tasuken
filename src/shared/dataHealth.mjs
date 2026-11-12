import { collectionKeyForEntityType, entityDefinitions } from "./entityRegistry.mjs";
import { resolveStableLinks } from "./stableLinks.mjs";
import { canonicalMarkdownBindingFromProperties } from "./canonicalMarkdown.mjs";

export const DATA_HEALTH_SCHEMA = "tasken-data-health/v1";
export const DATA_HEALTH_STATE_SCHEMA = "tasken-data-health-state/v1";

export const DATA_HEALTH_RULES = Object.freeze([
  {
    id: "missing_provenance",
    label: "出典がありません",
    severity: "warning",
    fixActions: ["source_entity"],
  },
  {
    id: "stale_context",
    label: "情報が stale です",
    severity: "warning",
    fixActions: ["source_entity"],
  },
  {
    id: "superseded_context",
    label: "後継情報へ置き換えられています",
    severity: "info",
    fixActions: ["source_entity"],
  },
  {
    id: "broken_internal_link",
    label: "Internal Link の参照先がありません",
    severity: "error",
    fixActions: ["source_entity"],
  },
  {
    id: "broken_relation",
    label: "Relation の参照先がありません",
    severity: "error",
    fixActions: ["source_entity"],
  },
  {
    id: "canonical_markdown_anomaly",
    label: "Canonical Markdown の保存先に問題があります",
    severity: "error",
    fixActions: ["settings", "source_entity"],
  },
  {
    id: "ai_pack_anomaly",
    label: "AI Pack を更新できません",
    severity: "error",
    fixActions: ["theme_ai_pack", "settings"],
  },
  {
    id: "ai_pack_stale",
    label: "AI Pack の更新が必要です",
    severity: "warning",
    fixActions: ["theme_ai_pack"],
  },
  {
    id: "isolated_entity",
    label: "関連を持たない Knowledge entity です",
    severity: "info",
    fixActions: ["source_entity"],
  },
  {
    id: "duplicate_candidate",
    label: "同名の entity があります",
    severity: "warning",
    fixActions: ["source_entity"],
  },
]);

const RULE_BY_ID = new Map(DATA_HEALTH_RULES.map((rule) => [rule.id, rule]));
const BODY_FIELDS = ["body_markdown", "body", "description", "summary", "text"];
const TERMINAL_PACK_STATES = new Set([
  "recovery_required",
  "root_unavailable",
  "identity_conflict",
  "failed_retryable",
  "needs_root",
]);
const STALE_PACK_STATES = new Set(["dirty", "missing", "current_with_warning", "stale_preview"]);
const CANONICAL_ANOMALY_STATES = new Set([
  "unavailable",
  "file_ahead",
  "external_ahead",
  "internal_ahead",
  "conflict",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function refKey(ref) {
  return `${ref.type}:${ref.id}`;
}

function issueId(ruleId, ref, qualifier = "") {
  return [ruleId, ref.type, encodeURIComponent(ref.id), qualifier].filter(Boolean).join(":");
}

function issue(ruleId, ref, themeId, reason, qualifier = "", metadata = {}) {
  const rule = RULE_BY_ID.get(ruleId);
  return {
    id: issueId(ruleId, ref, qualifier),
    ruleId,
    label: rule.label,
    severity: rule.severity,
    ref,
    themeId: themeId || null,
    reason,
    fixActions: [...rule.fixActions],
    metadata,
  };
}

function recordTitle(record) {
  return text(record.title || record.name || record.label || record.text);
}

function recordThemeId(type, record) {
  if (type === "project") return text(record.id) || null;
  return text(record.project_id || record.theme_id) || null;
}

function recordBody(record) {
  for (const field of BODY_FIELDS) {
    if (typeof record[field] === "string" && record[field].trim()) return record[field];
  }
  return "";
}

function hasProvenance(record) {
  if (array(record.ai_source_refs || object(record.ai).source_refs || record.source_refs).length)
    return true;
  return Boolean(
    text(
      record.source_id ||
        record.source_note_id ||
        record.source_link_id ||
        record.source_item_id ||
        record.source_url ||
        record.url,
    ),
  );
}

function entitySignature(type, record, structureSignature) {
  const structureDependency = recordBody(record).includes("[[") ? structureSignature : "";
  return JSON.stringify([
    type,
    record.id,
    record.version,
    record.updated_at,
    record.ai_freshness,
    record.ai_authority,
    record.ai_summary,
    record.ai_summary_authority,
    record.source,
    record.source_refs,
    recordBody(record),
    structureDependency,
  ]);
}

function activeEntries(workspace) {
  const result = [];
  for (const definition of entityDefinitions) {
    const collection = array(workspace?.[definition.collectionKey]);
    for (const recordValue of collection) {
      const record = object(recordValue);
      if (!text(record.id) || record.deleted_at) continue;
      result.push({ type: definition.type, record });
    }
  }
  return result;
}

function localIssues(type, record, workspace, structureSignature) {
  const ref = { type, id: text(record.id) };
  const themeId = recordThemeId(type, record);
  const result = [];
  const authority = text(record.ai_authority || object(record.ai).authority);
  if (["imported", "external", "ai_generated"].includes(authority) && !hasProvenance(record)) {
    result.push(
      issue(
        "missing_provenance",
        ref,
        themeId,
        "外部由来の情報ですが、source refsを確認できません。出典を追加してください。",
      ),
    );
  }
  const freshness = text(record.ai_freshness || object(record.ai).freshness);
  if (freshness === "stale")
    result.push(
      issue(
        "stale_context",
        ref,
        themeId,
        "AI Context上でstaleです。元Entityの内容とfreshnessを確認してください。",
      ),
    );
  if (freshness === "superseded")
    result.push(
      issue(
        "superseded_context",
        ref,
        themeId,
        "後継情報に置き換えられています。AIへ渡す対象に残すか確認してください。",
      ),
    );
  if (recordBody(record).includes("[[")) {
    for (const link of resolveStableLinks(recordBody(record), workspace)) {
      if (link.kind !== "canonical" || link.resolution !== "broken") continue;
      result.push(
        issue(
          "broken_internal_link",
          ref,
          themeId,
          `Internal Link ${link.raw} の参照先がありません。元Entityでリンクを修正してください。`,
          `${link.source_span.start}-${link.source_span.end}`,
          { target: link.ref },
        ),
      );
    }
  }
  if (type === "note") {
    const properties = object(record.properties_json || record.properties);
    const rawBinding = object(properties.canonical_markdown || properties.markdown_export);
    const binding = canonicalMarkdownBindingFromProperties(properties, { noteId: ref.id });
    const syncState = text(rawBinding.sync_state) || text(binding?.sync_state);
    if (binding && CANONICAL_ANOMALY_STATES.has(syncState)) {
      result.push(
        issue(
          "canonical_markdown_anomaly",
          ref,
          themeId,
          `Canonical Markdownは${syncState}です。Notesで同期状態を確認してください。`,
          syncState,
          { syncState },
        ),
      );
    }
  }
  return { signature: entitySignature(type, record, structureSignature), issues: result };
}

function relationIssues(workspace, entries) {
  const issues = [];
  const ids = new Set(entries.map(({ type, record }) => refKey({ type, id: text(record.id) })));
  for (const record of array(workspace.references)) {
    if (record.deleted_at) continue;
    const ref = { type: "reference", id: text(record.id) };
    const source = { type: text(record.source_type), id: text(record.source_id) };
    const target = { type: text(record.target_type), id: text(record.target_id) };
    const missing = [source, target].filter((candidate) => !ids.has(refKey(candidate)));
    if (missing.length)
      issues.push(
        issue(
          "broken_relation",
          ref,
          null,
          "Referenceの参照先がありません。元Relationを確認してください。",
          "reference",
          { missing },
        ),
      );
  }
  const nodeIds = new Set(
    array(workspace.knowledge_nodes)
      .filter((record) => !record.deleted_at)
      .map((record) => text(record.id)),
  );
  const connectedNodeIds = new Set();
  for (const record of array(workspace.knowledge_edges)) {
    if (record.deleted_at) continue;
    const sourceId = text(record.source_node_id);
    const targetId = text(record.target_node_id);
    const missing = [sourceId, targetId].filter((id) => !nodeIds.has(id));
    if (missing.length) {
      issues.push(
        issue(
          "broken_relation",
          { type: "knowledge_edge", id: text(record.id) },
          null,
          "Knowledge Relationの参照先がありません。元Relationを確認してください。",
          "knowledge",
          { missingIds: missing },
        ),
      );
    } else {
      connectedNodeIds.add(sourceId);
      connectedNodeIds.add(targetId);
    }
  }
  for (const node of array(workspace.knowledge_nodes).filter((record) => !record.deleted_at)) {
    if (!connectedNodeIds.has(text(node.id))) {
      issues.push(
        issue(
          "isolated_entity",
          { type: "knowledge_node", id: text(node.id) },
          recordThemeId("knowledge_node", node),
          "他EntityとのRelationがありません。関連を追加するか不要なら状態を見直してください。",
        ),
      );
    }
  }
  return issues;
}

function duplicateIssues(entries) {
  const groups = new Map();
  for (const { type, record } of entries) {
    const title = recordTitle(record).normalize("NFKC").toLocaleLowerCase("ja-JP");
    if (!title) continue;
    const key = `${type}:${title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const issues = [];
  for (const [key, records] of groups) {
    if (records.length < 2) continue;
    const type = key.slice(0, key.indexOf(":"));
    const duplicateIds = records.map((record) => text(record.id)).sort();
    for (const record of records) {
      issues.push(
        issue(
          "duplicate_candidate",
          { type, id: text(record.id) },
          recordThemeId(type, record),
          `同じタイトルの${type}が${records.length}件あります。統合は自動で行いません。`,
          duplicateIds.join(","),
          { duplicateIds },
        ),
      );
    }
  }
  return issues;
}

function globalIssues(workspace, entries, options) {
  const issues = [...relationIssues(workspace, entries), ...duplicateIssues(entries)];
  for (const [rootId, statusValue] of Object.entries(object(workspace.canonical_root_status))) {
    if (object(statusValue).status !== "broken") continue;
    issues.push(
      issue(
        "canonical_markdown_anomaly",
        { type: "canonical_root", id: rootId },
        null,
        "Canonical Markdown rootを利用できません。Settingsで保存先を確認してください。",
      ),
    );
  }
  for (const statusValue of array(options.themeAiPackStatuses)) {
    const status = object(statusValue);
    if (!TERMINAL_PACK_STATES.has(text(status.state)) && !STALE_PACK_STATES.has(text(status.state)))
      continue;
    const themeId = text(status.themeId);
    const state = text(status.state);
    const ruleId = TERMINAL_PACK_STATES.has(state) ? "ai_pack_anomaly" : "ai_pack_stale";
    issues.push(
      issue(
        ruleId,
        { type: "project", id: themeId },
        themeId,
        `AI Packは${state}です。ThemeのAI Packを確認してください。`,
        state,
        { state },
      ),
    );
  }
  return issues;
}

export function normalizeDataHealthState(value) {
  const source = object(value);
  const sourceIssues = object(source.issues);
  const issues = {};
  for (const id of Object.keys(sourceIssues).sort().slice(0, 10_000)) {
    const entry = object(sourceIssues[id]);
    if (!text(id) || !["ignored", "resolved"].includes(entry.state)) continue;
    issues[id] = {
      state: entry.state,
      updatedAt: text(entry.updatedAt),
      note: text(entry.note).slice(0, 500),
    };
  }
  return {
    schema: DATA_HEALTH_STATE_SCHEMA,
    revision: Number.isInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    updatedAt: text(source.updatedAt),
    issues,
  };
}

export class DataHealthEvaluator {
  constructor() {
    this.entityCache = new Map();
    this.globalCache = { signature: "", issues: [] };
  }

  evaluate(workspaceValue, options = {}) {
    const workspace = object(workspaceValue);
    const entries = activeEntries(workspace);
    const structureSignature = JSON.stringify(
      entries.map(({ type, record }) => [type, record.id]).sort(),
    );
    const activeKeys = new Set();
    const issues = [];
    let evaluatedEntities = 0;
    let reusedEntities = 0;
    for (const { type, record } of entries) {
      const key = refKey({ type, id: text(record.id) });
      activeKeys.add(key);
      const signature = entitySignature(type, record, structureSignature);
      const cached = this.entityCache.get(key);
      if (cached?.signature === signature) {
        issues.push(...cached.issues);
        reusedEntities += 1;
      } else {
        const evaluated = localIssues(type, record, workspace, structureSignature);
        this.entityCache.set(key, evaluated);
        issues.push(...evaluated.issues);
        evaluatedEntities += 1;
      }
    }
    for (const key of this.entityCache.keys())
      if (!activeKeys.has(key)) this.entityCache.delete(key);
    const globalSignature = JSON.stringify([
      structureSignature,
      array(workspace.references).map((entry) => [
        entry.id,
        entry.version,
        entry.updated_at,
        entry.deleted_at,
      ]),
      array(workspace.knowledge_edges).map((entry) => [
        entry.id,
        entry.version,
        entry.updated_at,
        entry.deleted_at,
      ]),
      object(workspace.canonical_root_status),
      array(options.themeAiPackStatuses).map((entry) => [entry.themeId, entry.state]),
      entries.map(({ type, record }) => [type, record.id, recordTitle(record)]),
    ]);
    if (this.globalCache.signature !== globalSignature) {
      this.globalCache = {
        signature: globalSignature,
        issues: globalIssues(workspace, entries, options),
      };
    }
    issues.push(...this.globalCache.issues);
    const state = normalizeDataHealthState(options.state);
    const projected = issues.map((entry) => ({
      ...entry,
      state: state.issues[entry.id]?.state || "open",
    }));
    return {
      schema: DATA_HEALTH_SCHEMA,
      generatedAt:
        text(options.generatedAt) || new Date(Number(options.now) || Date.now()).toISOString(),
      issues: projected.sort(
        (left, right) =>
          left.severity.localeCompare(right.severity) || left.id.localeCompare(right.id),
      ),
      counts: {
        open: projected.filter((entry) => entry.state === "open").length,
        ignored: projected.filter((entry) => entry.state === "ignored").length,
        resolved: projected.filter((entry) => entry.state === "resolved").length,
      },
      evaluation: { evaluatedEntities, reusedEntities, totalEntities: entries.length },
      stateRevision: state.revision,
    };
  }
}

export function buildDataHealth(workspace, options = {}) {
  return new DataHealthEvaluator().evaluate(workspace, options);
}
