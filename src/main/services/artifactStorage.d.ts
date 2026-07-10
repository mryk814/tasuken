export function splitArtifactFileName(fileName: string): { base: string; extension: string };
export function artifactFileTypeOf(fileName: string): string;
export function artifactMimeTypeOf(fileName: string): string;
export function safeArtifactFileName(fileName: string): string;
export function resolveUniqueArtifactFileName(fileName: string, exists: (name: string) => boolean): string;
export function artifactMonthSegments(date?: Date): [string, string];
export function safeThemeFolderSegment(value: string | null | undefined): string;

export type ThemeContentKind = "artifacts" | "notes" | "exports";

export type ThemeContentDirectoryParts =
  | { kind: "needs_directory" }
  | { kind: "ok"; root: string; segments: string[] };

export function resolveThemeContentDirectoryParts(options?: {
  artifactDirectory?: string | null;
  themeId?: string | null;
  themeCode?: string | null;
  themeStorageRoot?: string | null;
  contentKind?: ThemeContentKind | string;
}): ThemeContentDirectoryParts;

export function resolveManagedArtifactDirectoryParts(options?: {
  artifactDirectory?: string | null;
  themeId?: string | null;
  themeCode?: string | null;
  themeStorageRoot?: string | null;
}): ThemeContentDirectoryParts;
