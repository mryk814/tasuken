export function reorderVisibleIdsInScope(
  allIds: readonly string[],
  visibleIds: readonly string[],
  draggedId: string,
  targetId: string,
  placement?: "before" | "after",
): string[] | null;
export function reindexScopedIds(ids: readonly string[]): Map<string, number>;
export function applyOptimisticSortOrders<T extends { id: string }>(records: readonly T[], overlays: Record<string, { token: string; value: number }>): T[];
export function clearOptimisticSortOrders(overlays: Record<string, { token: string; value: number }>, token: string): Record<string, { token: string; value: number }>;
