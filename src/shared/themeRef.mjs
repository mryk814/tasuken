import { themeFieldForEntityType } from "./entityRegistry.mjs";

export const PERSONAL_DEFAULT_THEME_ID = "theme-personal-default";
export const PERSONAL_DEFAULT_THEME_NAME = "個人業務";
export const PERSONAL_DEFAULT_THEME_KIND = "personal_default";

/** Empty/null is the explicit Themeなし value; it is never a personal identity. */
export const THEME_NONE_VALUE = "";

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
  if (allowPersonal) {
    options.push({ value: PERSONAL_DEFAULT_THEME_ID, label: PERSONAL_DEFAULT_THEME_NAME, kind: "personal" });
  }
  if (allowNone) options.push({ value: THEME_NONE_VALUE, label: "Themeなし", kind: "none" });
  for (const theme of themes) {
    const id = normalizeThemeId(theme?.id);
    if (!id || id === PERSONAL_DEFAULT_THEME_ID) continue;
    options.push({ value: id, label: theme.name || id, kind: "theme" });
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
