export function reorderVisibleIdsInScope(
  allIds: readonly string[],
  visibleIds: readonly string[],
  draggedId: string,
  targetId: string,
  placement?: "before" | "after",
): string[] | null;
export function reindexScopedIds(ids: readonly string[]): Map<string, number>;
