/**
 * 全EntityでAIへ渡す文脈を同じ意味で扱うための共通metadata契約（#294）。
 *
 * 本文schemaは統一しない。概要・鮮度・根拠・公開範囲・出典だけをEntity間で揃え、
 * MCP・AI Pack・Context Previewが同じ判定関数を通るようにする。
 *
 * 保存フィールドは `ai_` 前置き。既存の `summary`（status_update）や
 * `source`（永続化層の由来）と衝突させないため、Issue本文の名称をそのまま使わない。
 */

/** AIへ渡す相手。Entityごとに独立に許可する（M365可でもCoding Agent不可があり得る）。 */
export const AI_AUDIENCES = ["m365", "coding_agent", "external_ai"];

/**
 * Issue #294のvisibility語彙をgrant集合のpresetとして保つ。
 * 単一のladder（local < m365 < coding_agent < external）にしないのは、
 * M365 CopilotとCoding Agentへ渡してよい情報が一致しないため。
 */
export const AI_VISIBILITY_PRESETS = {
  local_only: [],
  m365_allowed: ["m365"],
  coding_agent_allowed: ["coding_agent"],
  m365_and_coding_agent_allowed: ["m365", "coding_agent"],
  external_ai_allowed: ["m365", "coding_agent", "external_ai"],
};

export const AI_FRESHNESS_VALUES = ["current", "stale", "superseded", "unknown"];

export const AI_AUTHORITY_VALUES = [
  "user_confirmed",
  "imported",
  "ai_generated",
  "inferred",
  "external_source",
];

export const AI_SUMMARY_AUTHORITY_VALUES = [
  "user_confirmed",
  "rule_generated",
  "ai_generated",
  "excerpt",
];

export const AI_SOURCE_REF_KINDS = [
  "url",
  "file",
  "canonical_document",
  "conversation",
  "meeting",
  "repository",
  "external_system",
];

/** 共通metadataを持つEntity種別。ここに無い種別は契約の対象外。 */
export const AI_METADATA_ENTITY_TYPES = [
  "theme",
  "project",
  "item",
  "task",
  "waiting",
  "plan_node",
  "note",
  "resource",
  "capture_entry",
  "knowledge_node",
  "artifact",
  "sketch",
];

/** Entity・Themeともに未設定のときの既定grant。 */
export const DEFAULT_AI_VISIBILITY = ["coding_agent"];

const AI_SUMMARY_MAX = 400;
const AI_EXCERPT_MAX = 160;
const AI_SOURCE_REFS_MAX = 20;

const audienceSet = new Set(AI_AUDIENCES);
const freshnessSet = new Set(AI_FRESHNESS_VALUES);
const authoritySet = new Set(AI_AUTHORITY_VALUES);
const summaryAuthoritySet = new Set(AI_SUMMARY_AUTHORITY_VALUES);
const sourceRefKindSet = new Set(AI_SOURCE_REF_KINDS);
const metadataTypeSet = new Set(AI_METADATA_ENTITY_TYPES);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return value == null ? "" : String(value);
}

export function hasAiMetadataContract(type) {
  return metadataTypeSet.has(type);
}

/** 未設定（null）と「明示的にローカルのみ（空配列）」を区別して返す。 */
export function normalizeAiVisibility(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const preset = AI_VISIBILITY_PRESETS[value];
    if (!preset) throw new Error("ai_visibilityが不正です。");
    return [...preset];
  }
  if (!Array.isArray(value)) throw new Error("ai_visibilityが不正です。");
  const normalized = [];
  for (const entry of value) {
    if (!audienceSet.has(entry)) throw new Error("ai_visibilityが不正です。");
    if (!normalized.includes(entry)) normalized.push(entry);
  }
  return AI_AUDIENCES.filter((audience) => normalized.includes(audience));
}

/** grant集合に一致するpreset名。UI表示と説明のために使う（無ければnull）。 */
export function aiVisibilityPresetOf(audiences) {
  if (!Array.isArray(audiences)) return null;
  const key = AI_AUDIENCES.filter((audience) => audiences.includes(audience)).join(",");
  for (const [name, preset] of Object.entries(AI_VISIBILITY_PRESETS)) {
    if (preset.join(",") === key) return name;
  }
  return null;
}

function normalizeSourceRef(input) {
  if (!isPlainObject(input)) throw new Error("ai_source_refsが不正です。");
  if (!sourceRefKindSet.has(input.kind)) throw new Error("ai_source_refs.kindが不正です。");
  const locator = text(input.locator).trim();
  if (!locator) throw new Error("ai_source_refs.locatorを入力してください。");
  const ref = { kind: input.kind, locator };
  if (text(input.title).trim()) ref.title = text(input.title).trim();
  if (text(input.captured_at).trim()) ref.captured_at = text(input.captured_at).trim();
  if (text(input.last_checked_at).trim()) ref.last_checked_at = text(input.last_checked_at).trim();
  // 正本文書は絶対パスに依存させず、同期root相対で辿れるようにする（#291 / #306）。
  if (text(input.storage_root_id).trim()) ref.storage_root_id = text(input.storage_root_id).trim();
  if (text(input.relative_path).trim()) ref.relative_path = text(input.relative_path).trim();
  return ref;
}

function normalizeSupersededBy(input) {
  if (input == null || input === "") return null;
  if (!isPlainObject(input)) throw new Error("ai_superseded_byが不正です。");
  const type = text(input.type).trim();
  const id = text(input.id).trim();
  if (!type || !id) throw new Error("ai_superseded_byにはtypeとidが必要です。");
  return { type, id };
}

function isIsoTimestamp(value) {
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * 共通metadataだけを正規化して返す。契約対象外の種別では空オブジェクトを返し、
 * 本文フィールドには一切触れない（既存Entityを本文変更なしで移行するため）。
 */
export function normalizeAiMetadata(type, input) {
  if (!hasAiMetadataContract(type) || !isPlainObject(input)) return {};
  const normalized = {};

  const summary = text(input.ai_summary).trim();
  if (summary.length > AI_SUMMARY_MAX) {
    throw new Error(`ai_summaryは${AI_SUMMARY_MAX}文字以内で入力してください。`);
  }
  normalized.ai_summary = summary || null;

  if (input.ai_summary_authority != null && input.ai_summary_authority !== "") {
    if (!summaryAuthoritySet.has(input.ai_summary_authority)) {
      throw new Error("ai_summary_authorityが不正です。");
    }
    normalized.ai_summary_authority = normalized.ai_summary ? input.ai_summary_authority : null;
  } else {
    normalized.ai_summary_authority = null;
  }

  if (input.ai_freshness != null && input.ai_freshness !== "") {
    if (!freshnessSet.has(input.ai_freshness)) throw new Error("ai_freshnessが不正です。");
    normalized.ai_freshness = input.ai_freshness;
  } else {
    normalized.ai_freshness = null;
  }

  if (input.ai_authority != null && input.ai_authority !== "") {
    if (!authoritySet.has(input.ai_authority)) throw new Error("ai_authorityが不正です。");
    normalized.ai_authority = input.ai_authority;
  } else {
    normalized.ai_authority = null;
  }

  normalized.ai_visibility = normalizeAiVisibility(input.ai_visibility);

  const lastVerified = text(input.ai_last_verified_at).trim();
  if (lastVerified && !isIsoTimestamp(lastVerified)) {
    throw new Error("ai_last_verified_atが不正です。");
  }
  normalized.ai_last_verified_at = lastVerified || null;

  normalized.ai_superseded_by = normalizeSupersededBy(input.ai_superseded_by);

  if (input.ai_source_refs == null || input.ai_source_refs === "") {
    normalized.ai_source_refs = [];
  } else if (!Array.isArray(input.ai_source_refs)) {
    throw new Error("ai_source_refsが不正です。");
  } else {
    if (input.ai_source_refs.length > AI_SOURCE_REFS_MAX) {
      throw new Error(`ai_source_refsは${AI_SOURCE_REFS_MAX}件以内にしてください。`);
    }
    normalized.ai_source_refs = input.ai_source_refs.map(normalizeSourceRef);
  }

  // supersededを名乗るなら置き換え先を必須にする。理由なく古い扱いにしない。
  if (normalized.ai_freshness === "superseded" && !normalized.ai_superseded_by) {
    throw new Error("ai_freshnessをsupersededにするには置き換え先を指定してください。");
  }

  if (type === "theme") {
    normalized.default_ai_visibility = normalizeAiVisibility(input.default_ai_visibility);
  }

  return normalized;
}

/** Entity本文の位置は種別ごとに違う。暫定summaryと本文除外の判定をここへ集約する。 */
export function aiEntityBodyText(type, entity) {
  if (!isPlainObject(entity)) return "";
  if (type === "note" || type === "resource") return text(entity.body_markdown);
  if (type === "capture_entry") return text(entity.text);
  if (type === "knowledge_node") return text(entity.body);
  if (type === "theme" || type === "project") return text(entity.description);
  return text(entity.description);
}

function excerpt(value, limit = AI_EXCERPT_MAX) {
  const raw = text(value).replace(/\r\n?/g, "\n").replace(/[#>*`_]/g, "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.length <= limit ? raw : `${raw.slice(0, limit)}…`;
}

/**
 * 概要の解決。ユーザー確定 > 決定的ルール > AI提案 > 本文先頭の暫定生成、の順。
 * 暫定生成をuser_confirmedとして返さない。
 */
export function resolveAiSummary(type, entity) {
  const stored = text(entity?.ai_summary).trim();
  if (stored) {
    return {
      summary: stored,
      authority: entity.ai_summary_authority || "user_confirmed",
      origin: "explicit",
    };
  }
  const body = excerpt(aiEntityBodyText(type, entity));
  if (!body) return { summary: "", authority: null, origin: "missing" };
  return { summary: body, authority: "excerpt", origin: "derived" };
}

/**
 * 鮮度の解決。日付が古いだけでstaleとは断定しない（#294の非ゴール）。
 * 明示値が無い場合、置き換え先があるときだけsupersededを導出する。
 */
export function resolveAiFreshness(entity) {
  if (entity?.ai_freshness) {
    return { freshness: entity.ai_freshness, origin: "explicit", reason: "明示的に設定されています。" };
  }
  if (entity?.ai_superseded_by) {
    return { freshness: "superseded", origin: "derived", reason: "置き換え先が設定されています。" };
  }
  return { freshness: "unknown", origin: "unset", reason: "鮮度が未設定です。最終確認日を記録すると判定できます。" };
}

/**
 * 根拠の解決。明示値が無いときは保存経路から推定し、推定であることを必ず添える。
 * 推定値をDBへ書き戻さない（既存Entityを本文変更なしで扱うため）。
 */
export function resolveAiAuthority(type, entity) {
  if (entity?.ai_authority) {
    return { authority: entity.ai_authority, origin: "explicit", reason: "明示的に設定されています。" };
  }
  const source = text(entity?.source);
  if (source === "imported" || source === "import") {
    return { authority: "imported", origin: "derived", reason: "取り込み経路で保存されたデータです。" };
  }
  if (source === "ai") {
    return { authority: "ai_generated", origin: "derived", reason: "AI経路で保存されたデータです。" };
  }
  if (type === "artifact") {
    const generatedBy = text(entity?.generated_by);
    if (generatedBy && generatedBy !== "manual") {
      return { authority: "ai_generated", origin: "derived", reason: `生成元が${generatedBy}です。` };
    }
  }
  if (entity?.source_record_id) {
    return { authority: "imported", origin: "derived", reason: "取り込み元レコードが紐づいています。" };
  }
  return { authority: null, origin: "unset", reason: "根拠が未設定です。確認済みかどうかを記録できます。" };
}

/**
 * 公開範囲の解決。Entity → Theme既定 → workspace既定 の順で継承し、
 * どこから来た値かを必ず返す（未設定と明示許可を区別するため）。
 */
export function resolveAiVisibility({ entity, theme, workspaceDefault } = {}) {
  const entityValue = Array.isArray(entity?.ai_visibility) ? entity.ai_visibility : null;
  if (entityValue) {
    return { audiences: [...entityValue], source: "entity", reason: "この項目で明示的に設定されています。" };
  }
  const themeValue = Array.isArray(theme?.default_ai_visibility) ? theme.default_ai_visibility : null;
  if (themeValue) {
    return {
      audiences: [...themeValue],
      source: "theme",
      reason: `Theme「${text(theme.name) || "未設定"}」の既定を継承しています。`,
    };
  }
  const fallback = Array.isArray(workspaceDefault) ? workspaceDefault : DEFAULT_AI_VISIBILITY;
  return { audiences: [...fallback], source: "workspace_default", reason: "全体の既定を使用しています。" };
}

export function isAiAudienceAllowed(audiences, audience) {
  return Array.isArray(audiences) && audiences.includes(audience);
}

/**
 * AI出力へ載せる共通header。本文は含めない（本文の可否は判定結果で別に返す）。
 */
export function buildAiEntityHeader(type, entity, context = {}) {
  const summary = resolveAiSummary(type, entity);
  const freshness = resolveAiFreshness(entity);
  const authority = resolveAiAuthority(type, entity);
  const visibility = resolveAiVisibility({
    entity,
    theme: context.theme,
    workspaceDefault: context.workspaceDefault,
  });
  return {
    id: text(entity?.id),
    type,
    title: text(entity?.title || entity?.name),
    summary: summary.summary,
    summary_authority: summary.authority,
    summary_origin: summary.origin,
    freshness: freshness.freshness,
    freshness_origin: freshness.origin,
    freshness_reason: freshness.reason,
    authority: authority.authority,
    authority_origin: authority.origin,
    authority_reason: authority.reason,
    ai_visibility: visibility.audiences,
    ai_visibility_source: visibility.source,
    ai_visibility_reason: visibility.reason,
    theme_id: text(entity?.project_id || entity?.theme_id) || null,
    updated_at: text(entity?.updated_at) || null,
    last_verified_at: entity?.ai_last_verified_at || null,
    superseded_by: entity?.ai_superseded_by || null,
    source_refs: Array.isArray(entity?.ai_source_refs) ? entity.ai_source_refs : [],
  };
}

/**
 * 対象audienceへ渡してよいかの判定。渡せない場合は本文もheaderも返させない。
 * 呼び出し側は excluded を件数と理由で集計して提示する。
 */
export function projectEntityForAi(type, entity, context = {}) {
  const audience = context.audience;
  if (!audienceSet.has(audience)) throw new Error("AIの公開先が不正です。");
  const header = buildAiEntityHeader(type, entity, context);
  if (!isAiAudienceAllowed(header.ai_visibility, audience)) {
    return {
      included: false,
      header: null,
      exclusion: {
        id: header.id,
        type,
        reason: header.ai_visibility_source === "entity"
          ? "この項目のAI公開範囲に含まれていません。"
          : header.ai_visibility_source === "theme"
            ? "ThemeのAI公開範囲に含まれていません。"
            : "全体の既定でAI公開範囲に含まれていません。",
      },
    };
  }
  return { included: true, header, exclusion: null };
}

/** 除外の内訳。「全部渡した」ように見せないため、必ず理由付きで集計する。 */
export function summarizeAiExclusions(exclusions) {
  const list = (exclusions || []).filter(Boolean);
  const byReason = new Map();
  for (const entry of list) {
    const key = `${entry.type}|${entry.reason}`;
    const current = byReason.get(key) || { type: entry.type, reason: entry.reason, count: 0 };
    current.count += 1;
    byReason.set(key, current);
  }
  return { excluded_count: list.length, excluded_reasons: [...byReason.values()] };
}
