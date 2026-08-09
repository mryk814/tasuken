import { getContextSubgraph, projectContextGraph } from "./contextGraph.mjs";
import { collectionKeyForEntityType, referenceTargetEntityTypes } from "./entityRegistry.mjs";
import { classifyLegacyRelationAlias, normalizeReferenceAssertion } from "./relationAssertion.mjs";

export const stableLinkSyntax = "typed-stable-link/v1";

const relationEntityTypeSet = new Set(referenceTargetEntityTypes);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function refKey(ref) {
  return JSON.stringify([ref.type, ref.id]);
}

function isEscaped(source, offset) {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function lineEnd(source, offset) {
  const end = source.indexOf("\n", offset);
  return end === -1 ? source.length : end + 1;
}

function fenceAtLine(source, offset) {
  const line = source.slice(offset, lineEnd(source, offset));
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return match ? { marker: match[1][0], length: match[1].length } : null;
}

function matchingInlineCodeEnd(source, offset, delimiterLength) {
  let cursor = offset + delimiterLength;
  while (cursor < source.length) {
    const found = source.indexOf("`", cursor);
    if (found === -1) return -1;
    let length = 1;
    while (source[found + length] === "`") length += 1;
    if (length === delimiterLength && !isEscaped(source, found)) return found + length;
    cursor = found + length;
  }
  return -1;
}

function closingBrackets(source, offset) {
  for (let cursor = offset; cursor < source.length - 1; cursor += 1) {
    if (source[cursor] === "\n" || source[cursor] === "\r") return -1;
    if (source[cursor] === "]" && source[cursor + 1] === "]" && !isEscaped(source, cursor)) return cursor;
  }
  return -1;
}

function unescapeToken(value) {
  return value.replace(/\\([|\]\\])/g, "$1").trim();
}

function splitTargetAndAlias(content) {
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "|" && !isEscaped(content, index)) {
      return [unescapeToken(content.slice(0, index)), unescapeToken(content.slice(index + 1))];
    }
  }
  const target = unescapeToken(content);
  return [target, ""];
}

function decodeStableId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

/**
 * Parse stable and legacy internal links from Markdown prose. Fenced code,
 * inline code and escaped opening brackets are intentionally opaque.
 */
export function parseStableLinks(value) {
  const source = value == null ? "" : String(value);
  const links = [];
  const canonicalOccurrences = new Map();
  let fence = null;
  let index = 0;
  while (index < source.length) {
    const atLineStart = index === 0 || source[index - 1] === "\n";
    if (atLineStart) {
      const marker = fenceAtLine(source, index);
      if (fence) {
        if (marker && marker.marker === fence.marker && marker.length >= fence.length) fence = null;
        index = lineEnd(source, index);
        continue;
      }
      if (marker) {
        fence = marker;
        index = lineEnd(source, index);
        continue;
      }
    }
    if (fence) {
      index = lineEnd(source, index);
      continue;
    }
    if (source[index] === "`" && !isEscaped(source, index)) {
      let delimiterLength = 1;
      while (source[index + delimiterLength] === "`") delimiterLength += 1;
      const end = matchingInlineCodeEnd(source, index, delimiterLength);
      if (end !== -1) {
        index = end;
        continue;
      }
    }
    if (source[index] !== "[" || source[index + 1] !== "[" || isEscaped(source, index)) {
      index += 1;
      continue;
    }
    const close = closingBrackets(source, index + 2);
    if (close === -1) {
      index += 2;
      continue;
    }
    const raw = source.slice(index, close + 2);
    const [targetToken, aliasToken] = splitTargetAndAlias(source.slice(index + 2, close));
    if (!targetToken) {
      index = close + 2;
      continue;
    }
    const colon = targetToken.indexOf(":");
    const possibleType = colon > 0 ? targetToken.slice(0, colon) : "";
    const decodedId = possibleType && relationEntityTypeSet.has(possibleType)
      ? decodeStableId(targetToken.slice(colon + 1))
      : "";
    const sourceSpan = { start: index, end: close + 2 };
    if (decodedId) {
      const canonicalRef = { type: possibleType, id: decodedId };
      const occurrenceKey = refKey(canonicalRef);
      const occurrence = canonicalOccurrences.get(occurrenceKey) || 0;
      canonicalOccurrences.set(occurrenceKey, occurrence + 1);
      links.push({
        kind: "canonical",
        raw,
        ref: canonicalRef,
        alias: aliasToken || "",
        occurrence,
        source_span: sourceSpan,
      });
    } else {
      links.push({
        kind: "legacy",
        raw,
        target: targetToken,
        alias: aliasToken || targetToken,
        source_span: sourceSpan,
      });
    }
    index = close + 2;
  }
  return links;
}

export function formatStableLink(ref, alias = "") {
  const type = text(ref?.type);
  const id = text(ref?.id);
  if (!relationEntityTypeSet.has(type) || !id) throw new Error("stable linkのtyped refが不正です。");
  const label = text(alias);
  if (/[\r\n]/.test(label) || label.includes("]]")) throw new Error("stable linkのaliasが不正です。");
  const escapedAlias = label.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\]/g, "\\]");
  return `[[${type}:${encodeURIComponent(id)}${escapedAlias ? `|${escapedAlias}` : ""}]]`;
}

function activeCandidates(workspace) {
  const candidates = [];
  for (const type of referenceTargetEntityTypes) {
    const collection = workspace?.[collectionKeyForEntityType(type)];
    if (!Array.isArray(collection)) continue;
    for (const record of collection) {
      const id = text(record?.id);
      if (!id || record?.deleted_at) continue;
      candidates.push({
        type,
        id,
        title: text(record.title || record.name || record.label) || `${type}:${id}`,
        record,
      });
    }
  }
  return candidates.sort((a, b) => refKey(a).localeCompare(refKey(b)));
}

/** Resolve canonical IDs without consulting titles; classify legacy titles only. */
export function resolveStableLinks(value, workspace) {
  const candidates = activeCandidates(workspace);
  const byRef = new Map(candidates.map((candidate) => [refKey(candidate), candidate]));
  return parseStableLinks(value).map((link) => {
    if (link.kind === "canonical") {
      const candidate = byRef.get(refKey(link.ref));
      return {
        ...link,
        resolution: candidate ? "resolved" : "broken",
        title: candidate?.title || link.alias || `${link.ref.type}:${link.ref.id}`,
        record: candidate?.record || null,
      };
    }
    const classified = classifyLegacyRelationAlias(link.target, candidates);
    return { ...link, resolution: classified.resolution, candidates: classified.candidates };
  });
}

function hash64(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/** Build the canonical Reference input consumed by the Markdown writer lane. */
export function stableLinkAssertion(source, link, options = {}) {
  if (link?.kind !== "canonical") throw new Error("canonical stable linkを指定してください。");
  const subject = { type: text(source?.type), id: text(source?.id) };
  const identity = JSON.stringify([subject.type, subject.id, link.ref.type, link.ref.id, Number(link.occurrence) || 0]);
  const assertionId = text(options.assertionId) || `stable-link:${hash64(identity)}`;
  return normalizeReferenceAssertion({
    id: assertionId,
    assertion_id: assertionId,
    subject,
    predicate: "links_to",
    object: link.ref,
    layer: "operational",
    status: "asserted",
    origin: options.origin || "user",
    evidence_refs: [subject],
    metadata: {
      syntax: stableLinkSyntax,
      raw: link.raw,
      raw_alias: link.alias,
      source_span: link.source_span,
    },
    recorded_at: options.recordedAt || null,
  }, { writeBoundary: true });
}

/**
 * Reconcile only assertions owned by the stable-link writer. Manual links_to
 * assertions are never removed. Repeated saves produce the same assertion IDs;
 * removed or replaced links explicitly return their stale IDs for deletion.
 */
export function reconcileStableLinkAssertions(source, markdown, existingAssertions = [], options = {}) {
  const normalizedExisting = existingAssertions
    .map((assertion) => {
      try {
        return normalizeReferenceAssertion(assertion, { legacyRead: true });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const existingById = new Map(normalizedExisting.map((assertion) => [assertion.assertion_id, assertion]));
  const assertions = parseStableLinks(markdown)
    .filter((link) => link.kind === "canonical")
    .map((link) => {
      const preliminary = stableLinkAssertion(source, link, options);
      const existing = existingById.get(preliminary.assertion_id);
      return stableLinkAssertion(source, link, {
        ...options,
        origin: existing?.origin || options.origin,
        recordedAt: existing?.recorded_at || options.recordedAt,
      });
    });
  const desiredIds = new Set(assertions.map((assertion) => assertion.assertion_id));
  const ownedExistingIds = normalizedExisting
    .filter((assertion) => (
      assertion
      && assertion.subject.type === source.type
      && assertion.subject.id === source.id
      && assertion.predicate === "links_to"
      && assertion.metadata?.syntax === stableLinkSyntax
    ))
    .map((assertion) => assertion.assertion_id);
  return {
    upsert_assertions: assertions,
    delete_assertion_ids: ownedExistingIds.filter((id) => !desiredIds.has(id)).sort(),
  };
}

function recordBody(record) {
  return String(record?.body_markdown || record?.body || record?.text || record?.description || "");
}

function edgeItem(graph, edge, seed) {
  const outbound = edge.source.type === seed.type && edge.source.id === seed.id;
  const ref = outbound ? edge.target : edge.source;
  return {
    assertion_id: edge.assertion_id,
    direction: outbound ? "outbound" : "inbound",
    ref,
    title: graph.nodes.get(refKey(ref))?.title || `${ref.type}:${ref.id}`,
    predicate: edge.predicate,
    metadata: edge.metadata || {},
  };
}

function itemKey(item) {
  return JSON.stringify([item.kind || "resolved", item.direction || "", item.ref?.type || "", item.ref?.id || "", item.assertion_id || "", item.source_span?.start ?? -1]);
}

/**
 * Bounded, deterministic internal-link/backlink projection. Canonical results
 * come exclusively from asserted links_to Relations in ContextGraph.
 */
export function buildStableLinkContext(workspace, seed, options = {}) {
  const maxItems = Math.min(100, Math.max(1, Number.isFinite(Number(options.maxItems)) ? Math.floor(Number(options.maxItems)) : 24));
  const graph = projectContextGraph(workspace);
  const query = (direction) => getContextSubgraph(graph, seed, {
    direction,
    maxHops: 1,
    maxNodes: maxItems + 1,
    maxEdges: maxItems,
    maxDiagnostics: maxItems,
    tokenBudget: options.tokenBudget || 12000,
    edgeFilter: (edge) => edge.predicate === "links_to",
  });
  const outgoingResult = query("outgoing");
  const incomingResult = query("incoming");
  const outbound = (outgoingResult.edges || []).map((edge) => ({ kind: "resolved", ...edgeItem(graph, edge, seed) }));
  const backlinks = (incomingResult.edges || []).map((edge) => ({ kind: "resolved", ...edgeItem(graph, edge, seed) }));
  const broken = [...(outgoingResult.diagnostics || []), ...(incomingResult.diagnostics || [])]
    .filter((diagnostic) => diagnostic.kind === "broken_relation")
    .map((diagnostic) => {
      const edge = graph.edges.find((candidate) => candidate.assertion_id === diagnostic.assertion_id);
      if (!edge) return null;
      return {
        kind: "broken",
        ...edgeItem(graph, edge, seed),
        missing_refs: diagnostic.missing_refs,
      };
    })
    .filter(Boolean);
  const seedRecord = graph.records.get(refKey(seed));
  const parsedResolutions = seedRecord ? resolveStableLinks(recordBody(seedRecord), workspace) : [];
  const brokenRelationTargets = new Set(broken.map((item) => refKey(item.ref)));
  const parsedBroken = parsedResolutions
    .filter((link) => link.kind === "canonical" && link.resolution === "broken" && !brokenRelationTargets.has(refKey(link.ref)))
    .map((link) => ({
      kind: "broken",
      assertion_id: `unpersisted:${link.source_span.start}:${link.source_span.end}`,
      direction: "outbound",
      ref: link.ref,
      title: link.title,
      predicate: "links_to",
      metadata: { syntax: stableLinkSyntax, raw: link.raw, raw_alias: link.alias, source_span: link.source_span },
      missing_refs: [link.ref],
    }));
  broken.push(...parsedBroken);
  const legacy = parsedResolutions
    .filter((link) => link.kind === "legacy")
    .map((link) => ({ kind: link.resolution, ...link }));
  const select = (items) => [...items].sort((a, b) => itemKey(a).localeCompare(itemKey(b))).slice(0, maxItems);
  const migrationCandidates = legacy.filter((item) => item.kind === "migration_candidate");
  const ambiguous = legacy.filter((item) => item.kind === "ambiguous");
  const unresolved = legacy.filter((item) => item.kind === "unresolved");
  const seedKey = refKey(seed);
  const isDefaultFact = (edge) => edge.predicate === "links_to" && ["asserted", "accepted"].includes(edge.status);
  const allOutboundEdges = (graph.outgoing.get(seedKey) || []).filter(isDefaultFact);
  const allInboundEdges = (graph.incoming.get(seedKey) || []).filter(isDefaultFact);
  const resolvedOutboundTotal = allOutboundEdges.filter((edge) => graph.nodes.has(refKey(edge.target))).length;
  const resolvedBacklinkTotal = allInboundEdges.filter((edge) => graph.nodes.has(refKey(edge.source))).length;
  const brokenTotal = new Set(broken.map((item) => item.assertion_id)).size;
  const categories = {
    outbound: { total: resolvedOutboundTotal, truncated: resolvedOutboundTotal > maxItems },
    backlinks: { total: resolvedBacklinkTotal, truncated: resolvedBacklinkTotal > maxItems },
    broken: { total: brokenTotal, truncated: brokenTotal > maxItems },
    migration_candidates: { total: migrationCandidates.length, truncated: migrationCandidates.length > maxItems },
    ambiguous: { total: ambiguous.length, truncated: ambiguous.length > maxItems },
    unresolved: { total: unresolved.length, truncated: unresolved.length > maxItems },
  };
  return {
    outbound: select(outbound),
    backlinks: select(backlinks),
    broken: select(broken),
    migration_candidates: select(migrationCandidates),
    ambiguous: select(ambiguous),
    unresolved: select(unresolved),
    categories,
    truncated: Object.values(categories).some((category) => category.truncated),
    limit: maxItems,
  };
}
