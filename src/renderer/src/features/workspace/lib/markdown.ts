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
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
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
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;margin:16px;color:#26211f;background:#fff}
h1,h2,h3{line-height:1.25;margin:1.2em 0 .5em}
p{margin:.5em 0}ul{padding-left:1.4em}pre{overflow:auto;padding:12px;border:1px solid #ddd;border-radius:6px;background:#f7f4f2}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.md-image{margin:1em 0}.md-image img{display:block;max-width:100%;max-height:70vh;object-fit:contain;border:1px solid #ddd;border-radius:6px}.md-image figcaption{margin-top:.35em;color:#6b625f;font-size:.85em}
.md-math-inline{display:inline-block;max-width:100%;overflow-x:auto;padding:0 .24em;color:#8A2F3B;font-family:Georgia,"Times New Roman",serif;font-size:1.04em;white-space:nowrap}
.md-math-block{overflow-x:auto;margin:1em 0;padding:12px;border:1px solid #ddd;border-radius:6px;background:#fff;color:#8A2F3B;font-family:Georgia,"Times New Roman",serif;font-size:1.12em;text-align:center;white-space:nowrap}.md-math-operator{margin-right:.18em;font-style:normal}.md-math-inline sub,.md-math-block sub{font-size:.68em;vertical-align:-.35em}.md-math-inline sup,.md-math-block sup{font-size:.68em;vertical-align:.55em}
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
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string) => `[画像: ${alt.trim() || "貼り付け画像"}]`)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/```/g, "")
    .replace(/^\$\$\s*|\s*\$\$$/gm, "")
    .trim();
  return [frontmatter ? `Frontmatter\n${frontmatter.trim()}` : "", renderedBody].filter(Boolean).join("\n\n");
}
