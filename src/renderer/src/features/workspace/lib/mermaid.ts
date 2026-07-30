let mermaidSequence = 0;
let mermaidModulePromise: Promise<typeof import("mermaid")> | null = null;

function loadMermaid() {
  mermaidModulePromise ||= import("mermaid");
  return mermaidModulePromise;
}

export async function renderMermaidBlocks(root: ParentNode): Promise<number> {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>("[data-mermaid='true']:not(.is-rendered):not(.has-render-error)"),
  );
  if (!nodes.length) return 0;

  const { default: mermaid } = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: "Nunito, Yu Gothic UI, Yu Gothic, sans-serif",
    sequence: {
      // 下端の参加者ミラーは短い図でもライフラインと余白を大きくするため表示しない。
      mirrorActors: false,
    },
  });

  let errorCount = 0;
  for (const node of nodes) {
    const source = node.querySelector("code")?.textContent || "";
    const id = `tasken-mermaid-${mermaidSequence++}`;
    try {
      const result = await mermaid.render(id, source);
      node.innerHTML = `<div class="md-mermaid-svg">${result.svg}</div>`;
      node.classList.add("is-rendered");
    } catch {
      errorCount += 1;
      node.classList.add("has-render-error");
      node.insertAdjacentHTML(
        "afterbegin",
        '<div class="md-mermaid-error">Mermaidを描画できませんでした。コードを確認してください。</div>',
      );
    }
  }
  return errorCount;
}

export async function renderMermaidDocumentForPdf(html: string): Promise<string> {
  const document = new DOMParser().parseFromString(html, "text/html");
  await renderMermaidBlocks(document);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
