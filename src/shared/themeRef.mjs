import { themeFieldForEntityType } from "./entityRegistry.mjs";

export const PERSONAL_DEFAULT_THEME_ID = "theme-personal-default";
export const PERSONAL_DEFAULT_THEME_NAME = "個人業務";
export const PERSONAL_DEFAULT_THEME_KIND = "personal_default";
export const THEME_CHARTER_SCHEMA = "tasken-theme-charter/v1";
export const THEME_STATE_SCHEMA = "tasken-theme-state/v1";

/** Empty/null is the explicit Themeなし value; it is never a personal identity. */
export const THEME_NONE_VALUE = "";
export const THEME_COLOR_TOKENS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
  "theme-extra-1",
  "theme-extra-2",
  "theme-extra-3",
  "theme-extra-4",
];
const THEME_COLOR_TOKEN_SET = new Set(THEME_COLOR_TOKENS);
const THEME_INTENT_LIST_LIMIT = 20;
const THEME_INTENT_TEXT_LIMIT = 8_000;

function intentText(value, limit = THEME_INTENT_TEXT_LIMIT) {
  return value == null ? "" : String(value).trim().slice(0, limit);
}

function intentList(value) {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];
  return [...new Set(entries.map((entry) => intentText(entry, 1_000)).filter(Boolean))].slice(
    0,
    THEME_INTENT_LIST_LIMIT,
  );
}

function hasIntentContent(record, fields) {
  return fields.some((field) => {
    const value = record[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

function themeColorToken(theme, index) {
  const color = typeof theme?.color === "string" ? theme.color.trim() : "";
  return THEME_COLOR_TOKEN_SET.has(color)
    ? color
    : THEME_COLOR_TOKENS[
        ((index % THEME_COLOR_TOKENS.length) + THEME_COLOR_TOKENS.length) %
          THEME_COLOR_TOKENS.length
      ];
}

export function normalizeThemeId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return id || null;
}

export function isPersonalDefaultThemeId(value) {
  return normalizeThemeId(value) === PERSONAL_DEFAULT_THEME_ID;
}

export function defaultThemeRef() {
  return { kind: "theme", id: PERSONAL_DEFAULT_THEME_ID };
}

export function noneThemeRef() {
  return { kind: "none", id: null };
}

export function themeRefFromId(
  value,
  { defaultPersonal = false, legacyNullMeansPersonal = false } = {},
) {
  const id = normalizeThemeId(value);
  if (id) return { kind: "theme", id };
  if (defaultPersonal || legacyNullMeansPersonal) return defaultThemeRef();
  return noneThemeRef();
}

/** Resolve legacy theme_id or canonical project_id at an explicit boundary. */
export function themeRefFromEntity(entity, options = {}) {
  const record = entity && typeof entity === "object" ? entity : {};
  const projectId = normalizeThemeId(record.project_id);
  const legacyId = normalizeThemeId(record.theme_id);
  if (projectId && legacyId && projectId !== legacyId) {
    throw new Error(`theme_idとproject_idが競合しています: ${legacyId} / ${projectId}`);
  }
  if (Object.prototype.hasOwnProperty.call(record, "project_id")) {
    return themeRefFromId(record.project_id, options);
  }
  return themeRefFromId(record.theme_id, { legacyNullMeansPersonal: true, ...options });
}

export function canonicalThemeId(value, options = {}) {
  return themeRefFromId(value, options).id;
}

export function themeIdForEntityType(type) {
  return themeFieldForEntityType(type);
}

export function themePickerOptions(themes = [], { allowPersonal = true, allowNone = false } = {}) {
  const options = [];
  const personal = themes.find(
    (theme) => normalizeThemeId(theme?.id) === PERSONAL_DEFAULT_THEME_ID,
  );
  if (allowPersonal) {
    options.push({
      value: PERSONAL_DEFAULT_THEME_ID,
      label: PERSONAL_DEFAULT_THEME_NAME,
      kind: "personal",
      colorToken: themeColorToken(personal || { color: "chart-6" }, 5),
    });
  }
  if (allowNone) options.push({ value: THEME_NONE_VALUE, label: "Themeなし", kind: "none" });
  for (const [index, theme] of themes.entries()) {
    const id = normalizeThemeId(theme?.id);
    if (!id || id === PERSONAL_DEFAULT_THEME_ID) continue;
    options.push({
      value: id,
      label: theme.name || id,
      kind: "theme",
      colorToken: themeColorToken(theme, index),
    });
  }
  return options;
}

export function resolveThemeRef(themes = [], value, options = {}) {
  const ref =
    value && typeof value === "object" && (value.kind === "theme" || value.kind === "none")
      ? value
      : value && typeof value === "object"
        ? themeRefFromEntity(value, options)
        : themeRefFromId(value, options);
  if (ref.kind === "none") return { ...noneThemeRef(), theme: null, missing: false };
  const theme = themes.find((candidate) => candidate?.id === ref.id) || null;
  return { kind: "theme", id: ref.id, theme, missing: !theme };
}

export function canonicalThemeRefForCreate(value) {
  return themeRefFromId(value, { defaultPersonal: true });
}

export function normalizeThemeCharter(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const charter = {
    schema: THEME_CHARTER_SCHEMA,
    purpose: intentText(input.purpose),
    desired_outcome: intentText(input.desired_outcome),
    principles: intentList(input.principles),
    scope: intentText(input.scope),
    non_goals: intentList(input.non_goals),
    long_term_questions: intentList(input.long_term_questions),
    learning_interests: intentList(input.learning_interests),
  };
  return hasIntentContent(charter, [
    "purpose",
    "desired_outcome",
    "principles",
    "scope",
    "non_goals",
    "long_term_questions",
    "learning_interests",
  ])
    ? charter
    : null;
}

export function normalizeThemeState(value, options = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const state = {
    schema: THEME_STATE_SCHEMA,
    current_direction: intentText(input.current_direction),
    active_questions: intentList(input.active_questions),
    current_bets: intentList(input.current_bets),
    blockers: intentList(input.blockers),
    unresolved_decisions: intentList(input.unresolved_decisions),
    next_frontier: intentText(input.next_frontier),
    updated_at: intentText(options.updatedAt ?? input.updated_at, 100) || null,
  };
  return hasIntentContent(state, [
    "current_direction",
    "active_questions",
    "current_bets",
    "blockers",
    "unresolved_decisions",
    "next_frontier",
  ])
    ? state
    : null;
}

export function themeIntentContent(value) {
  return {
    charter: normalizeThemeCharter(value?.theme_charter),
    state: normalizeThemeState(value?.theme_state),
  };
}

function boundedIntentList(values, budget, perItemLimit = 1_000) {
  return values.map((entry) => budget.take(entry, perItemLimit)).filter(Boolean);
}

export function publicThemeIntent(theme, budget) {
  const charter = normalizeThemeCharter(theme?.theme_charter);
  const state = normalizeThemeState(theme?.theme_state);
  return {
    charter: charter
      ? {
          schema: charter.schema,
          purpose: budget.take(charter.purpose, 4_000),
          desired_outcome: budget.take(charter.desired_outcome, 4_000),
          principles: boundedIntentList(charter.principles, budget),
          scope: budget.take(charter.scope, 4_000),
          non_goals: boundedIntentList(charter.non_goals, budget),
          long_term_questions: boundedIntentList(charter.long_term_questions, budget),
          learning_interests: boundedIntentList(charter.learning_interests, budget),
        }
      : null,
    state: state
      ? {
          schema: state.schema,
          current_direction: budget.take(state.current_direction, 4_000),
          active_questions: boundedIntentList(state.active_questions, budget),
          current_bets: boundedIntentList(state.current_bets, budget),
          blockers: boundedIntentList(state.blockers, budget),
          unresolved_decisions: boundedIntentList(state.unresolved_decisions, budget),
          next_frontier: budget.take(state.next_frontier, 4_000),
          updated_at: state.updated_at,
        }
      : null,
  };
}
