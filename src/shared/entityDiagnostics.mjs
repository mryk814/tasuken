import {
  entityDefinitionForCollection,
  entityDefinitions,
  entityTypes,
  themeFieldForEntityType,
} from "./entityRegistry.mjs";
import { normalizeThemeId } from "./themeRef.mjs";

/**
 * Diagnostics for the raw DB/Snapshot boundary.  This intentionally returns
 * data instead of throwing: the caller can show the exact record while the
 * migration keeps unrelated body and file fields intact.
 */
export function diagnoseWorkspaceRawRecord(workspace, { knownThemeIds = [] } = {}) {
  const issues = [];
  const knownThemes = new Set(knownThemeIds);
  const ids = new Map();
  const allowedKeys = new Set(["meta", "plan_revisions", ...entityDefinitions.map((definition) => definition.collectionKey)]);

  for (const key of Object.keys(workspace || {})) {
    if (!allowedKeys.has(key)) issues.push({ kind: "unknown_collection", collectionKey: key });
  }

  for (const type of entityTypes) {
    const definition = entityDefinitions.find((entry) => entry.type === type);
    const collection = workspace?.[definition.collectionKey];
    if (collection == null) continue;
    if (!Array.isArray(collection)) {
      issues.push({ kind: "collection_not_array", type, collectionKey: definition.collectionKey });
      continue;
    }
    for (const record of collection) {
      const id = String(record?.id || "");
      const declaredType = record?.entityType ?? record?.__entity_type;
      if (declaredType != null && declaredType !== type) {
        issues.push({ kind: "type_payload_mismatch", type, declaredType, collectionKey: definition.collectionKey, entityId: id });
      }
      const seenKey = `${type}:${id}`;
      if (id && ids.has(seenKey)) issues.push({ kind: "duplicate_id", type, entityId: id });
      if (id) ids.set(seenKey, true);

      const themeField = themeFieldForEntityType(type);
      if (!themeField || !record || typeof record !== "object") continue;
      const legacyThemeField = definition.legacyThemeFields?.find((field) => normalizeThemeId(record[field]));
      const themeId = normalizeThemeId(record[themeField]) || normalizeThemeId(legacyThemeField ? record[legacyThemeField] : null);
      const legacyId = normalizeThemeId(record.theme_id);
      const canonicalId = normalizeThemeId(record.project_id);
      if (legacyId && canonicalId && legacyId !== canonicalId) {
        issues.push({ kind: "theme_ref_conflict", type, entityId: id, themeId: legacyId, projectId: canonicalId });
      }
      if (themeId && knownThemes.size && !knownThemes.has(themeId)) {
        issues.push({ kind: "invalid_theme_ref", type, entityId: id, themeId });
      }
      if (definition.themePolicy === "required" && !themeId) {
        issues.push({ kind: "missing_theme_ref", type, entityId: id, field: themeField });
      }
    }
  }

  return { issues, hasErrors: issues.length > 0 };
}

export function diagnoseCollectionKey(collectionKey) {
  const definition = entityDefinitionForCollection(collectionKey);
  return definition ? { type: definition.type, collectionKey } : { type: null, collectionKey };
}
