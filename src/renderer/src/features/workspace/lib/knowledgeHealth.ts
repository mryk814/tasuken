import { buildDataHealth as sharedBuildDataHealth, groupDataHealthIssues } from "../../../../../shared/knowledgeHealth.mjs";
import type { KnowledgeNode } from "../types";
import type { KnowledgeEdge } from "../domain-model/types";

interface HealthEntity { id: string; status?: string; state?: string; title?: string }

export interface KnowledgeHealthIssue {
  id: string;
  kind: "claim_without_evidence" | "unanswered_question" | "contradicted_claim" | "evidence_without_source" | "isolated_node" | "stale_decision";
  node: KnowledgeNode;
  message: string;
  action: string;
}

export function buildDataHealth(nodes: KnowledgeNode[], relations: KnowledgeEdge[], entities: HealthEntity[] = [], options?: { now?: number }): KnowledgeHealthIssue[] {
  return sharedBuildDataHealth(nodes, relations, entities, options) as KnowledgeHealthIssue[];
}

export const buildKnowledgeHealth = buildDataHealth;

export function groupKnowledgeHealthIssues(issues: KnowledgeHealthIssue[]) {
  return groupDataHealthIssues(issues);
}
