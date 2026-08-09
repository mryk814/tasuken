import type { AiAudience } from "./aiMetadata.mjs";

export interface ThemeAiPackPublication {
  published: boolean;
  title?: string;
  storage_root_id?: string;
  relative_path?: string;
  web_url?: string;
  locator?: string;
}

export interface ThemeAiPackCandidate {
  type: string;
  entity: Record<string, unknown>;
  relatedToTheme?: boolean;
  relation?: { themeId?: string };
  publication?: ThemeAiPackPublication;
}

export interface ThemeAiPackActivityProjection {
  events?: Array<Record<string, unknown>>;
  excluded_count?: number;
  excluded_reasons?: Array<{ type?: string; reason?: string; count?: number }>;
}

export interface ThemeAiPackFile {
  name: string;
  content: string;
  content_hash: string;
  includedEntityIds: string[];
}

export interface ThemeAiPackManifest {
  schema: "tasken-ai-pack/v1";
  themeId: string;
  generatedAt: string;
  sourceRevision: string | null;
  projection: "generated_read_only";
  audience: "m365";
  contentHash: string;
  files: Array<{ name: string; contentHash: string; includedEntityIds: string[] }>;
  includedEntityIds: string[];
  excludedCount: number;
  excludedReasons: Array<{ type: string; reason: string; count: number }>;
}

export interface ThemeAiPackPlan {
  schema: "tasken-ai-pack/v1";
  theme_id: string;
  audience: Extract<AiAudience, "m365">;
  generated_at: string;
  source_revision: string | null;
  content_hash: string;
  files: ThemeAiPackFile[];
  manifest: ThemeAiPackManifest;
  preview: {
    files: Array<{ name: string; includedCount: number; characterCount: number }>;
    includedCount: number;
    excludedCount: number;
    excludedReasons: Array<{ type: string; reason: string; count: number }>;
    warnings: Array<{
      kind: "stale" | "superseded";
      type: string;
      id: string;
      title: string;
      reason: string;
    }>;
    totalCharacterCount: number;
  };
  included_entity_ids: string[];
  excluded_count: number;
  excluded_reasons: Array<{ type: string; reason: string; count: number }>;
}

export interface BuildThemeAiPackPlanInput {
  theme: Record<string, unknown>;
  candidates?: ThemeAiPackCandidate[];
  activity?: ThemeAiPackActivityProjection;
  workspaceDefault?: AiAudience[] | null;
  generatedAt?: string;
  sourceRevision?: string | number | null;
  maxBodyChars?: number;
}

export const THEME_AI_PACK_SCHEMA: "tasken-ai-pack/v1";
export const THEME_AI_PACK_FILES: ReadonlyArray<Readonly<{ key: string; name: string; title: string }>>;
/** generatedAt/sourceRevisionはmanifest専用で、生成Markdownとstable content hashへは入れない。 */
export function buildThemeAiPackPlan(input: BuildThemeAiPackPlanInput): ThemeAiPackPlan;
