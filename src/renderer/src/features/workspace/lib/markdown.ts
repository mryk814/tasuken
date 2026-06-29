export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizePreviewHtml(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(src|href)\s*=\s*("|')?(?!https?:|mailto:|#)[^"'\s>]*\2/gi, "")
    .replace(/javascript:/gi, "");
}

export function splitFrontmatter(value: string): { frontmatter: string; body: string } {
  const normalized = value.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/);
  if (!match) return { frontmatter: "", body: value };
  return {
    frontmatter: match[1],
    body: normalized.slice(match[0].length),
  };
}

export function renderMarkdownPreview(value: string): string {
  const { frontmatter, body } = splitFrontmatter(value);
  const lines = body.split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let inList = false;
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  if (frontmatter) {
    html.push(`<details class="md-frontmatter"><summary>Frontmatter</summary><pre>${escapeHtml(frontmatter)}</pre></details>`);
  }
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      closeList();
      html.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(bullet[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) {
      html.push("<br />");
      continue;
    }
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  if (inCode) html.push("</code></pre>");
  return html.join("");
}

export function previewHtml(body: string, format: string): string {
  if (format === "html") return sanitizePreviewHtml(body);
  if (format === "markdown") return renderMarkdownPreview(body);
  return `<pre>${escapeHtml(body)}</pre>`;
}

export function previewDocument(body: string, format: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;margin:16px;color:#26211f;background:#fff}
h1,h2,h3{line-height:1.25;margin:1.2em 0 .5em}
p{margin:.5em 0}ul{padding-left:1.4em}pre{overflow:auto;padding:12px;border:1px solid #ddd;border-radius:6px;background:#f7f4f2}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.md-frontmatter{margin:0 0 1em;padding:10px 12px;border:1px solid #ddd;border-radius:6px;background:#fbf8f6}
.md-frontmatter summary{cursor:pointer;font-weight:600}
.md-frontmatter pre{margin:.6em 0 0;background:#fff}
</style></head><body>${previewHtml(body, format)}</body></html>`;
}

export function renderedText(body: string, format: string): string {
  if (format === "html") {
    return sanitizePreviewHtml(body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (format !== "markdown") return body.trim();
  const { frontmatter, body: markdownBody } = splitFrontmatter(body);
  const renderedBody = markdownBody
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/```/g, "")
    .trim();
  return [frontmatter ? `Frontmatter\n${frontmatter.trim()}` : "", renderedBody].filter(Boolean).join("\n\n");
}
