/**
 * 常設の既定Theme「個人業務」（#282）。
 *
 * これまで「個人業務」は Theme の実体ではなく、`project_id` が未設定のときの
 * 表示ラベルでしかなかった。そのため Theme フィルタ・Context Pack・MCP から
 * 通常の Theme として扱えず、個人向けの作業だけ別条件分岐が残っていた。
 *
 * 実体を1件だけ常設し、`project_id` が未設定の既存データはそのままこの Theme へ
 * 解決する。既存データを一括で書き換えないので、backup / restore / import で
 * 所属を失わないし、migration を何度実行しても重複しない。
 *
 * 表示名の文字列比較（`name === "個人業務"`）では識別しない。正本は
 * `system_kind === "personal_default"` と、この安定IDである。
 */

/** 端末・workspaceをまたいで同じ既定Themeだと分かるよう、IDを固定する。 */
export const PERSONAL_DEFAULT_THEME_ID = "theme-personal-default";
export const PERSONAL_DEFAULT_THEME_NAME = "個人業務";
export const PERSONAL_DEFAULT_THEME_KIND = "personal_default";

export function isPersonalDefaultTheme(theme) {
  if (!theme) return false;
  return theme.system_kind === PERSONAL_DEFAULT_THEME_KIND || theme.id === PERSONAL_DEFAULT_THEME_ID;
}

/** 既定Themeは削除・アーカイブできない。誤って消えると所属の解決先が失われる。 */
export function isThemeDeletable(theme) {
  return !isPersonalDefaultTheme(theme);
}

export function buildPersonalDefaultTheme(now = new Date().toISOString()) {
  return {
    id: PERSONAL_DEFAULT_THEME_ID,
    name: PERSONAL_DEFAULT_THEME_NAME,
    system_kind: PERSONAL_DEFAULT_THEME_KIND,
    code: "",
    description: "Themeを決めていない個人の作業。常設の既定Themeで、削除・アーカイブできません。",
    status: "active",
    color: "chart-6",
    created_at: now,
    updated_at: now,
  };
}

/**
 * `project_id` を表示・フィルタ用のTheme IDへ解決する（#282）。
 * 未設定は既定Themeとして扱い、「個人業務だけ検索対象外」のような例外を作らない。
 */
export function resolveThemeId(projectId) {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  return id || PERSONAL_DEFAULT_THEME_ID;
}

/** 解決後のTheme IDが、保存時に `project_id` として書くべき値か。 */
export function projectIdForTheme(themeId) {
  // 既定Themeは実体を持つので、そのIDをそのまま保存してよい。
  return themeId || null;
}

/**
 * 既定Themeを見失わないよう先頭へ固定する。
 * 装飾ではなく順序で「常設」を示す。
 *
 * 既定Theme以外の並びは触らない。利用者が見慣れた順序を、この都合で入れ替えない。
 */
export function sortThemesWithDefaultFirst(themes) {
  const defaults = themes.filter((theme) => isPersonalDefaultTheme(theme));
  const rest = themes.filter((theme) => !isPersonalDefaultTheme(theme));
  return [...defaults, ...rest];
}

/**
 * 既定Themeを1件だけ保証する（#282）。
 * 欠落していれば作り、複数あれば最初の1件だけ残す候補を返す。
 * 破壊的な統合はせず、呼び出し側が保存する操作だけを組み立てる。
 */
export function planPersonalDefaultTheme(themes, now = new Date().toISOString()) {
  const existing = themes.filter((theme) => isPersonalDefaultTheme(theme));
  if (!existing.length) return { create: buildPersonalDefaultTheme(now), duplicates: [] };
  // 同じ既定Themeが複数できてしまった場合、安定IDを持つものを正とする。
  const canonical = existing.find((theme) => theme.id === PERSONAL_DEFAULT_THEME_ID) || existing[0];
  return {
    create: null,
    duplicates: existing.filter((theme) => theme.id !== canonical.id),
  };
}
