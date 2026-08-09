import type { DocumentSaveReferenceCompanion, Entity, SaveOperation } from "../types";
import type { EntityRefType } from "../domain-model/types";

const LINEAGE_SOURCE_TYPES = new Set<EntityRefType>([
  "project", "capture_entry", "task", "waiting", "plan_node", "note", "resource", "knowledge_node", "sketch", "artifact",
]);

export const LINEAGE_SOURCE_TYPE_KEY = "_lineage_source_type";
export const LINEAGE_SOURCE_ID_KEY = "_lineage_source_id";
export const LINEAGE_REFERENCE_ID_KEY = "_lineage_reference_id";

export function lineageDraftSource(base: Record<string, unknown>): { type: EntityRefType; id: string; referenceId: string } | null {
  const type = String(base[LINEAGE_SOURCE_TYPE_KEY] || "") as EntityRefType;
  const id = String(base[LINEAGE_SOURCE_ID_KEY] || "").trim();
  if (!LINEAGE_SOURCE_TYPES.has(type) || !id) return null;
  return {
    type,
    id,
    referenceId: String(base[LINEAGE_REFERENCE_ID_KEY] || "").trim() || crypto.randomUUID(),
  };
}

export function buildDerivedFromReferenceOperation(
  base: Record<string, unknown>,
  outputType: EntityRefType,
  outputId: string,
): SaveOperation | null {
  const source = lineageDraftSource(base);
  if (!source || !outputId) return null;
  return {
    action: "save",
    type: "reference",
    entity: {
      id: source.referenceId,
      source_type: outputType,
      source_id: outputId,
      target_type: source.type,
      target_id: source.id,
      relation_type: "derived_from",
      note: "Conversationの明示操作から作成",
      created_at: new Date().toISOString(),
    } as Entity,
    options: { source: "manual", reason: "created_from_conversation" },
  };
}

export function buildDerivedFromDocumentCompanion(
  base: Record<string, unknown>,
  noteId: string,
): DocumentSaveReferenceCompanion | null {
  return buildDerivedFromReferenceOperation(base, "note", noteId) as DocumentSaveReferenceCompanion | null;
}

export function stripLineageDraftMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const {
    [LINEAGE_SOURCE_TYPE_KEY]: _sourceType,
    [LINEAGE_SOURCE_ID_KEY]: _sourceId,
    [LINEAGE_REFERENCE_ID_KEY]: _referenceId,
    ...clean
  } = record;
  return clean;
}
