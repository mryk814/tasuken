import katex from "katex";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { mathFromMarkdown } from "mdast-util-math";
import { toString as mdastToString } from "mdast-util-to-string";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { math as micromarkMath } from "micromark-extension-math";
import type {
  BlockContent,
  Blockquote,
  Code,
  Content,
  Delete,
  Emphasis,
  Heading,
  Html,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
} from "mdast";
import { KATEX_DOCUMENT_CSS } from "./katexDocumentCss";
import { parseWikiLinks } from "./knowledgeLinks";

/** MDXEditor と同じ GFM table / strikethrough / math 拡張で mdast 化する（Preview / PDF 共通）。 */
function parseMarkdownBody(body: string): Root {
  return fromMarkdown(body, {
    extensions: [
      gfmTable(),
      gfmStrikethrough(),
      micromarkMath({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [
      gfmTableFromMarkdown(),
      gfmStrikethroughFromMarkdown(),
      mathFromMarkdown(),
    ],
  });
}

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

/** Preview/Edit からリンクを開く前に許可 scheme を検証する。 */
export function safeMarkdownLinkUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "about:blank") return "";
  const direct = safeMarkdownUrl(trimmed, "link");
  if (direct) return direct;
  // Lexical / ブラウザ解決後の bare host や //example.com を救済する。
  if (trimmed.startsWith("//")) return safeMarkdownUrl(`https:${trimmed}`, "link");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith("#") && !trimmed.startsWith("/")) {
    return safeMarkdownUrl(`https://${trimmed}`, "link");
  }
  return "";
}

/** 許可された Markdown リンクを外部で開く。開けたら true。 */
export function openSafeMarkdownLink(value: string): boolean {
  const url = safeMarkdownLinkUrl(value);
  if (!url || url.startsWith("#")) return false;
  window.open(url, "_blank", "noreferrer");
  return true;
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

function renderTextWithWikiLinks(value: string): string {
  const parts: string[] = [];
  const pattern = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > last) parts.push(escapeHtml(value.slice(last, match.index)));
    const link = parseWikiLinks(match[0])[0];
    if (link) {
      parts.push(`<span class="md-wiki-link" data-knowledge-target="${escapeHtml(link.target)}">${escapeHtml(link.alias)}</span>`);
    } else {
      parts.push(escapeHtml(match[0]));
    }
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push(escapeHtml(value.slice(last)));
  return parts.join("");
}

/** MDX リサイズは getBoundingClientRect 由来の小数になり得る。表示用に正の px 整数へ丸める。 */
function parseDisplayPx(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0 || n > 99999) return null;
  return Math.max(1, Math.round(n));
}

/**
 * MDXEditor が出力する <img width height src> を安全な figure に変換する。
 *
 * 表示幅は figure に載せる（img の width だけだと Preview CSS で潰れやすい）。
 * height 属性は壊れた比率の原因になるので出さない。高さは自然比 + height:auto。
 */
function renderSafeHtmlImage(raw: string): string | null {
  const trimmed = raw.trim();
  // 開始タグのみ（self-closing 可）。閉じタグ付きや複数タグは拒否。
  if (!/^<img\b[^>]*\/?>$/i.test(trimmed)) return null;
  if (/\son\w+\s*=/i.test(trimmed) || /javascript:/i.test(trimmed)) return null;

  const url = safeMarkdownUrl(attributeValue(trimmed, "src"), "image");
  if (!url) return null;

  const alt = attributeValue(trimmed, "alt").trim() || "貼り付け画像";
  const width = parseDisplayPx(attributeValue(trimmed, "width"));
  const figureClass = width != null ? "md-image has-display-width" : "md-image";
  // figure に幅を持たせ、img は 100% で埋める（中央寄せ・指定幅の両方が効く）
  const figureStyle = width != null
    ? ` style="width:min(100%, ${width}px)"`
    : "";
  const imgAttrs = width != null
    ? ` width="${width}" data-display-width="${width}" style="width:100%;height:auto;display:block"`
    : ` style="max-width:100%;height:auto;display:block"`;

  return `<figure class="${figureClass}"${figureStyle}><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${imgAttrs} loading="lazy" /><figcaption>${escapeHtml(alt)}</figcaption></figure>`;
}

function renderAllowedHtmlTag(value: string): string {
  const trimmed = value.trim();
  const imageHtml = renderSafeHtmlImage(trimmed);
  if (imageHtml) return imageHtml;
  if (/^<u\b[^>]*>$/i.test(trimmed)) return '<u class="md-underline">';
  if (/^<\/u>$/i.test(trimmed)) return "</u>";
  if (/^<sup\b[^>]*>$/i.test(trimmed)) return "<sup>";
  if (/^<\/sup>$/i.test(trimmed)) return "</sup>";
  if (/^<sub\b[^>]*>$/i.test(trimmed)) return "<sub>";
  if (/^<\/sub>$/i.test(trimmed)) return "</sub>";
  if (/^<br\s*\/?>$/i.test(trimmed)) return "<br />";
  return escapeHtml(value);
}

function renderPhrasing(nodes: PhrasingContent[] | undefined): string {
  if (!nodes?.length) return "";
  return nodes.map((node) => {
    switch (node.type) {
      case "text":
        return renderTextWithWikiLinks((node as Text).value || "");
      case "strong":
        return `<strong>${renderPhrasing((node as Strong).children)}</strong>`;
      case "emphasis":
        return `<em>${renderPhrasing((node as Emphasis).children)}</em>`;
      case "delete":
        return `<del>${renderPhrasing((node as Delete).children)}</del>`;
      case "inlineCode":
        return `<code>${escapeHtml((node as InlineCode).value || "")}</code>`;
      case "break":
        return "<br />";
      case "link": {
        const link = node as Link;
        const url = safeMarkdownUrl(link.url || "", "link");
        const label = renderPhrasing(link.children) || escapeHtml(link.url || "");
        if (!url) return label;
        return `<a class="md-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>`;
      }
      case "image": {
        const image = node as Image;
        const url = safeMarkdownUrl(image.url || "", "image");
        const label = (image.alt || "").trim() || "貼り付け画像";
        if (!url) return escapeHtml(`[画像: ${label}]`);
        return `<figure class="md-image"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" style="max-width:100%;height:auto;display:block" loading="lazy" /><figcaption>${escapeHtml(label)}</figcaption></figure>`;
      }
      case "inlineMath":
        return `<span class="md-math-inline">${renderMathExpression(String((node as { value?: string }).value || ""), false)}</span>`;
      case "html":
        return renderAllowedHtmlTag((node as Html).value || "");
      default:
        if ("children" in node && Array.isArray((node as { children?: PhrasingContent[] }).children)) {
          return renderPhrasing((node as { children: PhrasingContent[] }).children);
        }
        if ("value" in node && typeof (node as { value?: unknown }).value === "string") {
          return escapeHtml(String((node as { value: string }).value));
        }
        return "";
    }
  }).join("");
}

function renderTableCell(cell: TableCell, tagName: "th" | "td"): string {
  return `<${tagName}>${renderPhrasing(cell.children as PhrasingContent[])}</${tagName}>`;
}

function renderTable(node: Table): string {
  const rows = node.children as TableRow[];
  if (!rows.length) return "";
  const [header, ...bodyRows] = rows;
  const head = `<thead><tr>${(header.children as TableCell[]).map((cell) => renderTableCell(cell, "th")).join("")}</tr></thead>`;
  const body = bodyRows.length
    ? `<tbody>${bodyRows.map((row) => `<tr>${(row.children as TableCell[]).map((cell) => renderTableCell(cell, "td")).join("")}</tr>`).join("")}</tbody>`
    : "";
  return `<table>${head}${body}</table>`;
}

function renderListItem(item: ListItem, ctx: MarkdownRenderContext): string {
  // tight list では <p> を付けない（編集器の見た目・既存テストと揃える）。
  const inner = (item.children || []).map((child) => {
    if (child.type === "paragraph") {
      return renderPhrasing((child as Paragraph).children);
    }
    if (child.type === "list") return renderList(child as List, ctx);
    return renderBlock(child as Content, ctx);
  }).join("");
  if (item.checked === true || item.checked === false) {
    const mark = item.checked ? "☑" : "☐";
    return `<li class="md-task-item" data-checked="${item.checked ? "true" : "false"}"><span class="md-task-marker" aria-hidden="true">${mark}</span> ${inner}</li>`;
  }
  return `<li>${inner}</li>`;
}

function renderList(node: List, ctx: MarkdownRenderContext): string {
  const tag = node.ordered ? "ol" : "ul";
  const start = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : "";
  return `<${tag}${start}>${(node.children as ListItem[]).map((item) => renderListItem(item, ctx)).join("")}</${tag}>`;
}

/**
 * 軽量 Callout。正本は 1 種類 `INSIGHT`（表示: 気づき）。
 * GitHub Alerts 風 `> [!INSIGHT]`。旧 `[!NOTE]` 等は同じ見た目のエイリアス。
 */
export const CALLOUT_KIND = "INSIGHT" as const;
export type CalloutKind = typeof CALLOUT_KIND;
export const CALLOUT_LABEL = "気づき";
/** 手書き用スニペット。 */
export const INSIGHT_CALLOUT_SNIPPET = "> [!INSIGHT]\n> \n";
/** @deprecated INSIGHT_CALLOUT_SNIPPET を使う */
export const NOTE_CALLOUT_SNIPPET = INSIGHT_CALLOUT_SNIPPET;

const CALLOUT_MARKER_RE = /^\[!(INSIGHT|NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;

export function parseCalloutMarker(text: string): { kind: CalloutKind; rest: string } | null {
  const match = text.trim().match(CALLOUT_MARKER_RE);
  if (!match) return null;
  return { kind: CALLOUT_KIND, rest: match[2].trim() };
}

function renderCallout(quote: Blockquote, ctx: MarkdownRenderContext): string {
  const children = [...(quote.children || [])] as Content[];
  if (!children.length) return `<blockquote><br /></blockquote>`;

  const first = children[0];
  if (first.type !== "paragraph") {
    const content = children.map((child) => renderBlock(child, ctx)).join("");
    return `<blockquote>${content || "<br />"}</blockquote>`;
  }

  const firstText = mdastToString(first);
  const marker = parseCalloutMarker(firstText);
  if (!marker) {
    const content = children.map((child) => renderBlock(child, ctx)).join("");
    return `<blockquote>${content || "<br />"}</blockquote>`;
  }

  const bodyNodes: Content[] = [];
  if (marker.rest) {
    bodyNodes.push({ type: "paragraph", children: [{ type: "text", value: marker.rest }] } as Paragraph);
  }
  bodyNodes.push(...children.slice(1));
  const body = bodyNodes.map((child) => renderBlock(child, ctx)).join("") || "<p></p>";
  return `<aside class="md-callout" data-callout="insight" role="note"><div class="md-callout-label">${escapeHtml(CALLOUT_LABEL)}</div><div class="md-callout-body">${body}</div></aside>`;
}

/**
 * Edit（MDX/Lexical）上の blockquote を Callout 見た目にする。
 * 本文テキストは書き換えず、data 属性と class だけ付ける。
 */
export function applyCalloutDecorations(root: ParentNode | null | undefined): void {
  if (!root || typeof (root as Element).querySelectorAll !== "function") return;
  const quotes = Array.from((root as Element).querySelectorAll("blockquote")) as HTMLElement[];
  for (const quote of quotes) {
    const firstP = quote.querySelector(":scope > p") as HTMLElement | null;
    const raw = (firstP?.textContent || "").replace(/\u00a0/g, " ");
    const firstLine = raw.split(/\r?\n/)[0] || raw;
    const marker = parseCalloutMarker(firstLine.trim()) || parseCalloutMarker(raw.trim());
    if (!marker) {
      if (quote.classList.contains("md-callout")) quote.classList.remove("md-callout");
      if (quote.hasAttribute("data-callout")) quote.removeAttribute("data-callout");
      if (quote.hasAttribute("data-callout-label")) quote.removeAttribute("data-callout-label");
      if (firstP?.classList.contains("md-callout-marker")) firstP.classList.remove("md-callout-marker");
      if (firstP?.classList.contains("md-callout-marker-only")) firstP.classList.remove("md-callout-marker-only");
      if (firstP?.hasAttribute("data-callout-label")) firstP.removeAttribute("data-callout-label");
      continue;
    }
    // マーカー行だけなら Edit 上は「気づき」ラベルを出し、生の [!INSIGHT]/[!NOTE] は隠す（本文 Markdown は触らない）。
    const markerOnly = !marker.rest && !/\r?\n/.test(raw.trim());
    if (!quote.classList.contains("md-callout")) quote.classList.add("md-callout");
    if (quote.getAttribute("data-callout") !== "insight") quote.setAttribute("data-callout", "insight");
    if (quote.getAttribute("data-callout-label") !== CALLOUT_LABEL) quote.setAttribute("data-callout-label", CALLOUT_LABEL);
    if (firstP) {
      if (!firstP.classList.contains("md-callout-marker")) firstP.classList.add("md-callout-marker");
      if (firstP.getAttribute("data-callout-label") !== CALLOUT_LABEL) firstP.setAttribute("data-callout-label", CALLOUT_LABEL);
      if (markerOnly) {
        if (!firstP.classList.contains("md-callout-marker-only")) firstP.classList.add("md-callout-marker-only");
      } else if (firstP.classList.contains("md-callout-marker-only")) {
        firstP.classList.remove("md-callout-marker-only");
      }
    }
  }
}

type MarkdownRenderContext = {
  headingNumbers?: { next: (level: number, titleText: string) => string };
  headingIndex: { value: number };
};

function renderBlock(
  node: Content | BlockContent,
  ctx: MarkdownRenderContext,
): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${renderPhrasing((node as Paragraph).children)}</p>`;
    case "heading": {
      const heading = node as Heading;
      const level = Math.min(4, Math.max(1, heading.depth || 1));
      const titleText = mdastToString(heading);
      const numberLabel = ctx.headingNumbers?.next(level, titleText) || "";
      const numberHtml = numberLabel
        ? `<span class="md-heading-number">${escapeHtml(numberLabel)}</span> `
        : "";
      const id = markdownHeadingId(ctx.headingIndex.value);
      ctx.headingIndex.value += 1;
      return `<h${level} id="${escapeHtml(id)}" data-md-heading-index="${ctx.headingIndex.value - 1}">${numberHtml}${renderPhrasing(heading.children)}</h${level}>`;
    }
    case "list":
      return renderList(node as List, ctx);
    case "table":
      return renderTable(node as Table);
    case "blockquote":
      return renderCallout(node as Blockquote, ctx);
    case "code": {
      const code = node as Code;
      return `<pre><code>${escapeHtml(code.value || "")}${code.value?.endsWith("\n") ? "" : "\n"}</code></pre>`;
    }
    case "thematicBreak":
      return "<hr />";
    case "math":
      return `<div class="md-math-block">${renderMathExpression(String((node as { value?: string }).value || ""), true)}</div>`;
    case "html": {
      // ブロック HTML は危険なのでエスケープ。許可インラインと MDX の <img> だけ通す。
      const raw = (node as Html).value || "";
      const imageHtml = renderSafeHtmlImage(raw);
      if (imageHtml) return imageHtml;
      if (/^<\/?(?:u|sup|sub)\b/i.test(raw.trim())) return renderAllowedHtmlTag(raw);
      return `<p>${escapeHtml(raw)}</p>`;
    }
    default:
      if ("children" in node && Array.isArray((node as { children?: Content[] }).children)) {
        return ((node as { children: Content[] }).children).map((child) => renderBlock(child, ctx)).join("");
      }
      return "";
  }
}

/** 見出しインデックス用の安定 id（文書内順）。 */
export function markdownHeadingId(index: number): string {
  return `md-h-${index}`;
}

export type MarkdownHeadingItem = {
  index: number;
  level: number;
  text: string;
  id: string;
};

/** 本文の見出し一覧。コードフェンス内の # は無視。frontmatter は除く。 */
export function extractMarkdownHeadings(source: string): MarkdownHeadingItem[] {
  const { body } = splitFrontmatter(source);
  const headings: MarkdownHeadingItem[] = [];
  const lines = body.split(/\r?\n/);
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (!match) continue;
    const index = headings.length;
    const text = match[2].replace(/\s+#+\s*$/, "").trim();
    if (!text) continue;
    headings.push({
      index,
      level: match[1].length,
      text,
      id: markdownHeadingId(index),
    });
  }
  return headings;
}

/** 見出しがこの件数以上ならインデックス UI を出す。 */
export const HEADING_INDEX_MIN_COUNT = 2;

/** Preview / 編集 / PDF 向けの見出し自動ナンバリング。本文 Markdown は書き換えない。 */
export type MarkdownRenderOptions = {
  headingNumbers?: boolean;
  /** 番号付けを始める見出しレベル（1=h1 … 4=h4）。これより浅い見出しは番号なし。既定 2（h2から）。 */
  headingNumberStart?: number;
  /**
   * YAML frontmatter を「Frontmatter」ブロックとして本文先頭に出すか。
   * 編集プレビューでは true（既定）、PDF / 文書ビュー（previewDocument）では false。
   */
  showFrontmatter?: boolean;
};

export const HEADING_NUMBER_START_LEVELS = [1, 2, 3, 4] as const;
export type HeadingNumberStart = (typeof HEADING_NUMBER_START_LEVELS)[number];
/** 未設定時の開始階層。タイトル(h1)を番号なしにし、章立て(h2)から振る用途が主。 */
export const DEFAULT_HEADING_NUMBER_START: HeadingNumberStart = 2;

export const HEADING_NUMBER_START_LABELS: Record<HeadingNumberStart, string> = {
  1: "h1から",
  2: "h2から",
  3: "h3から",
  4: "h4から",
};

/** 1〜4 に正規化。未設定・不正値は h2 から（DEFAULT_HEADING_NUMBER_START）。 */
export function normalizeHeadingNumberStart(value: unknown): HeadingNumberStart {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return DEFAULT_HEADING_NUMBER_START;
}

/** 見出し先頭が手動番号（1. / 1.1 / 第1章 / (1) / ① 等）か。二重番号を避ける判定。 */
export function hasManualHeadingNumber(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  // 1. 概要 / 1.1 背景 / 1.1.1. 詳細
  if (/^\d+\.\s/.test(value) || /^\d+\.$/.test(value)) return true;
  if (/^\d+(?:\.\d+)+[.\s]/.test(value) || /^\d+(?:\.\d+)+\.$/.test(value)) return true;
  // 第1章 / 第２節 / 第十二部
  if (/^第[0-9０-９一二三四五六七八九十百千]+[章節部編項条]/.test(value)) return true;
  // (1) 概要 / （12）
  if (/^[（(][0-9０-９]+[）)]/.test(value)) return true;
  // ①〜⑳ など
  if (/^[①-⑳❶-❿⑴-⒇]/.test(value)) return true;
  // 一、 / 二．
  if (/^[一二三四五六七八九十]+[、．.]/.test(value)) return true;
  return false;
}

/** 1 → "1." / 1.2 → "1.2"（最上位段だけ末尾にドット）。 */
export function formatHeadingNumber(parts: number[]): string {
  if (!parts.length) return "";
  if (parts.length === 1) return `${parts[0]}.`;
  return parts.join(".");
}

/**
 * 見出し配列に対する通し番号ラベルを返す。
 * - startLevel より浅い見出しは番号なし（カウンタも進めない）
 * - 対象レベルのうち文書に現れる最上位を 1 段目にする（例: start=2 で h3 のみなら h3 が 1.）
 * - 手動番号の見出しは null だが、対象レベルならカウンタは進める
 */
export function computeHeadingNumberLabels(
  headings: Array<{ level: number; text: string }>,
  startLevel: number = DEFAULT_HEADING_NUMBER_START,
): Array<string | null> {
  if (!headings.length) return [];
  const minStart = normalizeHeadingNumberStart(startLevel);
  const usable = headings.filter((heading) => heading.level >= minStart && heading.level <= 4);
  if (!usable.length) return headings.map(() => null);
  const baseLevel = Math.min(...usable.map((heading) => heading.level));
  const counters = [0, 0, 0, 0];
  return headings.map(({ level, text }) => {
    if (level < minStart || level > 4) return null;
    if (level < baseLevel) return null;
    const index = level - baseLevel;
    counters[index] += 1;
    for (let deeper = index + 1; deeper < counters.length; deeper += 1) counters[deeper] = 0;
    if (hasManualHeadingNumber(text)) return null;
    return formatHeadingNumber(counters.slice(0, index + 1));
  });
}

function createHeadingNumberState(body: string, options: MarkdownRenderOptions) {
  if (!options.headingNumbers) {
    return { next: () => "" };
  }
  const startLevel = normalizeHeadingNumberStart(options.headingNumberStart);
  const headings: Array<{ level: number; text: string }> = [];
  const lines = body.split(/\r?\n/);
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) headings.push({ level: heading[1].length, text: heading[2] });
  }
  const labels = computeHeadingNumberLabels(headings, startLevel);
  let cursor = 0;
  return {
    next(level: number, titleText: string): string {
      const expected = headings[cursor];
      if (!expected || expected.level !== level || expected.text !== titleText) {
        return "";
      }
      const label = labels[cursor] || "";
      cursor += 1;
      return label;
    },
  };
}

/**
 * note.properties_json から Preview / PDF 用の番号オプションを読む。
 * `heading_numbers` が ON なら Preview と PDF の両方に番号を付ける（本文・Markdown出力は対象外）。
 * `heading_number_start` で開始階層（1〜4、既定 2=h2から）。
 */
export function headingNumberOptionsFromProperties(properties: Record<string, unknown> | null | undefined): {
  preview: MarkdownRenderOptions;
  publish: MarkdownRenderOptions;
} {
  const props = properties && typeof properties === "object" && !Array.isArray(properties) ? properties : {};
  const enabled = props.heading_numbers === true;
  const options: MarkdownRenderOptions = {
    headingNumbers: enabled,
    headingNumberStart: normalizeHeadingNumberStart(props.heading_number_start),
  };
  return { preview: options, publish: options };
}

/** 編集画面の見出し DOM に data-heading-number を付け、::before で表示する（本文テキストは触らない）。 */
export function applyHeadingNumberAttributes(
  root: ParentNode | null | undefined,
  options: boolean | MarkdownRenderOptions,
): void {
  if (!root || typeof (root as Element).querySelectorAll !== "function") return;
  const resolved: MarkdownRenderOptions = typeof options === "boolean"
    ? { headingNumbers: options }
    : options;
  const nodes = Array.from((root as Element).querySelectorAll("h1, h2, h3, h4")) as HTMLElement[];
  if (!resolved.headingNumbers) {
    for (const node of nodes) node.removeAttribute("data-heading-number");
    return;
  }
  const headings = nodes.map((node) => ({
    level: Number(node.tagName.slice(1)),
    text: (node.textContent || "").replace(/\s+/g, " ").trim(),
  }));
  const labels = computeHeadingNumberLabels(headings, normalizeHeadingNumberStart(resolved.headingNumberStart));
  nodes.forEach((node, index) => {
    const label = labels[index];
    if (label) node.setAttribute("data-heading-number", label);
    else node.removeAttribute("data-heading-number");
  });
}

/**
 * PDF / 成果物 iframe 用のスタンドアロン CSS。
 * 見た目の正本は app.css の `.markdown-preview`（＋ :root の --markdown-*）。
 * ここは data: URL で外部 CSS を読めないため、同じトークン値を埋め込み、
 * ページ枠（@page / padding / break-after）だけ印刷向けに足す。
 * 編集・Preview の見た目を変えたら、同じ差分をここにも反映すること。
 */
const MARKDOWN_DOCUMENT_CSS = `
@page{size:A4;margin:18mm}
body{margin:0;background:#fff;color:#26211f;font-family:"Nunito","Hiragino Maru Gothic ProN","Yu Gothic","Segoe UI",system-ui,sans-serif}
.markdown-document{
  --markdown-paper:#fff;
  --markdown-paper-text:#26211f;
  --markdown-paper-secondary:#6f625b;
  --markdown-paper-subtle:#f6f4f1;
  --markdown-paper-border:#ded8d1;
  --markdown-accent:#2D7FB8;
  --markdown-accent-strong:#1C557D;
  --markdown-accent-bg:#E8F1F8;
  --markdown-accent-bd:#C3DCEE;
  --markdown-link:#0B6BCB;
  --markdown-link-hover:#084F96;
  --markdown-link-underline:#7BB4E3;
  --md-space-1:4px;--md-space-2:8px;--md-space-3:12px;--md-space-4:16px;--md-space-5:20px;
  --md-text-xs:11px;--md-text-sm:13px;--md-text-base:14px;--md-text-lg:16px;--md-text-xl:20px;--md-text-2xl:24px;
  --md-radius-sm:4px;--md-radius-md:7px;
  --md-font-mono:ui-monospace,SFMono-Regular,Consolas,monospace;
  --md-border-subtle:#ECE0DE;
  box-sizing:border-box;max-width:840px;margin:0 auto;padding:26px 30px 34px;
  background:var(--markdown-paper);color:var(--markdown-paper-text);
  font-size:var(--md-text-base);line-height:1.72;overflow-wrap:anywhere
}
.markdown-document h1,.markdown-document h2,.markdown-document h3,.markdown-document h4{
  margin:var(--md-space-4) 0 var(--md-space-2);color:var(--markdown-accent-strong);line-height:1.3;letter-spacing:0;break-after:avoid
}
.markdown-document h1:first-child,.markdown-document h2:first-child,.markdown-document h3:first-child,.markdown-document h4:first-child{margin-top:0}
.markdown-document .md-heading-number{font-variant-numeric:tabular-nums;margin-right:.15em;font-family:var(--md-font-mono);font-weight:inherit;color:inherit}
.markdown-document h1{padding-bottom:var(--md-space-2);border-bottom:2px solid var(--markdown-accent-bd);font-size:var(--md-text-2xl)}
.markdown-document h2{
  padding:var(--md-space-2) var(--md-space-3);border-left:6px solid var(--markdown-accent);border-bottom:2px solid var(--markdown-accent-bd);
  border-radius:var(--md-radius-sm);background:color-mix(in srgb,var(--markdown-accent-bg) 84%,var(--markdown-paper));font-size:var(--md-text-xl)
}
.markdown-document h3{
  padding:2px 0 2px var(--md-space-2);border-left:4px solid color-mix(in srgb,var(--markdown-accent) 85%,var(--markdown-paper));
  color:var(--markdown-accent-strong);font-size:var(--md-text-lg);font-weight:700
}
.markdown-document h4{
  width:fit-content;max-width:100%;padding:3px var(--md-space-2);
  border-left:3px solid color-mix(in srgb,var(--markdown-accent) 60%,var(--markdown-paper));border-radius:var(--md-radius-sm);
  background:color-mix(in srgb,var(--markdown-accent-bg) 58%,var(--markdown-paper));color:var(--markdown-accent-strong);
  font-size:var(--md-text-base);font-weight:700
}
.markdown-document p{margin:var(--md-space-2) 0}
.markdown-document ul,.markdown-document ol{margin:var(--md-space-2) 0 var(--md-space-3);padding-left:var(--md-space-5);list-style-position:outside}
.markdown-document ul{list-style-type:disc}
.markdown-document ol{list-style-type:decimal}
.markdown-document ul ul{list-style-type:circle}
.markdown-document ul ul ul{list-style-type:square}
.markdown-document ol ol{list-style-type:lower-alpha}
.markdown-document li{margin:3px 0;display:list-item}
.markdown-document li::marker{color:var(--markdown-accent-strong);font-weight:700}
.markdown-document del{text-decoration:line-through}
.markdown-document blockquote{
  margin:var(--md-space-3) 0;padding:var(--md-space-2) var(--md-space-3);border-left:3px solid var(--markdown-accent-bd);
  background:color-mix(in srgb,var(--markdown-accent-bg) 20%,var(--markdown-paper));color:var(--markdown-paper-secondary);font-style:italic
}
.markdown-document blockquote p{margin:var(--md-space-1) 0}
.markdown-document .md-callout{
  margin:var(--md-space-3) 0;padding:var(--md-space-2) var(--md-space-3);border:1px solid #EFD9B0;
  border-left:4px solid #C77D29;border-radius:var(--md-radius-md);
  background:color-mix(in srgb,#FBF0DD 78%,#fff);color:var(--markdown-paper-text);break-inside:avoid
}
.markdown-document .md-callout-label{
  margin:0 0 var(--md-space-1);color:#8A5212;font-size:var(--md-text-xs);font-weight:700;letter-spacing:.02em
}
.markdown-document .md-callout-body > :first-child{margin-top:0}
.markdown-document .md-callout-body > :last-child{margin-bottom:0}
.markdown-document .md-callout p{margin:var(--md-space-1) 0;font-style:normal}
.markdown-document hr{height:0;margin:var(--md-space-3) 0;border:0;border-top:1px solid var(--markdown-accent-bd)}
.markdown-document pre{
  overflow:auto;margin:var(--md-space-3) 0;padding:var(--md-space-3);border:1px solid var(--markdown-accent-bd);border-radius:var(--md-radius-md);
  background:color-mix(in srgb,var(--markdown-accent-bg) 42%,var(--markdown-paper));font:var(--md-text-xs)/1.62 var(--md-font-mono);white-space:pre-wrap
}
.markdown-document code{
  padding:1px var(--md-space-1);border-radius:var(--md-radius-sm);
  background:color-mix(in srgb,var(--markdown-accent-bg) 55%,var(--markdown-paper));color:var(--markdown-accent-strong);
  font-family:var(--md-font-mono);font-size:.92em
}
.markdown-document pre code{padding:0;background:transparent;color:inherit;font-size:inherit}
/* 印刷でも枠が見えるようセル全周に border（overflow:hidden は printToPDF で欠けやすいので付けない） */
.markdown-document table{
  width:100%;margin:var(--md-space-2) 0 var(--md-space-3);border-collapse:collapse;border-spacing:0;
  border:1px solid #C9D8E2;font-size:var(--md-text-sm)
}
.markdown-document th,.markdown-document td{
  padding:4px 8px;border:1px solid #C9D8E2;text-align:left;vertical-align:top;background:#fff
}
.markdown-document th{
  background:color-mix(in srgb,var(--markdown-accent-bg) 44%,var(--markdown-paper));color:var(--markdown-accent-strong);font-weight:700
}
.markdown-document tr:nth-child(even) td{background:color-mix(in srgb,var(--markdown-accent-bg) 10%,var(--markdown-paper))}
.markdown-document u,.markdown-document .md-underline{
  text-decoration:underline;text-decoration-thickness:from-font;text-underline-offset:2px;text-decoration-skip-ink:none
}
.markdown-document a,.markdown-document .md-link{
  color:var(--markdown-link);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;
  text-decoration-color:var(--markdown-link-underline);overflow-wrap:anywhere
}
.markdown-document a:hover,.markdown-document .md-link:hover{
  color:var(--markdown-link-hover);text-decoration-thickness:2px;background:color-mix(in srgb,var(--markdown-link) 10%,transparent);border-radius:3px
}
.markdown-document h1 a,.markdown-document h2 a,.markdown-document h3 a,.markdown-document h4 a,
.markdown-document blockquote a,.markdown-document th a,.markdown-document td a{color:var(--markdown-link);font-style:normal}
.markdown-document pre a,.markdown-document code a{color:var(--markdown-link);text-decoration:underline;background:transparent}
.markdown-document .md-wiki-link{
  display:inline-flex;align-items:center;max-width:100%;padding:0 .42em;border:1px solid color-mix(in srgb,var(--markdown-accent) 45%,var(--markdown-paper-border));
  border-radius:var(--md-radius-sm);background:color-mix(in srgb,var(--markdown-accent-bg) 72%,var(--markdown-paper));
  color:var(--markdown-accent-strong);font-weight:600;overflow-wrap:anywhere
}
.markdown-document .md-image{display:block;max-width:100%;margin:var(--md-space-3) auto;box-sizing:border-box}
.markdown-document .md-image:not(.has-display-width){width:fit-content}
.markdown-document .md-image img{
  display:block;width:100%;max-width:100%;height:auto;margin:0;object-fit:contain;border:1px solid var(--markdown-paper-border);
  border-radius:var(--md-radius-md);background:var(--markdown-paper-subtle)
}
.markdown-document .md-image:not(.has-display-width) img{width:auto;max-width:100%}
.markdown-document .md-image figcaption{margin-top:var(--md-space-1);color:var(--markdown-paper-secondary);font-size:var(--md-text-xs);text-align:center}
.markdown-document .md-image-missing{
  padding:var(--md-space-3);border:1px dashed var(--markdown-paper-border);border-radius:var(--md-radius-md);
  background:var(--markdown-paper-subtle);color:var(--markdown-paper-secondary)
}
.markdown-document .md-math-inline{display:inline;padding:0 .12em;color:var(--markdown-accent-strong);vertical-align:baseline}
.markdown-document .md-math-block{
  overflow-x:auto;margin:var(--md-space-3) 0;padding:var(--md-space-3);border:1px solid var(--markdown-accent-bd);border-radius:var(--md-radius-md);
  background:color-mix(in srgb,var(--markdown-accent-bg) 42%,var(--markdown-paper));color:var(--markdown-accent-strong);line-height:1.72;text-align:center
}
.markdown-document .md-math-inline .katex,.markdown-document .md-math-block .katex{color:inherit}
.markdown-document .md-math-block .katex-display{margin:0}
.markdown-document .md-math-operator{margin-right:.18em;font-style:normal}
.markdown-document .md-math-inline sub,.markdown-document .md-math-block sub{font-size:.68em;vertical-align:-.35em}
.markdown-document .md-math-inline sup,.markdown-document .md-math-block sup{font-size:.68em;vertical-align:.55em}
`;

export function renderMarkdownPreview(value: string, options: MarkdownRenderOptions = {}): string {
  const { frontmatter, body } = splitFrontmatter(value);
  const ctx: MarkdownRenderContext = {
    headingNumbers: createHeadingNumberState(body, options),
    headingIndex: { value: 0 },
  };
  const tree = parseMarkdownBody(body);
  const parts: string[] = [];
  // 編集プレビューでは frontmatter を確認できるよう既定で表示。PDF/文書ビューは showFrontmatter:false。
  if (frontmatter && options.showFrontmatter !== false) {
    parts.push(`<details class="md-frontmatter"><summary>Frontmatter</summary><pre>${escapeHtml(frontmatter)}</pre></details>`);
  }
  for (const child of tree.children) {
    parts.push(renderBlock(child as Content, ctx));
  }
  return parts.join("");
}

export function previewHtml(body: string, format: string, options: MarkdownRenderOptions = {}): string {
  if (format === "html") return sanitizePreviewHtml(body);
  if (format === "markdown") return renderMarkdownPreview(body, options);
  return `<pre>${escapeHtml(body)}</pre>`;
}

export function previewDocument(body: string, format: string, options: MarkdownRenderOptions = {}): string {
  // PDF / 成果物iframe は完成文書ビューなので frontmatter を本文に出さない（メタは編集画面側で確認）。
  const resolved: MarkdownRenderOptions = { ...options, showFrontmatter: options.showFrontmatter ?? false };
  return `<!doctype html><html><head><meta charset="utf-8"><style>${KATEX_DOCUMENT_CSS}${MARKDOWN_DOCUMENT_CSS}</style></head><body><main class="markdown-document">${previewHtml(body, format, resolved)}</main></body></html>`;
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
