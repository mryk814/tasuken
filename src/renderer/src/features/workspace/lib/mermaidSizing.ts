const MERMAID_DISPLAY_SCALE = 1.5;

export function mermaidSvgPresentation(viewBox: string | null): {
  preferredWidth: number;
  intrinsicWidth: number;
  intrinsicHeight: number;
} | null {
  const parts = String(viewBox || "").trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0) {
    return null;
  }
  const width = parts[2];
  return {
    // 小さい図だけ拡大する。大きい図は自然寸法を保ち、本文幅へ潰さず図内でスクロールする。
    preferredWidth: Math.ceil(width * (width < 480 ? MERMAID_DISPLAY_SCALE : 1)),
    intrinsicWidth: Math.ceil(width),
    intrinsicHeight: Math.ceil(parts[3]),
  };
}
