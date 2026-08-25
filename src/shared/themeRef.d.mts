export type ThemeRef = { kind: "theme"; id: string } | { kind: "none"; id: null };
export interface ThemeCharter {
  schema: "tasken-theme-charter/v1";
  purpose: string;
  desired_outcome: string;
  principles: string[];
  scope: string;
  non_goals: string[];
  long_term_questions: string[];
  learning_interests: string[];
}
export interface ThemeState {
  schema: "tasken-theme-state/v1";
  current_direction: string;
  active_questions: string[];
  current_bets: string[];
  blockers: string[];
  unresolved_decisions: string[];
  next_frontier: string;
  updated_at: string | null;
}
export type ThemePickerOption = {
  value: string;
  label: string;
  kind: "personal" | "theme" | "none";
  colorToken?:
    | "chart-1"
    | "chart-2"
    | "chart-3"
    | "chart-4"
    | "chart-5"
    | "chart-6"
    | "theme-extra-1"
    | "theme-extra-2"
    | "theme-extra-3"
    | "theme-extra-4";
};
export const THEME_COLOR_TOKENS: readonly string[];
export const PERSONAL_DEFAULT_THEME_ID: string;
export const PERSONAL_DEFAULT_THEME_NAME: string;
export const PERSONAL_DEFAULT_THEME_KIND: string;
export const THEME_NONE_VALUE: string;
export const THEME_CHARTER_SCHEMA: ThemeCharter["schema"];
export const THEME_STATE_SCHEMA: ThemeState["schema"];
export function normalizeThemeId(value: unknown): string | null;
export function defaultThemeRef(): ThemeRef;
export function noneThemeRef(): ThemeRef;
export function themeRefFromId(
  value: unknown,
  options?: { defaultPersonal?: boolean; legacyNullMeansPersonal?: boolean },
): ThemeRef;
export function themeRefFromEntity(
  entity: Record<string, unknown>,
  options?: { defaultPersonal?: boolean; legacyNullMeansPersonal?: boolean },
): ThemeRef;
export function canonicalThemeId(
  value: unknown,
  options?: { defaultPersonal?: boolean; legacyNullMeansPersonal?: boolean },
): string | null;
export function themeIdForEntityType(type: string): string | null;
export function themePickerOptions(
  themes?: Record<string, unknown>[],
  options?: { allowPersonal?: boolean; allowNone?: boolean },
): ThemePickerOption[];
export function resolveThemeRef(
  themes: Record<string, any>[],
  value: unknown,
  options?: { defaultPersonal?: boolean; legacyNullMeansPersonal?: boolean },
): { kind: string; id: string | null; theme: Record<string, any> | null; missing: boolean };
export function canonicalThemeRefForCreate(value: unknown): ThemeRef;
export function normalizeThemeCharter(value: unknown): ThemeCharter | null;
export function normalizeThemeState(
  value: unknown,
  options?: { updatedAt?: unknown },
): ThemeState | null;
export function themeIntentContent(value: unknown): {
  charter: ThemeCharter | null;
  state: ThemeState | null;
};
export function publicThemeIntent(
  theme: unknown,
  budget: { take(value: unknown, perFieldLimit?: number): string },
): { charter: ThemeCharter | null; state: ThemeState | null };
