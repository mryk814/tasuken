export type CanonicalMarkdownFileState = "none" | "synced" | "pending" | "external_change" | "failed";

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

export function shouldCreateExportArtifact(format: string | null | undefined): boolean;
