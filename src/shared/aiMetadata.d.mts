export type AiFreshness = "current" | "stale" | "superseded" | "unknown";

export type AiAuthority =
  "user_confirmed" | "imported" | "ai_generated" | "inferred" | "external_source";

export type AiSummaryAuthority = "user_confirmed" | "rule_generated" | "ai_generated" | "excerpt";

export type AiSourceRefKind =
  | "url"
  | "file"
  | "canonical_document"
  | "conversation"
  | "meeting"
  | "repository"
  | "external_system";

export interface AiSourceRef {
  kind: AiSourceRefKind;
  locator: string;
  title?: string;
  captured_at?: string;
  last_checked_at?: string;
  storage_root_id?: string;
  relative_path?: string;
}

export interface AiEntityRef {
  type: string;
  id: string;
}

/** Entityへ保存する共通metadata。未設定はnull。 */
export interface AiMetadataFields {
  ai_creation?: Record<string, unknown> | null;
  ai_seen_at?: string | null;
  ai_summary: string | null;
  ai_summary_authority: AiSummaryAuthority | null;
  ai_freshness: AiFreshness | null;
  ai_authority: AiAuthority | null;
  ai_last_verified_at: string | null;
  ai_superseded_by: AiEntityRef | null;
  ai_source_refs: AiSourceRef[];
}

export interface AiEntityHeader {
  id: string;
  type: string;
  title: string;
  summary: string;
  summary_authority: AiSummaryAuthority | null;
  summary_origin: "explicit" | "derived" | "missing";
  freshness: AiFreshness;
  freshness_origin: "explicit" | "derived" | "unset";
  freshness_reason: string;
  authority: AiAuthority | null;
  authority_origin: "explicit" | "derived" | "unset";
  authority_reason: string;
  theme_id: string | null;
  updated_at: string | null;
  last_verified_at: string | null;
  superseded_by: AiEntityRef | null;
  source_refs: AiSourceRef[];
}

export const AI_FRESHNESS_VALUES: AiFreshness[];
export const AI_AUTHORITY_VALUES: AiAuthority[];
export const AI_SUMMARY_AUTHORITY_VALUES: AiSummaryAuthority[];
export const AI_SOURCE_REF_KINDS: AiSourceRefKind[];
export const AI_METADATA_ENTITY_TYPES: string[];

export function hasAiMetadataContract(type: string): boolean;
export function normalizeAiMetadata(type: string, input: unknown): Partial<AiMetadataFields>;
export function aiEntityBodyText(type: string, entity: unknown): string;

export function resolveAiSummary(
  type: string,
  entity: unknown,
): {
  summary: string;
  authority: AiSummaryAuthority | null;
  origin: "explicit" | "derived" | "missing";
};

export function resolveAiFreshness(entity: unknown): {
  freshness: AiFreshness;
  origin: "explicit" | "derived" | "unset";
  reason: string;
};

export function resolveAiAuthority(
  type: string,
  entity: unknown,
): {
  authority: AiAuthority | null;
  origin: "explicit" | "derived" | "unset";
  reason: string;
};

export function buildAiEntityHeader(type: string, entity: unknown): AiEntityHeader;
