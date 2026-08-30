export type CanonicalMarkdownFileState =
  "none" | "synced" | "pending" | "external_change" | "failed" | "conflict" | "unavailable";
export type CanonicalMarkdownSyncState =
  "in_sync" | "internal_ahead" | "file_ahead" | "conflict" | "unavailable";

export interface CanonicalMarkdownBinding {
  schema_version: number;
  binding_id: string;
  mode: "linked_canonical";
  canonical_path: string;
  directory: string;
  root_identity: string;
  file_name: string;
  body_signature: string;
  file_signature: string;
  file_size: number | null;
  file_mtime_ms: number | null;
  last_synced_revision: number | null;
  sync_state: CanonicalMarkdownSyncState;
  last_operation_id: string;
  last_attempt_at: string;
  last_synced_at: string;
  last_error: string;
  file_ahead_signature: string;
}

export const CANONICAL_MARKDOWN_SCHEMA_VERSION: number;
export function sha256Hex(bytes: Uint8Array): string;

export function buildCanonicalMarkdownContent(options?: {
  title?: string;
  themeName?: string;
  updatedAt?: string;
  body?: string;
}): string;

export function normalizeCanonicalMarkdownBinding(
  value?: unknown,
  options?: { noteId?: string },
): CanonicalMarkdownBinding;
export function canonicalMarkdownBindingFromProperties(
  properties?: unknown,
  options?: { noteId?: string },
): CanonicalMarkdownBinding | null;
export function withCanonicalMarkdownBinding(
  properties?: unknown,
  binding?: unknown,
): Record<string, unknown>;
export function canonicalMarkdownFileState(syncState?: string): CanonicalMarkdownFileState;

export type CanonicalMarkdownWritePlan =
  | { action: "write" }
  | { action: "skip"; reason: "unchanged" }
  | { action: "confirm"; reason: "external_change"; externalSignature: string }
  | { action: "unavailable"; reason: "missing_path" | "root_unavailable" };

export function markdownSignature(content: string | null | undefined): string;

export function planCanonicalMarkdownWrite(options?: {
  canonicalPath?: string;
  nextContent?: string;
  lastWrittenSignature?: string;
  currentFileSignature?: string | null;
  fileExists?: boolean;
  rootAvailable?: boolean;
}): CanonicalMarkdownWritePlan;

export function noteSaveStateLabel(options?: {
  internalSaved?: boolean;
  fileState?: CanonicalMarkdownFileState;
}): string;

export function shouldCreateExportArtifact(
  format: string | null | undefined,
  purpose?: "canonical" | "copy" | "derived",
): boolean;
