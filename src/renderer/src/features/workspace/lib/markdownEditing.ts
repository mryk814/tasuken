export type MarkdownSearchMatch = {
  index: number;
  length: number;
};

export type MarkdownDiffLine = {
  kind: "same" | "added" | "removed";
  text: string;
};

function splitLines(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").split("\n");
}

function isFence(line: string): boolean {
  return /^\s*(?:`{3,}|~{3,})/.test(line);
}

/**
 * Markdown本文の意味を変えない範囲で、行末空白と過剰な空行だけを整える。
 * コードフェンス内はそのまま保持し、日本語本文の改行やURLは触らない。
 */
export function formatMarkdown(value: string): string {
  const lines = splitLines(value);
  const formatted: string[] = [];
  let inFence = false;
  let blankRun = 0;

  for (const line of lines) {
    if (isFence(line)) {
      inFence = !inFence;
      blankRun = 0;
      formatted.push(line);
      continue;
    }
    if (inFence) {
      formatted.push(line);
      continue;
    }

    const normalized = line.replace(/[ \t]+$/, "");
    if (!normalized.trim()) {
      if (blankRun < 1) formatted.push("");
      blankRun += 1;
      continue;
    }
    formatted.push(normalized);
    blankRun = 0;
  }

  while (formatted.at(-1) === "") formatted.pop();
  return formatted.join("\n");
}

export function findMarkdownMatches(source: string, query: string): MarkdownSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const haystack = source.toLocaleLowerCase();
  const matches: MarkdownSearchMatch[] = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) break;
    matches.push({ index, length: needle.length });
    cursor = index + needle.length;
  }
  return matches;
}

/**
 * 小さな行diff。一般的なNoteではLCSで変更箇所を分け、極端に長い文書では
 * 共通の前後だけを残して安全に描画する。
 */
export function diffMarkdownLines(before: string, after: string): MarkdownDiffLine[] {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const maxCells = 1_500_000;
  if (oldLines.length * newLines.length > maxCells) {
    return coarseDiff(oldLines, newLines);
  }

  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const result: MarkdownDiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      result.push({ kind: "same", text: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      result.push({ kind: "removed", text: oldLines[oldIndex] });
      oldIndex += 1;
    } else {
      result.push({ kind: "added", text: newLines[newIndex] });
      newIndex += 1;
    }
  }
  while (oldIndex < oldLines.length) result.push({ kind: "removed", text: oldLines[oldIndex++] });
  while (newIndex < newLines.length) result.push({ kind: "added", text: newLines[newIndex++] });
  return result;
}

function coarseDiff(oldLines: string[], newLines: string[]): MarkdownDiffLine[] {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
  ) suffix += 1;
  return [
    ...oldLines.slice(0, prefix).map((text) => ({ kind: "same" as const, text })),
    ...oldLines.slice(prefix, oldLines.length - suffix).map((text) => ({ kind: "removed" as const, text })),
    ...newLines.slice(prefix, newLines.length - suffix).map((text) => ({ kind: "added" as const, text })),
    ...oldLines.slice(oldLines.length - suffix).map((text) => ({ kind: "same" as const, text })),
  ];
}
