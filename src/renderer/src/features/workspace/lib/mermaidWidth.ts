const MERMAID_WIDTH_META = /(?:^|\s)width\s*=\s*(\d+(?:\.\d+)?)%?(?=\s|$)/i;

export const MERMAID_WIDTH_MIN = 30;
export const MERMAID_WIDTH_MAX = 100;
export const MERMAID_WIDTH_STEP = 5;

export function normalizeMermaidWidth(value: number): number {
  if (!Number.isFinite(value)) return MERMAID_WIDTH_MAX;
  const rounded = Math.round(value / MERMAID_WIDTH_STEP) * MERMAID_WIDTH_STEP;
  return Math.min(MERMAID_WIDTH_MAX, Math.max(MERMAID_WIDTH_MIN, rounded));
}

export function mermaidWidthFromMeta(meta: string | null | undefined): number | null {
  const match = String(meta || "").match(MERMAID_WIDTH_META);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < MERMAID_WIDTH_MIN || value > MERMAID_WIDTH_MAX) return null;
  return normalizeMermaidWidth(value);
}

export function withMermaidWidthMeta(meta: string | null | undefined, width: number | null): string {
  const rest = String(meta || "")
    .replace(MERMAID_WIDTH_META, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (width === null) return rest;
  return [rest, `width=${normalizeMermaidWidth(width)}%`].filter(Boolean).join(" ");
}
