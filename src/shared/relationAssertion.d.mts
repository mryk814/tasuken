export type RelationLayer = "operational" | "provenance" | "semantic";
export type RelationStatus = "asserted" | "suggested" | "rejected" | "superseded";
export type RelationOrigin = "user" | "system_action" | "import" | "ai_suggested" | "migration";
export type RelationEntityType = import("./entityRegistry.mjs").ReferenceTargetEntityType;
export type RelationPredicate = import("./entityRegistry.mjs").ReferenceRelationType;

export interface RelationRef { type: RelationEntityType; id: string }
export interface RelationEvidenceRef { type: import("./entityRegistry.mjs").RegistryEntityType; id: string }
export interface RelationAssertionMetadata {
  raw_alias?: string;
  source_span?: { start: number; end: number };
  [key: string]: unknown;
}
export interface RelationAssertion {
  id: string;
  assertion_id: string;
  subject: RelationRef;
  predicate: RelationPredicate;
  object: RelationRef;
  layer: RelationLayer;
  status: RelationStatus;
  origin: RelationOrigin;
  evidence_refs: RelationEvidenceRef[];
  legacy_evidence_refs?: string[];
  confidence: number | null;
  metadata: RelationAssertionMetadata;
  recorded_at: string | null;
  superseded_by_assertion_id: string | null;
  source_type: RelationEntityType;
  source_id: string;
  target_type: RelationEntityType;
  target_id: string;
  relation_type: RelationPredicate;
  [key: string]: unknown;
}
export interface RelationAssertionReadView extends Omit<RelationAssertion, "predicate" | "relation_type"> {
  predicate: string;
  relation_type: string;
  legacy_read?: boolean;
}

export const relationLayers: readonly RelationLayer[];
export const relationStatuses: readonly RelationStatus[];
export const relationOrigins: readonly RelationOrigin[];
export const relationPredicates: readonly RelationPredicate[];
export const relationEntityTypes: readonly RelationEntityType[];
export function referenceAssertionIdentity(input: Record<string, unknown>): { subject: RelationRef; object: RelationRef };
export function normalizeReferenceAssertion(input: Record<string, unknown>, options: { legacyRead: true; writeBoundary?: false }): RelationAssertionReadView;
export function normalizeReferenceAssertion(input: Record<string, unknown>, options?: { writeBoundary?: boolean; legacyRead?: false }): RelationAssertion;
export function classifyLegacyRelationAlias(rawAlias: string, candidates: Array<{ type: string; id: string; title: string }>): Readonly<{ raw_alias: string; resolution: "migration_candidate" | "ambiguous" | "unresolved"; candidates: readonly RelationRef[] }>;
export function decideRelationProposal(assertions: RelationAssertion[], proposal: Record<string, unknown>, decision: "accept" | "reject" | "dismiss"): { assertions: RelationAssertion[]; proposal: Record<string, unknown> };
