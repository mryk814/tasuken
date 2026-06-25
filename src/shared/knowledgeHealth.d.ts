export interface KnowledgeHealthNode {
  id: string;
  node_type?: string;
  status?: string;
  title?: string;
  source_type?: string | null;
  source_id?: string | null;
  source_note_id?: string | null;
  source_link_id?: string | null;
  source_item_id?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface KnowledgeHealthRelation {
  id?: string;
  source_node_id?: string;
  target_node_id?: string;
  relation_type?: string;
  [key: string]: unknown;
}

export interface KnowledgeHealthEntity {
  id: string;
  status?: string;
  state?: string;
  title?: string;
  [key: string]: unknown;
}

export interface KnowledgeHealthIssue {
  id: string;
  kind: "claim_without_evidence" | "unanswered_question" | "contradicted_claim" | "evidence_without_source" | "isolated_node" | "stale_decision";
  node: KnowledgeHealthNode;
  message: string;
  action: string;
}

export function buildKnowledgeHealth(
  nodes: KnowledgeHealthNode[],
  relations: KnowledgeHealthRelation[],
  entities?: KnowledgeHealthEntity[],
  options?: { now?: number },
): KnowledgeHealthIssue[];

export function groupKnowledgeHealthIssues(issues: KnowledgeHealthIssue[]): {
  issues: KnowledgeHealthIssue[];
  unresolved_questions: KnowledgeHealthNode[];
  claims_without_evidence: KnowledgeHealthNode[];
  contradicted_claims: KnowledgeHealthNode[];
  evidence_without_source: KnowledgeHealthNode[];
  isolated_nodes: KnowledgeHealthNode[];
  stale_decisions: KnowledgeHealthNode[];
};
