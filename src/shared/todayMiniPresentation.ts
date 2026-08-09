import {
  PERSONAL_DEFAULT_THEME_ID,
  PERSONAL_DEFAULT_THEME_NAME,
  canonicalThemeId,
} from "./themeRef.mjs";

const TODAY_MINI_THEME_COLORS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
] as const;

export interface TodayMiniThemePresentation {
  name: string;
  color: string;
}

/** Shared Today projection for canonical ThemeRef values and standalone tokens. */
export function presentTodayMiniTheme(themes: readonly Record<string, unknown>[], value: unknown): TodayMiniThemePresentation {
  const id = canonicalThemeId(value, { legacyNullMeansPersonal: true });
  const theme = themes.find((candidate) => candidate.id === id);
  const index = theme ? themes.indexOf(theme) : 0;
  const rawColor = typeof theme?.color === "string" ? theme.color.trim() : "";
  const colorKey = TODAY_MINI_THEME_COLORS.includes(rawColor as typeof TODAY_MINI_THEME_COLORS[number])
    ? rawColor
    : TODAY_MINI_THEME_COLORS[((index % TODAY_MINI_THEME_COLORS.length) + TODAY_MINI_THEME_COLORS.length) % TODAY_MINI_THEME_COLORS.length];
  return {
    name: String(theme?.name || (id === PERSONAL_DEFAULT_THEME_ID ? PERSONAL_DEFAULT_THEME_NAME : "個人業務")),
    color: `var(--color-${colorKey})`,
  };
}
