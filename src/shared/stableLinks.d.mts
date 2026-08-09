import type { RegistryEntityType } from "./entityRegistry.mjs";

export interface StableLinkRef { type: RegistryEntityType; id: string }
export interface StableLinkSpan { start: number; end: number }
export interface CanonicalStableLink {
  kind: "canonical";
  raw: string;
  ref: StableLinkRef;
  alias: string;
  occurrence: number;
  source_span: StableLinkSpan;
}
export interface LegacyStableLink {
  kind: "legacy";
  raw: string;
  target: string;
  alias: string;
  source_span: StableLinkSpan;
}
export type ParsedStableLink = CanonicalStableLink | LegacyStableLink;
export interface StableLinkRelationItem {
  kind: "resolved" | "broken";
  assertion_id: string;
  direction: "outbound" | "inbound";
  ref: StableLinkRef;
  title: string;
  predicate: "links_to";
  metadata: Record<string, unknown>;
  missing_refs?: StableLinkRef[];
}
export type LegacyStableLinkResolution = Omit<LegacyStableLink, "kind"> & {
  kind: "migration_candidate" | "ambiguous" | "unresolved";
  resolution: "migration_candidate" | "ambiguous" | "unresolved";
  candidates: StableLinkRef[];
};

export const stableLinkSyntax: "typed-stable-link/v1";
export function parseStableLinks(value: unknown): ParsedStableLink[];
export function formatStableLink(ref: StableLinkRef, alias?: string): string;
export function resolveStableLinks(value: unknown, workspace: Record<string, unknown>): Array<Record<string, unknown>>;
export function stableLinkAssertion(source: StableLinkRef, link: CanonicalStableLink, options?: { assertionId?: string; recordedAt?: string; origin?: "user" | "system_action" | "import" | "migration" }): Record<string, unknown>;
export function reconcileStableLinkAssertions(source: StableLinkRef, markdown: unknown, existingAssertions?: Array<Record<string, unknown>>, options?: { recordedAt?: string; origin?: "user" | "system_action" | "import" | "migration" }): {
  upsert_assertions: Array<Record<string, unknown>>;
  delete_assertion_ids: string[];
};
export function buildStableLinkContext(workspace: Record<string, unknown>, seed: StableLinkRef, options?: { maxItems?: number; tokenBudget?: number }): {
  outbound: StableLinkRelationItem[];
  backlinks: StableLinkRelationItem[];
  broken: StableLinkRelationItem[];
  migration_candidates: LegacyStableLinkResolution[];
  ambiguous: LegacyStableLinkResolution[];
  unresolved: LegacyStableLinkResolution[];
  categories: Record<"outbound" | "backlinks" | "broken" | "migration_candidates" | "ambiguous" | "unresolved", { total: number; truncated: boolean }>;
  truncated: boolean;
  limit: number;
};
