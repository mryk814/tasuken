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
import { isDefaultPrompt, isPromptNote, promptPurpose } from "../lib/prompts";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";
import type { KnowledgeEdge } from "../domain-model/types";

const ALL = "all";
const NODE_TYPE_ORDER = ["question", "claim", "evidence", "decision"] as const;
const GRAPH_NODE_WIDTH = 164;
const GRAPH_NODE_HEIGHT = 62;
const GRAPH_HEIGHT = 420;
const GRAPH_MAX_NODES = 40;
const GRAPH_MAX_EDGES = 80;
const GRAPH_LABEL_HEIGHT = 18;
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
type GraphScope = "selected" | "theme" | "health";
type PositionedKnowledgeNode = KnowledgeNode & {
  x: number;
  y: number;
  issueKinds: Set<KnowledgeHealthIssue["kind"]>;
  relationCount: number;
  hop: number;
  priority: number;
};
type GraphRect = { x: number; y: number; width: number; height: number };

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
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

function relationWeight(type?: string | null): number {
  switch (type) {
    case "contradicts":
      return 42;
    case "answers":
    case "supports":
      return 34;
    case "derived_from":
    case "depends_on":
      return 24;
    case "leads_to":
    case "causes":
      return 22;
    case "explains":
    case "example_of":
      return 18;
    default:
      return 12;
  }
}

function issueWeight(kinds: Set<KnowledgeHealthIssue["kind"]>): number {
  let score = 0;
  for (const kind of kinds) {
    score += Math.max(2, 18 - ISSUE_PRIORITY[kind] * 2);
  }
  return score;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rectsOverlap(a: GraphRect, b: GraphRect, padding = 0): boolean {
  return a.x < b.x + b.width + padding
    && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding
    && a.y + a.height + padding > b.y;
}

function relationLabelWidth(label: string): number {
  return clamp(label.length * 7 + 14, 44, 104);
}

function labelRect(x: number, y: number, width: number): GraphRect {
  return {
    x: x - width / 2,
    y: y - GRAPH_LABEL_HEIGHT + 4,
    width,
    height: GRAPH_LABEL_HEIGHT,
  };
}

function placeRelationLabel(
  candidates: Array<{ x: number; y: number }>,
  width: number,
  nodeRects: GraphRect[],
  usedLabelRects: GraphRect[],
) {
  const scored = candidates.map((candidate, index) => {
    const x = clamp(candidate.x, width / 2 + 10, 890 - width / 2);
    const y = clamp(candidate.y, GRAPH_LABEL_HEIGHT + 8, GRAPH_HEIGHT - 12);
    const rect = labelRect(x, y, width);
    const nodeHits = nodeRects.filter((nodeRect) => rectsOverlap(rect, nodeRect, 6)).length;
    const labelHits = usedLabelRects.filter((usedRect) => rectsOverlap(rect, usedRect, 4)).length;
    return {
      x,
      y,
      rect,
      score: nodeHits * 1000 + labelHits * 180 + index * 4 + Math.abs(candidate.y - y) + Math.abs(candidate.x - x),
    };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0];
}

function buildKnowledgeGraphLayout(
  nodes: KnowledgeNode[],
  relations: KnowledgeEdge[],
  selectedId: string | null,
  graphScope: GraphScope,
  issues: KnowledgeHealthIssue[],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selected = selectedId ? nodeById.get(selectedId) : null;
  if (!nodes.length) return { nodes: [], edges: [], hidden: 0 };

  const scopedRelations = relations.filter((relation) =>
    nodeById.has(String(relation.source_node_id)) && nodeById.has(String(relation.target_node_id)));
  const issueMap = issueKindsByNode(issues);
  const issueNodeIds = new Set(issues.map((issue) => issue.node.id).filter((id) => nodeById.has(id)));
  const relationCounts = new Map<string, number>();
  const weightedRelationCounts = new Map<string, number>();
  const adjacency = new Map<string, Array<{ id: string; relation: KnowledgeEdge }>>();

  for (const relation of scopedRelations) {
    const sourceId = String(relation.source_node_id);
    const targetId = String(relation.target_node_id);
    relationCounts.set(sourceId, (relationCounts.get(sourceId) || 0) + 1);
    relationCounts.set(targetId, (relationCounts.get(targetId) || 0) + 1);
    const weight = relationWeight(relation.relation_type);
    weightedRelationCounts.set(sourceId, (weightedRelationCounts.get(sourceId) || 0) + weight);
    weightedRelationCounts.set(targetId, (weightedRelationCounts.get(targetId) || 0) + weight);
    adjacency.set(sourceId, [...(adjacency.get(sourceId) || []), { id: targetId, relation }]);
    adjacency.set(targetId, [...(adjacency.get(targetId) || []), { id: sourceId, relation }]);
  }

  const candidateIds = new Set<string>();
  const hopById = new Map<string, number>();
  const addCandidate = (id: string, hop: number) => {
    if (!nodeById.has(id)) return;
    candidateIds.add(id);
    hopById.set(id, Math.min(hopById.get(id) ?? hop, hop));
  };

  if (graphScope === "selected" && selected) {
    addCandidate(selected.id, 0);
    for (const neighbor of adjacency.get(selected.id) || []) {
      addCandidate(neighbor.id, 1);
      for (const secondHop of adjacency.get(neighbor.id) || []) {
        addCandidate(secondHop.id, secondHop.id === selected.id ? 0 : 2);
      }
    }
  } else if (graphScope === "health") {
    for (const id of issueNodeIds) {
      addCandidate(id, selected?.id === id ? 0 : 1);
      for (const neighbor of adjacency.get(id) || []) addCandidate(neighbor.id, 2);
    }
    if (!candidateIds.size && selected) addCandidate(selected.id, 0);
  } else {
    for (const node of nodes) addCandidate(node.id, selected?.id === node.id ? 0 : 1);
  }

  if (!candidateIds.size) return { nodes: [], edges: [], hidden: 0 };

  const scoreNode = (node: KnowledgeNode) => {
    const kinds = issueMap.get(node.id) || new Set<KnowledgeHealthIssue["kind"]>();
    const hop = hopById.get(node.id) ?? 3;
    const selectedScore = node.id === selected?.id ? 1000 : 0;
    const scopeScore = graphScope === "health" && issueNodeIds.has(node.id) ? 240 : 0;
    const distanceScore = Math.max(0, 160 - hop * 48);
    return selectedScore
      + scopeScore
      + distanceScore
      + issueWeight(kinds)
      + (relationCounts.get(node.id) || 0) * 10
      + (weightedRelationCounts.get(node.id) || 0)
      + (String(node.updated_at || "").length ? 2 : 0);
  };

  const rankedNodes = [...candidateIds]
    .map((id) => nodeById.get(id))
    .filter((node): node is KnowledgeNode => Boolean(node))
    .sort((a, b) => scoreNode(b) - scoreNode(a) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const shownNodes = rankedNodes.slice(0, GRAPH_MAX_NODES);
  const shownIds = new Set(shownNodes.map((node) => node.id));
  let hidden = Math.max(0, rankedNodes.length - shownNodes.length);

  const lanes: Record<"left" | "center" | "right", KnowledgeNode[]> = { left: [], center: [], right: [] };
  for (const node of shownNodes) {
    lanes[GRAPH_LANES[node.node_type] || "center"].push(node);
  }

  const positioned = new Map<string, PositionedKnowledgeNode>();
  (Object.keys(lanes) as Array<keyof typeof lanes>).forEach((lane) => {
    const sortedLaneNodes = lanes[lane].sort((a, b) => {
      const scoreDiff = scoreNode(b) - scoreNode(a);
      if (scoreDiff) return scoreDiff;
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
    const selectedInLane = selected ? sortedLaneNodes.find((node) => node.id === selected.id) : null;
    const laneNodes = selectedInLane
      ? (() => {
          const ordered = sortedLaneNodes.filter((node) => node.id !== selectedInLane.id);
          const center = Math.floor(sortedLaneNodes.length / 2);
          ordered.splice(center, 0, selectedInLane);
          return ordered;
        })()
      : sortedLaneNodes;
    const gap = Math.max(GRAPH_NODE_HEIGHT + 14, Math.min(86, (GRAPH_HEIGHT - 68) / Math.max(1, laneNodes.length)));
    const centerIndex = Math.max(0, (laneNodes.length - 1) / 2);
    const top = Math.max(24, GRAPH_HEIGHT / 2 - centerIndex * gap - GRAPH_NODE_HEIGHT / 2);
    laneNodes.forEach((node, index) => {
      const kinds = issueMap.get(node.id) || new Set<KnowledgeHealthIssue["kind"]>();
      const issueOffset = kinds.has("contradicted_claim") || kinds.has("claim_without_evidence") || kinds.has("unanswered_question") ? -10 : 0;
      const y = Math.min(GRAPH_HEIGHT - GRAPH_NODE_HEIGHT - 24, top + index * gap + issueOffset);
      positioned.set(node.id, {
        ...node,
        x: GRAPH_LANE_X[lane],
        y,
        issueKinds: kinds,
        relationCount: relationCounts.get(node.id) || 0,
        hop: hopById.get(node.id) ?? 3,
        priority: scoreNode(node),
      });
    });
  });

  const visibleRelations = scopedRelations
    .filter((relation) => shownIds.has(String(relation.source_node_id)) && shownIds.has(String(relation.target_node_id)))
    .sort((a, b) => relationWeight(b.relation_type) - relationWeight(a.relation_type))
    .slice(0, GRAPH_MAX_EDGES);
  hidden += Math.max(0, scopedRelations.filter((relation) =>
    candidateIds.has(String(relation.source_node_id)) && candidateIds.has(String(relation.target_node_id))).length - visibleRelations.length);

  const nodeRects = [...positioned.values()].map((node) => ({
    x: node.x,
    y: node.y,
    width: GRAPH_NODE_WIDTH,
    height: GRAPH_NODE_HEIGHT,
  }));
  const usedLabelRects: GraphRect[] = [];
  const graphEdges = visibleRelations
    .map((relation, index) => {
      const source = positioned.get(String(relation.source_node_id));
      const target = positioned.get(String(relation.target_node_id));
      if (!source || !target) return null;
      const sourceLane = GRAPH_LANES[source.node_type] || "center";
      const targetLane = GRAPH_LANES[target.node_type] || "center";
      const y1 = source.y + GRAPH_NODE_HEIGHT / 2;
      const y2 = target.y + GRAPH_NODE_HEIGHT / 2;
      const sameLane = sourceLane === targetLane;
      const forward = source.x < target.x;
      const x1 = sameLane ? source.x : forward ? source.x + GRAPH_NODE_WIDTH : source.x;
      const x2 = sameLane ? target.x : forward ? target.x : target.x + GRAPH_NODE_WIDTH;
      const routeSide = sourceLane === "right" ? 1 : -1;
      const laneRouteX = sameLane ? source.x + (routeSide < 0 ? -22 : GRAPH_NODE_WIDTH + 22) + routeSide * ((index % 4) * 10) : 0;
      const offset = sameLane ? 0 : Math.min(64, Math.max(30, Math.abs(x2 - x1) * 0.34));
      const pathD = sameLane
        ? `M${x1},${y1} C${laneRouteX},${y1} ${laneRouteX},${y2} ${x2},${y2}`
        : `M${x1},${y1} C${x1 + (forward ? offset : -offset)},${y1} ${x2 - (forward ? offset : -offset)},${y2} ${x2},${y2}`;
      const labelText = KNOWLEDGE_RELATION_LABELS[relation.relation_type || "supports"] || relation.relation_type || "relation";
      const labelWidth = relationLabelWidth(labelText);
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const label = placeRelationLabel(
        sameLane
          ? [
              { x: laneRouteX + routeSide * 42, y: midY - 8 },
              { x: laneRouteX + routeSide * 56, y: midY + 18 },
              { x: laneRouteX + routeSide * 42, y: Math.min(y1, y2) - 16 },
              { x: laneRouteX + routeSide * 42, y: Math.max(y1, y2) + 22 },
              { x: source.x + GRAPH_NODE_WIDTH / 2, y: midY },
            ]
          : [
              { x: midX, y: midY - 14 },
              { x: midX, y: midY + 18 },
              { x: x1 + (x2 - x1) * 0.35, y: y1 - 18 },
              { x: x1 + (x2 - x1) * 0.65, y: y2 + 18 },
              { x: midX, y: Math.min(y1, y2) - 22 },
            ],
        labelWidth,
        nodeRects,
        usedLabelRects,
      );
      usedLabelRects.push(label.rect);
      return {
        relation,
        labelText,
        labelWidth,
        source,
        target,
        x1,
        y1,
        x2,
        y2,
        pathD,
        sameLane,
        labelX: label.x,
        labelY: label.y,
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
  const [graphScope, setGraphScope] = useState<GraphScope>("selected");
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
  const graph = useMemo(() => buildKnowledgeGraphLayout(visible, relations, selectedId, graphScope, healthIssues), [visible, relations, selectedId, graphScope, healthIssues]);
  const knowledgePrompt = useMemo(() => (data.notes || [])
    .filter((note) => isPromptNote(note) && promptPurpose(note) === "knowledge")
    .filter((note) => themeId === ALL || !note.theme_id || note.theme_id === themeId)
    .sort((a, b) => Number(isDefaultPrompt(b)) - Number(isDefaultPrompt(a)) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0] || null,
  [data.notes, themeId]);

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

  function copyKnowledgePrompt() {
    if (!knowledgePrompt) return;
    workspaceApi.copyText(str(knowledgePrompt.body_markdown)).then(() => setToast("Knowledge用プロンプトをコピーしました。"));
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
          _auto_edge_target_id: issue.node.id,
          _auto_edge_relation_type: "answers",
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
          _auto_edge_target_id: issue.node.id,
          _auto_edge_relation_type: "supports",
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
        {knowledgePrompt && <button className="secondary-button" onClick={copyKnowledgePrompt}>Knowledgeプロンプトをコピー</button>}
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
        <div className="section-heading">
          <h2>つながり</h2>
          <span>{viewMode === "graph" ? `${graph.nodes.length} node / ${graph.edges.length} relation` : `${relationPreview.length}件`}</span>
        </div>
        {viewMode === "graph" && selectedNode && (
          <div className="knowledge-focus-bar">
            <StatusBadge value={selectedNode.status} label={KNOWLEDGE_NODE_LABELS[selectedNode.node_type] || selectedNode.node_type} />
            <div className="knowledge-focus-info">
              <strong>{selectedNode.title}</strong>
              <span>{nodeBody(selectedNode)}</span>
            </div>
            <button className="secondary-button compact" onClick={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: selectedNode })}>開く</button>
          </div>
        )}
        {viewMode === "graph" && (
          <div className="knowledge-graph-toolbar">
            <div className="segmented" aria-label="Graph範囲">
              <button className={graphScope === "selected" ? "is-active" : ""} onClick={() => setGraphScope("selected")}>選択中心</button>
              <button className={graphScope === "theme" ? "is-active" : ""} onClick={() => setGraphScope("theme")}>Theme</button>
              <button className={graphScope === "health" ? "is-active" : ""} onClick={() => setGraphScope("health")}>Health</button>
            </div>
            <span>最大40 node / 80 relation</span>
          </div>
        )}
        <div className="knowledge-explorer-body">
          <div className="knowledge-graph-main">
            {viewMode === "graph" ? (
              graph.nodes.length ? (
                <svg className="knowledge-graph" viewBox="0 0 900 420" role="img" aria-label="選択中Knowledgeの関係グラフ">
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
                    <pattern id="knowledge-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                      <circle cx="12" cy="12" r="0.8" className="knowledge-grid-dot" />
                    </pattern>
                  </defs>
                  <rect width="900" height="420" fill="url(#knowledge-dots)" />
                  {graph.edges.map((edge) => (
                    <g className={`graph-edge graph-edge-${relationClassName(edge.relation.relation_type)} ${edge.sameLane ? "is-same-lane" : ""}`} key={edge.relation.id}>
                      <path d={edge.pathD} markerEnd={`url(#${relationMarkerId(edge.relation.relation_type)})`} />
                      <rect className="graph-edge-label-bg" x={edge.labelX - edge.labelWidth / 2} y={edge.labelY - GRAPH_LABEL_HEIGHT + 4} width={edge.labelWidth} height={GRAPH_LABEL_HEIGHT} rx="5" />
                      <text x={edge.labelX} y={edge.labelY} textAnchor="middle">
                        {edge.labelText}
                      </text>
                    </g>
                  ))}
                  {graph.nodes.map((node) => {
                    const issueClass = node.issueKinds.has("contradicted_claim")
                      ? "has-contradiction"
                      : node.issueKinds.has("claim_without_evidence")
                        ? "needs-evidence"
                        : node.issueKinds.has("unanswered_question")
                          ? "needs-answer"
                          : "";
                    return (
                      <g
                        className={`graph-node graph-node-${node.node_type} ${node.id === selectedId ? "is-selected" : ""} ${issueClass}`}
                        key={node.id}
                        role="button"
                        aria-label={`${KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}: ${node.title}`}
                        tabIndex={0}
                        onClick={() => setSelectedId(node.id)}
                        onDoubleClick={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: node })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openDrawer({ type: "knowledge_node", mode: "edit", entity: node });
                          }
                        }}
                      >
                        <title>{`${KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}: ${node.title}${str(node.body) ? `\n${str(node.body).slice(0, 120)}` : ""}`}</title>
                        <rect x={node.x} y={node.y} width={GRAPH_NODE_WIDTH} height={GRAPH_NODE_HEIGHT} rx="7" />
                        <text className="graph-node-type" x={node.x + 12} y={node.y + 21}>{KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}</text>
                        <text className="graph-node-title" x={node.x + 12} y={node.y + 43}>{shortText(node.title, 10)}</text>
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
              <button className={`${node.node_type} ${node.id === selectedId ? "is-selected" : ""}`} key={node.id} title={node.title} onClick={() => setSelectedId(node.id)} onDoubleClick={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: node })}>
                <span><NodeTypeIcon type={node.node_type} /> {KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}</span>
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
              <div className={`knowledge-lane panel ${type}`} key={type}>
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
