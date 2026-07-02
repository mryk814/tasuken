import katex from "katex";

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
    .replace(/\s(src|href)\s*=\s*("|')?(?!https?:|mailto:|#|tasken-attachment:)[^"'\s>]*\2/gi, "")
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

function safeMarkdownUrl(value: string, kind: "image" | "link"): string {
  const trimmed = value.trim().replace(/^<|>$/g, "");
  try {
    const parsed = new URL(trimmed);
    const allowed = kind === "image"
      ? ["https:", "http:", "tasken-attachment:"]
      : ["https:", "http:", "mailto:"];
    return allowed.includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return trimmed.startsWith("#") ? trimmed : "";
  }
}

const MATH_COMMANDS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  sigma: "σ",
  phi: "φ",
  omega: "ω",
  arg: "arg",
  max: "max",
  min: "min",
  sum: "Σ",
  prod: "Π",
  infty: "∞",
  leq: "≤",
  geq: "≥",
  neq: "≠",
  times: "×",
  cdot: "·",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
};

function renderFallbackMathExpression(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\") {
      const command = value.slice(index + 1).match(/^[A-Za-z]+/);
      if (command) {
        const replacement = MATH_COMMANDS[command[0]] || command[0];
        const isOperator = ["arg", "max", "min"].includes(replacement);
        output += isOperator ? `<span class="md-math-operator">${replacement}</span>` : escapeHtml(replacement);
        index += command[0].length;
        continue;
      }
    }
    if ((char === "_" || char === "^") && index + 1 < value.length) {
      const tag = char === "_" ? "sub" : "sup";
      let content = "";
      if (value[index + 1] === "{") {
        const end = value.indexOf("}", index + 2);
        if (end !== -1) {
          content = value.slice(index + 2, end);
          index = end;
        }
      } else {
        content = value[index + 1];
        index += 1;
      }
      output += content ? `<${tag}>${renderFallbackMathExpression(content)}</${tag}>` : escapeHtml(char);
      continue;
    }
    output += escapeHtml(char);
  }
  return output.replace(/\s+/g, " ").trim();
}

export function normalizeMathExpression(value: string): string {
  return value.replace(/[¥￥]/g, "\\");
}

export function renderMathExpression(value: string, displayMode = false): string {
  const expression = normalizeMathExpression(value);
  try {
    return katex.renderToString(expression, {
      displayMode,
      output: "htmlAndMathml",
      strict: "ignore",
      throwOnError: false,
      trust: false,
    });
  } catch {
    return renderFallbackMathExpression(expression);
  }
}

function renderInlineMarkdown(value: string): string {
  const tokens: string[] = [];
  const stash = (html: string): string => {
    const key = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return key;
  };

  let text = value
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, alt: string, rawUrl: string) => {
      const url = safeMarkdownUrl(rawUrl, "image");
      const label = alt.trim() || "貼り付け画像";
      if (!url) return escapeHtml(`[画像: ${label}]`);
      return stash(`<figure class="md-image"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" /><figcaption>${escapeHtml(label)}</figcaption></figure>`);
    })
    .replace(/`([^`]+)`/g, (_match, code: string) => stash(`<code>${escapeHtml(code)}</code>`))
    .replace(/\$([^$\n]+)\$/g, (_match, expression: string) => stash(`<span class="md-math-inline">${renderMathExpression(expression.trim(), false)}</span>`));

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] || "");
}

function markdownTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = markdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function renderMarkdownTableRow(cells: string[], tagName: "th" | "td"): string {
  return `<tr>${cells.map((cell) => `<${tagName}>${renderInlineMarkdown(cell)}</${tagName}>`).join("")}</tr>`;
}

function renderMarkdownTable(header: string[], rows: string[][]): string {
  const body = rows.map((row) => renderMarkdownTableRow(row, "td")).join("");
  return `<table><thead>${renderMarkdownTableRow(header, "th")}</thead><tbody>${body}</tbody></table>`;
}

const MARKDOWN_DOCUMENT_CSS = `
@page{size:A4;margin:18mm}
body{margin:0;background:#fff;color:#26211f;font-family:"Yu Gothic","Hiragino Maru Gothic ProN","Segoe UI",system-ui,sans-serif}
.markdown-document{box-sizing:border-box;max-width:840px;margin:0 auto;padding:26px 30px 34px;background:#fff;color:#26211f;font-size:15px;line-height:1.72}
.markdown-document h1,.markdown-document h2,.markdown-document h3{line-height:1.28;color:#1C557D;break-after:avoid}
.markdown-document h1{margin:0 0 18px;padding-bottom:10px;border-bottom:2px solid #C3DCEE;font-size:28px}
.markdown-document h2{margin:28px 0 12px;padding-left:10px;border-left:4px solid #2D7FB8;font-size:21px}
.markdown-document h3{margin:22px 0 10px;font-size:17px}
.markdown-document p{margin:9px 0}.markdown-document ul,.markdown-document ol{margin:10px 0 12px;padding-left:1.55em}
.markdown-document li{margin:4px 0}.markdown-document li::marker{color:#2D7FB8;font-weight:700}
.markdown-document blockquote{margin:16px 0;padding:10px 14px;border-left:4px solid #2D7FB8;border-radius:6px;background:#E8F1F8;color:#1C557D}
.markdown-document blockquote p{margin:5px 0}
.markdown-document pre{overflow:auto;margin:14px 0;padding:12px 14px;border:1px solid #D9E5ED;border-radius:7px;background:#F5F9FC;color:#26211f;font:12px/1.62 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap}
.markdown-document code{padding:1px 4px;border-radius:4px;background:#F0F6FA;color:#1C557D;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em}
.markdown-document pre code{padding:0;background:transparent;color:inherit;font-size:inherit}
.markdown-document table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}
.markdown-document th,.markdown-document td{padding:7px 9px;border:1px solid #CFE0EA;text-align:left;vertical-align:top}
.markdown-document th{background:#E8F1F8;color:#1C557D;font-weight:700}
.markdown-document tr:nth-child(even) td{background:#F7FBFD}
.markdown-document a{color:#1C557D;text-decoration:underline;text-underline-offset:2px}
.markdown-document .md-image{margin:16px 0}.markdown-document .md-image img{display:block;max-width:100%;max-height:70vh;object-fit:contain;border:1px solid #CFE0EA;border-radius:7px;background:#fff}.markdown-document .md-image figcaption{margin-top:6px;color:#6b625f;font-size:12px}
.markdown-document .md-math-inline{display:inline-block;max-width:100%;overflow-x:auto;padding:0 .24em;color:#1C557D;font-family:Georgia,"Times New Roman",serif;font-size:1.04em;white-space:nowrap}
.markdown-document .md-math-block{overflow-x:auto;margin:16px 0;padding:12px;border:1px solid #CFE0EA;border-radius:7px;background:#F7FBFD;color:#1C557D;font-family:Georgia,"Times New Roman",serif;font-size:1.12em;text-align:center;white-space:nowrap}
.markdown-document .md-math-operator{margin-right:.18em;font-style:normal}.markdown-document .md-math-inline sub,.markdown-document .md-math-block sub{font-size:.68em;vertical-align:-.35em}.markdown-document .md-math-inline sup,.markdown-document .md-math-block sup{font-size:.68em;vertical-align:.55em}
.markdown-document .md-frontmatter{margin:0 0 16px;padding:10px 12px;border:1px solid #CFE0EA;border-radius:7px;background:#F7FBFD}.markdown-document .md-frontmatter summary{cursor:pointer;color:#1C557D;font-weight:700}.markdown-document .md-frontmatter pre{margin:8px 0 0;background:#fff}
`;

export function renderMarkdownPreview(value: string): string {
  const { frontmatter, body } = splitFrontmatter(value);
  const lines = body.split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let listTag: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listTag) {
      html.push(`</${listTag}>`);
      listTag = null;
    }
  };
  const openList = (tagName: "ul" | "ol") => {
    if (listTag !== tagName) {
      closeList();
      html.push(`<${tagName}>`);
      listTag = tagName;
    }
  };
  if (frontmatter) {
    html.push(`<details class="md-frontmatter"><summary>Frontmatter</summary><pre>${escapeHtml(frontmatter)}</pre></details>`);
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
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
    const trimmed = line.trim();
    if (trimmed.startsWith("$$")) {
      closeList();
      const collected: string[] = [];
      const first = trimmed.slice(2);
      if (first.endsWith("$$") && first.length > 2) {
        collected.push(first.slice(0, -2));
      } else {
        if (first) collected.push(first);
        while (index + 1 < lines.length) {
          index += 1;
          const next = lines[index];
          if (next === undefined) break;
          if (next.trim().endsWith("$$")) {
            collected.push(next.replace(/\$\$\s*$/, ""));
            break;
          }
          collected.push(next);
        }
      }
      html.push(`<div class="md-math-block">${renderMathExpression(collected.join("\n").trim(), true)}</div>`);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      closeList();
      const header = markdownTableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(markdownTableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(renderMarkdownTable(header, rows));
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      closeList();
      const chunks = [quote[1]];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].match(/^\s*>\s?(.*)$/);
        if (!next) break;
        chunks.push(next[1]);
        index += 1;
      }
      const content = chunks.map((chunk) => chunk.trim() ? `<p>${renderInlineMarkdown(chunk)}</p>` : "<br />").join("");
      html.push(`<blockquote>${content}</blockquote>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      openList(ordered ? "ol" : "ul");
      html.push(`<li>${renderInlineMarkdown((bullet || ordered)?.[1] || "")}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) {
      html.push("<br />");
      continue;
    }
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
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
  return `<!doctype html><html><head><meta charset="utf-8"><style>${MARKDOWN_DOCUMENT_CSS}</style></head><body><main class="markdown-document">${previewHtml(body, format)}</main></body></html>`;
}

export function renderedText(body: string, format: string): string {
  if (format === "html") {
    return sanitizePreviewHtml(body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (format !== "markdown") return body.trim();
  const { frontmatter, body: markdownBody } = splitFrontmatter(body);
  const renderedBody = markdownBody
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string) => `[画像: ${alt.trim() || "貼り付け画像"}]`)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/```/g, "")
    .replace(/^\$\$\s*|\s*\$\$$/gm, "")
    .trim();
  return [frontmatter ? `Frontmatter\n${frontmatter.trim()}` : "", renderedBody].filter(Boolean).join("\n\n");
}

function htmlAttribute(value: string, name: string): string {
  const match = value.match(new RegExp(`${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? String(match[1] || match[2] || match[3] || "") : "";
}

function outlookInlineStyles(html: string): string {
  return html
    .replace(/<figure\b[^>]*>\s*<img\b([^>]*)>\s*(?:<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>)?\s*<\/figure>/gi, (_match, attrs: string, caption: string) => {
      const alt = htmlAttribute(attrs, "alt").trim();
      const text = caption?.replace(/<[^>]+>/g, "").trim() || alt || "貼り付け画像";
      return `<p style="margin:8px 0;color:#666;">[画像: ${escapeHtml(text)}]</p>`;
    })
    .replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => {
      const alt = htmlAttribute(attrs, "alt").trim() || "貼り付け画像";
      return `<span style="color:#666;">[画像: ${escapeHtml(alt)}]</span>`;
    })
    .replace(/\sclass="[^"]*"/gi, "")
    .replace(/\sclass='[^']*'/gi, "")
    .replace(/<h1\b/gi, '<h1 style="margin:16px 0 8px;font-size:18pt;line-height:1.25;font-weight:700;"')
    .replace(/<h2\b/gi, '<h2 style="margin:14px 0 7px;font-size:15pt;line-height:1.3;font-weight:700;"')
    .replace(/<h3\b/gi, '<h3 style="margin:12px 0 6px;font-size:12.5pt;line-height:1.35;font-weight:700;"')
    .replace(/<p\b/gi, '<p style="margin:8px 0;"')
    .replace(/<ul\b/gi, '<ul style="margin:8px 0 8px 22px;padding:0;"')
    .replace(/<ol\b/gi, '<ol style="margin:8px 0 8px 22px;padding:0;"')
    .replace(/<li\b/gi, '<li style="margin:3px 0;"')
    .replace(/<blockquote\b/gi, '<blockquote style="margin:10px 0;padding-left:12px;border-left:3px solid #ccc;color:#444;"')
    .replace(/<pre\b/gi, '<pre style="margin:10px 0;padding:10px;border:1px solid #ddd;background:#f7f7f7;font-family:Consolas,monospace;font-size:10pt;white-space:pre-wrap;"')
    .replace(/<code\b/gi, '<code style="font-family:Consolas,monospace;font-size:10pt;"')
    .replace(/<table\b/gi, '<table style="border-collapse:collapse;margin:10px 0;width:100%;"')
    .replace(/<th\b/gi, '<th style="border:1px solid #ccc;padding:5px 7px;background:#f2f2f2;text-align:left;font-weight:700;"')
    .replace(/<td\b/gi, '<td style="border:1px solid #ccc;padding:5px 7px;vertical-align:top;"')
    .replace(/<a\b/gi, '<a style="color:#0563c1;text-decoration:underline;"');
}

export function outlookHtml(body: string, format: string): string {
  const rendered = format === "markdown"
    ? previewHtml(splitFrontmatter(body).body, "markdown")
    : previewHtml(body, format);
  const styled = outlookInlineStyles(sanitizePreviewHtml(rendered));
  return `<div style="font-family:'Yu Gothic','Meiryo','Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.55;color:#1f1f1f;">${styled}</div>`;
}
