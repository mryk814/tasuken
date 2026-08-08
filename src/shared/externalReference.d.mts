export const EXTERNAL_REFERENCE_KINDS: readonly [
  "issue",
  "pull_request",
  "merge_request",
  "commit",
  "branch",
  "file",
  "pipeline",
  "other",
];

export type ExternalReferenceKind = (typeof EXTERNAL_REFERENCE_KINDS)[number];

export interface ExternalReference {
  kind: ExternalReferenceKind;
  provider: string | null;
  display_label: string;
  url: string;
  external_id: string | null;
}

export function normalizeExternalReference(input: Record<string, unknown>): ExternalReference;
export function normalizeExternalReferences(value: unknown): ExternalReference[];
