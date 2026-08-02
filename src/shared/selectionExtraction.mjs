const TITLE_LIMIT = 80;
const EXCERPT_LIMIT = 280;

function cleanTitleLine(line) {
  return String(line || "")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/, "")
    .replace(/^\s*\[[ xX]\]\s+/, "")
    .replace(/[*_~`]/g, "")
    .trim();
}

export function selectionTitleCandidate(text) {
  const line = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(cleanTitleLine)
    .find(Boolean) || "選択範囲からのメモ";
  return line.length <= TITLE_LIMIT ? line : `${line.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

export function selectionExcerpt(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length <= EXCERPT_LIMIT
    ? normalized
    : `${normalized.slice(0, EXCERPT_LIMIT - 1).trimEnd()}…`;
}

export function markdownHeadingBeforeOffset(markdown, offset) {
  const before = String(markdown || "").slice(0, Math.max(0, Number(offset) || 0)).replace(/\r\n?/g, "\n");
  const lines = before.split("\n");
  let inCode = false;
  let heading = null;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) heading = cleanTitleLine(match[1]);
  }
  return heading;
}
