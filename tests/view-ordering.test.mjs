import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyOptimisticSortOrders,
  clearOptimisticSortOrders,
  reorderVisibleIdsInScope,
  reindexScopedIds,
} from "../src/shared/viewOrdering.mjs";

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

test("sort-only overlay preserves newer external entity fields", () => {
  const latest = [{ id: "a", title: "外部更新", state: "adopted", sort_order: 10 }];
  const overlaid = applyOptimisticSortOrders(latest, { a: { token: "A", value: 20 } });
  assert.deepEqual(overlaid, [{ id: "a", title: "外部更新", state: "adopted", sort_order: 20 }]);
});

test("serial reorder tokens clear only their own optimistic state", () => {
  const overlays = {
    a: { token: "A", value: 20 },
    b: { token: "B", value: 10 },
  };
  assert.deepEqual(clearOptimisticSortOrders(overlays, "A"), { b: { token: "B", value: 10 } });
  assert.deepEqual(clearOptimisticSortOrders(overlays, "B"), { a: { token: "A", value: 20 } });
});

test("ChatRefs serializes reorder writes and leaves error ownership with saveEntities", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/ChatRefsPage.tsx", "utf8");
  assert.match(source, /reorderQueueRef/);
  assert.match(source, /latestChatResourcesRef/);
  assert.doesNotMatch(source, /previousOptimistic/);
  assert.doesNotMatch(source, /setToast\("並び替えを保存できませんでした/);
});
