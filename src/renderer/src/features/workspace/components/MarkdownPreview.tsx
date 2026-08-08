import { useEffect, useRef, type MouseEventHandler, type Ref, type UIEventHandler } from "react";

import { renderMermaidBlock, renderMermaidBlocks } from "../lib/mermaid";

export function MarkdownPreview({
  html,
  className = "markdown-preview",
  renderMermaidEager = false,
  rootRef: externalRef,
  onScroll,
  onClick,
}: {
  html: string;
  className?: string;
  renderMermaidEager?: boolean;
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
    if (renderMermaidEager) {
      void renderMermaidBlocks(root).catch(() => {
        if (active && renderVersionRef.current === version) nodes.forEach((node) => node.classList.add("has-render-error"));
      });
      return () => {
        active = false;
        renderVersionRef.current += 1;
      };
    }

    const renderNode = (node: HTMLElement) => {
      if (!active || renderVersionRef.current !== version) return;
      void renderMermaidBlock(node).catch(() => {
        if (active && renderVersionRef.current === version) node.classList.add("has-render-error");
      });
    };
    let observer: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer?.unobserve(entry.target);
          renderNode(entry.target as HTMLElement);
        }
      }, { rootMargin: "700px 0px" });
      nodes.forEach((node) => observer?.observe(node));
    } else {
      void renderMermaidBlocks(root).catch(() => {
        if (active && renderVersionRef.current === version) nodes.forEach((node) => node.classList.add("has-render-error"));
      });
    }

    return () => {
      active = false;
      observer?.disconnect();
      renderVersionRef.current += 1;
    };
  }, [html, renderMermaidEager]);

  return <div ref={(node) => {
    internalRef.current = node;
    if (typeof externalRef === "function") externalRef(node);
    else if (externalRef) externalRef.current = node;
  }} className={className} onScroll={onScroll} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
