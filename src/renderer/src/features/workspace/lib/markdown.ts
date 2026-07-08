import katex from "katex";
import { parseWikiLinks } from "./knowledgeLinks";

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
    .replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (match: string) => {
      const link = parseWikiLinks(match)[0];
      if (!link) return escapeHtml(match);
      return stash(`<span class="md-wiki-link" data-knowledge-target="${escapeHtml(link.target)}">${escapeHtml(link.alias)}</span>`);
    })
    .replace(/(?<!!)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, label: string, rawUrl: string) => {
      const url = safeMarkdownUrl(rawUrl, "link");
      const renderedLabel = escapeHtml(label.trim() || rawUrl);
      if (!url) return renderedLabel;
      return stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${renderedLabel}</a>`);
    })
    .replace(/(?<!\\)`([^`]+)`/g, (_match, code: string) => stash(`<code>${escapeHtml(code)}</code>`))
    // 開き$の直後・閉じ$の直前は空白不可、閉じ$の直後に数字を続けない（Pandoc等と同じ規約）。
    // これがないと「予算は$100で、残りは$50です」のような金額表記が丸ごと数式扱いされてしまう。
    // \$ はMDXEditorがドル記号をエスケープした形なので数式にしない。
    .replace(/(?<!\\)\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/g, (_match, expression: string) => stash(`<span class="md-math-inline">${renderMathExpression(expression.trim(), false)}</span>`))
    // MDXEditorはMarkdown書き出し時に - * _ | $ などをバックスラッシュでエスケープする。
    // 記号を文字どおり表示し、強調・数式などの記法として再解釈されないよう先に退避する。
    .replace(/\\([\\`*_{}[\]()#+\-.!|$~<>])/g, (_match, char: string) => stash(escapeHtml(char)));

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] || "");
}

export function isStructuredMarkdownPaste(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return [
    /(^|\n)#{1,6}\s+\S/,
    /(^|\n)\s*[-*+]\s+\S/,
    /(^|\n)\s*\d+[.)]\s+\S/,
    /(^|\n)\s*>\s?\S/,
    /(^|\n)\s*```/,
    /\|.+\|\s*\n\s*\|[\s:|-]+\|/,
    /\[[^\]\n]+\]\([^)]+\)/,
    /(^|[^\\])(\*\*|__)\S[\s\S]*?\S\2/,
    /(^|[^\\])`[^`\n]+`/,
  ].some((pattern) => pattern.test(text));
}

export function insertStructuredMarkdownPaste(
  current: string,
  pasted: string,
  anchorText = "",
  anchorOffset = 0,
): string {
  const content = pasted.trim();
  if (!content) return current;
  const append = () => (current.trim() ? `${current.trimEnd()}\n\n${content}\n` : `${content}\n`);
  const anchor = anchorText.trimEnd();
  if (!anchor) return append();

  const safeOffset = Math.max(0, Math.min(anchorOffset, anchorText.length));
  const directIndex = current.indexOf(anchorText);
  let insertionIndex = directIndex >= 0 ? directIndex + safeOffset : -1;
  if (insertionIndex < 0) {
    const beforeSelection = anchorText.slice(0, safeOffset).trimEnd();
    if (beforeSelection) {
      const beforeIndex = current.indexOf(beforeSelection);
      if (beforeIndex >= 0) insertionIndex = beforeIndex + beforeSelection.length;
    }
  }
  if (insertionIndex < 0) return append();

  const before = current.slice(0, insertionIndex).trimEnd();
  const after = current.slice(insertionIndex).replace(/^\s+/, "");
  return `${before}\n\n${content}\n${after ? `\n${after}` : ""}`;
}

function attributeValue(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeHtmlEntities(match[2] || match[3] || match[4] || "") : "";
}

function stripHtmlTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ""));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function normalizeMarkdownPaste(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToMarkdownPaste(html: string): string {
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/\s+/g, " ");

  text = text.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (tag) => {
    const href = safeMarkdownUrl(attributeValue(tag, "href"), "link");
    const label = stripHtmlTags(tag.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, "")).replace(/\s+/g, " ").trim();
    if (!label) return "";
    return href ? `[${label}](${href})` : label;
  });

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|h[1-6])>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/?(ul|ol|p|div|section|article|h[1-6])\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "");

  return normalizeMarkdownPaste(decodeHtmlEntities(text));
}

function markdownTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  // \| はセル内のパイプ表記なので区切りとして扱わない。
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim());
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
.markdown-document{box-sizing:border-box;max-width:840px;margin:0 auto;padding:26px 30px 34px;background:#fff;color:#26211f;font-size:15px;line-height:1.64}
.markdown-document h1,.markdown-document h2,.markdown-document h3,.markdown-document h4{line-height:1.28;color:#1C557D;break-after:avoid}
.markdown-document h1{margin:0 0 18px;padding-bottom:10px;border-bottom:2px solid #C3DCEE;font-size:28px}
.markdown-document h2{margin:28px 0 12px;padding:7px 10px;border-left:5px solid #2D7FB8;border-bottom:1px solid #C3DCEE;background:#E8F1F8;font-size:21px}
.markdown-document h3{margin:22px 0 10px;padding:2px 0 2px 9px;border-left:4px solid #8DBFE0;font-size:17px}
.markdown-document h4{width:fit-content;max-width:100%;margin:18px 0 8px;padding:3px 8px;border-left:2px solid #C3DCEE;border-radius:5px;background:#F7FBFD;color:#245F86;font-size:14px}
.markdown-document p{margin:5px 0}.markdown-document ul,.markdown-document ol{margin:7px 0 8px;padding-left:1.55em}
.markdown-document li{margin:2px 0}.markdown-document li::marker{color:#2D7FB8;font-weight:700}
.markdown-document blockquote{margin:10px 0;padding:8px 12px;border-left:4px solid #2D7FB8;border-radius:6px;background:#E8F1F8;color:#1C557D}
.markdown-document blockquote p{margin:3px 0}
.markdown-document hr{height:0;margin:14px 0;border:0;border-top:1px solid #C3DCEE}
.markdown-document pre{overflow:auto;margin:10px 0;padding:10px 12px;border:1px solid #D9E5ED;border-radius:7px;background:#F5F9FC;color:#26211f;font:12px/1.58 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap}
.markdown-document code{padding:1px 4px;border-radius:4px;background:#F0F6FA;color:#1C557D;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em}
.markdown-document pre code{padding:0;background:transparent;color:inherit;font-size:inherit}
.markdown-document table{width:100%;border-collapse:separate;border-spacing:0;margin:12px 0 14px;border:1px solid #D8E6EE;border-radius:5px;overflow:hidden;font-size:13px}
.markdown-document th,.markdown-document td{padding:4px 7px;border-right:1px solid #D8E6EE;border-bottom:1px solid #D8E6EE;text-align:left;vertical-align:top}
.markdown-document th:last-child,.markdown-document td:last-child{border-right:0}
.markdown-document tbody tr:last-child td{border-bottom:0}
.markdown-document th{background:#F0F6FA;color:#1C557D;font-weight:700}
.markdown-document tr:nth-child(even) td{background:#F7FBFD}
.markdown-document a{color:#1C557D;text-decoration:underline;text-underline-offset:2px}
.markdown-document .md-image{margin:16px 0}.markdown-document .md-image img{display:block;max-width:100%;max-height:70vh;object-fit:contain;border:1px solid #CFE0EA;border-radius:7px;background:#fff}.markdown-document .md-image figcaption{margin-top:6px;color:#6b625f;font-size:12px}
.markdown-document .md-math-inline{display:inline-block;max-width:100%;overflow-x:auto;padding:0 .24em;color:#1C557D;font-family:Georgia,"Times New Roman",serif;font-size:1.04em;white-space:nowrap}
.markdown-document .md-math-block{overflow-x:auto;margin:10px 0;padding:10px;border:1px solid #CFE0EA;border-radius:7px;background:#F7FBFD;color:#1C557D;font-family:Georgia,"Times New Roman",serif;font-size:1.12em;text-align:center;white-space:nowrap}
.markdown-document .md-math-operator{margin-right:.18em;font-style:normal}.markdown-document .md-math-inline sub,.markdown-document .md-math-block sub{font-size:.68em;vertical-align:-.35em}.markdown-document .md-math-inline sup,.markdown-document .md-math-block sup{font-size:.68em;vertical-align:.55em}
.markdown-document .md-frontmatter{margin:0 0 16px;padding:10px 12px;border:1px solid #CFE0EA;border-radius:7px;background:#F7FBFD}.markdown-document .md-frontmatter summary{cursor:pointer;color:#1C557D;font-weight:700}.markdown-document .md-frontmatter pre{margin:8px 0 0;background:#fff}
`;

export function renderMarkdownPreview(value: string): string {
  const { frontmatter, body } = splitFrontmatter(value);
  const lines = body.split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  // インデント量で入れ子リストを表現する。各フレームは開いた<li>を持ったまま積まれ、
  // 同レベルの次項目・レベル終了時に</li>を閉じる。
  const listStack: { tag: "ul" | "ol"; indent: number }[] = [];
  const closeOneList = () => {
    const frame = listStack.pop();
    if (frame) html.push(`</li></${frame.tag}>`);
  };
  const closeList = () => {
    while (listStack.length) closeOneList();
  };
  const appendListItem = (tag: "ul" | "ol", indent: number, content: string) => {
    while (listStack.length && indent < listStack[listStack.length - 1].indent) closeOneList();
    const top = listStack[listStack.length - 1];
    if (!top || indent > top.indent) {
      html.push(`<${tag}><li>${content}`);
      listStack.push({ tag, indent });
      return;
    }
    if (top.tag !== tag) {
      closeOneList();
      html.push(`<${tag}><li>${content}`);
      listStack.push({ tag, indent });
      return;
    }
    html.push(`</li><li>${content}`);
  };
  const listIndent = (line: string): number => (line.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
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
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList();
      html.push("<hr />");
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
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
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      appendListItem(ordered ? "ol" : "ul", listIndent(line), renderInlineMarkdown((bullet || ordered)?.[1] || ""));
      continue;
    }
    if (!line.trim()) {
      // 項目間に空行があるリスト（loose list）を分断しないよう、次の非空行がリスト項目なら閉じない。
      if (listStack.length) {
        let lookahead = index + 1;
        while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
        const nextLine = lines[lookahead];
        if (nextLine && /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(nextLine)) continue;
      }
      closeList();
      continue;
    }
    closeList();
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
    .replace(/<h4\b/gi, '<h4 style="margin:10px 0 5px;font-size:11pt;line-height:1.35;font-weight:700;"')
    .replace(/<p\b/gi, '<p style="margin:8px 0;"')
    .replace(/<ul\b/gi, '<ul style="margin:8px 0 8px 22px;padding:0;"')
    .replace(/<ol\b/gi, '<ol style="margin:8px 0 8px 22px;padding:0;"')
    .replace(/<li\b/gi, '<li style="margin:3px 0;"')
    .replace(/<blockquote\b/gi, '<blockquote style="margin:10px 0;padding-left:12px;border-left:3px solid #ccc;color:#444;"')
    .replace(/<hr\b[^>]*>/gi, '<hr style="margin:12px 0;border:0;border-top:1px solid #ccc;" />')
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
