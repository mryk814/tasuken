import assert from "node:assert/strict";
import test from "node:test";

import { reorderVisibleIdsInScope, reindexScopedIds } from "../src/shared/viewOrdering.mjs";

test("drag success reorders visible IDs and reindexes only the scope", () => {
  const next = reorderVisibleIdsInScope(["a", "b", "c"], ["a", "b", "c"], "c", "a", "before");
  assert.deepEqual(next, ["c", "a", "b"]);
  assert.deepEqual([...reindexScopedIds(next).values()], [10, 20, 30]);
});

test("hidden/filter-out IDs keep their place and relative order", () => {
  const next = reorderVisibleIdsInScope(["a", "hidden-1", "b", "hidden-2", "c"], ["a", "b", "c"], "c", "a", "before");
  assert.deepEqual(next, ["c", "hidden-1", "a", "hidden-2", "b"]);
  assert.deepEqual(next.filter((id) => id.startsWith("hidden")), ["hidden-1", "hidden-2"]);
});

test("invalid or cross-scope drag is rejected without changing the source", () => {
  const original = ["a", "b"];
  assert.equal(reorderVisibleIdsInScope(original, ["a"], "a", "b", "before"), null);
  assert.equal(reorderVisibleIdsInScope(original, ["a", "a"], "a", "a", "before"), null);
  assert.deepEqual(original, ["a", "b"]);
});
