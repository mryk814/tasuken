import { forwardRef, memo, useEffect, useRef, useState, type MouseEvent, type MouseEventHandler, type Ref, type UIEventHandler } from "react";
import { createPortal } from "react-dom";

import type { MermaidPowerPointAction } from "../../../../../shared/mermaidPowerPoint";

import { mermaidPowerPointCapabilities } from "../lib/mermaidPowerPoint";
import {
  isMermaidNearViewport,
  MERMAID_LAZY_VIEWPORT_MARGIN_PX,
  renderMermaidBlock,
  renderMermaidBlocks,
} from "../lib/mermaid";

const MarkdownPreviewContent = memo(forwardRef<HTMLDivElement, { html: string }>(function MarkdownPreviewContent({ html }, ref) {
  return <div ref={ref} className="markdown-preview-content" dangerouslySetInnerHTML={{ __html: html }} />;
}));

export function MarkdownPreview({
  html,
  className = "markdown-preview",
  rootRef: externalRef,
  onScroll,
  onClick,
  onMermaidAction,
}: {
  html: string;
  className?: string;
  rootRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onMermaidAction?: (request: { action: MermaidPowerPointAction; blockId: string; source: string }) => Promise<void>;
}) {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const renderVersionRef = useRef(0);
  const mermaidActionRef = useRef(onMermaidAction);
  mermaidActionRef.current = onMermaidAction;
  const mermaidMenuRef = useRef<HTMLDivElement | null>(null);
  const mermaidTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [mermaidMenu, setMermaidMenu] = useState<{ x: number; y: number; blockId: string; source: string } | null>(null);
  const [busyAction, setBusyAction] = useState<MermaidPowerPointAction | null>(null);
  const [mermaidBlocks, setMermaidBlocks] = useState<Array<{ blockId: string; source: string }>>([]);
  const [mermaidTriggerPositions, setMermaidTriggerPositions] = useState<Record<string, { top: number; left: number }>>({});
  const hasMermaidAction = Boolean(onMermaidAction);

  useEffect(() => {
    closeMermaidMenu(false);
    setBusyAction(null);
  }, [html, hasMermaidAction]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMermaidMenu(true);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  useEffect(() => {
    if (!mermaidMenu) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (mermaidMenuRef.current?.contains(target) || mermaidTriggerRef.current?.contains(target))) return;
      closeMermaidMenu(true);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [mermaidMenu]);

  useEffect(() => {
    if (!mermaidMenu) return;
    const frame = window.requestAnimationFrame(() => {
      mermaidMenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mermaidMenu]);

  useEffect(() => {
    const root = internalRef.current;
    const content = contentRef.current;
    if (!root || !content) return;
    if (hasMermaidAction) {
      const nextBlocks = Array.from(content.querySelectorAll<HTMLElement>("pre[data-mermaid='true']")).map((node, index) => {
        const blockId = node.dataset.mermaidBlockId || `mermaid-block-${index + 1}`;
        node.dataset.mermaidBlockId = blockId;
        node.id = blockId;
        return { blockId, source: node.dataset.mermaidSource || node.querySelector("code")?.textContent || "" };
      });
      setMermaidBlocks(nextBlocks);
    } else {
      setMermaidBlocks([]);
      setMermaidTriggerPositions({});
    }
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
  }, [html, hasMermaidAction]);

  useEffect(() => {
    const root = internalRef.current;
    const content = contentRef.current;
    if (!root || !content || !mermaidBlocks.length) return;
    let frame = 0;
    const refreshPositions = () => {
      frame = 0;
      const rootRect = root.getBoundingClientRect();
      const next = Object.fromEntries(mermaidBlocks.flatMap(({ blockId }) => {
        const block = content.querySelector<HTMLElement>(`#${CSS.escape(blockId)}`);
        if (!block) return [];
        const rect = block.getBoundingClientRect();
        return [[blockId, {
          top: rect.top - rootRect.top + root.scrollTop + 6,
          left: Math.max(6, rect.right - rootRect.left + root.scrollLeft - 54),
        }]];
      }));
      setMermaidTriggerPositions((previous) => {
        const previousKeys = Object.keys(previous);
        const nextKeys = Object.keys(next);
        if (previousKeys.length !== nextKeys.length) return next;
        if (nextKeys.some((key) => previous[key]?.top !== next[key]?.top || previous[key]?.left !== next[key]?.left)) return next;
        return previous;
      });
    };
    const scheduleRefresh = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(refreshPositions);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleRefresh);
    resizeObserver?.observe(content);
    content.querySelectorAll<HTMLElement>("[data-mermaid='true']").forEach((block) => resizeObserver?.observe(block));
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleRefresh);
    mutationObserver?.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-mermaid", "data-mermaid-block-id"] });
    scheduleRefresh();
    root.addEventListener("scroll", refreshPositions, { passive: true });
    window.addEventListener("resize", scheduleRefresh);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      root.removeEventListener("scroll", refreshPositions);
      window.removeEventListener("resize", scheduleRefresh);
    };
  }, [mermaidBlocks]);

  async function runMermaidAction(action: MermaidPowerPointAction) {
    if (!mermaidMenu || !onMermaidAction || busyAction) return;
    setBusyAction(action);
    try {
      await onMermaidAction({ action, blockId: mermaidMenu.blockId, source: mermaidMenu.source });
      closeMermaidMenu(true);
    } finally {
      setBusyAction(null);
    }
  }

  function closeMermaidMenu(restoreFocus: boolean) {
    const trigger = mermaidTriggerRef.current;
    trigger?.setAttribute("aria-expanded", "false");
    setMermaidMenu(null);
    if (restoreFocus) window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
  }

  function openMermaidMenu(blockId: string, source: string, trigger: HTMLButtonElement) {
    if (!mermaidActionRef.current) return;
    const rect = trigger.getBoundingClientRect();
    mermaidTriggerRef.current?.setAttribute("aria-expanded", "false");
    mermaidTriggerRef.current = trigger;
    trigger.setAttribute("aria-expanded", "true");
    setMermaidMenu({
      x: Math.min(rect.left, Math.max(8, window.innerWidth - 350)),
      y: Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 190)),
      blockId,
      source,
    });
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!mermaidActionRef.current) return;
    const target = event.target instanceof Element ? event.target : null;
    const block = target?.closest<HTMLElement>("pre[data-mermaid='true']");
    if (!block || !internalRef.current?.contains(block)) return;
    event.preventDefault();
    event.stopPropagation();
    const blockId = block.dataset.mermaidBlockId || "mermaid-block-1";
    const source = block.dataset.mermaidSource || block.querySelector("code")?.textContent || "";
    const trigger = Array.from(internalRef.current.querySelectorAll<HTMLButtonElement>(".md-mermaid-export-trigger"))
      .find((button) => button.dataset.mermaidBlockId === blockId);
    mermaidTriggerRef.current?.setAttribute("aria-expanded", "false");
    mermaidTriggerRef.current = trigger || null;
    trigger?.setAttribute("aria-expanded", "true");
    setMermaidMenu({ x: Math.min(event.clientX, Math.max(8, window.innerWidth - 350)), y: Math.min(event.clientY, Math.max(8, window.innerHeight - 190)), blockId, source });
  }

  const menu = mermaidMenu && onMermaidAction ? (
    <div
      id={`mermaid-export-menu-${mermaidMenu.blockId}`}
      ref={mermaidMenuRef}
      className="context-menu mermaid-export-menu"
      role="menu"
      aria-label={`${mermaidMenu.blockId}の出力`}
      style={{ left: mermaidMenu.x, top: mermaidMenu.y }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mermaid-export-menu-heading">Mermaid · {mermaidMenu.blockId}</div>
      <button type="button" role="menuitem" disabled={busyAction !== null} onClick={() => void runMermaidAction("copy-svg")}>PowerPoint編集用SVGをコピー</button>
      <button type="button" role="menuitem" disabled={busyAction !== null} onClick={() => void runMermaidAction("export-svg")}>PowerPoint用SVGを書き出す</button>
      <button
        type="button"
        role="menuitem"
        disabled={busyAction !== null || !mermaidPowerPointCapabilities(mermaidMenu.source).nativePptx}
        title={mermaidPowerPointCapabilities(mermaidMenu.source).reason}
        onClick={() => void runMermaidAction("export-pptx")}
      >編集可能なPowerPointを作成</button>
      {!mermaidPowerPointCapabilities(mermaidMenu.source).nativePptx && (
        <div className="mermaid-export-menu-hint">ネイティブPPTXはflowchart / graphのみ。SVG出力は利用できます。</div>
      )}
      {busyAction && <div className="mermaid-export-menu-status" role="status">出力中…</div>}
    </div>
  ) : null;
  return <>
    <div ref={(node) => {
      internalRef.current = node;
      if (typeof externalRef === "function") externalRef(node);
      else if (externalRef) externalRef.current = node;
    }} className={className} onScroll={(event) => {
      closeMermaidMenu(false);
      onScroll?.(event);
    }} onClick={onClick} onContextMenu={handleContextMenu}>
      <MarkdownPreviewContent ref={contentRef} html={html} />
      {hasMermaidAction && mermaidBlocks.length > 0 && (
        <div className="md-mermaid-export-actions" aria-label="Mermaid出力">
          {mermaidBlocks.map(({ blockId, source }) => {
            const position = mermaidTriggerPositions[blockId];
            if (!position) return null;
            return (
              <button
                key={blockId}
                type="button"
                className="md-mermaid-export-trigger"
                data-mermaid-block-id={blockId}
                title={`${blockId}をPowerPointへ出力`}
                aria-label={`${blockId}をPowerPointへ出力`}
                aria-expanded={mermaidMenu?.blockId === blockId}
                aria-controls={`mermaid-export-menu-${blockId}`}
                style={{ top: position.top, left: position.left }}
                onClick={(event) => {
                  event.stopPropagation();
                  openMermaidMenu(blockId, source, event.currentTarget);
                }}
              >
                出力
              </button>
            );
          })}
        </div>
      )}
    </div>
    {menu ? createPortal(menu, document.body) : null}
  </>;
}
