import type { Item, KnowledgeNode } from "../types";
import type { KnowledgeEdge } from "../domain-model/types";

export interface KnowledgeHealthIssue {
  id: string;
  kind: "claim_without_evidence" | "unanswered_question" | "contradicted_claim" | "evidence_without_source" | "isolated_node" | "stale_decision";
  node: KnowledgeNode;
  message: string;
  action: string;
}

const STALE_DECISION_DAYS = 90;

function daysSince(value?: string): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.floor((Date.now() - time) / 86400000);
}

function hasRelation(node: KnowledgeNode, relations: KnowledgeEdge[], predicate?: (relation: KnowledgeEdge) => boolean): boolean {
  return relations.some((relation) =>
    (relation.source_node_id === node.id || relation.target_node_id === node.id)
    && (!predicate || predicate(relation)));
}

function hasEvidenceSupport(claim: KnowledgeNode, nodes: KnowledgeNode[], relations: KnowledgeEdge[]): boolean {
  const evidenceIds = new Set(nodes.filter((node) => node.node_type === "evidence").map((node) => node.id));
  return relations.some((relation) => {
    if (relation.relation_type !== "supports") return false;
    if (relation.source_node_id === claim.id && evidenceIds.has(String(relation.target_node_id))) return true;
    if (relation.target_node_id === claim.id && evidenceIds.has(String(relation.source_node_id))) return true;
    return false;
  });
}

export function buildKnowledgeHealth(nodes: KnowledgeNode[], relations: KnowledgeEdge[], items: Item[] = []): KnowledgeHealthIssue[] {
  const issues: KnowledgeHealthIssue[] = [];
  const openItemIds = new Set(items.filter((item) => !["done", "cancelled", "archived"].includes(item.status || "")).map((item) => item.id));
  for (const node of nodes.filter((entry) => (entry.status || "active") === "active")) {
    if (node.node_type === "claim" && !hasEvidenceSupport(node, nodes, relations)) {
      issues.push({
        id: `${node.id}:claim_without_evidence`,
        kind: "claim_without_evidence",
        node,
        message: "根拠となるEvidenceとのsupports関係がありません。",
        action: "Evidenceを追加するか、既存Evidenceとsupportsで接続します。",
      });
    }
    if (node.node_type === "question" && !hasRelation(node, relations, (relation) => relation.relation_type === "answers")) {
      issues.push({
        id: `${node.id}:unanswered_question`,
        kind: "unanswered_question",
        node,
        message: "answers関係がない未解決Questionです。",
        action: "回答候補のDecision / Insight / Evidenceを接続します。",
      });
    }
    if (node.node_type === "claim" && hasRelation(node, relations, (relation) => relation.relation_type === "contradicts")) {
      issues.push({
        id: `${node.id}:contradicted_claim`,
        kind: "contradicted_claim",
        node,
        message: "contradicts関係があるClaimです。",
        action: "どちらの主張を採用するか確認し、statusを更新します。",
      });
    }
    if (node.node_type === "evidence" && !node.source_id && !node.source_note_id && !node.source_link_id && !node.source_item_id) {
      issues.push({
        id: `${node.id}:evidence_without_source`,
        kind: "evidence_without_source",
        node,
        message: "出典が未設定のEvidenceです。",
        action: "出典（メモ、リソース、タスク等）を設定します。",
      });
    }
    if (!hasRelation(node, relations)) {
      issues.push({
        id: `${node.id}:isolated_node`,
        kind: "isolated_node",
        node,
        message: "他のKnowledgeとのrelationがありません。",
        action: "関連する問い・根拠・決定へ接続するか、不要ならrejectedにします。",
      });
    }
    const decisionItemId = (node.source_type === "task" || node.source_type === "waiting" || node.source_type === "plan_node") ? node.source_id : node.source_item_id;
    if (node.node_type === "decision" && (!decisionItemId || !openItemIds.has(String(decisionItemId))) && daysSince(node.updated_at || node.created_at) >= STALE_DECISION_DAYS) {
      issues.push({
        id: `${node.id}:stale_decision`,
        kind: "stale_decision",
        node,
        message: `${STALE_DECISION_DAYS}日以上更新されていないDecisionです。`,
        action: "まだ有効か確認し、関連タスクまたは新しいDecisionに接続します。",
      });
    }
  }
  return issues;
}
