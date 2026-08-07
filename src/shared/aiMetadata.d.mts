export type AiAudience = "m365" | "coding_agent" | "external_ai";

export type AiVisibilityPreset =
  | "local_only"
  | "m365_allowed"
  | "coding_agent_allowed"
  | "m365_and_coding_agent_allowed"
  | "external_ai_allowed";

export type AiFreshness = "current" | "stale" | "superseded" | "unknown";

export type AiAuthority =
  | "user_confirmed"
  | "imported"
  | "ai_generated"
  | "inferred"
  | "external_source";

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

/** Entityへ保存する共通metadata。未設定はnull、明示的な「ローカルのみ」は空配列。 */
export interface AiMetadataFields {
  ai_summary: string | null;
  ai_summary_authority: AiSummaryAuthority | null;
  ai_freshness: AiFreshness | null;
  ai_authority: AiAuthority | null;
  ai_visibility: AiAudience[] | null;
  ai_last_verified_at: string | null;
  ai_superseded_by: AiEntityRef | null;
  ai_source_refs: AiSourceRef[];
  /** themeのみ。配下Entityが継承する既定値。 */
  default_ai_visibility?: AiAudience[] | null;
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
  ai_visibility: AiAudience[];
  ai_visibility_source: "entity" | "theme" | "workspace_default";
  ai_visibility_reason: string;
  theme_id: string | null;
  updated_at: string | null;
  last_verified_at: string | null;
  superseded_by: AiEntityRef | null;
  source_refs: AiSourceRef[];
}

export interface AiExclusion {
  id: string;
  type: string;
  reason: string;
}

export interface AiProjectionContext {
  audience?: AiAudience;
  theme?: Record<string, unknown> | null;
  workspaceDefault?: AiAudience[] | null;
}

export const AI_AUDIENCES: AiAudience[];
export const AI_VISIBILITY_PRESETS: Record<AiVisibilityPreset, AiAudience[]>;
export const AI_FRESHNESS_VALUES: AiFreshness[];
export const AI_AUTHORITY_VALUES: AiAuthority[];
export const AI_SUMMARY_AUTHORITY_VALUES: AiSummaryAuthority[];
export const AI_SOURCE_REF_KINDS: AiSourceRefKind[];
export const AI_METADATA_ENTITY_TYPES: string[];
export const DEFAULT_AI_VISIBILITY: AiAudience[];

export function hasAiMetadataContract(type: string): boolean;
export function normalizeAiVisibility(value: unknown): AiAudience[] | null;
export function aiVisibilityPresetOf(audiences: unknown): AiVisibilityPreset | null;
export function normalizeAiMetadata(type: string, input: unknown): Partial<AiMetadataFields>;
export function aiEntityBodyText(type: string, entity: unknown): string;

export function resolveAiSummary(type: string, entity: unknown): {
  summary: string;
  authority: AiSummaryAuthority | null;
  origin: "explicit" | "derived" | "missing";
};

export function resolveAiFreshness(entity: unknown): {
  freshness: AiFreshness;
  origin: "explicit" | "derived" | "unset";
  reason: string;
};

export function resolveAiAuthority(type: string, entity: unknown): {
  authority: AiAuthority | null;
  origin: "explicit" | "derived" | "unset";
  reason: string;
};

export function resolveAiVisibility(options?: {
  entity?: Record<string, unknown> | null;
  theme?: Record<string, unknown> | null;
  workspaceDefault?: AiAudience[] | null;
}): {
  audiences: AiAudience[];
  source: "entity" | "theme" | "workspace_default";
  reason: string;
};

export function isAiAudienceAllowed(audiences: unknown, audience: AiAudience): boolean;

export function buildAiEntityHeader(
  type: string,
  entity: unknown,
  context?: AiProjectionContext,
): AiEntityHeader;

export function projectEntityForAi(
  type: string,
  entity: unknown,
  context: AiProjectionContext,
): { included: boolean; header: AiEntityHeader | null; exclusion: AiExclusion | null };

export function summarizeAiExclusions(exclusions: (AiExclusion | null | undefined)[]): {
  excluded_count: number;
  excluded_reasons: { type: string; reason: string; count: number }[];
};
