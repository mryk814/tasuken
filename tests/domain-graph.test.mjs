import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDependencyAcyclic,
  assertItemParentAcyclic,
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
