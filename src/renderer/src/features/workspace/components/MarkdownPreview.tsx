import { useEffect, useRef, type MouseEventHandler, type Ref, type UIEventHandler } from "react";

import { renderMermaidBlocks } from "../lib/mermaid";

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
    void Promise.resolve().then(async () => {
      if (!active || renderVersionRef.current !== version) return;
      await renderMermaidBlocks(root);
    }).catch(() => {
      if (active && renderVersionRef.current === version) nodes.forEach((node) => node.classList.add("has-render-error"));
    });

    return () => {
      active = false;
      renderVersionRef.current += 1;
    };
  }, [html]);

  return <div ref={(node) => {
    internalRef.current = node;
    if (typeof externalRef === "function") externalRef(node);
    else if (externalRef) externalRef.current = node;
  }} className={className} onScroll={onScroll} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
