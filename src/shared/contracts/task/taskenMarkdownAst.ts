import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { mathFromMarkdown } from "mdast-util-math";
import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
import { gfmStrikethroughCjkFriendly } from "micromark-extension-cjk-friendly-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { math as micromarkMath } from "micromark-extension-math";
import type { Root } from "mdast";

export interface TaskenMarkdownSourceRange {
  start: number;
  end: number;
}

/**
 * Canonical Tasken Markdown parsing for Preview, PDF, and trusted content boundaries.
 * The CJK extensions keep emphasis semantics stable next to Japanese punctuation.
 */
export function parseTaskenMarkdownBody(body: string): Root {
  return fromMarkdown(body, {
    extensions: [
      gfmTable(),
      // Checklist syntax is ordinary Scratchpad and Note content.
      gfmTaskListItem(),
      gfmStrikethroughCjkFriendly(),
      micromarkMath({ singleDollarTextMath: true }),
      cjkFriendlyExtension(),
    ],
    mdastExtensions: [
      gfmTableFromMarkdown(),
      gfmTaskListItemFromMarkdown(),
      gfmStrikethroughFromMarkdown(),
      mathFromMarkdown(),
    ],
  });
}

export function splitTaskenMarkdownFrontmatter(value: string): {
  frontmatter: string;
  body: string;
} {
  const normalized = value.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/);
  if (!match) return { frontmatter: "", body: value };
  return {
    frontmatter: match[1],
    body: normalized.slice(match[0].length),
  };
}

function markdownLines(value: string): Array<{ text: string; start: number; end: number }> {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (const newline of value.matchAll(/\r?\n/g)) {
    const newlineStart = newline.index;
    lines.push({
      text: value.slice(start, newlineStart),
      start,
      end: newlineStart + newline[0].length,
    });
    start = newlineStart + newline[0].length;
  }
  lines.push({ text: value.slice(start), start, end: value.length });
  return lines;
}

export function extractTaskenMarkdownFootnoteDefinitions(value: string): {
  body: string;
  definitions: Map<string, string>;
  definitionRanges: TaskenMarkdownSourceRange[];
} {
  const definitions = new Map<string, string>();
  const definitionRanges: TaskenMarkdownSourceRange[] = [];
  const kept: string[] = [];
  const lines = markdownLines(value);
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index].text.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      inFence = !inFence;
      kept.push(lines[index].text);
      continue;
    }
    if (inFence) {
      kept.push(lines[index].text);
      continue;
    }
    const match = lines[index].text.match(/^\[\^([^\]\n]+)\]:\s*(.*)$/);
    if (!match) {
      kept.push(lines[index].text);
      continue;
    }
    const rangeStart = lines[index].start;
    const parts = [match[2]];
    while (index + 1 < lines.length && /^(?: {4}|\t)/.test(lines[index + 1].text)) {
      index += 1;
      parts.push(lines[index].text.replace(/^(?: {4}|\t)/, ""));
    }
    definitions.set(match[1].trim(), parts.join("\n").trim());
    definitionRanges.push({ start: rangeStart, end: lines[index].end });
  }
  return { body: kept.join("\n"), definitions, definitionRanges };
}

/** Ranges that Preview shows as metadata or only conditionally, never as ordinary body images. */
export function taskenMarkdownNonBodyRanges(value: string): TaskenMarkdownSourceRange[] {
  const normalized = value.replace(/^\uFEFF/, "");
  const frontmatterMatch = normalized.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/);
  const bomLength = normalized.length === value.length ? 0 : 1;
  const bodyStart = frontmatterMatch ? bomLength + frontmatterMatch[0].length : 0;
  const rawBody = frontmatterMatch ? normalized.slice(frontmatterMatch[0].length) : value;
  const footnotes = extractTaskenMarkdownFootnoteDefinitions(rawBody);
  return [
    ...(frontmatterMatch ? [{ start: 0, end: bodyStart }] : []),
    ...footnotes.definitionRanges.map((range) => ({
      start: bodyStart + range.start,
      end: bodyStart + range.end,
    })),
  ];
}
