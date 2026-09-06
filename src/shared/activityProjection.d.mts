export interface ActivityProjectionEvent {
  [key: string]: unknown;
  id: string;
  occurred_at: string;
  event_kind: string;
  entity_ref: { type: string; id: string; revision?: number };
  entity_title: string;
  theme_ref: { kind: "theme" | "none"; id: string | null };
  actor: Record<string, unknown>;
  origin: Record<string, unknown>;
  summary: string;
  changed_fields: string[];
  canonical_refs: Array<Record<string, unknown>>;
  source_refs: Array<Record<string, unknown>>;
  relation_refs: Array<Record<string, unknown>>;
  work_receipt_ref: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  local_date: string;
  local_time: string;
  recall?: {
    stage: string;
    authority: string | null;
    authority_origin: string;
    source_ref: { type: string; id: string };
    history?: {
      entity_title_source: "after_snapshot" | "before_snapshot" | "current_fallback" | "unknown";
      theme_ref_source: "event" | "after_snapshot" | "before_snapshot" | "unknown";
      theme_title: string | null;
      theme_title_source:
        "theme_event_after" | "theme_event_before" | "current_fallback" | "unknown";
      current_entity_title: string | null;
      current_theme_ref: { kind: "theme" | "none"; id: string | null };
      current_theme_title: string | null;
    };
  };
}

export interface ActivityProjectionPage {
  status: "ok" | "invalid_cursor" | "resync_required";
  period: {
    date: string | null;
    from: string | null;
    to: string | null;
    timezone: string;
    boundaries: "inclusive";
  };
  limit: number;
  returned_count: number;
  offset: number | null;
  matched_visible_count: number | null;
  next_cursor: string | null;
  revision: string;
  generated_at: string;
}

export interface ActivityProjectionResult {
  schema_version: number;
  timezone: string;
  date: string | null;
  events: ActivityProjectionEvent[];
  excluded_count: number;
  excluded_reasons: Array<Record<string, unknown>>;
  truncated: boolean;
  page: ActivityProjectionPage;
  matched_count?: number | null;
}

export interface ActivityProjectionQuery {
  cursor?: string | null;
  profile?: "default" | "recall";
  events?: Array<Record<string, unknown>>;
  workspace?: Record<string, unknown>;
  entities?: Record<string, unknown>;
  themes?: Array<unknown>;
  references?: Array<unknown>;
  date?: string;
  from?: string;
  to?: string;
  themeId?: string;
  theme_id?: string;
  entityType?: string;
  entity_type?: string;
  entity_id?: string;
  eventKinds?: string[];
  event_kinds?: string[];
  timezone?: string;
  audience?: string | null;
  workspaceDefault?: unknown;
  roots?: Record<string, unknown>;
  limit?: number;
  sort_direction?: "asc" | "desc";
  include_match_metadata?: boolean;
}

export function localDate(value: unknown, timezone?: string): string;
export function queryActivityEvents(input?: ActivityProjectionQuery): ActivityProjectionResult;
export function projectActivityMarkdown(
  result: ActivityProjectionResult,
  options?: { title?: string; date?: string | null },
): string;
export function projectActivityJson(result: ActivityProjectionResult): ActivityProjectionResult;
export function projectActivityMcp(
  result: ActivityProjectionResult,
): ActivityProjectionResult & { read_only: true };
