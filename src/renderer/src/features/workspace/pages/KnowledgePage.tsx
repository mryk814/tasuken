import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DataHealthIssue } from "../../../../../shared/dataHealth.mjs";
import type { DataHealthQueryResult } from "../../../../../shared/ipc/contracts";
import { buildKnowledgeInventory } from "../../../../../shared/knowledgeInventory.mjs";
import { createLatestRequestGate } from "../../../../../shared/latestRequest.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import { drawerTargetForPreview } from "../components/AiContextPreviewPanel";
import { EmptyState, Metric, PageHeader, StatusBadge, ThemePickerSelect } from "../components/common";
import type { KnowledgeEdge } from "../domain-model/types";
import { KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { parseWikiLinks } from "../lib/knowledgeLinks";
import type { KnowledgeNode, PageProps } from "../types";

const ALL = "all";
const NODE_TYPE_ORDER = ["question", "claim", "evidence", "decision", "source", "insight"];
const HEALTH_ENTITY_TYPES = ["project", "task", "waiting", "plan_node", "note", "resource", "knowledge_node", "knowledge_edge", "reference", "artifact", "sketch"];
const FIX_ACTION_LABELS: Record<string, string> = {
  source_entity: "元Entityを確認",
  settings: "Settingsを確認",
  theme_ai_pack: "ThemeのAI Packを確認",
};

function nodeOrigin(node: KnowledgeNode): string {
  const source = str(node.source).toLowerCase();
  if (source === "ai_generated") return "ai";
  if (source) return source;
  if (node.source_type) return str(node.source_type);
  if (node.source_note_id) return "note";
  if (node.source_link_id) return "resource";
  if (node.source_item_id) return "task";
  return "unknown";
}

function originLabel(origin: string): string {
  return { manual: "manual", imported: "imported", ai: "AI", note: "Note", resource: "Resource", task: "Task", unknown: "unknown" }[origin] || origin;
}

function titleOf(node: KnowledgeNode): string {
  return str(node.title) || "無題";
}

function shortText(value: unknown, max = 120): string {
  const text = str(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function relationTitle(relation: KnowledgeEdge, nodesById: Map<string, KnowledgeNode>): string {
  const source = nodesById.get(relation.source_node_id);
  const target = nodesById.get(relation.target_node_id);
  return `${titleOf(source || ({ id: relation.source_node_id, title: relation.source_node_id } as KnowledgeNode))} → ${titleOf(target || ({ id: relation.target_node_id, title: relation.target_node_id } as KnowledgeNode))}`;
}

export function KnowledgePage({ data, themes, openDrawer }: PageProps) {
  const [query, setQuery] = useState("");
  const [themeId, setThemeId] = useState(ALL);
  const [nodeType, setNodeType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [healthType, setHealthType] = useState(ALL);
  const [healthSeverity, setHealthSeverity] = useState(ALL);
  const [healthState, setHealthState] = useState<"open" | "ignored" | "resolved">("open");
  const [health, setHealth] = useState<DataHealthQueryResult | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState("");
  const [updatingIssueId, setUpdatingIssueId] = useState("");
  const healthRequestGate = useRef(createLatestRequestGate());

  const nodes = data.knowledge_nodes || [];
  const relations = data.knowledge_edges as unknown as KnowledgeEdge[];
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
  const visibleNodes = useMemo(() => nodes
    .filter((node) => themeId === ALL || str(node.theme_id) === themeId)
    .filter((node) => nodeType === ALL || node.node_type === nodeType)
    .filter((node) => status === ALL || str(node.status || "active") === status)
    .filter((node) => !normalizedQuery || `${titleOf(node)} ${str(node.body)}`.toLocaleLowerCase("ja-JP").includes(normalizedQuery))
    .sort((left, right) => str(right.updated_at || right.created_at).localeCompare(str(left.updated_at || left.created_at))),
  [nodes, normalizedQuery, nodeType, status, themeId]);
  const inventory = useMemo(() => buildKnowledgeInventory(nodes, relations), [nodes, relations]);
  const refreshHealth = useCallback(async () => {
    const requestId = healthRequestGate.current.next();
    setHealthLoading(true);
    setHealthError("");
    try {
      const result = await workspaceApi.getDataHealth({
        themeId: themeId === ALL ? undefined : themeId,
        entityType: healthType === ALL ? undefined : healthType,
        severity: healthSeverity === ALL ? undefined : healthSeverity as "info" | "warning" | "error",
        state: healthState,
      });
      if (healthRequestGate.current.isCurrent(requestId)) setHealth(result);
    } catch (error) {
      if (healthRequestGate.current.isCurrent(requestId)) setHealthError(error instanceof Error ? error.message : "Data Healthを確認できませんでした。もう一度お試しください。");
    } finally {
      if (healthRequestGate.current.isCurrent(requestId)) setHealthLoading(false);
    }
  }, [healthSeverity, healthState, healthType, themeId]);

  useEffect(() => {
    void refreshHealth();
    return () => healthRequestGate.current.invalidate();
  }, [data, refreshHealth]);

  async function setHealthIssueState(issue: DataHealthIssue, nextState: "ignored" | "resolved" | "open") {
    if (!health) return;
    if (updatingIssueId) return;
    setUpdatingIssueId(issue.id);
    try {
      await workspaceApi.setDataHealthIssueState({ issueId: issue.id, state: nextState, expectedRevision: health.stateRevision });
      await refreshHealth();
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : "Data Healthの状態を保存できませんでした。再読み込みしてください。");
    } finally {
      setUpdatingIssueId("");
    }
  }

  function openHealthIssue(issue: DataHealthIssue) {
    const target = drawerTargetForPreview(data, issue.ref);
    if (target) openDrawer(target);
  }

  return (
    <div className="page knowledge-page knowledge-experimental-page">
      <PageHeader route="knowledge" />
      <section className="knowledge-experimental-note panel">
        <strong>Knowledgeの実データ棚卸し</strong>
        <span>Entity・Relation・AI公開状態を読み取り、修正が必要な元Entityへ案内します。自動修正は行いません。</span>
      </section>

      <section className="knowledge-metric-grid" aria-label="Knowledge概要">
        <Metric label="Entities" value={inventory.total_nodes} />
        <Metric label="Relations" value={inventory.total_relations} />
        <Metric label="Relation参照あり" value={inventory.linked_nodes} />
        <Metric label="Data Health" value={health?.counts.open ?? 0} tone={(health?.counts.open || 0) > 0 ? "warning" : ""} />
      </section>

      <section className="knowledge-inventory panel">
        <div className="section-heading">
          <div><h2>実データ棚卸し</h2><p>Typeごとの保持状態をread-onlyで確認します。</p></div>
          <span className="muted-text">{visibleNodes.length} / {nodes.length}件</span>
        </div>
        <div className="filter-bar knowledge-filter-bar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル・本文を検索" aria-label="Knowledge検索" />
          <ThemePickerSelect themes={themes} value={themeId} onChange={setThemeId} allowAll allowNone allLabel="全Theme" ariaLabel="Themeで絞り込む" />
          <select value={nodeType} onChange={(event) => setNodeType(event.target.value)} aria-label="Typeで絞り込む">
            <option value={ALL}>全Type</option>{NODE_TYPE_ORDER.map((type) => <option key={type} value={type}>{KNOWLEDGE_NODE_LABELS[type] || type}</option>)}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Statusで絞り込む">
            <option value={ALL}>全Status</option><option value="active">active</option><option value="resolved">resolved</option><option value="deprecated">deprecated</option><option value="rejected">rejected</option>
          </select>
        </div>
        {inventory.types.length ? (
          <div className="knowledge-inventory-table-wrap"><table className="knowledge-inventory-table">
            <thead><tr><th>Type</th><th>件数</th><th>更新</th><th>作成元</th><th>Relation参照</th><th /></tr></thead>
            <tbody>{inventory.types.map((group) => (
              <tr key={group.node_type}><th scope="row">{KNOWLEDGE_NODE_LABELS[group.node_type] || group.node_type}</th><td className="numeric-cell">{group.count}</td><td>{group.updated_count}件 / {formatDate(group.latest_updated_at)}</td><td>{group.origins.map((origin: { origin: string; count: number }) => `${originLabel(origin.origin)} ${origin.count}`).join(" / ") || "—"}</td><td className="numeric-cell">{group.relation_refs}</td><td><button type="button" className="text-button compact" onClick={() => setNodeType(group.node_type)}>表示</button></td></tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState title="Knowledge Entityはありません" />}
      </section>

      <section className="knowledge-diagnostic-grid">
        <section className="knowledge-diagnostic panel" aria-busy={healthLoading}>
          <div className="section-heading"><h2>Data Health</h2><span className="muted-text">{health?.issues.length ?? 0} / {health?.totalIssueCount ?? 0}</span></div>
          <div className="filter-bar knowledge-filter-bar data-health-filter-bar">
            <select value={healthType} onChange={(event) => setHealthType(event.target.value)} aria-label="Data Health type"><option value={ALL}>全Type</option>{HEALTH_ENTITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
            <select value={healthSeverity} onChange={(event) => setHealthSeverity(event.target.value)} aria-label="Data Health severity"><option value={ALL}>全Severity</option><option value="error">error</option><option value="warning">warning</option><option value="info">info</option></select>
            <select value={healthState} onChange={(event) => setHealthState(event.target.value as typeof healthState)} aria-label="Data Health state"><option value="open">open</option><option value="ignored">ignored</option><option value="resolved">resolved</option></select>
            <button type="button" className="text-button compact" disabled={healthLoading} onClick={() => void refreshHealth()}>再確認</button>
          </div>
          {healthLoading && !health && <div className="ai-context-preview-state">Data Healthを確認中…</div>}
          {healthError && <p className="alert-note danger">{healthError} フィルタと前回の結果は保持しています。</p>}
          {health?.issues.length ? <ul className="knowledge-diagnostic-list">{health.issues.map((issue) => (
            <li key={issue.id}>
              <button type="button" className="knowledge-diagnostic-link" disabled={!drawerTargetForPreview(data, issue.ref)} onClick={() => openHealthIssue(issue)}><strong>{issue.ref.type}:{issue.ref.id}</strong><span>{issue.reason}</span><small>修正候補: {issue.fixActions.map((action) => FIX_ACTION_LABELS[action] || "元Entityを確認").join(" / ")}</small></button>
              <StatusBadge value={issue.severity === "error" ? "blocked" : issue.severity === "warning" ? "review" : "planned"} label={issue.label} />
              <div className="inline-actions data-health-actions">
                {healthState !== "ignored" && <button type="button" className="text-button compact" disabled={Boolean(updatingIssueId)} onClick={() => void setHealthIssueState(issue, "ignored")}>無視</button>}
                {healthState !== "resolved" && <button type="button" className="text-button compact" disabled={Boolean(updatingIssueId)} onClick={() => void setHealthIssueState(issue, "resolved")}>解決済み</button>}
                {healthState !== "open" && <button type="button" className="text-button compact" disabled={Boolean(updatingIssueId)} onClick={() => void setHealthIssueState(issue, "open")}>再開</button>}
              </div>
            </li>
          ))}</ul> : !healthLoading && <EmptyState title={healthState === "open" ? "Data Health上の要確認はありません" : `${healthState}のissueはありません`} />}
        </section>

        <section className="knowledge-diagnostic panel">
          <div className="section-heading"><h2>既存Relation</h2><span className="muted-text">{relations.length}件 / read-only</span></div>
          {relations.length ? <ul className="knowledge-relation-list">{relations.slice(0, 12).map((relation) => (
            <li key={relation.id}><button type="button" className="knowledge-diagnostic-link" onClick={() => openDrawer({ type: "knowledge_edge", mode: "view", entity: relation as unknown as Record<string, unknown> })}><strong>{relationTitle(relation, nodesById)}</strong><span>{KNOWLEDGE_RELATION_LABELS[relation.relation_type] || relation.relation_type} {shortText(relation.description)}</span></button></li>
          ))}</ul> : <EmptyState title="Relationはありません" />}
          {relations.length > 12 && <p className="muted-text">先頭12件を表示中。全件は既存データとして保持されています。</p>}
        </section>
      </section>

      <section className="knowledge-existing-list panel">
        <div className="section-heading"><h2>既存Entity</h2><span className="muted-text">閲覧・診断用</span></div>
        {visibleNodes.length ? <div className="knowledge-node-list">{visibleNodes.map((node) => {
          const relationCount = relations.filter((relation) => relation.source_node_id === node.id || relation.target_node_id === node.id).length;
          const backlinks = parseWikiLinks(str(node.body)).length;
          return <button key={node.id} type="button" className="knowledge-node-row" onClick={() => openDrawer({ type: "knowledge_node", mode: "view", entity: node })}><span className="knowledge-node-row-main"><strong>{titleOf(node)}</strong><span>{shortText(node.body)}</span></span><span className="knowledge-node-row-meta"><span>{KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}</span><span>{originLabel(nodeOrigin(node))}</span><span>{relationCount} refs</span><span>{backlinks} links</span><span>{formatDate(node.updated_at || node.created_at)}</span></span></button>;
        })}</div> : <EmptyState title="条件に一致するEntityはありません" />}
      </section>
    </div>
  );
}
