export interface ActivityCanonicalRef {
  kind: string;
  storage_root_id?: string;
  relative_path?: string;
  web_url?: string;
  [key: string]: unknown;
}

export type ActivityCanonicalLocalResolution =
  | { status: "ok"; ref: ActivityCanonicalRef; path: string }
  | { status: "missing" | "outside_root"; ref: ActivityCanonicalRef | null };

export function resolveActivityCanonicalLocalPath(
  value: unknown,
  roots?: Record<string, string> | Map<string, string>,
): ActivityCanonicalLocalResolution;
