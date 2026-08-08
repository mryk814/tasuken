import { canonicalThemeRefForCreate } from "./themeRef.mjs";

export interface TodayMiniThemeChoice {
  value: string;
  kind: "personal" | "theme" | "none";
}

/** Main-side boundary: only the shared picker values are accepted for creation. */
export function resolveTodayMiniThemeRef(options: TodayMiniThemeChoice[], value: unknown) {
  const personal = options.find((option) => option.kind === "personal");
  const candidate = typeof value === "string" && value.trim() ? value.trim() : personal?.value || "";
  const selected = options.find((option) => option.value === candidate && option.kind !== "none");
  if (!selected) throw new Error("選択したThemeが見つかりません。Themeを選び直してください。");
  return canonicalThemeRefForCreate(selected.value);
}
