import { useEffect, useRef, type MouseEventHandler, type Ref, type UIEventHandler } from "react";

import {
  isMermaidNearViewport,
  MERMAID_LAZY_VIEWPORT_MARGIN_PX,
  renderMermaidBlock,
  renderMermaidBlocks,
} from "../lib/mermaid";

export function MarkdownPreview({
  html,
  className = "markdown-preview",
  rootRef: externalRef,
  onScroll,
  onClick,
}: {
  html: string;
  className?: string;
  rootRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const renderVersionRef = useRef(0);
  useEffect(() => {
    const root = internalRef.current;
    if (!root) return;
    const version = renderVersionRef.current + 1;
    renderVersionRef.current = version;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-mermaid='true']:not(.is-rendered):not(.has-render-error)"));
    if (!nodes.length) return;

    let active = true;
    const queuedNodes = new Set<HTMLElement>();
    const renderNode = (node: HTMLElement) => {
      if (!active || renderVersionRef.current !== version) return;
      if (queuedNodes.has(node)) return;
      queuedNodes.add(node);
      void renderMermaidBlock(node).catch(() => {
        if (active && renderVersionRef.current === version) node.classList.add("has-render-error");
      });
    };
    let observer: IntersectionObserver | null = null;
    let fallbackFrame = 0;
    const renderNearViewportNodes = () => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      for (const node of nodes) {
        if (!isMermaidNearViewport(node.getBoundingClientRect(), viewportWidth, viewportHeight, MERMAID_LAZY_VIEWPORT_MARGIN_PX)) continue;
        observer?.unobserve(node);
        renderNode(node);
      }
    };
    const scheduleViewportFallback = () => {
      if (fallbackFrame || !active) return;
      fallbackFrame = window.requestAnimationFrame(() => {
        fallbackFrame = 0;
        if (active) renderNearViewportNodes();
      });
    };
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer?.unobserve(entry.target);
          renderNode(entry.target as HTMLElement);
        }
      }, { rootMargin: `${MERMAID_LAZY_VIEWPORT_MARGIN_PX}px 0px` });
      nodes.forEach((node) => observer?.observe(node));
      // Keep the production lazy boundary while covering a hosted Chromium
      // case where the first IO notification is omitted after a paint.
      window.addEventListener("scroll", scheduleViewportFallback, true);
      window.addEventListener("resize", scheduleViewportFallback);
      scheduleViewportFallback();
    } else {
      void renderMermaidBlocks(root).catch(() => {
        if (active && renderVersionRef.current === version) nodes.forEach((node) => node.classList.add("has-render-error"));
      });
    }

    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("scroll", scheduleViewportFallback, true);
      window.removeEventListener("resize", scheduleViewportFallback);
      if (fallbackFrame) window.cancelAnimationFrame(fallbackFrame);
      renderVersionRef.current += 1;
    };
  }, [html]);

  return <div ref={(node) => {
    internalRef.current = node;
    if (typeof externalRef === "function") externalRef(node);
    else if (externalRef) externalRef.current = node;
  }} className={className} onScroll={onScroll} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
