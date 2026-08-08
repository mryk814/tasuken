export type PreferenceId =
  | "shell.sidebarCollapsed"
  | "shell.zoomFactor"
  | "notes.preferences"
  | "chatRefs.preferences"
  | "chatRefs.collapsedGroups"
  | "timeline.preferences"
  | "todo.preferences"
  | "theme.preferences"
  | "artifacts.preferences"
  | "sketch.libraryPreferences"
  | "sketch.toolPresets"
  | "sketch.shapeKind"
  | "sketch.eraserMode";

export interface NotesPreferenceValue {
  scope: "all" | "note" | "resource" | "report" | "prompt";
  sortOrder: "updated_desc" | "updated_asc" | "created_desc" | "created_asc";
  themeId: string;
  listWidth: number | null;
  listCollapsed: boolean;
  documentFocus: boolean;
}

export interface ChatRefsPreferenceValue {
  sortOrder: "manual" | "newest" | "oldest";
  groupSortOrder: "recent" | "name";
  statusFilter: "all" | "inbox" | "adopted";
  listMode: "active" | "archive";
  includeArchivedInSearch: boolean;
}

export interface TimelinePreferenceValue {
  dayWidth: number;
  themeFilter: string;
  showCompleted: boolean;
  showDependencies: boolean;
  showLightning: boolean;
  rangeBufferMonths: 0 | 3 | 6;
  collapsedThemes: string[];
}

export interface TodoPreferenceValue {
  filter: "open" | "today" | "overdue" | "no-schedule" | "done";
  taskFilters: {
    tab: TodoPreferenceValue["filter"];
    themeId: string;
    state: string;
    priority: "" | "high" | "normal";
    schedule: "" | "scheduled" | "no-schedule" | "overdue" | "this-week" | "today";
    rangeSemantics: "" | "execution_window" | "ongoing_period" | "unspecified_range";
  };
  sortMode: "default" | "priority" | "theme" | "title";
  sortDirection: "asc" | "desc";
  groupMode: "none" | "schedule" | "theme";
}

export interface ArtifactsPreferenceValue {
  themeId: string;
  sourceType: string;
  typeFilter: "all" | "image" | "spreadsheet" | "pdf" | "markdown" | "presentation" | "other";
  sortOrder: "newest" | "oldest" | "recent_opened" | "name";
}

export interface SketchLibraryPreferenceValue {
  themeId: string;
  sortOrder: "updated_desc" | "updated_asc" | "title";
}

export interface SketchToolPresetsPreferenceValue {
  pen: { color: string; width: number };
  highlighter: { color: string; width: number };
  eraser: { color: string; width: number };
  shape: { color: string; width: number };
  arrow: { color: string; width: number };
  text: { color: string; width: number };
}

export type PreferenceValueMap = {
  "shell.sidebarCollapsed": boolean;
  "shell.zoomFactor": number;
  "notes.preferences": NotesPreferenceValue;
  "chatRefs.preferences": ChatRefsPreferenceValue;
  "chatRefs.collapsedGroups": string[];
  "timeline.preferences": TimelinePreferenceValue;
  "todo.preferences": TodoPreferenceValue;
  "theme.preferences": { collapsedSections: string[] };
  "artifacts.preferences": ArtifactsPreferenceValue;
  "sketch.libraryPreferences": SketchLibraryPreferenceValue;
  "sketch.toolPresets": SketchToolPresetsPreferenceValue;
  "sketch.shapeKind": "auto" | "line" | "rectangle" | "rounded_rectangle" | "ellipse" | "triangle" | "diamond" | "sticky_note" | "callout" | "bidirectional_arrow";
  "sketch.eraserMode": "partial" | "stroke";
};

export interface ViewPreferenceDefinition<K extends PreferenceId = PreferenceId> {
  id: K;
  surfaceId: string;
  scope: "workspace" | "theme";
  scopeKey: string;
  sortKey: string;
  direction: string;
  schemaVersion: number;
  defaultValue: PreferenceValueMap[K];
  legacyKeys: string[];
}

export interface ViewPreferenceEntry {
  schemaVersion: number;
  value: unknown;
}

export interface ViewPreferenceEnvelope {
  schemaVersion: 1;
  revision: number;
  values: Record<string, ViewPreferenceEntry>;
}

export interface ViewPreferenceChange {
  id: PreferenceId;
  scopeKey: string;
  schemaVersion: number;
  value: unknown;
  revision: number;
}

export const VIEW_PREFERENCE_REGISTRY: readonly ViewPreferenceDefinition[];
export function getViewPreferenceDefinition<K extends PreferenceId>(id: K): ViewPreferenceDefinition<K> | null;
export function isViewPreferenceId(id: unknown): id is PreferenceId;
export function normalizeViewPreference<K extends PreferenceId>(id: K, value: unknown, fromVersion?: number): PreferenceValueMap[K];
export function defaultViewPreference<K extends PreferenceId>(id: K): PreferenceValueMap[K];
export function viewPreferenceSlotKey(id: PreferenceId, scopeKey?: string): string;
export function normalizeViewPreferenceEnvelope(value: unknown): ViewPreferenceEnvelope;
