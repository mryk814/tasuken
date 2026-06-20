import { useMemo, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { KnowledgeNode, PageProps } from "../types";
import { KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS } from "../lib/domain";
import { str } from "../lib/format";
import { buildKnowledgeHealth } from "../lib/knowledgeHealth";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

const ALL = "all";

function resolveSourceName(node: KnowledgeNode, data: { notes: { id: string; title: string }[]; links: { id: string; title: string }[]; resources?: { id: string; title: string }[]; items: { id: string; title: string }[] }): string {
  if (node.source_type && node.source_id) {
    if (node.source_type === "note") return data.notes.find((n) => n.id === node.source_id)?.title || node.source_id;
    if (node.source_type === "resource") {
      const r = (data.resources || []).find((r) => r.id === node.source_id) || data.links.find((l) => l.id === node.source_id);
      return r?.title || node.source_id;
    }
    const item = data.items.find((i) => i.id === node.source_id);
    return item?.title || node.source_id;
  }
  if (node.source_note_id) return data.notes.find((n) => n.id === node.source_note_id)?.title || "";
  if (node.source_link_id) return data.links.find((l) => l.id === node.source_link_id)?.title || "";
  if (node.source_item_id) return data.items.find((i) => i.id === node.source_item_id)?.title || "";
  return "";
}

export function KnowledgePage({ data, themes, openDrawer, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const [themeId, setThemeId] = useState(ALL);
  const [nodeType, setNodeType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const nodes = data.knowledge_nodes || [];
  const relations = data.knowledge_relations || [];

  const visible = useMemo(() => nodes.filter((node) => {
    const text = `${node.title} ${node.body ?? ""}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (themeId === ALL || node.theme_id === themeId)
      && (nodeType === ALL || node.node_type === nodeType)
      && (status === ALL || node.status === status);
  }).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))), [nodes, query, themeId, nodeType, status]);
  const healthIssues = useMemo(() => buildKnowledgeHealth(visible, relations, data.items || []), [visible, relations, data.items]);

  function relationCount(node: KnowledgeNode) {
    return relations.filter((relation) => relation.source_node_id === node.id || relation.target_node_id === node.id).length;
  }

  function themeName(id?: string | null) {
    return themes.find((theme) => theme.id === id)?.name || "未設定";
  }

  function copy() {
    const text = visible.map((node) => [
      KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type,
      node.title,
      themeName(node.theme_id),
      node.confidence || "medium",
      node.status || "active",
      relationCount(node),
    ].join("\t")).join("\n");
    workspaceApi.copyText(text).then(() => setToast("Knowledge一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Knowledge" subtitle="メモから抽出した問い・根拠・主張・決定を整理します">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: {} })}>Knowledgeを追加</button>
      </PageHeader>
      <div className="filter-bar panel">
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル・本文を検索" />
        <select value={themeId} onChange={(event) => setThemeId(event.target.value)} aria-label="Theme">
          <option value={ALL}>すべてのTheme</option>
          {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select>
        <select value={nodeType} onChange={(event) => setNodeType(event.target.value)} aria-label="Node type">
          <option value={ALL}>すべての種類</option>
          {Object.entries(KNOWLEDGE_NODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
          <option value={ALL}>すべての状態</option>
          <option value="active">active</option>
          <option value="resolved">resolved</option>
          <option value="deprecated">deprecated</option>
          <option value="rejected">rejected</option>
        </select>
        <span>{visible.length}件</span>
      </div>
      <section className="panel list-page">
        <div className="section-heading"><h2>Health Check</h2><span>{healthIssues.length}件</span></div>
        {healthIssues.slice(0, 8).map((issue) => (
          <button className="wide-row" key={issue.id} onClick={() => openDrawer({ type: "knowledge_node", entity: issue.node })}>
            <strong>{issue.node.title}</strong>
            <span>{issue.message} {issue.action}</span>
          </button>
        ))}
        {!healthIssues.length && <div className="empty-state"><strong>目立つ問題はありません</strong></div>}
      </section>
      <section className="panel list-page">
        <div className="section-heading"><h2>Nodes</h2><span>{visible.length}件</span></div>
        {visible.map((node) => {
          const related = relationCount(node);
          const sourceName = resolveSourceName(node, data);
          return (
            <div className="note-row" key={node.id}>
              <button className="note-row-main" onClick={() => openDrawer({ type: "knowledge_node", entity: node })}>
                <span className="note-row-head">
                  <StatusBadge value={node.status} label={KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type} />
                  <strong className="note-row-title">{node.title}</strong>
                  <span className="comment-count" aria-label={`${related}件の関係`}>{related}</span>
                </span>
                <span className="note-row-body">
                  {themeName(node.theme_id)} / {node.confidence || "medium"} / {sourceName ? `source: ${sourceName}` : "sourceなし"} / {str(node.body) || "本文なし"}
                </span>
              </button>
              <button className="secondary-button compact note-row-open" onClick={() => openDrawer({ type: "knowledge_relation", mode: "edit", entity: { source_node_id: node.id } })}>
                関係を追加
              </button>
            </div>
          );
        })}
        {!visible.length && <EmptyState title="Knowledgeはまだありません" action="Knowledgeを追加" onAction={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: {} })} />}
      </section>
      {relations.length > 0 && (
        <section className="panel list-page">
          <div className="section-heading"><h2>Relations</h2><span>{relations.length}件</span></div>
          {relations.slice(0, 20).map((relation) => {
            const source = nodes.find((node) => node.id === relation.source_node_id);
            const target = nodes.find((node) => node.id === relation.target_node_id);
            return (
              <button className="wide-row" key={relation.id} onClick={() => openDrawer({ type: "knowledge_relation", mode: "edit", entity: relation })}>
                <strong>{source?.title || "不明"} → {target?.title || "不明"}</strong>
                <span>{KNOWLEDGE_RELATION_LABELS[relation.relation_type || "supports"] || relation.relation_type} / {relation.confidence || "medium"}</span>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}
