import assert from "node:assert/strict";
import test from "node:test";

import { buildKnowledgeHealth } from "../src/renderer/src/features/workspace/lib/knowledgeHealth.ts";

test("knowledge health detects claim, question, evidence, contradiction, and isolated issues", () => {
  const nodes = [
    { id: "claim-1", node_type: "claim", title: "Claim", status: "active" },
    { id: "question-1", node_type: "question", title: "Question", status: "active" },
    { id: "evidence-1", node_type: "evidence", title: "Evidence", status: "active" },
    { id: "claim-2", node_type: "claim", title: "Contradicted", status: "active" },
  ];
  const relations = [
    { id: "rel-1", source_node_id: "claim-2", target_node_id: "claim-1", relation_type: "contradicts" },
  ];

  const issues = buildKnowledgeHealth(nodes, relations, []);
  const kinds = issues.map((issue) => issue.kind);

  assert.ok(kinds.includes("claim_without_evidence"));
  assert.ok(kinds.includes("unanswered_question"));
  assert.ok(kinds.includes("evidence_without_source"));
  assert.ok(kinds.includes("contradicted_claim"));
  assert.ok(kinds.includes("isolated_node"));
});

test("knowledge health accepts supported claims and answered questions", () => {
  const nodes = [
    { id: "claim-1", node_type: "claim", title: "Claim", status: "active" },
    { id: "evidence-1", node_type: "evidence", title: "Evidence", source_note_id: "note-1", status: "active" },
    { id: "question-1", node_type: "question", title: "Question", status: "active" },
    { id: "decision-1", node_type: "decision", title: "Decision", status: "active" },
  ];
  const relations = [
    { id: "rel-1", source_node_id: "evidence-1", target_node_id: "claim-1", relation_type: "supports" },
    { id: "rel-2", source_node_id: "decision-1", target_node_id: "question-1", relation_type: "answers" },
  ];

  const issues = buildKnowledgeHealth(nodes, relations, []);
  const kinds = issues.map((issue) => issue.kind);

  assert.equal(kinds.includes("claim_without_evidence"), false);
  assert.equal(kinds.includes("unanswered_question"), false);
  assert.equal(kinds.includes("evidence_without_source"), false);
});
