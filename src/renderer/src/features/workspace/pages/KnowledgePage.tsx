import { useMemo, useState, type ComponentType } from "react";
import {
  IconAlertCircle,
  IconArrowRight,
  IconBulb,
  IconCircleCheck,
  IconLink,
  IconMessageQuestion,
  IconQuote,
  IconSearch,
  IconStack2,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { KnowledgeNode, PageProps } from "../types";
import { KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS } from "../lib/domain";
import { str } from "../lib/format";
import { buildKnowledgeHealth, type KnowledgeHealthIssue } from "../lib/knowledgeHealth";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";
import type { KnowledgeEdge } from "../domain-model/types";

const ALL = "all";
const NODE_TYPE_ORDER = ["question", "claim", "evidence", "decision"] as const;
const ISSUE_PRIORITY: Record<KnowledgeHealthIssue["kind"], number> = {
  unanswered_question: 0,
  claim_without_evidence: 1,
  evidence_without_source: 2,
  contradicted_claim: 3,
  stale_decision: 4,
  isolated_node: 5,
};
const ISSUE_TITLES: Record<KnowledgeHealthIssue["kind"], string> = {
  unanswered_question: "回答待ち",
  claim_without_evidence: "根拠待ち",
  evidence_without_source: "出典待ち",
  contradicted_claim: "判断待ち",
  stale_decision: "再確認",
  isolated_node: "接続待ち",
};
const ISSUE_ACTIONS: Record<KnowledgeHealthIssue["kind"], string> = {
  unanswered_question: "回答を作る",
  claim_without_evidence: "根拠を作る",
  evidence_without_source: "出典を設定",
  contradicted_claim: "確認する",
  stale_decision: "見直す",
  isolated_node: "関係を追加",
};
const NODE_TYPE_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  question: IconMessageQuestion,
  claim: IconQuote,
  evidence: IconSearch,
  decision: IconCircleCheck,
  source: IconLink,
  insight: IconBulb,
};

function resolveSourceName(node: KnowledgeNode, data: PageProps["data"]): string {
  const resourceIds = new Set((data.resources || []).map((r) => r.id));
  const allResources = [...(data.resources || []), ...(data.links || []).filter((l) => !resourceIds.has(l.id))];
  const allEntities = [...(data.tasks || []), ...(data.waitings || []), ...(data.plan_nodes || [])];
  if (node.source_type && node.source_id) {
    if (node.source_type === "note") return data.notes.find((n) => n.id === node.source_id)?.title || node.source_id;
    if (node.source_type === "resource") {
      const r = allResources.find((r) => r.id === node.source_id);
      return str(r?.title) || node.source_id;
    }
    const entity = allEntities.find((e) => e.id === node.source_id);
    return str(entity?.title) || node.source_id;
  }
  if (node.source_note_id) return data.notes.find((n) => n.id === node.source_note_id)?.title || "";
  if (node.source_link_id) return str(allResources.find((r) => r.id === node.source_link_id)?.title) || "";
  if (node.source_item_id) return str(allEntities.find((e) => e.id === node.source_item_id)?.title) || "";
  return "";
}

export function KnowledgePage({ data, domain, themes, openDrawer, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const [themeId, setThemeId] = useState(ALL);
  const [nodeType, setNodeType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const nodes = data.knowledge_nodes || [];
  const relations = (data.knowledge_edges || []) as unknown as KnowledgeEdge[];

  const visible = useMemo(() => nodes.filter((node) => {
    const text = `${node.title} ${node.body ?? ""}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (themeId === ALL || node.theme_id === themeId)
      && (nodeType === ALL || node.node_type === nodeType)
      && (status === ALL || node.status === status);
  }).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))), [nodes, query, themeId, nodeType, status]);
  const domainEntities = useMemo(() => [
    ...domain.tasks.map((t) => ({ id: t.id, status: t.state, title: t.title })),
    ...domain.waitings.map((w) => ({ id: w.id, status: w.state, title: w.title })),
    ...domain.plan_nodes.map((p) => ({ id: p.id, status: p.state, title: p.title })),
  ], [domain.tasks, domain.waitings, domain.plan_nodes]);
  const healthIssues = useMemo(() => buildKnowledgeHealth(visible, relations, domainEntities), [visible, relations, domainEntities]);
  const sortedIssues = useMemo(() => [...healthIssues].sort((a, b) =>
    ISSUE_PRIORITY[a.kind] - ISSUE_PRIORITY[b.kind] || String(b.node.updated_at || "").localeCompare(String(a.node.updated_at || ""))),
  [healthIssues]);
  const visibleByType = useMemo(() => {
    const grouped: Record<string, KnowledgeNode[]> = {};
    for (const node of visible) {
      const key = node.node_type || "insight";
      grouped[key] = [...(grouped[key] || []), node];
    }
    return grouped;
  }, [visible]);
  const relationPreview = useMemo(() => {
    const visibleIds = new Set(visible.map((node) => node.id));
    return relations
      .map((relation) => ({
        relation,
        source: nodes.find((node) => node.id === relation.source_node_id),
        target: nodes.find((node) => node.id === relation.target_node_id),
      }))
      .filter((entry) => entry.source && entry.target && visibleIds.has(entry.source.id) && visibleIds.has(entry.target.id))
      .slice(0, 8);
  }, [nodes, relations, visible]);

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

  function openIssueAction(issue: KnowledgeHealthIssue) {
    if (issue.kind === "unanswered_question") {
      openDrawer({
        type: "knowledge_node",
        mode: "edit",
        entity: {
          node_type: "decision",
          title: `回答: ${issue.node.title}`,
          theme_id: issue.node.theme_id || null,
          confidence: "medium",
          status: "active",
        },
      });
      return;
    }
    if (issue.kind === "claim_without_evidence") {
      openDrawer({
        type: "knowledge_node",
        mode: "edit",
        entity: {
          node_type: "evidence",
          title: `根拠: ${issue.node.title}`,
          theme_id: issue.node.theme_id || null,
          confidence: "medium",
          status: "active",
        },
      });
      return;
    }
    if (issue.kind === "isolated_node") {
      openDrawer({ type: "knowledge_edge", mode: "edit", entity: { source_node_id: issue.node.id } });
      return;
    }
    openDrawer({ type: "knowledge_node", mode: "edit", entity: issue.node });
  }

  function nodeBody(node: KnowledgeNode) {
    return str(node.body) || "本文なし";
  }

  function NodeTypeIcon({ type }: { type: string }) {
    const Icon = NODE_TYPE_ICONS[type] || IconStack2;
    return <Icon size={18} />;
  }

  return (
    <div className="page knowledge-page">
      <PageHeader title="Knowledge" subtitle="後から判断に使う問い・主張・根拠・決定を整理します">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: { node_type: "question" } })}>問いを追加</button>
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
      <section className="knowledge-workbench">
        <div className="knowledge-focus panel">
          <div className="section-heading"><h2>整理キュー</h2><span>{healthIssues.length}件</span></div>
          <div className="knowledge-issue-grid">
            {sortedIssues.slice(0, 6).map((issue) => (
              <article className={`knowledge-issue-card ${issue.kind}`} key={issue.id}>
                <button className="knowledge-card-main" onClick={() => openDrawer({ type: "knowledge_node", entity: issue.node })}>
                  <span className="knowledge-card-kicker">
                    <IconAlertCircle size={16} />
                    {ISSUE_TITLES[issue.kind]}
                  </span>
                  <strong>{issue.node.title}</strong>
                  <span>{issue.message}</span>
                </button>
                <button className="secondary-button compact" onClick={() => openIssueAction(issue)}>{ISSUE_ACTIONS[issue.kind]}</button>
              </article>
            ))}
            {!healthIssues.length && <div className="empty-state"><strong>目立つ問題はありません</strong></div>}
          </div>
        </div>
        <aside className="knowledge-map panel">
          <div className="section-heading"><h2>関係の流れ</h2><span>{relationPreview.length}件</span></div>
          <div className="knowledge-flow-list">
            {relationPreview.map(({ relation, source, target }) => (
              <button className="knowledge-flow" key={relation.id} onClick={() => openDrawer({ type: "knowledge_edge", mode: "edit", entity: relation as unknown as Record<string, unknown> })}>
                <span>
                  <strong>{source?.title || "不明"}</strong>
                  <small>{KNOWLEDGE_NODE_LABELS[source?.node_type || ""] || source?.node_type}</small>
                </span>
                <span className="knowledge-flow-arrow">
                  <IconArrowRight size={16} />
                  {KNOWLEDGE_RELATION_LABELS[relation.relation_type || "supports"] || relation.relation_type}
                </span>
                <span>
                  <strong>{target?.title || "不明"}</strong>
                  <small>{KNOWLEDGE_NODE_LABELS[target?.node_type || ""] || target?.node_type}</small>
                </span>
              </button>
            ))}
            {!relationPreview.length && <div className="empty-state"><strong>関係はまだありません</strong></div>}
          </div>
        </aside>
      </section>
      {visible.length > 0 ? (
        <section className="knowledge-lanes">
          {NODE_TYPE_ORDER.map((type) => {
            const laneNodes = visibleByType[type] || [];
            return (
              <div className="knowledge-lane panel" key={type}>
                <div className="knowledge-lane-heading">
                  <span><NodeTypeIcon type={type} /> {KNOWLEDGE_NODE_LABELS[type]}</span>
                  <strong>{laneNodes.length}</strong>
                </div>
                <div className="knowledge-card-list">
                  {laneNodes.slice(0, 5).map((node) => {
                    const related = relationCount(node);
                    const sourceName = resolveSourceName(node, data);
                    return (
                      <article className="knowledge-node-card" key={node.id}>
                        <button className="knowledge-card-main" onClick={() => openDrawer({ type: "knowledge_node", entity: node })}>
                          <span className="knowledge-card-meta">
                            <StatusBadge value={node.status} label={node.confidence || "medium"} />
                            <span>{themeName(node.theme_id)}</span>
                            <span>{related} relation</span>
                          </span>
                          <strong>{node.title}</strong>
                          <span>{nodeBody(node)}</span>
                          <small>{sourceName ? `source: ${sourceName}` : "sourceなし"}</small>
                        </button>
                        <button className="text-button compact" onClick={() => openDrawer({ type: "knowledge_edge", mode: "edit", entity: { source_node_id: node.id } })}>関係を追加</button>
                      </article>
                    );
                  })}
                  {!laneNodes.length && (
                    <EmptyState
                      title={`${KNOWLEDGE_NODE_LABELS[type]}はありません`}
                      action={type === "question" ? "問いを追加" : undefined}
                      onAction={type === "question" ? () => openDrawer({ type: "knowledge_node", mode: "edit", entity: { node_type: "question" } }) : undefined}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <section className="panel">
          <EmptyState title="判断材料はまだありません" action="問いを追加" onAction={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: { node_type: "question" } })} />
        </section>
      )}
      {visible.some((node) => !NODE_TYPE_ORDER.includes(node.node_type as (typeof NODE_TYPE_ORDER)[number])) && (
        <section className="panel list-page">
          <div className="section-heading"><h2>その他</h2><span>{visible.filter((node) => !NODE_TYPE_ORDER.includes(node.node_type as (typeof NODE_TYPE_ORDER)[number])).length}件</span></div>
          {visible.filter((node) => !NODE_TYPE_ORDER.includes(node.node_type as (typeof NODE_TYPE_ORDER)[number])).map((node) => (
            <button className="wide-row" key={node.id} onClick={() => openDrawer({ type: "knowledge_node", entity: node })}>
              <strong>{node.title}</strong>
              <span>{KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type} / {themeName(node.theme_id)}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
