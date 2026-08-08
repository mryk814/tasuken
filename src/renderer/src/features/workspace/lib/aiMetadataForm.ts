import type { AiAudience, AiMetadataFields, AiSourceRef } from "../../../../../shared/aiMetadata.mjs";
import { normalizeAiVisibility } from "../../../../../shared/aiMetadata.mjs";
import type { AiMetadata } from "../domain-model/types";
import { formText } from "./format";

const AI_METADATA_KEYS = [
  "ai_summary",
  "ai_summary_authority",
  "ai_freshness",
  "ai_authority",
  "ai_visibility",
  "ai_last_verified_at",
  "ai_superseded_by",
  "ai_source_refs",
] as const;

/** 保存経路がフォームの値でEntityを組み立て直すため、欄が無いときは既存値を持ち回る。 */
export function carryAiMetadata(base: Record<string, unknown>): AiMetadata {
  const carried: Record<string, unknown> = {};
  for (const key of AI_METADATA_KEYS) {
    if (base[key] !== undefined) carried[key] = base[key];
  }
  return carried as AiMetadata;
}

function readVisibility(values: FormData): AiAudience[] | null {
  // 個別設定のチェックを外したら「未設定」に戻し、Theme・全体の既定へ継承させる。
  if (!values.getAll("ai_visibility_override").map(String).includes("true")) return null;
  return normalizeAiVisibility(values.getAll("ai_visibility").map(String)) || [];
}

/**
 * 出典。場所が空の行は保存しない（追加用の空行と削除を同じ操作で扱う）。
 * `storage_root_id` / `relative_path` はImport・正本Markdown経路が付けるため、
 * フォームで触らずに既存値をそのまま引き継ぐ。
 */
function readSourceRefs(values: FormData, base: Record<string, unknown>): AiMetadataFields["ai_source_refs"] {
  const stored: AiSourceRef[] = Array.isArray(base.ai_source_refs) ? base.ai_source_refs as AiSourceRef[] : [];
  const kinds = values.getAll("ai_source_ref_kind").map(String);
  const locators = values.getAll("ai_source_ref_locator").map(String);
  const titles = values.getAll("ai_source_ref_title").map(String);
  return locators.flatMap((locator, index): AiSourceRef[] => {
    const trimmed = locator.trim();
    if (!trimmed) return [];
    const previous = stored[index];
    const title = titles[index]?.trim();
    return [{
      ...(previous && previous.locator === trimmed ? previous : {}),
      kind: (kinds[index] || "url") as AiSourceRef["kind"],
      locator: trimmed,
      ...(title ? { title } : {}),
    }];
  });
}

function readSupersededBy(values: FormData): AiMetadataFields["ai_superseded_by"] {
  const type = formText(values, "ai_superseded_by_type");
  const id = formText(values, "ai_superseded_by_id");
  if (!type || !id) return null;
  return { type, id };
}

/**
 * AI共通metadata（#294）をフォームから読む。欄が無い保存経路では既存値を保持し、
 * 編集ドロワー以外の保存でmetadataが消えないようにする。
 */
export function aiMetadataFromForm(
  values: FormData,
  base: Record<string, unknown>,
  hasField: (name: string) => boolean,
): AiMetadata {
  if (!hasField("ai_context_present")) return carryAiMetadata(base);
  const summary = formText(values, "ai_summary");
  const supersededBy = readSupersededBy(values);
  const freshness = formText(values, "ai_freshness");
  const lastVerified = formText(values, "ai_last_verified_at");
  return {
    ai_summary: summary || null,
    ai_summary_authority: summary
      ? (formText(values, "ai_summary_authority") || "user_confirmed") as AiMetadataFields["ai_summary_authority"]
      : null,
    // 置き換え先が無いままsupersededにしない。理由なく古い扱いへ倒さない。
    ai_freshness: freshness === "superseded" && !supersededBy
      ? null
      : (freshness || null) as AiMetadataFields["ai_freshness"],
    ai_authority: (formText(values, "ai_authority") || null) as AiMetadataFields["ai_authority"],
    ai_visibility: readVisibility(values),
    ai_last_verified_at: lastVerified || null,
    ai_superseded_by: supersededBy,
    ai_source_refs: readSourceRefs(values, base),
  };
}

/** ThemeのAI公開既定。個別設定を外したら全体の既定へ戻す。 */
export function themeDefaultAiVisibilityFromForm(
  values: FormData,
  base: Record<string, unknown>,
  hasField: (name: string) => boolean,
): AiAudience[] | null {
  if (!hasField("default_ai_visibility_override")) {
    return (base.default_ai_visibility as AiAudience[] | null | undefined) ?? null;
  }
  if (!values.getAll("default_ai_visibility_override").map(String).includes("true")) return null;
  return normalizeAiVisibility(values.getAll("default_ai_visibility").map(String)) || [];
}
