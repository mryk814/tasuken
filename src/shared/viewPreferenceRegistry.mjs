const NOTES_DEFAULT = {
  scope: "note",
  sortOrder: "updated_desc",
  themeId: "all",
  listWidth: null,
  listCollapsed: false,
  documentFocus: false,
};

const CHAT_REFS_DEFAULT = {
  sortOrder: "newest",
  groupSortOrder: "recent",
  statusFilter: "all",
  listMode: "active",
  includeArchivedInSearch: false,
};

const TIMELINE_DEFAULT = {
  dayWidth: 2,
  themeFilter: "all",
  showCompleted: true,
  showDependencies: true,
  showLightning: true,
  rangeBufferMonths: 0,
  collapsedThemes: [],
};

const TODO_DEFAULT = {
  filter: "open",
  taskFilters: {
    tab: "open",
    themeId: "all",
    state: "",
    priority: "",
    schedule: "",
    rangeSemantics: "",
  },
  sortMode: "default",
  sortDirection: "desc",
  groupMode: "none",
};

const ARTIFACTS_DEFAULT = {
  themeId: "all",
  sourceType: "all",
  typeFilter: "all",
  sortOrder: "newest",
};

const SKETCH_LIBRARY_DEFAULT = { themeId: "all", sortOrder: "updated_desc" };
const SKETCH_TOOL_PRESETS_DEFAULT = {
  pen: { color: "#211e1d", width: 2 },
  highlighter: { color: "#2f6fa6", width: 20 },
  eraser: { color: "#211e1d", width: 28 },
  shape: { color: "#211e1d", width: 2 },
  arrow: { color: "#8a2f3b", width: 2 },
  text: { color: "#211e1d", width: 24 },
};

const THEME_DEFAULT = { collapsedSections: [] };

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function oneOf(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

function stringArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter((entry) => typeof entry === "string"))] : [];
}

function normalizeNotes(value) {
  const raw = plain(value);
  return {
    scope: oneOf(raw.scope, ["all", "note", "resource", "report", "prompt"], NOTES_DEFAULT.scope),
    sortOrder: oneOf(raw.sortOrder, ["updated_desc", "updated_asc", "created_desc", "created_asc"], NOTES_DEFAULT.sortOrder),
    themeId: text(raw.themeId, NOTES_DEFAULT.themeId),
    listWidth: raw.listWidth === null ? null : Math.max(180, Math.min(800, finite(raw.listWidth, 280))),
    listCollapsed: bool(raw.listCollapsed, NOTES_DEFAULT.listCollapsed),
    documentFocus: bool(raw.documentFocus, NOTES_DEFAULT.documentFocus),
  };
}

function normalizeChatRefs(value) {
  const raw = plain(value);
  return {
    sortOrder: oneOf(raw.sortOrder, ["manual", "newest", "oldest"], CHAT_REFS_DEFAULT.sortOrder),
    groupSortOrder: oneOf(raw.groupSortOrder, ["recent", "name"], CHAT_REFS_DEFAULT.groupSortOrder),
    statusFilter: oneOf(raw.statusFilter, ["all", "inbox", "adopted"], CHAT_REFS_DEFAULT.statusFilter),
    listMode: oneOf(raw.listMode, ["active", "archive"], CHAT_REFS_DEFAULT.listMode),
    includeArchivedInSearch: bool(raw.includeArchivedInSearch, CHAT_REFS_DEFAULT.includeArchivedInSearch),
  };
}

function normalizeTimeline(value) {
  const raw = plain(value);
  return {
    dayWidth: Math.max(0.5, Math.min(8, finite(raw.dayWidth, TIMELINE_DEFAULT.dayWidth))),
    themeFilter: text(raw.themeFilter, TIMELINE_DEFAULT.themeFilter),
    showCompleted: bool(raw.showCompleted, TIMELINE_DEFAULT.showCompleted),
    showDependencies: bool(raw.showDependencies, TIMELINE_DEFAULT.showDependencies),
    showLightning: bool(raw.showLightning, TIMELINE_DEFAULT.showLightning),
    rangeBufferMonths: oneOf(raw.rangeBufferMonths, [0, 3, 6], TIMELINE_DEFAULT.rangeBufferMonths),
    collapsedThemes: stringArray(raw.collapsedThemes),
  };
}

function normalizeTodo(value) {
  const raw = plain(value);
  const filters = plain(raw.taskFilters);
  const taskFilters = {
    tab: oneOf(filters.tab, ["open", "today", "overdue", "no-schedule", "done"], TODO_DEFAULT.taskFilters.tab),
    themeId: text(filters.themeId, TODO_DEFAULT.taskFilters.themeId),
    state: oneOf(filters.state, ["", "todo", "doing", "waiting", "review", "done", "cancelled"], ""),
    priority: oneOf(filters.priority, ["", "high", "normal"], ""),
    schedule: oneOf(filters.schedule, ["", "scheduled", "no-schedule", "overdue", "this-week", "today"], ""),
    rangeSemantics: oneOf(filters.rangeSemantics, ["", "execution_window", "ongoing_period", "unspecified_range"], ""),
  };
  return {
    filter: oneOf(raw.filter, ["open", "today", "overdue", "no-schedule", "done"], TODO_DEFAULT.filter),
    taskFilters: { ...taskFilters, tab: oneOf(raw.filter, ["open", "today", "overdue", "no-schedule", "done"], taskFilters.tab) },
    sortMode: oneOf(raw.sortMode, ["default", "priority", "theme", "title"], TODO_DEFAULT.sortMode),
    sortDirection: oneOf(raw.sortDirection, ["asc", "desc"], TODO_DEFAULT.sortDirection),
    groupMode: oneOf(raw.groupMode, ["none", "schedule", "theme"], TODO_DEFAULT.groupMode),
  };
}

function normalizeArtifacts(value) {
  const raw = plain(value);
  return {
    themeId: text(raw.themeId, ARTIFACTS_DEFAULT.themeId),
    sourceType: text(raw.sourceType, ARTIFACTS_DEFAULT.sourceType),
    typeFilter: oneOf(raw.typeFilter, ["all", "image", "spreadsheet", "pdf", "markdown", "presentation", "other"], ARTIFACTS_DEFAULT.typeFilter),
    sortOrder: oneOf(raw.sortOrder, ["newest", "oldest", "recent_opened", "name"], ARTIFACTS_DEFAULT.sortOrder),
  };
}

function normalizeSketchLibrary(value) {
  const raw = plain(value);
  return {
    themeId: text(raw.themeId, SKETCH_LIBRARY_DEFAULT.themeId),
    sortOrder: oneOf(raw.sortOrder, ["updated_desc", "updated_asc", "title"], SKETCH_LIBRARY_DEFAULT.sortOrder),
  };
}

function normalizeToolPresets(value) {
  const raw = plain(value);
  return Object.fromEntries(Object.entries(SKETCH_TOOL_PRESETS_DEFAULT).map(([tool, fallback]) => {
    const candidate = plain(raw[tool]);
    return [tool, {
      color: typeof candidate.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color) ? candidate.color : fallback.color,
      width: typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : fallback.width,
    }];
  }));
}

const definitions = [
  { id: "shell.sidebarCollapsed", surfaceId: "shell", scope: "workspace", scopeKey: "", sortKey: "none", direction: "none", schemaVersion: 1, defaultValue: false, legacyKeys: ["tasken:shell:sidebar-collapsed:v1", "tasuken-research-desk:shell:sidebar-collapsed:v1"], normalize: (value) => bool(value, false) },
  { id: "shell.zoomFactor", surfaceId: "shell", scope: "workspace", scopeKey: "", sortKey: "none", direction: "none", schemaVersion: 1, defaultValue: 1, legacyKeys: ["tasken:shell:zoom-factor:v1", "tasuken-research-desk:shell:zoom-factor:v1"], normalize: (value) => Math.max(0.7, Math.min(1.5, finite(value, 1))) },
  { id: "notes.preferences", surfaceId: "notes", scope: "workspace", scopeKey: "", sortKey: "sortOrder", direction: "sortOrder", schemaVersion: 2, defaultValue: NOTES_DEFAULT, legacyKeys: ["tasken:notes:prefs:v1", "tasuken-research-desk:notes:prefs:v1"], normalize: normalizeNotes, migrate: (value) => normalizeNotes(value) },
  { id: "chatRefs.preferences", surfaceId: "chat-refs", scope: "workspace", scopeKey: "", sortKey: "sortOrder", direction: "sortOrder", schemaVersion: 1, defaultValue: CHAT_REFS_DEFAULT, legacyKeys: ["tasken:chat-refs:prefs:v1", "tasuken-research-desk:chat-refs:prefs:v1"], normalize: normalizeChatRefs },
  { id: "chatRefs.collapsedGroups", surfaceId: "chat-refs", scope: "workspace", scopeKey: "", sortKey: "collapsedGroups", direction: "none", schemaVersion: 1, defaultValue: [], legacyKeys: ["tasken:chat-refs:collapsed-groups:v1", "tasuken-research-desk:chat-refs:collapsed-groups:v1"], normalize: stringArray },
  { id: "timeline.preferences", surfaceId: "timeline", scope: "workspace", scopeKey: "", sortKey: "dayWidth", direction: "none", schemaVersion: 2, defaultValue: TIMELINE_DEFAULT, legacyKeys: ["tasken:timeline:prefs:v6", "tasuken-research-desk:timeline:prefs:v6"], normalize: normalizeTimeline, migrate: (value) => normalizeTimeline(value) },
  { id: "todo.preferences", surfaceId: "todo", scope: "workspace", scopeKey: "", sortKey: "sortMode", direction: "sortDirection", schemaVersion: 1, defaultValue: TODO_DEFAULT, legacyKeys: [], normalize: normalizeTodo },
  { id: "theme.preferences", surfaceId: "theme", scope: "theme", scopeKey: "themeId", sortKey: "none", direction: "none", schemaVersion: 1, defaultValue: THEME_DEFAULT, legacyKeys: [], normalize: (value) => ({ collapsedSections: stringArray(plain(value).collapsedSections) }) },
  { id: "artifacts.preferences", surfaceId: "artifacts", scope: "workspace", scopeKey: "", sortKey: "sortOrder", direction: "sortOrder", schemaVersion: 1, defaultValue: ARTIFACTS_DEFAULT, legacyKeys: ["tasken:artifacts:prefs:v1", "tasuken-research-desk:artifacts:prefs:v1"], normalize: normalizeArtifacts },
  { id: "sketch.libraryPreferences", surfaceId: "sketch", scope: "workspace", scopeKey: "", sortKey: "sortOrder", direction: "sortOrder", schemaVersion: 1, defaultValue: SKETCH_LIBRARY_DEFAULT, legacyKeys: ["tasken:sketch:library-prefs:v1", "tasuken-research-desk:sketch:library-prefs:v1"], normalize: normalizeSketchLibrary },
  { id: "sketch.toolPresets", surfaceId: "sketch-editor", scope: "workspace", scopeKey: "", sortKey: "none", direction: "none", schemaVersion: 1, defaultValue: SKETCH_TOOL_PRESETS_DEFAULT, legacyKeys: ["tasken:sketch:tool-presets:v1", "tasuken-research-desk:sketch:tool-presets:v1"], normalize: normalizeToolPresets },
  { id: "sketch.shapeKind", surfaceId: "sketch-editor", scope: "workspace", scopeKey: "", sortKey: "none", direction: "none", schemaVersion: 2, defaultValue: "rectangle", legacyKeys: ["tasken:sketch:shape-kind:v2", "tasken:sketch:shape-kind:v1", "tasuken-research-desk:sketch:shape-kind:v2"], normalize: (value) => oneOf(value, ["auto", "line", "rectangle", "rounded_rectangle", "ellipse", "triangle", "diamond", "sticky_note", "callout", "bidirectional_arrow"], "rectangle") },
  { id: "sketch.eraserMode", surfaceId: "sketch-editor", scope: "workspace", scopeKey: "", sortKey: "none", direction: "none", schemaVersion: 1, defaultValue: "partial", legacyKeys: ["tasken:sketch:eraser-mode:v1", "tasuken-research-desk:sketch:eraser-mode:v1"], normalize: (value) => oneOf(value, ["partial", "stroke"], "partial") },
];

export const VIEW_PREFERENCE_REGISTRY = Object.freeze(definitions);

export function getViewPreferenceDefinition(id) {
  return definitions.find((definition) => definition.id === id) || null;
}

export function isViewPreferenceId(id) {
  return typeof id === "string" && Boolean(getViewPreferenceDefinition(id));
}

export function normalizeViewPreference(id, value, fromVersion = 1) {
  const definition = getViewPreferenceDefinition(id);
  if (!definition) throw new Error(`未登録の表示設定です: ${id}`);
  const migrated = typeof definition.migrate === "function" ? definition.migrate(value, fromVersion) : value;
  return definition.normalize(migrated);
}

export function defaultViewPreference(id) {
  const definition = getViewPreferenceDefinition(id);
  if (!definition) throw new Error(`未登録の表示設定です: ${id}`);
  return structuredClone(definition.defaultValue);
}

export function viewPreferenceSlotKey(id, scopeKey = "") {
  if (!isViewPreferenceId(id)) throw new Error(`未登録の表示設定です: ${id}`);
  return `${id}::${scopeKey || ""}`;
}

export function normalizeViewPreferenceEnvelope(value) {
  const raw = plain(value);
  const values = plain(raw.values);
  const normalized = {};
  for (const definition of definitions) {
    for (const [slotKey, entry] of Object.entries(values)) {
      if (!slotKey.startsWith(`${definition.id}::`)) continue;
      const scopeKey = slotKey.slice(definition.id.length + 2);
      const candidate = plain(entry);
      normalized[viewPreferenceSlotKey(definition.id, scopeKey)] = {
        schemaVersion: definition.schemaVersion,
        value: normalizeViewPreference(definition.id, candidate.value, Number(candidate.schemaVersion) || 1),
      };
    }
  }
  return {
    schemaVersion: 1,
    revision: Number.isFinite(Number(raw.revision)) ? Number(raw.revision) : 0,
    values: normalized,
  };
}

