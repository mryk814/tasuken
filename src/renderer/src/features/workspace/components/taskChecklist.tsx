import { IconCheck, IconListCheck, IconPlus } from "@tabler/icons-react";
import { useLayoutEffect, useRef, useState } from "react";

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
      aria-label={`チェックリスト${complete ? "（完了）" : ""}`}
      title="チェックリスト"
    >
      <IconListCheck size={14} />
    </span>
  );
}

export function InlineTaskChecklist({
  items,
  onToggle,
  onAdd,
}: {
  items?: TaskChecklistItem[] | null;
  onToggle: (itemId: string) => void;
  onAdd: () => void;
}) {
  const visibleItems = (items || [])
    .filter((item) => item.title.trim())
    .sort((left, right) => left.sort_order - right.sort_order);
  const itemsKey = visibleItems.map((item) => `${item.id}:${item.title}:${item.done}`).join("|");
  const [visibleCount, setVisibleCount] = useState(visibleItems.length);
  const checklistRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const measureRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  useLayoutEffect(() => {
    const container = checklistRef.current;
    if (!container || !visibleItems.length) {
      setVisibleCount(0);
      return;
    }

    const updateVisibleCount = () => {
      const gap = Number.parseFloat(getComputedStyle(container).gap) || 4;
      const addWidth = addButtonRef.current?.getBoundingClientRect().width || 18;
      const available = container.clientWidth;
      const widths = visibleItems.map((item) => measureRefs.current[item.id]?.getBoundingClientRect().width || 0);
      let used = 0;
      let count = 0;

      for (let index = 0; index < widths.length; index += 1) {
        const nextUsed = used + (count ? gap : 0) + widths[index];
        const hidden = widths.length - index - 1;
        const moreWidth = hidden ? Math.max(24, 12 + String(hidden).length * 8) : 0;
        const total = nextUsed + (hidden ? gap + moreWidth : 0) + gap + addWidth;
        if (total > available) break;
        used = nextUsed;
        count += 1;
      }

      setVisibleCount((current) => current === count ? current : count);
    };

    updateVisibleCount();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(container);
    return () => observer.disconnect();
  }, [itemsKey]);

  const shownItems = visibleItems.slice(0, visibleCount);
  const hiddenCount = visibleItems.length - shownItems.length;

  return (
    <div ref={checklistRef} className={`inline-task-checklist ${visibleItems.length ? "has-items" : "is-empty"}`} aria-label="チェックリスト">
      {shownItems.length > 0 && (
        <div className="inline-task-checklist-items">
          {shownItems.map((item) => (
            <button
              className={`inline-task-checklist-item ${item.done ? "is-done" : ""}`}
              key={item.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(item.id);
              }}
              title={item.title}
              aria-label={`${item.title}を${item.done ? "未完了に戻す" : "完了"}`}
            >
              <span className="inline-task-checklist-check" aria-hidden="true">
                {item.done && <IconCheck size={11} stroke={2.4} />}
              </span>
              <span>{item.title}</span>
            </button>
          ))}
          {hiddenCount > 0 && (
            <span className="inline-task-checklist-more">+{hiddenCount}</span>
          )}
        </div>
      )}
      <button
        ref={addButtonRef}
        className="inline-task-checklist-add"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAdd();
        }}
        title="チェックリストを追加"
        aria-label="チェックリストを追加"
      >
        <IconPlus size={13} />
      </button>
      <div className="inline-task-checklist-measure" aria-hidden="true">
        {visibleItems.map((item) => (
          <span
            className={`inline-task-checklist-item ${item.done ? "is-done" : ""}`}
            key={item.id}
            ref={(element) => { measureRefs.current[item.id] = element; }}
          >
            <span className="inline-task-checklist-check" />
            <span>{item.title}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
