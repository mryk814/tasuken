import type { AiAudience, AiAuthority, AiFreshness } from "./aiMetadata.mjs";
import type { ThemeAiPackPlan } from "./themeAiPack.mjs";

export type PreviewCapability = "full" | "partial" | "aggregate_only" | "unavailable";
export type PreviewBodyMode = "full" | "excerpt" | "summary" | "metadata_only" | "reference_only" | "unknown";

export interface PreviewEntityRef {
  type: string;
  id: string;
}

export interface PreviewSourceLocator {
  tool?: string;
  arguments?: Record<string, string | number | boolean | null>;
  url?: string;
  storageRootId?: string;
  relativePath?: string;
}

export interface PreviewSourceRef {
  kind?: string;
  locator?: string;
  title?: string;
  storageRootId?: string;
  relativePath?: string;
  capturedAt?: string;
  lastCheckedAt?: string;
}

export interface PreviewRelationPathStep {
  edgeId?: string;
  source?: PreviewEntityRef;
  target?: PreviewEntityRef;
  predicate?: string;
  layer?: string;
  status?: string;
  origin?: string;
}

export interface PreviewContent {
  mode: "full" | "excerpt" | "summary";
  text: string;
  truncated: boolean;
  sourceField: "body_markdown" | "body" | "excerpt" | "body_excerpt" | "summary" | "ai_summary" | "description" | "content";
}

export interface PreviewIncludedEntity {
  ref: PreviewEntityRef;
  title: string | null;
  bodyMode: PreviewBodyMode;
  content: PreviewContent | null;
  visibility: AiAudience[];
  freshness: AiFreshness | string | null;
  authority: AiAuthority | string | null;
  includedReason: string | null;
  relationPath: PreviewRelationPathStep[];
  sourceRefs: PreviewSourceRef[];
  sourceLocator: PreviewSourceLocator | null;
  sourceOrder: number;
}

export interface PreviewRelation {
  id: string | null;
  source: PreviewEntityRef;
  target: PreviewEntityRef;
  predicate: string | null;
  layer: string | null;
  status: string | null;
  origin: string | null;
  evidenceRefs: Array<string | PreviewEntityRef>;
  reason: string | null;
  path: PreviewRelationPathStep[];
}

export interface PreviewExclusion {
  kind: "entity" | "edge" | "aggregate";
  ref: PreviewEntityRef | null;
  edge: { id: string | null; source: PreviewEntityRef; target: PreviewEntityRef; predicate: string | null } | null;
  entityType: string | null;
  reason: string | null;
  count: number;
}

export interface AiContextPreview {
  schema: "tasken-ai-context-preview/v1";
  audience: AiAudience | null;
  readOnly: true;
  scope: { kind: "theme" | "task" | "context_subgraph"; seed: PreviewEntityRef | null };
  capabilities: {
    entityDetails: PreviewCapability;
    exclusionDetails: PreviewCapability;
    relationDetails: PreviewCapability;
    aiMetadata: PreviewCapability;
    sourceLocators: PreviewCapability;
  };
  included: PreviewIncludedEntity[];
  relations: PreviewRelation[];
  excluded: PreviewExclusion[];
  files: Array<{
    name: string;
    includedCount: number | null;
    characterCount: number | null;
    contentHash: string | null;
    content: PreviewContent | null;
    untypedIncludedIds: string[];
  }>;
  warnings: Array<{
    code: string | null;
    kind: string | null;
    ref: PreviewEntityRef | null;
    message: string | null;
    reason: string | null;
  }>;
  limits: unknown;
  truncation: { truncated: boolean; reasons: string[]; details: unknown };
  estimates: { characters: number | null; tokens: number | null };
  counts: {
    included: number;
    representedIncluded: number;
    relations: number;
    representedRelations: number;
    excluded: number;
    representedExcluded: number;
  };
  /** Producerが型を返さないTheme AI Pack向け。型を推測してincludedへ昇格しない。 */
  untypedIncludedIds: string[];
}

export const AI_CONTEXT_PREVIEW_SCHEMA: "tasken-ai-context-preview/v1";

/** Theme AI Pack planの選択結果を再計算せず、集計能力の限界も含めて表示用へ投影する。 */
export function previewThemeM365(themeAiPackPlan: ThemeAiPackPlan | unknown): AiContextPreview;
/** tasken.get_task_contextの実responseを再queryせず表示用へ投影する。 */
export function previewTaskCoding(taskContextResponse: unknown): AiContextPreview;
/** tasken.get_theme_contextの実responseを再queryせず表示用へ投影する。 */
export function previewThemeCoding(themeContextResponse: unknown): AiContextPreview;
/** tasken.get_context_subgraph / contextGraphMcpShapeの実responseを再queryせず表示用へ投影する。 */
export function previewContextSubgraph(contextGraphResponse: unknown): AiContextPreview;
