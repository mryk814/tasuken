import { useMemo, useState } from "react";

import { EmptyState, Metric, PageHeader, StatusBadge, ThemePickerSelect } from "../components/common";
import type { KnowledgeNode, PageProps } from "../types";
import type { KnowledgeEdge } from "../domain-model/types";
import { KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { buildDataHealth } from "../lib/knowledgeHealth";
import { parseWikiLinks } from "../lib/knowledgeLinks";
import { buildKnowledgeInventory } from "../../../../../shared/knowledgeInventory.mjs";

const ALL = "all";
const NODE_TYPE_ORDER = ["question", "claim", "evidence", "decision", "source", "insight"];

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

  const nodes = data.knowledge_nodes || [];
  const relations = data.knowledge_edges as unknown as KnowledgeEdge[];
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
  const visibleNodes = useMemo(() => nodes
    .filter((node) => themeId === ALL || str(node.theme_id) === themeId)
    .filter((node) => nodeType === ALL || node.node_type === nodeType)
    .filter((node) => status === ALL || str(node.status || "active") === status)
    .filter((node) => !normalizedQuery || `${titleOf(node)} ${str(node.body)}`.toLocaleLowerCase("ja-JP").includes(normalizedQuery))
    .sort((a, b) => str(b.updated_at || b.created_at).localeCompare(str(a.updated_at || a.created_at))),
  [nodes, normalizedQuery, nodeType, status, themeId]);

  const inventory = useMemo(() => buildKnowledgeInventory(nodes, relations), [nodes, relations]);
  const healthEntities = useMemo(() => [
    ...(data.tasks || []).map((entity) => ({ id: entity.id, status: str(entity.status), title: str(entity.title) })),
    ...(data.waitings || []).map((entity) => ({ id: entity.id, status: str(entity.status), title: str(entity.title) })),
    ...(data.plan_nodes || []).map((entity) => ({ id: entity.id, status: str(entity.status), title: str(entity.title) })),
  ], [data.plan_nodes, data.tasks, data.waitings]);
  const healthIssues = useMemo(() => buildDataHealth(nodes, relations, healthEntities), [healthEntities, nodes, relations]);
  const brokenRelations = useMemo(() => relations.filter((relation) => !nodesById.has(relation.source_node_id) || !nodesById.has(relation.target_node_id)), [nodesById, relations]);
  const linkedNodes = inventory.linked_nodes;

  return (
    <div className="page knowledge-page knowledge-experimental-page">
      <PageHeader route="knowledge" />
      <section className="knowledge-experimental-note panel">
        <strong>既存Knowledgeの実データ棚卸し</strong>
        <span>Knowledge / Relationを読み取り、件数・更新・作成元・参照状況を確認します。通常の作成導線はここに置きません。</span>
      </section>

      <section className="knowledge-metric-grid" aria-label="Knowledge概要">
        <Metric label="Entities" value={inventory.total_nodes} />
        <Metric label="Relations" value={inventory.total_relations} />
        <Metric label="Relation参照あり" value={linkedNodes} />
        <Metric label="Data Health" value={healthIssues.length + brokenRelations.length} tone={healthIssues.length || brokenRelations.length ? "warning" : ""} />
      </section>

      <section className="knowledge-inventory panel">
        <div className="section-heading">
          <div>
            <h2>実データ棚卸し</h2>
            <p>Typeごとの保持状況をread-onlyで確認します。残す・Note等へ寄せる判断はこの画面では行いません。</p>
          </div>
          <span className="muted-text">{visibleNodes.length} / {nodes.length}件</span>
        </div>
        <div className="filter-bar knowledge-filter-bar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル・本文を検索" aria-label="Knowledge検索" />
          <ThemePickerSelect themes={themes} value={themeId} onChange={setThemeId} allowAll allowNone allLabel="全Theme" ariaLabel="Themeで絞り込む" />
          <select value={nodeType} onChange={(event) => setNodeType(event.target.value)} aria-label="Typeで絞り込む">
            <option value={ALL}>全Type</option>
            {NODE_TYPE_ORDER.map((type) => <option key={type} value={type}>{KNOWLEDGE_NODE_LABELS[type] || type}</option>)}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Statusで絞り込む">
            <option value={ALL}>全Status</option>
            <option value="active">active</option>
            <option value="resolved">resolved</option>
            <option value="deprecated">deprecated</option>
            <option value="rejected">rejected</option>
          </select>
        </div>
        {inventory.types.length ? (
          <div className="knowledge-inventory-table-wrap">
            <table className="knowledge-inventory-table">
              <thead><tr><th>Type</th><th>件数</th><th>更新</th><th>作成元</th><th>Relation参照</th><th /></tr></thead>
              <tbody>
                {inventory.types.map((group) => (
                  <tr key={group.node_type}>
                    <th scope="row">{KNOWLEDGE_NODE_LABELS[group.node_type] || group.node_type}</th>
                    <td className="numeric-cell">{group.count}</td>
                    <td>{group.updated_count}件 / {formatDate(group.latest_updated_at)}</td>
                    <td>{group.origins.map((origin: { origin: string; count: number }) => `${originLabel(origin.origin)} ${origin.count}`).join(" / ") || "—"}</td>
                    <td className="numeric-cell">{group.relation_refs}</td>
                    <td><button type="button" className="text-button compact" onClick={() => setNodeType(group.node_type)}>表示</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Knowledge Entityはありません" />}
      </section>

      <section className="knowledge-diagnostic-grid">
        <section className="knowledge-diagnostic panel">
          <div className="section-heading"><h2>Data Health</h2><span className="muted-text">{healthIssues.length}件</span></div>
          {healthIssues.length ? (
            <ul className="knowledge-diagnostic-list">
              {healthIssues.map((issue) => (
                <li key={issue.id}>
                  <button type="button" className="knowledge-diagnostic-link" onClick={() => openDrawer({ type: "knowledge_node", mode: "view", entity: issue.node })}>
                    <strong>{titleOf(issue.node)}</strong><span>{issue.message}</span>
                  </button>
                  <StatusBadge value={issue.node.status || "active"} label={issue.kind} />
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Data Health上の要確認はありません" />}
          {brokenRelations.length > 0 && <p className="alert-note warning">参照先が見つからないRelationが{brokenRelations.length}件あります。既存データは変更していません。</p>}
        </section>
        <section className="knowledge-diagnostic panel">
          <div className="section-heading"><h2>既存Relation</h2><span className="muted-text">{relations.length}件 / read-only</span></div>
          {relations.length ? (
            <ul className="knowledge-relation-list">
              {relations.slice(0, 12).map((relation) => (
                <li key={relation.id}>
                  <button type="button" className="knowledge-diagnostic-link" onClick={() => openDrawer({ type: "knowledge_edge", mode: "view", entity: relation as unknown as Record<string, unknown> })}>
                    <strong>{relationTitle(relation, nodesById)}</strong>
                    <span>{KNOWLEDGE_RELATION_LABELS[relation.relation_type] || relation.relation_type} {shortText(relation.description)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Relationはありません" />}
          {relations.length > 12 && <p className="muted-text">先頭12件を表示中。全件は既存データとして保持されています。</p>}
        </section>
      </section>

      <section className="knowledge-existing-list panel">
        <div className="section-heading"><h2>既存Entity</h2><span className="muted-text">閲覧・診断用</span></div>
        {visibleNodes.length ? (
          <div className="knowledge-node-list">
            {visibleNodes.map((node) => {
              const relationCount = relations.filter((relation) => relation.source_node_id === node.id || relation.target_node_id === node.id).length;
              const backlinks = parseWikiLinks(str(node.body)).length;
              return (
                <button key={node.id} type="button" className="knowledge-node-row" onClick={() => openDrawer({ type: "knowledge_node", mode: "view", entity: node })}>
                  <span className="knowledge-node-row-main"><strong>{titleOf(node)}</strong><span>{shortText(node.body)}</span></span>
                  <span className="knowledge-node-row-meta"><span>{KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}</span><span>{originLabel(nodeOrigin(node))}</span><span>{relationCount} refs</span><span>{backlinks} links</span><span>{formatDate(node.updated_at || node.created_at)}</span></span>
                </button>
              );
            })}
          </div>
        ) : <EmptyState title="条件に一致するEntityはありません" />}
      </section>
    </div>
  );
}
