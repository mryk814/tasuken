import assert from "node:assert/strict";
import test from "node:test";

import { buildKnowledgeInventory } from "../src/shared/knowledgeInventory.mjs";
import { buildBacklinkContext, parseExplicitLinks } from "../src/shared/contextLinks.mjs";

test("Knowledge inventory is read-only and reports type, origin, update, and relation references", () => {
  const nodes = [
    { id: "q1", node_type: "question", source: "manual", updated_at: "2026-08-01T00:00:00Z" },
    { id: "q2", node_type: "question", source_type: "note", updated_at: "2026-08-03T00:00:00Z" },
    { id: "e1", node_type: "evidence", source: "ai_generated", updated_at: "2026-08-02T00:00:00Z" },
  ];
  const relations = [
    { id: "r1", source_node_id: "q1", target_node_id: "e1" },
    { id: "r2", source_node_id: "e1", target_node_id: "q2" },
  ];
  const before = structuredClone({ nodes, relations });

  const result = buildKnowledgeInventory(nodes, relations);

  assert.deepEqual({ nodes, relations }, before);
  assert.deepEqual(result, {
    total_nodes: 3,
    total_relations: 2,
    linked_nodes: 3,
    types: [
      {
        node_type: "question",
        count: 2,
        updated_count: 2,
        latest_updated_at: "2026-08-03T00:00:00Z",
        relation_refs: 2,
        origins: [{ origin: "manual", count: 1 }, { origin: "note", count: 1 }],
      },
      {
        node_type: "evidence",
        count: 1,
        updated_count: 1,
        latest_updated_at: "2026-08-02T00:00:00Z",
        relation_refs: 2,
        origins: [{ origin: "ai", count: 1 }],
      },
    ],
  });
});

test("Context links are a shared projection independent of Knowledge UI", () => {
  assert.deepEqual(parseExplicitLinks("[[Claim A|説明]]"), [{ raw: "[[Claim A|説明]]", target: "Claim A", alias: "説明" }]);
  const result = buildBacklinkContext(
    { id: "target", title: "Claim A" },
    [
      { type: "note", record: { id: "n1", title: "source", body_markdown: "[[Claim A]]" } },
      { type: "task", record: { id: "t1", title: "candidate", body: "Claim Aを確認" } },
    ],
  );
  assert.deepEqual(result.backlinks.map((entry) => entry.id), ["n1"]);
  assert.deepEqual(result.unlinkedMentions.map((entry) => entry.id), ["t1"]);
});
