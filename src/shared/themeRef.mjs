import { themeFieldForEntityType } from "./entityRegistry.mjs";

export const PERSONAL_DEFAULT_THEME_ID = "theme-personal-default";
export const PERSONAL_DEFAULT_THEME_NAME = "個人業務";
export const PERSONAL_DEFAULT_THEME_KIND = "personal_default";

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

function themeColorToken(theme, index) {
  const color = typeof theme?.color === "string" ? theme.color.trim() : "";
  return THEME_COLOR_TOKEN_SET.has(color)
    ? color
    : THEME_COLOR_TOKENS[((index % THEME_COLOR_TOKENS.length) + THEME_COLOR_TOKENS.length) % THEME_COLOR_TOKENS.length];
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

export function themeRefFromId(value, { defaultPersonal = false, legacyNullMeansPersonal = false } = {}) {
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
  const personal = themes.find((theme) => normalizeThemeId(theme?.id) === PERSONAL_DEFAULT_THEME_ID);
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
  const ref = value && typeof value === "object" && (value.kind === "theme" || value.kind === "none")
    ? value
    : (value && typeof value === "object" ? themeRefFromEntity(value, options) : themeRefFromId(value, options));
  if (ref.kind === "none") return { ...noneThemeRef(), theme: null, missing: false };
  const theme = themes.find((candidate) => candidate?.id === ref.id) || null;
  return { kind: "theme", id: ref.id, theme, missing: !theme };
}

export function canonicalThemeRefForCreate(value) {
  return themeRefFromId(value, { defaultPersonal: true });
}
