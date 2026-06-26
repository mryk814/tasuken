import { IconListCheck } from "@tabler/icons-react";

import type { TaskChecklistItem } from "../domain-model/types";

export function checklistProgress(items?: TaskChecklistItem[] | null): { done: number; total: number } | null {
  const valid = (items || []).filter((item) => item.title.trim());
  if (!valid.length) return null;
  return {
    done: valid.filter((item) => item.done).length,
    total: valid.length,
  };
}

export function ChecklistProgressBadge({ items }: { items?: TaskChecklistItem[] | null }) {
  const progress = checklistProgress(items);
  if (!progress) return null;
  const complete = progress.done === progress.total;
  return (
    <span
      className={`checklist-progress-badge ${complete ? "is-complete" : ""}`}
      aria-label={`チェックリスト ${progress.done}/${progress.total} 完了`}
      title={`チェックリスト ${progress.done}/${progress.total} 完了`}
    >
      <IconListCheck size={14} />
      <span className="num">{progress.done}/{progress.total}</span>
    </span>
  );
}
