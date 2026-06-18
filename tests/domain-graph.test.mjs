import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDependencyAcyclic,
  assertItemParentAcyclic,
  assertKnowledgeRelationAcyclic,
} from "../src/main/repositories/domain.mjs";

function item(id, title, parent_item_id = null) {
  return {
    id,
    title,
    kind: "task",
    level: "task",
    status: "todo",
    parent_item_id,
  };
}

test("item parent cannot be itself", () => {
  assert.throws(
    () => assertItemParentAcyclic([], item("a", "A", "a")),
    /親Item|自身|循環/,
  );
});

test("item parent cannot be a descendant", () => {
  const items = [
    item("a", "A"),
    item("b", "B", "a"),
    item("c", "C", "b"),
  ];
  assert.throws(
    () => assertItemParentAcyclic(items, item("a", "A", "c")),
    /循環/,
  );
});

test("dependency cannot create a cycle", () => {
  const dependencies = [
    { id: "ab", source_item_id: "a", target_item_id: "b" },
    { id: "bc", source_item_id: "b", target_item_id: "c" },
  ];
  assert.throws(
    () => assertDependencyAcyclic(dependencies, { id: "ca", source_item_id: "c", target_item_id: "a" }),
    /Dependencyが循環/,
  );
});

test("dependency update ignores the edge being replaced", () => {
  const dependencies = [
    { id: "ab", source_item_id: "a", target_item_id: "b" },
    { id: "bc", source_item_id: "b", target_item_id: "c" },
  ];
  assert.doesNotThrow(
    () => assertDependencyAcyclic(dependencies, { id: "bc", source_item_id: "b", target_item_id: "d" }),
  );
});

test("directional knowledge relation cannot create a cycle", () => {
  const relations = [
    { id: "ab", source_node_id: "a", target_node_id: "b", relation_type: "depends_on" },
    { id: "bc", source_node_id: "b", target_node_id: "c", relation_type: "leads_to" },
  ];
  assert.throws(
    () => assertKnowledgeRelationAcyclic(relations, { id: "ca", source_node_id: "c", target_node_id: "a", relation_type: "causes" }),
    /Knowledge Relationが循環/,
  );
});

test("similar knowledge relation does not require acyclic graph", () => {
  const relations = [
    { id: "ab", source_node_id: "a", target_node_id: "b", relation_type: "depends_on" },
    { id: "bc", source_node_id: "b", target_node_id: "c", relation_type: "leads_to" },
  ];
  assert.doesNotThrow(
    () => assertKnowledgeRelationAcyclic(relations, { id: "ca", source_node_id: "c", target_node_id: "a", relation_type: "similar_to" }),
  );
});
