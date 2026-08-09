export type MarkdownSearchMatch = {
  index: number;
  length: number;
};

export type MarkdownReplaceResult = {
  text: string;
  count: number;
  /** 置換後の本文で次に選ぶべき一致の番号。一致が無くなった場合は0。 */
  nextIndex: number;
};

export type MarkdownDiffLine = {
  kind: "same" | "added" | "removed";
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
};

type RawMarkdownDiffLine = Omit<MarkdownDiffLine, "beforeLine" | "afterLine">;

export type MarkdownDiffHunk = {
  lines: MarkdownDiffLine[];
  focusStart: number;
  focusEnd: number;
  changedLines: number;
  addedLines: number;
  removedLines: number;
  omittedBefore: number;
  omittedAfter: number;
};

export type MarkdownDiffMarker = {
  lineNumber: number;
  kind: "added" | "removed" | "changed";
  hunk: MarkdownDiffHunk;
};

export function normalizeMarkdownDiffAnchorText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase();
}

export function buildMarkdownDiffMarkerAnchorTexts(marker: MarkdownDiffMarker): string[] {
  const { lines, focusStart, focusEnd } = marker.hunk;
  const candidateLines = [
    ...lines.slice(focusStart, focusEnd + 1).filter((line) => line.kind === "added"),
    ...lines.slice(focusEnd + 1).filter((line) => line.kind === "same"),
    ...lines.slice(0, focusStart).reverse().filter((line) => line.kind === "same"),
  ];

  return [...new Set(candidateLines
    .map((line) => normalizeMarkdownDiffAnchorText(line.text))
    .filter((text) => text.length >= 2))];
}

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
 * 現在選んでいる一致1件だけを置換する。
 * 置換文字列が検索語を含んでも同じ位置を選び直さないよう、
 * 次の一致は置換後の文字列より後ろから探す。
 */
export function replaceMarkdownMatch(
  source: string,
  query: string,
  matchIndex: number,
  replacement: string,
): MarkdownReplaceResult {
  const matches = findMarkdownMatches(source, query);
  const target = matches[matchIndex];
  if (!target) return { text: source, count: 0, nextIndex: 0 };

  const text = `${source.slice(0, target.index)}${replacement}${source.slice(target.index + target.length)}`;
  const resumeFrom = target.index + replacement.length;
  const nextMatches = findMarkdownMatches(text, query);
  const nextIndex = nextMatches.findIndex((match) => match.index >= resumeFrom);
  return { text, count: 1, nextIndex: nextIndex < 0 ? 0 : nextIndex };
}

/**
 * 文書内のすべての一致を一度に置換する。
 * 置換前の一致位置だけを使い、挿入した文字列を再走査しない。
 */
export function replaceAllMarkdownMatches(
  source: string,
  query: string,
  replacement: string,
): MarkdownReplaceResult {
  const matches = findMarkdownMatches(source, query);
  if (!matches.length) return { text: source, count: 0, nextIndex: 0 };

  const parts: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    parts.push(source.slice(cursor, match.index), replacement);
    cursor = match.index + match.length;
  }
  parts.push(source.slice(cursor));
  return { text: parts.join(""), count: matches.length, nextIndex: 0 };
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
    return addLineNumbers(coarseDiff(oldLines, newLines));
  }

  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const result: RawMarkdownDiffLine[] = [];
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
  return addLineNumbers(result);
}

/**
 * 差分の変更箇所を、前後の文脈行付きの小さなまとまりへ分ける。
 * 変更のない行をReview画面へ持ち込まず、狭い画面でも変更箇所へ集中できるようにする。
 */
export function buildMarkdownDiffHunks(lines: MarkdownDiffLine[], context = 2): MarkdownDiffHunk[] {
  const safeContext = Math.max(0, Math.floor(context));
  const changedRanges: Array<{ start: number; end: number }> = [];
  let changedStart: number | null = null;

  lines.forEach((line, index) => {
    if (line.kind !== "same") {
      if (changedStart == null) changedStart = index;
      return;
    }
    if (changedStart == null) return;
    changedRanges.push({ start: changedStart, end: index - 1 });
    changedStart = null;
  });
  if (changedStart != null) changedRanges.push({ start: changedStart, end: lines.length - 1 });

  return changedRanges.map(({ start, end }) => {
    const rangeStart = Math.max(0, start - safeContext);
    const rangeEnd = Math.min(lines.length - 1, end + safeContext);
    const hunkLines = lines.slice(rangeStart, rangeEnd + 1);
    const focusStart = start - rangeStart;
    const focusEnd = end - rangeStart;
    const focusedLines = hunkLines.slice(focusStart, focusEnd + 1);
    return {
      lines: hunkLines,
      focusStart,
      focusEnd,
      changedLines: focusedLines.length,
      addedLines: focusedLines.filter((line) => line.kind === "added").length,
      removedLines: focusedLines.filter((line) => line.kind === "removed").length,
      omittedBefore: rangeStart,
      omittedAfter: lines.length - rangeEnd - 1,
    };
  });
}

/**
 * 差分のうち採用したhunkだけを元本文へ適用する。
 * Proposalの部分採用用。変更のない行は常に保持する。
 */
export function applyMarkdownDiffHunks(before: string, after: string, acceptedHunks: number[]): string {
  const accepted = new Set(acceptedHunks);
  const lines = diffMarkdownLines(before, after);
  const output: string[] = [];
  let hunkIndex = -1;
  let inChange = false;
  for (const line of lines) {
    if (line.kind === "same") {
      inChange = false;
      output.push(line.text);
      continue;
    }
    if (!inChange) {
      hunkIndex += 1;
      inChange = true;
    }
    if (accepted.has(hunkIndex) ? line.kind === "added" : line.kind === "removed") {
      output.push(line.text);
    }
  }
  return output.join("\n");
}

/**
 * 本文左端へ置く変更マーカー。表示中の本文側の行番号へ寄せ、削除だけの変更は直前の行に置く。
 */
export function buildMarkdownDiffMarkers(lines: MarkdownDiffLine[], context = 2): MarkdownDiffMarker[] {
  return buildMarkdownDiffHunks(lines, context).map((hunk) => {
    const changedLines = hunk.lines.slice(hunk.focusStart, hunk.focusEnd + 1);
    const first = changedLines[0];
    const anchor = changedLines.find((line) => line.kind === "added") || first;
    const hasAdded = changedLines.some((line) => line.kind === "added");
    const hasRemoved = changedLines.some((line) => line.kind === "removed");
    return {
      lineNumber: anchor.afterLine ?? Math.max(1, (anchor.beforeLine ?? 1) - 1),
      kind: hasAdded && hasRemoved ? "changed" : hasAdded ? "added" : "removed",
      hunk,
    };
  });
}

/**
 * 下書き本文の指定hunkだけを、保存済み本文側の行へ戻す。
 * 文脈行も含めたhunk全体を置換し、未変更の行を取りこぼさずに復元する。
 */
export function restoreMarkdownDiffHunk(after: string, hunk: MarkdownDiffHunk): string {
  const currentLines = splitLines(after);
  const focusedLines = hunk.lines.slice(hunk.focusStart, hunk.focusEnd + 1);
  const currentHunkLines = focusedLines.filter((line) => line.kind === "added");
  const originalHunkLines = focusedLines.filter((line) => line.kind === "removed");

  if (!currentHunkLines.length) {
    const nextLine = hunk.lines.slice(hunk.focusEnd + 1).find((line) => line.afterLine !== null);
    const previousLine = hunk.lines.slice(0, hunk.focusStart).reverse().find((line) => line.afterLine !== null);
    const insertionIndex = nextLine?.afterLine != null
      ? Math.max(0, nextLine.afterLine - 1)
      : Math.min(currentLines.length, previousLine?.afterLine ?? 0);
    currentLines.splice(insertionIndex, 0, ...originalHunkLines.map((line) => line.text));
    return currentLines.join("\n");
  }

  const start = Math.max(0, (currentHunkLines[0].afterLine ?? 1) - 1);
  const end = Math.min(currentLines.length, currentHunkLines.at(-1)?.afterLine ?? start);
  currentLines.splice(start, Math.max(0, end - start), ...originalHunkLines.map((line) => line.text));
  return currentLines.join("\n");
}

function coarseDiff(oldLines: string[], newLines: string[]): RawMarkdownDiffLine[] {
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

function addLineNumbers(lines: RawMarkdownDiffLine[]): MarkdownDiffLine[] {
  let beforeLine = 1;
  let afterLine = 1;
  return lines.map((line) => {
    const numbered: MarkdownDiffLine = {
      ...line,
      beforeLine: line.kind === "added" ? null : beforeLine,
      afterLine: line.kind === "removed" ? null : afterLine,
    };
    if (line.kind !== "added") beforeLine += 1;
    if (line.kind !== "removed") afterLine += 1;
    return numbered;
  });
}
