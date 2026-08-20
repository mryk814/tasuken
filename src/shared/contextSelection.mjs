import { publicAiHeader } from "./taskContext.mjs";

export const CONTEXT_SELECTION_SCHEMA = "tasken-context-selection/v1";

function text(value, limit = 2_000) {
  return value == null ? "" : String(value).slice(0, limit);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ref(value, fallbackType = "") {
  const source = object(value);
  const type = text(source.type || fallbackType, 200).trim();
  const id = text(source.id, 500).trim();
  return type && id ? { type, id } : null;
}

function locator(value) {
  const source = object(value);
  const tool = text(source.tool, 300).trim();
  if (!tool) return null;
  const args = {};
  for (const key of Object.keys(object(source.arguments)).sort().slice(0, 20)) {
    const item = source.arguments[key];
    if (!["string", "number", "boolean"].includes(typeof item)) continue;
    if (typeof item === "string") {
      const safe = text(item, 1_000).trim();
      if (!safe || /^(?:[A-Za-z]:[\\/]|\\\\|\/|file:)/i.test(safe) || /(^|[\\/])\.\.([\\/]|$)/.test(safe)) continue;
      args[key] = safe;
    } else args[key] = item;
  }
  return { tool, arguments: args };
}

function safeLegacyEvidence(value) {
  const candidate = text(value, 2_000).trim();
  if (!candidate || /\s|[\u0000-\u001f]/.test(candidate)) return "";
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|file:)/i.test(candidate)) return "";
  if (candidate.includes("/") || candidate.includes("\\") || candidate.split(":").includes("..")) {
    try {
      const url = new URL(candidate);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
      return url.toString();
    } catch {
      return "";
    }
  }
  return candidate;
}

function evidenceRefs(value) {
  const refs = [];
  const seen = new Set();
  for (const entry of Array.isArray(value) ? value.slice(0, 200) : []) {
    const typed = ref(entry);
    if (typed) {
      const key = JSON.stringify([typed.type, typed.id]);
      if (!seen.has(key)) refs.push(typed);
      seen.add(key);
      continue;
    }
    if (typeof entry !== "string") continue;
    const legacy = safeLegacyEvidence(entry);
    if (!legacy) continue;
    const key = JSON.stringify(["legacy", legacy]);
    if (!seen.has(key)) refs.push(legacy);
    seen.add(key);
  }
  return refs.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function relationPath(value) {
  return (Array.isArray(value) ? value : []).slice(0, 100).map((entryValue) => {
    const entry = object(entryValue);
    const from = ref(entry.from || entry.source);
    const to = ref(entry.to || entry.target);
    if (!from || !to) return null;
    return {
      edge_id: text(entry.edge_id || entry.id, 1_000).trim() || null,
      assertion_id: text(entry.assertion_id, 1_000).trim() || null,
      from,
      predicate: text(entry.predicate, 300).trim() || null,
      to,
      layer: text(entry.layer, 100).trim() || null,
      status: text(entry.status, 100).trim() || null,
      origin: text(entry.origin, 300).trim() || null,
      evidence_refs: evidenceRefs(entry.evidence_refs),
      reason: text(entry.reason, 1_000).trim() || null,
    };
  }).filter(Boolean);
}

function relation(value) {
  const entry = object(value);
  const source = ref(entry.source);
  const target = ref(entry.target);
  if (!source || !target) return null;
  return {
    id: text(entry.id, 1_000).trim() || null,
    assertion_id: text(entry.assertion_id, 1_000).trim() || null,
    source,
    target,
    predicate: text(entry.predicate, 300).trim() || null,
    layer: text(entry.layer, 100).trim() || null,
    status: text(entry.status, 100).trim() || null,
    origin: text(entry.origin, 300).trim() || null,
    evidence_refs: evidenceRefs(entry.evidence_refs),
    reason: text(entry.reason, 1_000).trim() || null,
    path: (Array.isArray(entry.path) ? entry.path : []).slice(0, 100).map((id) => text(id, 1_000)),
  };
}

export function contextSelectionEntry(type, recordValue, options = {}) {
  const record = object(recordValue);
  const entityRef = ref(record, type);
  if (!entityRef) return null;
  const ai = publicAiHeader({ ai: record.ai });
  return {
    ref: entityRef,
    reason: text(options.reason ?? record.included_because, 1_000).trim() || null,
    count: 1,
    title: text(record.title || record.name || record.label, 500).trim() || null,
    ai,
    relation_path: relationPath(options.relationPath ?? record.relation_path),
    locator: locator(options.locator ?? record.locator),
  };
}

export function contextSelectionExclusions(value) {
  const entries = [];
  for (const exclusionValue of Array.isArray(value) ? value : []) {
    const exclusion = object(exclusionValue);
    const entityRef = ref(exclusion.ref || exclusion);
    if (!entityRef) continue;
    entries.push({
      ref: entityRef,
      reason: text(exclusion.reason, 1_000).trim() || "ai_visibility_policy",
      count: Math.max(1, Number(exclusion.count) || 1),
    });
  }
  return [...new Map(entries.map((entry) => [`${JSON.stringify([entry.ref.type, entry.ref.id])}|${entry.reason}`, entry])).values()]
    .sort((left, right) => `${left.ref.type}|${left.ref.id}|${left.reason}`.localeCompare(`${right.ref.type}|${right.ref.id}|${right.reason}`));
}

export function buildContextSelection({
  seed = null,
  included = [],
  excluded = [],
  relations = [],
  limits = {},
  truncated = false,
  truncation = {},
  estimatedCharacters = 0,
  estimatedTokens = 0,
  policy = null,
} = {}) {
  const includedEntries = included.filter(Boolean)
    .sort((left, right) => `${left.ref.type}|${left.ref.id}`.localeCompare(`${right.ref.type}|${right.ref.id}`));
  return {
    schema: CONTEXT_SELECTION_SCHEMA,
    seed: ref(seed),
    included: includedEntries,
    excluded: contextSelectionExclusions(excluded),
    relations: relations.map(relation).filter(Boolean)
      .sort((left, right) => `${left.id || ""}|${left.source.type}|${left.source.id}|${left.target.type}|${left.target.id}`.localeCompare(`${right.id || ""}|${right.source.type}|${right.source.id}|${right.target.type}|${right.target.id}`)),
    limits,
    truncated: Boolean(truncated),
    truncation,
    estimated_characters: Math.max(0, Number(estimatedCharacters) || 0),
    estimated_tokens: Math.max(0, Number(estimatedTokens) || 0),
    policy: policy && typeof policy === "object" && !Array.isArray(policy) ? policy : null,
  };
}
