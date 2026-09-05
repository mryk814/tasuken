export interface TaskChecklistItemView {
  id: string;
  title: string;
  done: boolean;
  sort_order: number;
  completed_at?: string | null;
}

export function checklistProgress(
  items?: readonly TaskChecklistItemView[] | null,
): { done: number; total: number } | null {
  const valid = (items || []).filter((item) => item.title.trim());
  if (!valid.length) return null;
  return {
    done: valid.filter((item) => item.done).length,
    total: valid.length,
  };
}

export function checklistItemsForCompactDisplay(
  items?: readonly TaskChecklistItemView[] | null,
): TaskChecklistItemView[] {
  return (items || [])
    .filter((item) => item.title.trim())
    .sort(
      (left, right) => Number(left.done) - Number(right.done) || left.sort_order - right.sort_order,
    );
}
