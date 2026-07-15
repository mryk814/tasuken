import { useEffect, useRef, type MouseEventHandler, type Ref, type UIEventHandler } from "react";

let mermaidSequence = 0;
let mermaidModulePromise: Promise<typeof import("mermaid")> | null = null;

function loadMermaid() {
  mermaidModulePromise ||= import("mermaid");
  return mermaidModulePromise;
}

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
    void loadMermaid().then(({ default: mermaid }) => {
      if (!active || renderVersionRef.current !== version) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "Nunito, Yu Gothic UI, Yu Gothic, sans-serif",
      });
      return nodes.reduce(async (previous, node) => {
        await previous;
        if (!active || renderVersionRef.current !== version) return;
        const source = node.querySelector("code")?.textContent || "";
        const id = `tasken-mermaid-${mermaidSequence++}`;
        try {
          const result = await mermaid.render(id, source);
          if (!active || renderVersionRef.current !== version) return;
          node.innerHTML = `<div class="md-mermaid-svg">${result.svg}</div>`;
          node.classList.add("is-rendered");
        } catch {
          if (!active || renderVersionRef.current !== version) return;
          node.classList.add("has-render-error");
          node.insertAdjacentHTML("afterbegin", '<div class="md-mermaid-error">Mermaidを描画できませんでした。コードを確認してください。</div>');
        }
      }, Promise.resolve());
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
