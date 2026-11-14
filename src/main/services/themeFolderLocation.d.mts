export function assertSafeThemeChildPath(input: {
  themeFolder: string;
  relativePath: string;
  fileSystem?: typeof import("node:fs");
}): string;

export type ThemeFolderLocation =
  | { status: "needs_root" | "root_unavailable" }
  | { status: "identity_conflict"; reason: string }
  | {
      status: "ok";
      source: string;
      themeFolder: string;
      createManifest: boolean;
      themeManifest: { schema: string; themeId: string; displayName: string };
    };

export function discoverThemeFolderLocation(input?: Record<string, unknown>): ThemeFolderLocation;
export function ensureThemeFolderLocation(
  location: ThemeFolderLocation,
  options?: Record<string, unknown>,
): ThemeFolderLocation;
