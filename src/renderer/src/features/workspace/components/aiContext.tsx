import { AiCreationMark } from "./AiCreationMark";
import { useState } from "react";

import {
  hasAiMetadataContract,
  resolveAiAuthority,
  resolveAiFreshness,
  resolveAiSummary,
} from "../../../../../shared/aiMetadata.mjs";
import type { AiSourceRef } from "../../../../../shared/aiMetadata.mjs";
import {
  AI_AUTHORITY_LABELS,
  AI_FRESHNESS_LABELS,
  ENTITY_REF_TYPE_LABELS,
  AI_SOURCE_REF_KIND_LABELS,
  AI_SUMMARY_AUTHORITY_LABELS,
  AI_UNSET_LABEL,
} from "../domain-model/labels";
import type { EntityRefType } from "../domain-model/types";
import { Field } from "./common";

/** 共通metadataを持つEntityだけがこのセクションを出す（#294）。 */
export function hasAiContextSection(type: string): boolean {
  return hasAiMetadataContract(type);
}

/** 置き換え先に指定できる種別。参照できるEntityだけを出す。 */
const SUPERSEDED_BY_TYPES: EntityRefType[] = [
  "note",
  "task",
  "knowledge_node",
  "resource",
  "plan_node",
];

/**
 * 詳細ドロワーの「AI・情報状態」。通常編集を圧迫しないよう読み取り中心にし、
 * 未設定は空欄にせず理由の分かる語で示す。
 */
export function AiContextSummary({
  type,
  entity,
}: {
  type: string;
  entity: Record<string, unknown>;
}) {
  if (!hasAiContextSection(type)) return null;
  const summary = resolveAiSummary(type, entity);
  const freshness = resolveAiFreshness(entity);
  const authority = resolveAiAuthority(type, entity);
  const sourceRefs: AiSourceRef[] = Array.isArray(entity.ai_source_refs)
    ? entity.ai_source_refs
    : [];
  const lastVerified = String(entity.ai_last_verified_at || "");
  return (
    <section className="ai-context-summary">
      <h3>AI・情報状態</h3>
      <AiCreationMark key={String(entity.id)} entity={entity} type={type} detail />
      <dl>
        <dt>概要</dt>
        <dd>
          {summary.summary || AI_UNSET_LABEL}
          {summary.authority && (
            <span className="ai-context-note">
              {AI_SUMMARY_AUTHORITY_LABELS[summary.authority]}
            </span>
          )}
        </dd>
        <dt>状態</dt>
        <dd>
          {AI_FRESHNESS_LABELS[freshness.freshness]}
          {freshness.origin !== "explicit" && (
            <span className="ai-context-note">{freshness.reason}</span>
          )}
        </dd>
        <dt>根拠</dt>
        <dd>
          {authority.authority ? AI_AUTHORITY_LABELS[authority.authority] : AI_UNSET_LABEL}
          <span className="ai-context-note">{authority.reason}</span>
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
}: {
  type: string;
  entity: Record<string, unknown>;
}) {
  const [freshness, setFreshness] = useState(String(entity.ai_freshness || ""));
  const storedSourceRefs: AiSourceRef[] = Array.isArray(entity.ai_source_refs)
    ? entity.ai_source_refs
    : [];
  // 空行は保存時に捨てるので、行数だけを状態に持つ（値はフォームが正本）。
  const [sourceRefRows, setSourceRefRows] = useState(storedSourceRefs.length + 1);
  if (!hasAiContextSection(type)) return null;
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
        <select
          name="ai_summary_authority"
          defaultValue={String(entity.ai_summary_authority || "user_confirmed")}
        >
          {Object.entries(AI_SUMMARY_AUTHORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
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
            <option key={value} value={value}>
              {AI_FRESHNESS_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>
      {/* 置き換え先は superseded を選んだときだけ聞く。常設の入力欄を増やさない。 */}
      {freshness === "superseded" && (
        <>
          <Field label="置き換えた項目の種別">
            <select
              name="ai_superseded_by_type"
              defaultValue={String(supersededBy?.type || "note")}
            >
              {SUPERSEDED_BY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ENTITY_REF_TYPE_LABELS[value]}
                </option>
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
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="最終確認日">
        <input
          type="date"
          name="ai_last_verified_at"
          defaultValue={String(entity.ai_last_verified_at || "").slice(0, 10)}
        />
      </Field>
      <fieldset className="ai-context-source-refs">
        <legend>出典</legend>
        {Array.from({ length: sourceRefRows }, (_, index) => {
          const ref = storedSourceRefs[index];
          return (
            <div className="ai-context-source-row" key={index}>
              <select
                name="ai_source_ref_kind"
                defaultValue={ref?.kind || "url"}
                aria-label="出典の種類"
              >
                {Object.entries(AI_SOURCE_REF_KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                name="ai_source_ref_locator"
                defaultValue={ref?.locator || ""}
                placeholder="URL・パス・IDなど"
                aria-label="出典の場所"
              />
              <input
                name="ai_source_ref_title"
                defaultValue={ref?.title || ""}
                placeholder="表示名（任意）"
                aria-label="出典の表示名"
              />
            </div>
          );
        })}
        <button
          type="button"
          className="text-button compact"
          onClick={() => setSourceRefRows((rows) => rows + 1)}
        >
          出典を追加
        </button>
        <p className="ai-context-note">場所を空にすると、その行は保存時に外れます。</p>
      </fieldset>
    </details>
  );
}
