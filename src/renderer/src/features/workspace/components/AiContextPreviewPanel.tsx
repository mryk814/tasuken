import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";

import type { AiContextPreviewAudience, AiContextPreviewResult, AiContextPreviewScope } from "../../../../../shared/ipc/contracts";
import type { PreviewEntityRef } from "../../../../../shared/aiContextPreview.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import type { DrawerConfig, OpenDrawer, WorkspaceData } from "../types";

const AUDIENCE_LABELS: Record<AiContextPreviewAudience, string> = {
  m365: "M365",
  coding_agent: "Coding Agent",
};

export function drawerTargetForPreview(data: WorkspaceData, ref: PreviewEntityRef): DrawerConfig | null {
  const lookup = (records: Array<Record<string, unknown>> | undefined, type: DrawerConfig["type"]) => {
    const entity = records?.find((entry) => String(entry.id) === ref.id);
    return entity ? { type, mode: "view" as const, entity } : null;
  };
  if (ref.type === "project" || ref.type === "theme") return lookup(data.themes, "theme");
  if (ref.type === "task") return lookup(data.tasks, "task");
  if (ref.type === "note") return lookup(data.notes, "note");
  if (ref.type === "resource") return lookup(data.resources, "resource");
  if (ref.type === "knowledge_node") return lookup(data.knowledge_nodes, "knowledge_node");
  if (ref.type === "knowledge_edge") return lookup(data.knowledge_edges, "knowledge_edge");
  if (ref.type === "waiting") return lookup(data.waitings, "waiting");
  if (ref.type === "plan_node") return lookup(data.plan_nodes, "plan_node");
  if (ref.type === "capture_entry") return lookup(data.capture_entrys, "capture_entry");
  if (ref.type === "sketch") return lookup(data.sketches, "sketch");
  return null;
}

function metadataValue(value: string | null | undefined): string {
  return value || "unknown";
}

export function AiContextPreviewPanel({
  scope,
  data,
  openDrawer,
}: {
  scope: AiContextPreviewScope;
  data: WorkspaceData;
  openDrawer: OpenDrawer;
}) {
  const [audience, setAudience] = useState<AiContextPreviewAudience>("coding_agent");
  const [results, setResults] = useState<Partial<Record<AiContextPreviewAudience, { scopeKey: string; result: AiContextPreviewResult }>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const scopeKey = `${scope.type}:${scope.id}`;
  const cached = results[audience]?.scopeKey === scopeKey ? results[audience]?.result : null;

  const refresh = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError("");
    try {
      const result = await workspaceApi.previewAiContext({ scope, audience });
      if (requestSequence.current !== sequence) return;
      if (result.state === "error") {
        setError(result.error || "Context Previewを作成できませんでした。元Entityの公開範囲を確認してください。");
        setResults((current) => current[audience]?.scopeKey === scopeKey ? current : ({ ...current, [audience]: { scopeKey, result } }));
      } else {
        setResults((current) => ({ ...current, [audience]: { scopeKey, result } }));
      }
    } catch (reason) {
      if (requestSequence.current === sequence) setError(reason instanceof Error ? reason.message : "Context Previewを作成できませんでした。もう一度お試しください。");
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, [audience, scope.id, scope.type, scopeKey]);

  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh]);

  const result = cached && cached.state !== "error" ? cached : null;
  const preview = result?.preview || null;
  const represented = useMemo(() => preview?.included.slice(0, 14) || [], [preview]);

  const openRef = (ref: PreviewEntityRef) => {
    const target = drawerTargetForPreview(data, ref);
    if (target) openDrawer(target);
  };

  return (
    <section className="ai-context-preview-panel" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h3>Context Preview</h3>
          <span className="muted-text">実際のAI公開選択</span>
        </div>
        <div className="inline-actions">
          {(Object.keys(AUDIENCE_LABELS) as AiContextPreviewAudience[]).map((value) => (
            <button key={value} type="button" className={`text-button compact ${audience === value ? "is-active" : ""}`} aria-pressed={audience === value} onClick={() => setAudience(value)}>
              {AUDIENCE_LABELS[value]}
            </button>
          ))}
          <button type="button" className="text-button compact icon-only" aria-label="Context Previewを更新" disabled={loading} onClick={() => void refresh()}><IconRefresh size={15} /></button>
        </div>
      </div>
      {loading && !result && <div className="ai-context-preview-state">Contextを確認中…</div>}
      {error && <div className="alert-note danger">{error} 入力と前回のPreviewは保持しています。</div>}
      {!loading && !error && result?.state === "empty" && <div className="ai-context-preview-state">公開対象はありません。visibilityとrelationを確認してください。</div>}
      {result && preview && (
        <div className="ai-context-preview-body">
          <div className="ai-context-preview-metrics">
            <span><strong>{preview.counts.included}</strong> included</span>
            <span><strong>{preview.counts.excluded}</strong> excluded</span>
            <span><strong>{preview.counts.relations}</strong> relations</span>
            <span><strong>{preview.estimates.tokens ?? Math.ceil((preview.estimates.characters || 0) / 4)}</strong> tokens est.</span>
          </div>
          {scope.type === "task" && audience === "m365" && (
            <p className={`ai-context-preview-scope ${result.includedInEffectiveScope ? "is-included" : "is-excluded"}`}>
              このTaskはTheme AI Packに{result.includedInEffectiveScope ? "含まれます" : "含まれません"}。実効scope: Theme {result.effectiveScope.id}
            </p>
          )}
          {preview.truncation.truncated && <p className="alert-note warning">上限で省略: {preview.truncation.reasons.join(" / ") || "producer limit"}</p>}
          <details open className="ai-context-preview-group">
            <summary>Included <span>{represented.length} / {preview.counts.representedIncluded}</span></summary>
            {represented.length ? (
              <ul>
                {represented.map((entry) => {
                  const target = drawerTargetForPreview(data, entry.ref);
                  const contextState = entry.freshness === "stale" || entry.freshness === "superseded" ? ` is-${entry.freshness}` : "";
                  return (
                    <li key={`${entry.ref.type}:${entry.ref.id}`} className={contextState}>
                      <button type="button" disabled={!target} onClick={() => openRef(entry.ref)}>
                        <strong>{entry.title || `${entry.ref.type}:${entry.ref.id}`}</strong>
                        <span>{entry.includedReason || "producer selection"}</span>
                      </button>
                      <small>{metadataValue(entry.visibility.join(", "))} · {metadataValue(entry.freshness)} · {metadataValue(entry.authority)} · {entry.bodyMode}</small>
                      {entry.relationPath.length > 0 && <small>path: {entry.relationPath.map((step) => `${step.predicate || "relation"} (${step.status || "unknown"})`).join(" → ")}</small>}
                    </li>
                  );
                })}
              </ul>
            ) : <p>個別Entityの詳細はproducerから公開されていません。{preview.untypedIncludedIds.length} IDs / {preview.files.length} files</p>}
            {preview.included.length > represented.length && <p>さらに {preview.included.length - represented.length} 件。件数は上の集計に含まれます。</p>}
          </details>
          <details className="ai-context-preview-group">
            <summary>Excluded <span>{Math.min(12, preview.excluded.length)} / {preview.counts.representedExcluded}</span></summary>
            {preview.excluded.length ? <ul>{preview.excluded.slice(0, 12).map((entry, index) => (
              <li key={`${entry.ref?.type || entry.entityType}:${entry.ref?.id || index}:${entry.reason}`}>
                {entry.ref && drawerTargetForPreview(data, entry.ref)
                  ? <button type="button" onClick={() => openRef(entry.ref as PreviewEntityRef)}><strong>{entry.ref.type}:{entry.ref.id}</strong></button>
                  : <strong>{entry.entityType || entry.kind}</strong>}
                <small>{entry.reason || "producer policy"} · {entry.count}件</small>
              </li>
            ))}</ul> : <p>除外理由の個別情報はありません。</p>}
            {preview.excluded.length > 12 && <p>さらに {preview.excluded.length - 12} 件。件数は上の集計に含まれます。</p>}
          </details>
          {preview.relations.length > 0 && (
            <details className="ai-context-preview-group">
              <summary>Relation path <span>{Math.min(12, preview.relations.length)} / {preview.counts.representedRelations}</span></summary>
              <ul>{preview.relations.slice(0, 12).map((relation, index) => (
                <li key={relation.id || `${relation.source.id}:${relation.target.id}:${index}`}>
                  <strong>{relation.source.type}:{relation.source.id} → {relation.target.type}:{relation.target.id}</strong>
                  <small>{relation.predicate || "relation"} · {relation.status || "unknown"} · {relation.reason || relation.origin || "producer selection"}</small>
                </li>
              ))}</ul>
              {preview.relations.length > 12 && <p>さらに {preview.relations.length - 12} 件。件数は上の集計に含まれます。</p>}
            </details>
          )}
          {(preview.warnings.length > 0 || preview.files.length > 0) && (
            <details className="ai-context-preview-group">
              <summary>Warnings / files <span>{preview.warnings.length + preview.files.length}</span></summary>
              <ul>
                {preview.warnings.map((warning, index) => <li key={`${warning.code}:${index}`}><strong>{warning.code || warning.kind || "warning"}</strong><small>{warning.message || warning.reason || "要確認"}</small></li>)}
                {preview.files.map((file) => <li key={file.name}><strong>{file.name}</strong><small>{file.includedCount ?? 0} entities · {file.characterCount ?? 0} chars</small></li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
