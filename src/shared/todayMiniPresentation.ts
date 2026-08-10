import {
  PERSONAL_DEFAULT_THEME_ID,
  PERSONAL_DEFAULT_THEME_NAME,
  THEME_COLOR_TOKENS,
  canonicalThemeId,
} from "./themeRef.mjs";

export interface TodayMiniThemePresentation {
  name: string;
  color: string;
}

/** Shared Today projection for canonical ThemeRef values and standalone tokens. */
export function presentTodayMiniTheme(themes: readonly Record<string, unknown>[], value: unknown): TodayMiniThemePresentation {
  const id = canonicalThemeId(value, { legacyNullMeansPersonal: true });
  const theme = themes.find((candidate) => candidate.id === id);
  if (!theme) {
    return id === PERSONAL_DEFAULT_THEME_ID
      ? { name: PERSONAL_DEFAULT_THEME_NAME, color: "var(--color-chart-6)" }
      : { name: "Theme不明", color: "var(--color-border-strong)" };
  }
  const index = theme ? themes.indexOf(theme) : 0;
  const rawColor = typeof theme?.color === "string" ? theme.color.trim() : "";
  const colorKey = THEME_COLOR_TOKENS.includes(rawColor)
    ? rawColor
    : THEME_COLOR_TOKENS[((index % THEME_COLOR_TOKENS.length) + THEME_COLOR_TOKENS.length) % THEME_COLOR_TOKENS.length];
  return {
    name: String(theme.name || (id === PERSONAL_DEFAULT_THEME_ID ? PERSONAL_DEFAULT_THEME_NAME : "Theme不明")),
    color: `var(--color-${colorKey})`,
  };
}
