import { useEffect, useMemo, useState, type ComponentType } from "react";
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
const GRAPH_NODE_WIDTH = 164;
const GRAPH_NODE_HEIGHT = 62;
const GRAPH_LANES: Record<string, "left" | "center" | "right"> = {
  question: "left",
  evidence: "left",
  source: "left",
  claim: "center",
  insight: "center",
  decision: "right",
};
const GRAPH_LANE_X = { left: 56, center: 368, right: 680 };
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

function shortText(value: unknown, max = 34): string {
  const text = str(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function relationClassName(value?: string | null): string {
  return String(value || "supports").replace(/[^a-z0-9_-]/gi, "_");
}

function relationMarkerId(value?: string | null): string {
  switch (value) {
    case "contradicts":
      return "knowledge-arrow-danger";
    case "answers":
      return "knowledge-arrow-review";
    case "leads_to":
      return "knowledge-arrow-accent";
    case "derived_from":
    case "depends_on":
      return "knowledge-arrow-muted";
    default:
      return "knowledge-arrow";
  }
}

function issueKindsByNode(issues: KnowledgeHealthIssue[]): Map<string, Set<KnowledgeHealthIssue["kind"]>> {
  const map = new Map<string, Set<KnowledgeHealthIssue["kind"]>>();
  for (const issue of issues) {
    const kinds = map.get(issue.node.id) || new Set<KnowledgeHealthIssue["kind"]>();
    kinds.add(issue.kind);
    map.set(issue.node.id, kinds);
  }
  return map;
}

function buildEgoGraph(nodes: KnowledgeNode[], relations: KnowledgeEdge[], selectedId: string | null, issues: KnowledgeHealthIssue[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selected = selectedId ? nodeById.get(selectedId) : null;
  if (!selected) return { nodes: [], edges: [], hidden: 0 };

  const graphRelations = relations.filter((relation) =>
    relation.source_node_id === selected.id || relation.target_node_id === selected.id);
  const graphIds = new Set<string>([selected.id]);
  for (const relation of graphRelations) {
    graphIds.add(String(relation.source_node_id));
    graphIds.add(String(relation.target_node_id));
  }

  const issueMap = issueKindsByNode(issues);
  const lanes: Record<"left" | "center" | "right", KnowledgeNode[]> = { left: [], center: [], right: [] };
  for (const id of graphIds) {
    const node = nodeById.get(id);
    if (!node) continue;
    lanes[GRAPH_LANES[node.node_type] || "center"].push(node);
  }

  const positioned = new Map<string, KnowledgeNode & { x: number; y: number; issueKinds: Set<KnowledgeHealthIssue["kind"]> }>();
  let hidden = 0;
  (Object.keys(lanes) as Array<keyof typeof lanes>).forEach((lane) => {
    const laneNodes = lanes[lane]
      .sort((a, b) => Number(b.id === selected.id) - Number(a.id === selected.id) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    const shown = laneNodes.slice(0, 4);
    hidden += Math.max(0, laneNodes.length - shown.length);
    const gap = shown.length >= 4 ? 78 : 92;
    const top = Math.max(28, 190 - ((shown.length - 1) * gap) / 2);
    shown.forEach((node, index) => {
      positioned.set(node.id, {
        ...node,
        x: GRAPH_LANE_X[lane],
        y: top + index * gap,
        issueKinds: issueMap.get(node.id) || new Set(),
      });
    });
  });

  const graphEdges = graphRelations
    .map((relation) => {
      const source = positioned.get(String(relation.source_node_id));
      const target = positioned.get(String(relation.target_node_id));
      if (!source || !target) return null;
      const sourceRight = source.x + GRAPH_NODE_WIDTH;
      const targetLeft = target.x;
      const forward = source.x <= target.x;
      const x1 = forward ? sourceRight : source.x;
      const x2 = forward ? targetLeft : target.x + GRAPH_NODE_WIDTH;
      const y1 = source.y + GRAPH_NODE_HEIGHT / 2;
      const y2 = target.y + GRAPH_NODE_HEIGHT / 2;
      return {
        relation,
        source,
        target,
        x1,
        y1,
        x2,
        y2,
        labelX: (x1 + x2) / 2,
        labelY: (y1 + y2) / 2 - 8,
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => edge !== null);

  return { nodes: [...positioned.values()], edges: graphEdges, hidden };
}

export function KnowledgePage({ data, domain, themes, openDrawer, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const [themeId, setThemeId] = useState(ALL);
  const [nodeType, setNodeType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const allHealthIssues = useMemo(() => buildKnowledgeHealth(nodes, relations, domainEntities), [nodes, relations, domainEntities]);
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
  const selectableNodes = useMemo(() => visible.slice(0, 12), [visible]);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedId) || null, [nodes, selectedId]);
  const graph = useMemo(() => buildEgoGraph(nodes, relations, selectedId, allHealthIssues), [nodes, relations, selectedId, allHealthIssues]);

  useEffect(() => {
    const visibleIds = new Set(visible.map((node) => node.id));
    if (selectedId && visibleIds.has(selectedId)) return;
    setSelectedId(sortedIssues[0]?.node.id || visible[0]?.id || null);
  }, [selectedId, sortedIssues, visible]);

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
        <div className="segmented" aria-label="Knowledge表示">
          <button className={viewMode === "graph" ? "is-active" : ""} onClick={() => setViewMode("graph")}>Graph</button>
          <button className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")}>List</button>
        </div>
        <span>{visible.length}件</span>
      </div>
      <section className="knowledge-explorer panel">
        <div className="section-heading"><h2>{viewMode === "graph" ? "根拠チェーン" : "関係の流れ"}</h2><span>{viewMode === "graph" ? `${graph.edges.length} relation` : `${relationPreview.length}件`}</span></div>
        {viewMode === "graph" && selectedNode && (
          <div className="knowledge-focus-bar">
            <span><StatusBadge value={selectedNode.status} label={KNOWLEDGE_NODE_LABELS[selectedNode.node_type] || selectedNode.node_type} /> {selectedNode.title}</span>
            <button className="secondary-button compact" onClick={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: selectedNode })}>開く</button>
          </div>
        )}
        <div className="knowledge-explorer-body">
          <div className="knowledge-graph-main">
            {viewMode === "graph" ? (
              graph.nodes.length ? (
                <svg className="knowledge-graph" viewBox="0 0 900 420" role="img" aria-label="選択中Knowledgeの1-hop関係グラフ">
                  <defs>
                    <marker id="knowledge-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                    <marker id="knowledge-arrow-danger" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                    <marker id="knowledge-arrow-review" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                    <marker id="knowledge-arrow-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                    <marker id="knowledge-arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                  </defs>
                  {graph.edges.map((edge) => (
                    <g className={`graph-edge graph-edge-${relationClassName(edge.relation.relation_type)}`} key={edge.relation.id}>
                      <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} markerEnd={`url(#${relationMarkerId(edge.relation.relation_type)})`} />
                      <text x={edge.labelX} y={edge.labelY} textAnchor="middle">
                        {KNOWLEDGE_RELATION_LABELS[edge.relation.relation_type || "supports"] || edge.relation.relation_type}
                      </text>
                    </g>
                  ))}
                  {graph.nodes.map((node) => {
                    const issueClass = node.issueKinds.has("contradicted_claim")
                      ? "has-contradiction"
                      : node.issueKinds.has("claim_without_evidence")
                        ? "needs-evidence"
                        : "";
                    return (
                      <g
                        className={`graph-node graph-node-${node.node_type} ${node.id === selectedId ? "is-selected" : ""} ${issueClass}`}
                        key={node.id}
                        role="button"
                        aria-label={`${KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}: ${node.title}`}
                        tabIndex={0}
                        onClick={() => setSelectedId(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedId(node.id);
                          }
                        }}
                      >
                        <rect x={node.x} y={node.y} width={GRAPH_NODE_WIDTH} height={GRAPH_NODE_HEIGHT} rx="7" />
                        <text className="graph-node-type" x={node.x + 12} y={node.y + 21}>{KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}</text>
                        <text className="graph-node-title" x={node.x + 12} y={node.y + 43}>{shortText(node.title, 24)}</text>
                      </g>
                    );
                  })}
                  {graph.hidden > 0 && <text className="graph-hidden" x="450" y="400" textAnchor="middle">他 {graph.hidden} 件は省略</text>}
                </svg>
              ) : (
                <EmptyState title="表示できるKnowledgeがありません" action="問いを追加" onAction={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: { node_type: "question" } })} />
              )
            ) : (
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
            )}
          </div>
        </div>
        {selectableNodes.length > 0 && (
          <div className="knowledge-selector-list" aria-label="Knowledge選択">
            {selectableNodes.map((node) => (
              <button className={node.id === selectedId ? "is-selected" : ""} key={node.id} onClick={() => setSelectedId(node.id)}>
                <span>{KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}</span>
                <strong>{node.title}</strong>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="knowledge-focus panel">
        <div className="section-heading"><h2>整理キュー</h2><span>{healthIssues.length}件</span></div>
        <div className="knowledge-issue-grid">
          {sortedIssues.slice(0, 6).map((issue) => (
            <article className={`knowledge-issue-card ${issue.kind}`} key={issue.id}>
              <button className="knowledge-card-main" onClick={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: issue.node })}>
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
                        <button className="knowledge-card-main" onClick={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: node })}>
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
