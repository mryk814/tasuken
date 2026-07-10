import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  computeHeadingNumberLabels,
  HEADING_INDEX_MIN_COUNT,
  normalizeHeadingNumberStart,
  type MarkdownHeadingItem,
  type MarkdownRenderOptions,
} from "../lib/markdown";

type MarkdownHeadingIndexProps = {
  headings: MarkdownHeadingItem[];
  onSelect: (heading: MarkdownHeadingItem) => void;
  /** 見出し番号 ON のとき一覧にも同じ番号を出す */
  headingNumberOptions?: MarkdownRenderOptions;
  /** 狭い画面で非表示にする場合など */
  hidden?: boolean;
};

const HEADING_INDEX_BAR_MAX = 16;

function findScrollContainer(surface: HTMLElement | null): HTMLElement | null {
  if (!surface) return null;
  return surface.querySelector<HTMLElement>('[class*="_rootContentEditableWrapper_"]')
    || surface.querySelector<HTMLElement>(".note-main-preview")
    || surface.querySelector<HTMLElement>("textarea.note-main-editor-raw");
}

function findHeadingElement(surface: HTMLElement, heading: MarkdownHeadingItem): HTMLElement | null {
  const preview = surface.querySelector(".note-main-preview");
  if (preview) {
    return preview.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`)
      || preview.querySelector<HTMLElement>(`[data-md-heading-index="${heading.index}"]`);
  }
  const mdx = surface.querySelector(".note-mdx-content");
  if (mdx) {
    const nodes = mdx.querySelectorAll("h1, h2, h3, h4");
    return (nodes[heading.index] as HTMLElement | undefined) || null;
  }
  return null;
}

/** スクロール位置から「いま読んでいる」見出しインデックスを求める。 */
function resolveActiveIndex(
  scrollEl: HTMLElement,
  targets: Array<{ el: HTMLElement | null }>,
): number {
  if (!targets.length) return 0;
  const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
  if (maxScroll <= 0) return 0;

  const scrollRect = scrollEl.getBoundingClientRect();
  // ビューポート上端から少し下を「現在地」とみなす
  const marker = scrollEl.scrollTop + Math.min(96, scrollEl.clientHeight * 0.22);

  let active = 0;
  let sawDom = false;
  for (let i = 0; i < targets.length; i += 1) {
    const el = targets[i].el;
    if (!el) continue;
    sawDom = true;
    const rect = el.getBoundingClientRect();
    const topInScroll = rect.top - scrollRect.top + scrollEl.scrollTop;
    if (topInScroll <= marker) active = i;
  }

  if (sawDom) return active;

  // Raw など DOM 見出しが無いとき: スクロール比率で近似
  const ratio = scrollEl.scrollTop / maxScroll;
  return Math.min(targets.length - 1, Math.max(0, Math.round(ratio * (targets.length - 1))));
}

/**
 * 文書中央右の線だけのフロート UI。
 * 線の本数 = h2 数。スクロール位置に応じて現在の線を強調。ホバーで一覧。
 */
export function MarkdownHeadingIndex({
  headings,
  onSelect,
  headingNumberOptions,
  hidden = false,
}: MarkdownHeadingIndexProps) {
  const [open, setOpen] = useState(false);
  const [activeBarIndex, setActiveBarIndex] = useState(0);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const listId = useId();

  const barHeadings = useMemo(() => {
    const h2s = headings.filter((item) => item.level === 2);
    const source = h2s.length > 0 ? h2s : headings;
    return source.slice(0, HEADING_INDEX_BAR_MAX);
  }, [headings]);

  const headingNumberLabels = useMemo(() => {
    if (!headingNumberOptions?.headingNumbers) return headings.map(() => null as string | null);
    return computeHeadingNumberLabels(
      headings.map((item) => ({ level: item.level, text: item.text })),
      normalizeHeadingNumberStart(headingNumberOptions.headingNumberStart),
    );
  }, [headings, headingNumberOptions?.headingNumbers, headingNumberOptions?.headingNumberStart]);

  const barCount = Math.max(1, barHeadings.length);
  const headingsKey = headings.map((item) => `${item.level}:${item.text}`).join("|");

  function clearCloseTimer() {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openNow() {
    clearCloseTimer();
    setOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [headingsKey]);

  // スクロール位置 → アクティブな線 / 見出し
  useEffect(() => {
    if (hidden || headings.length < HEADING_INDEX_MIN_COUNT) return;

    let scrollEl: HTMLElement | null = null;
    let frame = 0;
    let cancelled = false;

    const surfaceOf = () => rootRef.current?.closest(".note-markdown-surface") as HTMLElement | null;

    const update = () => {
      if (cancelled) return;
      const surface = surfaceOf();
      const scroller = findScrollContainer(surface);
      if (!scroller || !surface) return;

      const barTargets = barHeadings.map((heading) => ({
        el: findHeadingElement(surface, heading),
      }));
      const nextBar = resolveActiveIndex(scroller, barTargets);
      setActiveBarIndex((prev) => (prev === nextBar ? prev : nextBar));

      const allTargets = headings.map((heading) => ({
        el: findHeadingElement(surface, heading),
      }));
      const nextHeading = resolveActiveIndex(scroller, allTargets);
      setActiveHeadingIndex((prev) => (prev === nextHeading ? prev : nextHeading));
    };

    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };

    const attach = () => {
      const surface = surfaceOf();
      const next = findScrollContainer(surface);
      if (next === scrollEl) {
        update();
        return;
      }
      scrollEl?.removeEventListener("scroll", onScroll);
      scrollEl = next;
      scrollEl?.addEventListener("scroll", onScroll, { passive: true });
      update();
    };

    attach();
    // Edit/Preview 切替や MDX の遅延マウントに追従
    const surface = surfaceOf();
    const observer = surface
      ? new MutationObserver(() => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(attach);
      })
      : null;
    observer?.observe(surface!, { childList: true, subtree: true });

    // 初回レイアウト後にもう一度
    const boot = window.setTimeout(attach, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(boot);
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      scrollEl?.removeEventListener("scroll", onScroll);
    };
  }, [hidden, headings, barHeadings, headingsKey]);

  if (hidden || headings.length < HEADING_INDEX_MIN_COUNT) return null;

  return (
    <div
      className={`md-heading-index ${open ? "is-open" : ""}`}
      ref={rootRef}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="md-heading-index-trigger"
        aria-label="見出し一覧"
        aria-expanded={open}
        aria-controls={listId}
        title="見出しへ移動"
        onFocus={openNow}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
            scheduleClose();
          }
        }}
      >
        <span className="md-heading-index-bars" aria-hidden data-bar-count={barCount}>
          {Array.from({ length: barCount }, (_, index) => (
            <span
              key={index}
              className={index === activeBarIndex ? "is-active" : undefined}
            />
          ))}
        </span>
      </button>
      {open && (
        <div
          className="md-heading-index-panel"
          id={listId}
          role="listbox"
          aria-label="見出し一覧"
          onMouseEnter={openNow}
        >
          {headings.map((heading, index) => {
            const numberLabel = headingNumberLabels[index];
            const title = numberLabel ? `${numberLabel} ${heading.text}` : heading.text;
            return (
              <button
                key={heading.id}
                type="button"
                role="option"
                aria-selected={index === activeHeadingIndex}
                className={`md-heading-index-item level-${heading.level}${index === activeHeadingIndex ? " is-active" : ""}`}
                title={title}
                onClick={() => {
                  onSelect(heading);
                  setOpen(false);
                }}
              >
                {numberLabel && <span className="md-heading-index-item-number">{numberLabel}</span>}
                <span className="md-heading-index-item-text">{heading.text}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
