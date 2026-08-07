import { useState } from "react";

import {
  AI_AUDIENCES,
  aiVisibilityPresetOf,
  hasAiMetadataContract,
  resolveAiAuthority,
  resolveAiFreshness,
  resolveAiSummary,
  resolveAiVisibility,
} from "../../../../../shared/aiMetadata.mjs";
import type { AiAudience, AiSourceRef } from "../../../../../shared/aiMetadata.mjs";
import {
  AI_AUDIENCE_LABELS,
  AI_AUTHORITY_LABELS,
  AI_FRESHNESS_LABELS,
  ENTITY_REF_TYPE_LABELS,
  AI_SOURCE_REF_KIND_LABELS,
  AI_SUMMARY_AUTHORITY_LABELS,
  AI_UNSET_LABEL,
  AI_VISIBILITY_PRESET_LABELS,
  AI_VISIBILITY_SOURCE_LABELS,
} from "../domain-model/labels";
import type { EntityRefType } from "../domain-model/types";
import { Field } from "./common";
import type { Theme, WorkspaceData } from "../types";

/** 共通metadataを持つEntityだけがこのセクションを出す（#294）。 */
export function hasAiContextSection(type: string): boolean {
  return hasAiMetadataContract(type);
}

/** workspace既定のAI公開範囲。未取得のうちはnullを返し、契約側の既定へ委ねる。 */
export function workspaceAiVisibility(data: WorkspaceData): AiAudience[] | null {
  const value = data.meta?.aiVisibilityDefault;
  return Array.isArray(value) ? value : null;
}

/** 置き換え先に指定できる種別。参照できるEntityだけを出す。 */
const SUPERSEDED_BY_TYPES: EntityRefType[] = ["note", "task", "knowledge_node", "resource", "plan_node"];

function audienceListLabel(audiences: AiAudience[]): string {
  const preset = aiVisibilityPresetOf(audiences);
  if (preset) return AI_VISIBILITY_PRESET_LABELS[preset];
  return audiences.map((audience) => AI_AUDIENCE_LABELS[audience]).join(" / ");
}

function themeOf(entity: Record<string, unknown>, themes: Theme[]): Theme | null {
  const themeId = String(entity.project_id || entity.theme_id || "");
  if (!themeId) return null;
  return themes.find((theme) => theme.id === themeId) || null;
}

/**
 * 詳細ドロワーの「AI・情報状態」。通常編集を圧迫しないよう読み取り中心にし、
 * 未設定は空欄にせず理由の分かる語で示す。
 */
export function AiContextSummary({
  type,
  entity,
  themes = [],
  workspaceDefault,
}: {
  type: string;
  entity: Record<string, unknown>;
  themes?: Theme[];
  workspaceDefault?: AiAudience[] | null;
}) {
  if (!hasAiContextSection(type)) return null;
  const summary = resolveAiSummary(type, entity);
  const freshness = resolveAiFreshness(entity);
  const authority = resolveAiAuthority(type, entity);
  const visibility = resolveAiVisibility({
    entity,
    theme: themeOf(entity, themes),
    workspaceDefault,
  });
  const sourceRefs: AiSourceRef[] = Array.isArray(entity.ai_source_refs) ? entity.ai_source_refs : [];
  const lastVerified = String(entity.ai_last_verified_at || "");
  return (
    <section className="ai-context-summary">
      <h3>AI・情報状態</h3>
      <dl>
        <dt>概要</dt>
        <dd>
          {summary.summary || AI_UNSET_LABEL}
          {summary.authority && (
            <span className="ai-context-note">{AI_SUMMARY_AUTHORITY_LABELS[summary.authority]}</span>
          )}
        </dd>
        <dt>状態</dt>
        <dd>
          {AI_FRESHNESS_LABELS[freshness.freshness]}
          {freshness.origin !== "explicit" && <span className="ai-context-note">{freshness.reason}</span>}
        </dd>
        <dt>根拠</dt>
        <dd>
          {authority.authority ? AI_AUTHORITY_LABELS[authority.authority] : AI_UNSET_LABEL}
          <span className="ai-context-note">{authority.reason}</span>
        </dd>
        <dt>AI公開</dt>
        <dd>
          {visibility.audiences.length ? audienceListLabel(visibility.audiences) : AI_VISIBILITY_PRESET_LABELS.local_only}
          <span className="ai-context-note">{AI_VISIBILITY_SOURCE_LABELS[visibility.source]}</span>
        </dd>
        <dt>最終確認</dt>
        <dd>{lastVerified ? lastVerified.slice(0, 10) : AI_UNSET_LABEL}</dd>
        {sourceRefs.length > 0 && (
          <>
            <dt>出典</dt>
            <dd>
              <ul className="ai-context-source-list">
                {sourceRefs.map((ref, index) => (
                  <li key={`${ref.kind}:${ref.locator}:${index}`}>
                    {AI_SOURCE_REF_KIND_LABELS[ref.kind]}: {ref.title || ref.locator}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

/**
 * 編集ドロワーの入力欄。既定は折りたたみ、通常編集の主目的を1種類に保つ。
 * hidden の `ai_context_present` は「フォームに欄がある」ことの目印で、
 * 欄が無い保存経路が既存値を消さないようにする。
 */
export function AiContextFields({
  type,
  entity,
  themes = [],
  workspaceDefault,
}: {
  type: string;
  entity: Record<string, unknown>;
  themes?: Theme[];
  workspaceDefault?: AiAudience[] | null;
}) {
  const [freshness, setFreshness] = useState(String(entity.ai_freshness || ""));
  if (!hasAiContextSection(type)) return null;
  const inherited = resolveAiVisibility({
    entity: null,
    theme: themeOf(entity, themes),
    workspaceDefault,
  });
  const visibility = Array.isArray(entity.ai_visibility) ? (entity.ai_visibility as AiAudience[]) : null;
  const supersededBy = entity.ai_superseded_by as { type?: string; id?: string } | null | undefined;
  return (
    <details className="ai-context-fields">
      <summary>AI・情報状態</summary>
      <input type="hidden" name="ai_context_present" value="true" />
      <Field label="AI向け概要">
        <textarea
          name="ai_summary"
          maxLength={400}
          defaultValue={String(entity.ai_summary || "")}
          placeholder="本文を読む前に判断できる短い説明"
        />
      </Field>
      <Field label="概要の根拠">
        <select name="ai_summary_authority" defaultValue={String(entity.ai_summary_authority || "user_confirmed")}>
          {Object.entries(AI_SUMMARY_AUTHORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      <Field label="鮮度">
        <select
          name="ai_freshness"
          defaultValue={String(entity.ai_freshness || "")}
          onChange={(event) => setFreshness(event.target.value)}
        >
          <option value="">{AI_UNSET_LABEL}</option>
          {(["current", "stale", "superseded"] as const).map((value) => (
            <option key={value} value={value}>{AI_FRESHNESS_LABELS[value]}</option>
          ))}
        </select>
      </Field>
      {/* 置き換え先は superseded を選んだときだけ聞く。常設の入力欄を増やさない。 */}
      {freshness === "superseded" && (
        <>
          <Field label="置き換えた項目の種別">
            <select name="ai_superseded_by_type" defaultValue={String(supersededBy?.type || "note")}>
              {SUPERSEDED_BY_TYPES.map((value) => (
                <option key={value} value={value}>{ENTITY_REF_TYPE_LABELS[value]}</option>
              ))}
            </select>
          </Field>
          <Field label="置き換えた項目のID">
            <input name="ai_superseded_by_id" defaultValue={String(supersededBy?.id || "")} />
          </Field>
        </>
      )}
      <Field label="根拠">
        <select name="ai_authority" defaultValue={String(entity.ai_authority || "")}>
          <option value="">{AI_UNSET_LABEL}</option>
          {Object.entries(AI_AUTHORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      <Field label="最終確認日">
        <input type="date" name="ai_last_verified_at" defaultValue={String(entity.ai_last_verified_at || "").slice(0, 10)} />
      </Field>
      <fieldset className="ai-context-visibility">
        <legend>AI公開範囲</legend>
        <label>
          <input
            type="checkbox"
            name="ai_visibility_override"
            value="true"
            defaultChecked={Boolean(visibility)}
          />
          この項目で個別に設定する
        </label>
        {AI_AUDIENCES.map((audience) => (
          <label key={audience}>
            <input
              type="checkbox"
              name="ai_visibility"
              value={audience}
              defaultChecked={(visibility || inherited.audiences).includes(audience)}
            />
            {AI_AUDIENCE_LABELS[audience]}
          </label>
        ))}
        <p className="ai-context-note">
          個別設定を外すと{AI_VISIBILITY_SOURCE_LABELS[inherited.source]}（
          {inherited.audiences.length ? audienceListLabel(inherited.audiences) : AI_VISIBILITY_PRESET_LABELS.local_only}
          ）を使います。
        </p>
      </fieldset>
    </details>
  );
}

/** ThemeのAI公開既定。配下Entityが未設定のときの継承元になる。 */
export function ThemeAiVisibilityField({
  value,
  workspaceDefault,
}: {
  value?: AiAudience[] | null;
  workspaceDefault?: AiAudience[] | null;
}) {
  const fallback = Array.isArray(workspaceDefault) ? workspaceDefault : [];
  const current = Array.isArray(value) ? value : null;
  return (
    <fieldset className="ai-context-visibility">
      <legend>配下のAI公開既定</legend>
      <label>
        <input
          type="checkbox"
          name="default_ai_visibility_override"
          value="true"
          defaultChecked={Boolean(current)}
        />
        このThemeで既定を決める
      </label>
      {AI_AUDIENCES.map((audience) => (
        <label key={audience}>
          <input
            type="checkbox"
            name="default_ai_visibility"
            value={audience}
            defaultChecked={(current || fallback).includes(audience)}
          />
          {AI_AUDIENCE_LABELS[audience]}
        </label>
      ))}
      <p className="ai-context-note">
        既定を決めないときは全体の既定（
        {fallback.length ? audienceListLabel(fallback) : AI_VISIBILITY_PRESET_LABELS.local_only}
        ）を使います。
      </p>
    </fieldset>
  );
}
