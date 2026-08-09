import { entityTypes, referenceRelationTypes, referenceTargetEntityTypes } from "./entityRegistry.mjs";

/**
 * Canonical relation assertion contract.
 *
 * A Reference is the durable assertion record. Legacy source/target fields are
 * retained as a read compatibility projection, while subject/object are the
 * canonical typed identities for every new write.
 */
export const relationLayers = Object.freeze(["operational", "provenance", "semantic"]);
export const relationStatuses = Object.freeze(["asserted", "suggested", "rejected", "superseded"]);
export const relationOrigins = Object.freeze(["user", "system_action", "import", "ai_suggested", "migration"]);
export const relationPredicates = referenceRelationTypes;
export const relationEntityTypes = referenceTargetEntityTypes;

const layerSet = new Set(relationLayers);
const statusSet = new Set(relationStatuses);
const originSet = new Set(relationOrigins);
const predicateSet = new Set(relationPredicates);
const entityTypeSet = new Set(relationEntityTypes);
const evidenceEntityTypeSet = new Set(entityTypes);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTypedRef(value, fallbackType, fallbackId, field) {
  const type = text(value?.type || fallbackType);
  const id = text(value?.id || fallbackId);
  if (!entityTypeSet.has(type) || !id) throw new Error(`reference.${field}が不正です。`);
  return { type, id };
}

function compatibleValue(canonical, legacy, field) {
  if (canonical && legacy && canonical !== legacy) {
    throw new Error(`reference.${field}がcanonical fieldと一致しません。`);
  }
}

function compareTypedRefs(a, b) {
  return JSON.stringify([a.type.length, a.type, a.id.length, a.id])
    .localeCompare(JSON.stringify([b.type.length, b.type, b.id.length, b.id]));
}

function normalizeEvidenceRefs(value) {
  if (value == null) return { canonical: [], legacy: [] };
  if (!Array.isArray(value) || value.length > 100) throw new Error("reference.evidence_refsが不正です。");
  const canonical = [];
  const legacy = [];
  const canonicalKeys = new Set();
  const legacyKeys = new Set();
  for (const entry of value) {
    if (isRecord(entry)) {
      const type = text(entry.type);
      const id = text(entry.id);
      if (!evidenceEntityTypeSet.has(type) || !id) throw new Error("reference.evidence_refsが不正です。");
      const key = JSON.stringify([type, id]);
      if (!canonicalKeys.has(key)) canonical.push({ type, id });
      canonicalKeys.add(key);
      continue;
    }
    const candidate = text(entry);
    if (!candidate || /\s/.test(candidate) || candidate.length > 200) throw new Error("reference.evidence_refsが不正です。");
    if (!legacyKeys.has(candidate)) legacy.push(candidate);
    legacyKeys.add(candidate);
  }
  return { canonical: canonical.sort(compareTypedRefs), legacy: legacy.sort() };
}

function normalizeOrigin(input) {
  const explicit = text(input.origin);
  if (explicit) return explicit;
  const source = text(input.source).toLowerCase();
  if (source === "import" || source === "imported") return "import";
  if (source === "migration" || source === "legacy") return "migration";
  if (source === "ai") return "ai_suggested";
  if (source === "system" || source === "system_action") return "system_action";
  return "user";
}

function normalizeMetadata(value) {
  if (value == null) return {};
  if (!isRecord(value)) throw new Error("reference.metadataが不正です。");
  const metadata = { ...value };
  if (metadata.raw_alias != null && (typeof metadata.raw_alias !== "string" || metadata.raw_alias.length > 1000)) {
    throw new Error("reference.metadata.raw_aliasが不正です。");
  }
  if (metadata.source_span != null) {
    const span = metadata.source_span;
    if (!isRecord(span) || !Number.isInteger(span.start) || span.start < 0 || !Number.isInteger(span.end) || span.end < span.start) {
      throw new Error("reference.metadata.source_spanが不正です。");
    }
    metadata.source_span = { start: span.start, end: span.end };
  }
  return metadata;
}

/** Return canonical subject/object even for an untouched legacy row. */
export function referenceAssertionIdentity(input) {
  if (!isRecord(input)) throw new Error("referenceの保存内容が不正です。");
  const subject = normalizeTypedRef(input.subject, input.source_type, input.source_id, "subject");
  const object = normalizeTypedRef(input.object, input.target_type, input.target_id, "object");
  compatibleValue(text(input.subject?.type), text(input.source_type), "source_type");
  compatibleValue(text(input.subject?.id), text(input.source_id), "source_id");
  compatibleValue(text(input.object?.type), text(input.target_type), "target_type");
  compatibleValue(text(input.object?.id), text(input.target_id), "target_id");
  return { subject, object };
}

/**
 * Normalize a legacy or canonical Reference without mutating it.
 * `writeBoundary` enforces that proposals never enter canonical facts before
 * acceptance. Superseded rows remain durable history, but default traversal
 * excludes them.
 */
export function normalizeReferenceAssertion(input, options = {}) {
  if (!isRecord(input)) throw new Error("referenceの保存内容が不正です。");
  const { subject, object } = referenceAssertionIdentity(input);
  const assertionId = text(input.assertion_id || input.id);
  if (!assertionId) throw new Error("reference.assertion_idを入力してください。");
  compatibleValue(text(input.assertion_id), text(input.id), "assertion_id");
  const predicate = text(input.predicate || input.relation_type);
  compatibleValue(text(input.predicate), text(input.relation_type), "predicate");
  if (!predicateSet.has(predicate) && !options.legacyRead) throw new Error("reference.predicateが不正です。");
  if (subject.type === object.type && subject.id === object.id) throw new Error("Referenceで自分自身は参照できません。");

  const layer = text(input.layer) || "operational";
  const status = text(input.status) === "accepted" ? "asserted" : text(input.status) || "asserted";
  const origin = normalizeOrigin(input);
  if (!layerSet.has(layer)) throw new Error("reference.layerが不正です。");
  if (!statusSet.has(status)) throw new Error("reference.statusが不正です。");
  if (!originSet.has(origin)) throw new Error("reference.originが不正です。");
  if (options.writeBoundary) {
    if (status === "suggested" || status === "rejected") {
      throw new Error("suggested/rejected relationはProposal decisionとして保存してください。");
    }
  }

  let confidence = null;
  if (input.confidence != null && input.confidence !== "") {
    confidence = Number(input.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("reference.confidenceは0から1で指定してください。");
  }
  const recordedAt = text(input.recorded_at || input.created_at);
  if (recordedAt && Number.isNaN(Date.parse(recordedAt))) throw new Error("reference.recorded_atが不正です。");
  const supersededByAssertionId = text(input.superseded_by_assertion_id) || null;
  if (options.writeBoundary && status === "superseded" && !supersededByAssertionId) {
    throw new Error("superseded relationには置き換え先assertion IDが必要です。");
  }
  if (status === "superseded" && supersededByAssertionId === assertionId) {
    throw new Error("reference.superseded_by_assertion_idに自分自身は指定できません。");
  }

  const evidence = normalizeEvidenceRefs([
    ...(Array.isArray(input.evidence_refs) ? input.evidence_refs : []),
    ...(Array.isArray(input.legacy_evidence_refs) ? input.legacy_evidence_refs : []),
  ]);
  const metadata = normalizeMetadata(input.metadata);
  if (options.writeBoundary && layer === "semantic" && !text(metadata.accepted_from_proposal_id)) {
    throw new Error("semantic relationのassertにはaccepted Proposalの証跡が必要です。");
  }
  if (options.writeBoundary && origin === "ai_suggested" && status === "asserted" && !text(metadata.accepted_from_proposal_id)) {
    throw new Error("AI suggested relationのassertにはaccepted Proposalの証跡が必要です。");
  }

  const normalized = {
    ...input,
    id: text(input.id) || assertionId,
    assertion_id: assertionId,
    subject,
    predicate,
    object,
    layer,
    status,
    origin,
    evidence_refs: evidence.canonical,
    ...(evidence.legacy.length ? { legacy_evidence_refs: evidence.legacy } : {}),
    confidence,
    metadata,
    recorded_at: recordedAt || null,
    superseded_by_assertion_id: supersededByAssertionId,
    legacy_read: Boolean(options.legacyRead && (input.legacy_read === true || !(isRecord(input.subject) && isRecord(input.object) && text(input.predicate)))),
    // Compatibility projection for existing #279/#283 consumers. These are
    // derived aliases; subject/object remain the canonical identity.
    source_type: subject.type,
    source_id: subject.id,
    target_type: object.type,
    target_id: object.id,
    relation_type: predicate,
  };
  if (!normalized.legacy_read) delete normalized.legacy_read;
  return normalized;
}

/**
 * Classify an old title-based alias without silently rewriting or reconnecting
 * it. Only one exact title match is a migration candidate.
 */
export function classifyLegacyRelationAlias(rawAlias, candidates) {
  const alias = text(rawAlias);
  const exact = Array.isArray(candidates)
    ? candidates.filter((candidate) => text(candidate?.title) === alias && entityTypeSet.has(text(candidate?.type)) && text(candidate?.id))
    : [];
  const refs = exact.map((candidate) => ({ type: text(candidate.type), id: text(candidate.id) }));
  return Object.freeze({
    raw_alias: alias,
    resolution: refs.length === 1 ? "migration_candidate" : refs.length > 1 ? "ambiguous" : "unresolved",
    candidates: Object.freeze(refs),
  });
}

/** Proposal decisions are pure: reject/dismiss never alter asserted facts. */
export function decideRelationProposal(assertions, proposal, decision) {
  if (!Array.isArray(assertions)) throw new Error("assertionsは配列で指定してください。");
  if (!isRecord(proposal)) throw new Error("relation proposalが不正です。");
  if (!["accept", "reject", "dismiss"].includes(decision)) throw new Error("relation proposal decisionが不正です。");
  const current = [...assertions];
  if (decision !== "accept") {
    return { assertions: current, proposal: { ...proposal, status: decision === "reject" ? "rejected" : "dismissed" } };
  }
  const proposedAssertion = proposal.assertion || proposal.payload?.assertion;
  const proposalId = text(proposal.id);
  if (!proposalId) throw new Error("relation proposal.idを入力してください。");
  const assertion = normalizeReferenceAssertion({
    ...proposedAssertion,
    status: "asserted",
    metadata: {
      ...(isRecord(proposedAssertion?.metadata) ? proposedAssertion.metadata : {}),
      accepted_from_proposal_id: proposalId,
      ...(text(proposal.decided_at) ? { accepted_at: text(proposal.decided_at) } : {}),
      ...(text(proposal.decided_by) ? { accepted_by: text(proposal.decided_by) } : {}),
    },
  }, { writeBoundary: true });
  return { assertions: [...current, assertion], proposal: { ...proposal, status: "accepted" } };
}
