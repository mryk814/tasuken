/**
 * 表示中のIDだけを並べ替え、非表示IDの位置と相対順を保持する。
 * filter/search/archive の外にあるEntityを、画面上の並べ替えで落とさないための共通規則。
 */
export function reorderVisibleIdsInScope(allIds, visibleIds, draggedId, targetId, placement = "before") {
  if (!Array.isArray(allIds) || !Array.isArray(visibleIds) || draggedId === targetId) return null;
  const visibleSet = new Set(visibleIds);
  if (!visibleSet.has(draggedId) || !visibleSet.has(targetId)) return null;
  const currentVisible = allIds.filter((id) => visibleSet.has(id));
  if (currentVisible.length !== visibleSet.size || new Set(allIds).size !== allIds.length) return null;
  const fromIndex = currentVisible.indexOf(draggedId);
  const targetIndex = currentVisible.indexOf(targetId);
  if (fromIndex < 0 || targetIndex < 0) return null;
  const nextVisible = [...currentVisible];
  const [moved] = nextVisible.splice(fromIndex, 1);
  const adjustedTargetIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertIndex = placement === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  nextVisible.splice(insertIndex, 0, moved);
  let visibleIndex = 0;
  return allIds.map((id) => visibleSet.has(id) ? nextVisible[visibleIndex++] : id);
}

export function reindexScopedIds(ids) {
  return new Map(ids.map((id, index) => [id, (index + 1) * 10]));
}

export function applyOptimisticSortOrders(records, overlays) {
  return records.map((record) => {
    const overlay = overlays?.[record.id];
    return overlay ? { ...record, sort_order: overlay.value } : record;
  });
}

export function clearOptimisticSortOrders(overlays, token) {
  return Object.fromEntries(
    Object.entries(overlays || {}).filter(([, entry]) => entry.token !== token),
  );
}
