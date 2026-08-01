import { mermaidSvgPresentation } from "./mermaidSizing";

let mermaidSequence = 0;
let mermaidModulePromise: Promise<typeof import("mermaid")> | null = null;
let mermaidRenderQueue: Promise<unknown> = Promise.resolve();
let lastEditorInputAt = 0;

function loadMermaid() {
  mermaidModulePromise ||= import("mermaid").then((module) => {
    module.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Nunito, Yu Gothic UI, Yu Gothic, sans-serif",
      sequence: {
        // 下端の参加者ミラーは短い図でもライフラインと余白を大きくするため表示しない。
        mirrorActors: false,
      },
    });
    return module;
  });
  return mermaidModulePromise;
}

type MermaidRenderMode = "screen" | "print";

export function markMermaidEditorInput(): void {
  lastEditorInputAt = performance.now();
}

async function waitForMermaidRenderIdle(): Promise<void> {
  while (true) {
    const quietFor = performance.now() - lastEditorInputAt;
    if (quietFor < 450) {
      await new Promise((resolve) => window.setTimeout(resolve, 450 - quietFor));
      continue;
    }
    if (!("requestIdleCallback" in window)) return;
    await new Promise<void>((resolve) => {
      window.requestIdleCallback(() => resolve(), { timeout: 1200 });
    });
    if (performance.now() - lastEditorInputAt >= 450) return;
  }
}

function fitMermaidSvg(node: HTMLElement, mode: MermaidRenderMode): void {
  const svg = node.querySelector<SVGSVGElement>("svg");
  if (!svg) return;

  const presentation = mermaidSvgPresentation(svg.getAttribute("viewBox"));
  if (!presentation) return;
  const hasCustomWidth = node.dataset.mermaidWidth !== undefined;
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.height = "auto";
  svg.style.margin = "0 auto";
  if (mode === "print") {
    // PDF はスクロールできないため、固有の縦横比を保ったまま用紙の幅・高さの両方に収める。
    svg.setAttribute("width", String(presentation.intrinsicWidth));
    svg.setAttribute("height", String(presentation.intrinsicHeight));
    svg.style.width = "auto";
    svg.style.height = "auto";
    svg.style.maxWidth = "100%";
    svg.style.maxHeight = "205mm";
  } else if (hasCustomWidth) {
    // 明示幅では画像と同じく図全体を指定領域へ収める。可読性優先の横スクロールは自動幅だけに残す。
    svg.removeAttribute("width");
    svg.style.width = "100%";
    svg.style.maxWidth = "100%";
  } else {
    svg.setAttribute("width", String(presentation.preferredWidth));
    svg.style.width = `${presentation.preferredWidth}px`;
    svg.style.maxWidth = "none";
    node.classList.add("is-mermaid-scrollable");
  }
}

async function renderMermaidBlockNow(node: HTMLElement, mode: MermaidRenderMode): Promise<boolean> {
  if (node.classList.contains("is-rendered") || node.classList.contains("has-render-error")) return false;
  node.classList.add("is-rendering");
  try {
    const { default: mermaid } = await loadMermaid();
    const source = node.querySelector("code")?.textContent || "";
    const id = `tasken-mermaid-${mermaidSequence++}`;
    const result = await mermaid.render(id, source);
    node.innerHTML = `<div class="md-mermaid-svg">${result.svg}</div>`;
    fitMermaidSvg(node, mode);
    node.classList.add("is-rendered");
    return false;
  } catch {
    node.classList.add("has-render-error");
    node.insertAdjacentHTML(
      "afterbegin",
      '<div class="md-mermaid-error">Mermaidを描画できませんでした。コードを確認してください。</div>',
    );
    return true;
  } finally {
    node.classList.remove("is-rendering");
  }
}

export function renderMermaidBlock(node: HTMLElement, mode: MermaidRenderMode = "screen"): Promise<boolean> {
  const task = mermaidRenderQueue.then(async () => {
    if (mode === "screen") await waitForMermaidRenderIdle();
    return renderMermaidBlockNow(node, mode);
  });
  mermaidRenderQueue = task.catch(() => undefined);
  return task;
}

export async function renderMermaidBlocks(root: ParentNode, mode: MermaidRenderMode = "screen"): Promise<number> {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>("[data-mermaid='true']:not(.is-rendered):not(.has-render-error):not(.is-rendering)"),
  );
  if (!nodes.length) return 0;

  let errorCount = 0;
  for (const node of nodes) {
    if (await renderMermaidBlock(node, mode)) errorCount += 1;
  }
  return errorCount;
}

export async function renderMermaidDocumentForPdf(html: string): Promise<string> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  await renderMermaidBlocks(parsed, "print");
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}
