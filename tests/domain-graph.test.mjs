import assert from "node:assert/strict";
import test from "node:test";

import {
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
