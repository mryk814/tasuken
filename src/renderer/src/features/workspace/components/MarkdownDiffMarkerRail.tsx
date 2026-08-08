import { useEffect, useState } from "react";

import {
  buildMarkdownDiffMarkerAnchorTexts,
  normalizeMarkdownDiffAnchorText,
  type MarkdownDiffMarker,
} from "../lib/markdownEditing";

type MarkdownDiffScrollMetrics = {
  containerTop: number;
  containerLeft: number;
  contentTop: number;
  contentHeight: number;
  lineHeight: number;
  paddingTop: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchorTops: Array<number | null>;
};

function markerElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, tr, img, [data-lexical-decorator='true']",
  ));
}

function markerElementText(element: HTMLElement): string {
  if (element instanceof HTMLImageElement) return element.alt;
  return element.textContent || "";
}

function findMarkerAnchor(
  root: HTMLElement,
  marker: MarkdownDiffMarker,
  totalLines: number,
): HTMLElement | null {
  const elements = markerElements(root);
  const rootRect = root.getBoundingClientRect();
  const lineRatio = Math.max(0, Math.min(1, (marker.lineNumber - 1) / Math.max(1, totalLines - 1)));
  const expectedTop = rootRect.top + lineRatio * Math.max(0, root.scrollHeight - 18);

  for (const anchorText of buildMarkdownDiffMarkerAnchorTexts(marker)) {
    const matches = elements.filter((element) => {
      const elementText = normalizeMarkdownDiffAnchorText(markerElementText(element));
      return elementText === anchorText || elementText.includes(anchorText);
    });
    if (matches.length === 0) continue;
    return matches.reduce((nearest, element) => {
      const nearestDistance = Math.abs(nearest.getBoundingClientRect().top - expectedTop);
      const elementDistance = Math.abs(element.getBoundingClientRect().top - expectedTop);
      return elementDistance < nearestDistance ? element : nearest;
    });
  }
  return null;
}

export function MarkdownDiffMarkerRail({
  markers,
  totalLines,
  mode,
  surfaceRef,
  onRestoreHunk,
}: {
  markers: MarkdownDiffMarker[];
  totalLines: number;
  mode: "edit" | "raw";
  surfaceRef: { current: HTMLDivElement | null };
  onRestoreHunk: (marker: MarkdownDiffMarker) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(markers.length > 0 ? 0 : null);
  const [metrics, setMetrics] = useState<MarkdownDiffScrollMetrics>({
    containerTop: 0,
    containerLeft: 0,
    contentTop: 0,
    contentHeight: 0,
    lineHeight: 0,
    paddingTop: 0,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    anchorTops: [],
  });

  useEffect(() => setActiveIndex(markers.length > 0 ? 0 : null), [markers]);

  useEffect(() => {
    let retryTimer: number | null = null;
    let frame = 0;
    let container: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const findContainer = () => {
      const surface = surfaceRef.current;
      if (!surface) return null;
      if (mode === "raw") return surface.querySelector<HTMLElement>("textarea.note-main-editor-raw");
      return surface.querySelector<HTMLElement>(".note-live-editor [class*='_rootContentEditableWrapper_']");
    };
    const findContent = () => {
      if (mode === "raw") return null;
      return surfaceRef.current?.querySelector<HTMLElement>(".note-mdx-content") || null;
    };

    const measure = () => {
      const surface = surfaceRef.current;
      const nextContainer = findContainer();
      if (!surface || !nextContainer) return;
      const surfaceRect = surface.getBoundingClientRect();
      const containerRect = nextContainer.getBoundingClientRect();
      const content = findContent();
      const contentRect = content?.getBoundingClientRect();
      const containerStyle = window.getComputedStyle(nextContainer);
      const lineHeight = Number.parseFloat(containerStyle.lineHeight);
      const paddingTop = Number.parseFloat(containerStyle.paddingTop);
      const anchorTops = mode === "edit" && content
        ? markers.map((marker) => {
          const anchor = findMarkerAnchor(content, marker, totalLines);
          if (!anchor) return null;
          const anchorRect = anchor.getBoundingClientRect();
          return anchorRect.top - surfaceRect.top + Math.min(12, anchorRect.height / 2);
        })
        : [];
      setMetrics({
        containerTop: containerRect.top - surfaceRect.top,
        containerLeft: containerRect.left - surfaceRect.left,
        contentTop: contentRect ? contentRect.top - surfaceRect.top : containerRect.top - surfaceRect.top,
        contentHeight: content ? Math.max(content.scrollHeight, contentRect?.height || 0) : nextContainer.scrollHeight,
        lineHeight: Number.isFinite(lineHeight) ? lineHeight : 0,
        paddingTop: Number.isFinite(paddingTop) ? paddingTop : 0,
        scrollTop: nextContainer.scrollTop,
        scrollHeight: nextContainer.scrollHeight,
        clientHeight: nextContainer.clientHeight,
        anchorTops,
      });
    };

    const attach = () => {
      container = findContainer();
      if (!container) {
        retryTimer = window.setTimeout(attach, 80);
        return;
      }
      container.addEventListener("scroll", measure, { passive: true });
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(container);
      const content = findContent();
      if (content) resizeObserver.observe(content);
      measure();
    };

    frame = window.requestAnimationFrame(attach);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      if (retryTimer != null) window.clearTimeout(retryTimer);
      container?.removeEventListener("scroll", measure);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mode, markers.length, surfaceRef, totalLines]);

  const contentHeight = Math.max(metrics.scrollHeight, metrics.clientHeight, 1);
  const lineSpan = Math.max(1, totalLines - 1);
  const markerTop = (marker: MarkdownDiffMarker, index: number) => {
    if (mode === "raw" && metrics.lineHeight > 0) {
      return metrics.containerTop + metrics.paddingTop + (marker.lineNumber - 1) * metrics.lineHeight
        + metrics.lineHeight / 2 - metrics.scrollTop;
    }
    const anchoredTop = metrics.anchorTops[index];
    if (anchoredTop != null) return anchoredTop;
    const ratio = Math.max(0, Math.min(1, (marker.lineNumber - 1) / lineSpan));
    const contentTop = metrics.contentTop || metrics.containerTop;
    const measuredContentHeight = metrics.contentHeight || contentHeight;
    return contentTop + ratio * Math.max(0, measuredContentHeight - 18);
  };
  const findScrollContainer = () => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    if (mode === "raw") return surface.querySelector<HTMLElement>("textarea.note-main-editor-raw");
    return surface.querySelector<HTMLElement>(".note-live-editor [class*='_rootContentEditableWrapper_']");
  };
  const scrollToMarker = (index: number) => {
    const marker = markers[index];
    const container = findScrollContainer();
    if (!marker || !container) return;
    const ratio = Math.max(0, Math.min(1, (marker.lineNumber - 1) / lineSpan));
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    let documentTop: number;
    if (mode === "raw") {
      const style = window.getComputedStyle(container);
      const lineHeight = Number.parseFloat(style.lineHeight) || 0;
      const paddingTop = Number.parseFloat(style.paddingTop) || 0;
      documentTop = paddingTop + (marker.lineNumber - 1) * lineHeight;
    } else {
      const content = surfaceRef.current?.querySelector<HTMLElement>(".note-mdx-content");
      const containerRect = container.getBoundingClientRect();
      const anchor = content ? findMarkerAnchor(content, marker, totalLines) : null;
      if (anchor) {
        const anchorRect = anchor.getBoundingClientRect();
        documentTop = anchorRect.top - containerRect.top + container.scrollTop + Math.min(12, anchorRect.height / 2);
      } else {
        const contentRect = content?.getBoundingClientRect();
        const contentDocumentTop = contentRect ? contentRect.top - containerRect.top + container.scrollTop : 0;
        const contentHeight = content ? Math.max(content.scrollHeight, contentRect?.height || 0) : container.scrollHeight;
        documentTop = contentDocumentTop + ratio * Math.max(0, contentHeight - 18);
      }
    }
    const target = documentTop - container.clientHeight * 0.35;
    container.scrollTo({ top: Math.max(0, Math.min(maxScrollTop, target)), behavior: "smooth" });
  };
  const selectMarker = (index: number) => {
    setActiveIndex(index);
    window.requestAnimationFrame(() => scrollToMarker(index));
  };
  useEffect(() => {
    if (markers.length === 0) return undefined;
    const frame = window.requestAnimationFrame(() => scrollToMarker(0));
    return () => window.cancelAnimationFrame(frame);
  }, [markers.length, mode, metrics.clientHeight, metrics.scrollHeight]);
  const activeMarker = activeIndex == null ? null : markers[activeIndex] || null;
  const markerLeft = metrics.containerLeft + 8;

  return (
    <div className="markdown-diff-marker-rail" aria-label="Markdownの変更箇所">
      {markers.map((marker, index) => (
        <button
          key={`${marker.lineNumber}-${index}`}
          type="button"
          className={`markdown-diff-marker is-${marker.kind} ${activeIndex === index ? "is-active" : ""}`}
          style={{ top: markerTop(marker, index), left: markerLeft }}
          aria-label={`変更箇所 ${index + 1}、${marker.lineNumber}行目`}
          aria-pressed={activeIndex === index}
          onClick={() => selectMarker(index)}
        />
      ))}
      {activeMarker && (
        <section
          className="markdown-diff-panel"
          role="dialog"
          aria-label="差分レビュー"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="markdown-diff-heading">
            <div className="markdown-diff-summary">
              <strong>差分レビュー</strong>
              <span className="markdown-diff-counts" aria-label="差分件数">
                <span className="markdown-diff-count is-added">+{activeMarker.hunk.addedLines}</span>
                <span aria-hidden="true">/</span>
                <span className="markdown-diff-count is-removed">-{activeMarker.hunk.removedLines}</span>
              </span>
            </div>
            <div className="markdown-diff-navigation">
              <button type="button" className="secondary-button compact" onClick={() => selectMarker((activeIndex! - 1 + markers.length) % markers.length)}>前へ</button>
              <span aria-live="polite">{(activeIndex ?? 0) + 1} / {markers.length}</span>
              <button type="button" className="secondary-button compact" onClick={() => selectMarker(((activeIndex ?? 0) + 1) % markers.length)}>次へ</button>
              <button type="button" className="secondary-button compact" onClick={() => setActiveIndex(null)}>閉じる</button>
            </div>
          </div>
          <div className="markdown-diff-hunk-meta">
            <div className="markdown-diff-current-location">
              <strong>表示中</strong>
              <span>変更箇所 {activeIndex! + 1} / {markers.length}</span>
              <span className="markdown-diff-direction">保存済み → 編集中</span>
            </div>
            <div className="markdown-diff-hunk-actions">
              <span className="markdown-diff-counts" aria-label="この変更箇所の差分件数">
                <span className="markdown-diff-count is-added">+{activeMarker.hunk.addedLines}</span>
                <span aria-hidden="true">/</span>
                <span className="markdown-diff-count is-removed">-{activeMarker.hunk.removedLines}</span>
              </span>
              <button type="button" className="secondary-button compact" onClick={() => onRestoreHunk(activeMarker)}>元に戻す</button>
            </div>
          </div>
          {activeMarker.hunk.omittedBefore > 0 && (
            <div className="markdown-diff-ellipsis">… 前に {activeMarker.hunk.omittedBefore} 行を省略 …</div>
          )}
          <div className="markdown-diff-lines" role="list" aria-label="差分内容">
            {activeMarker.hunk.lines.map((line, index) => {
              const isCurrentChange = index >= activeMarker.hunk.focusStart
                && index <= activeMarker.hunk.focusEnd;
              const isOtherChange = line.kind !== "same" && !isCurrentChange;
              return (
                <div
                  key={`${line.kind}-${index}-${line.beforeLine ?? line.afterLine ?? "none"}`}
                  className={`markdown-diff-line is-${line.kind} ${isCurrentChange ? "is-current-change" : ""} ${isOtherChange ? "is-other-change" : ""}`}
                  role="listitem"
                  aria-current={isCurrentChange ? "true" : undefined}
                >
                  <span className="markdown-diff-line-number">{line.beforeLine ?? "·"}</span>
                  <span className="markdown-diff-line-number">{line.afterLine ?? "·"}</span>
                  <span className="markdown-diff-line-marker" aria-hidden="true">
                    {isCurrentChange ? "▶" : line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
                  </span>
                  <span className="markdown-diff-line-text">{line.text || " "}</span>
                </div>
              );
            })}
          </div>
          {activeMarker.hunk.omittedAfter > 0 && (
            <div className="markdown-diff-ellipsis">… 後に {activeMarker.hunk.omittedAfter} 行を省略 …</div>
          )}
        </section>
      )}
    </div>
  );
}
