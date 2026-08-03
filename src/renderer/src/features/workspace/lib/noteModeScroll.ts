export type NoteModeScrollAnchor = {
  ratio: number;
  headingIndex: number | null;
  sectionProgress: number;
};

export function rawHeadingScrollTop(
  sourceLine: number,
  sourceLineCount: number,
  scrollHeight: number,
): number {
  const lineExtent = Math.max(1, sourceLineCount - 1);
  return (Math.max(0, sourceLine) / lineExtent) * Math.max(0, scrollHeight);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function captureNoteModeScroll(
  scrollTop: number,
  scrollable: number,
  documentHeight: number,
  headingPositions: number[],
): NoteModeScrollAnchor {
  const ratio = scrollable > 0 ? clamp(scrollTop / scrollable, 0, 1) : 0;
  let headingIndex = -1;
  for (let index = 0; index < headingPositions.length; index += 1) {
    if (headingPositions[index] > scrollTop + 8) break;
    headingIndex = index;
  }
  if (headingIndex < 0) return { ratio, headingIndex: null, sectionProgress: 0 };

  const start = headingPositions[headingIndex];
  const end = headingPositions[headingIndex + 1] ?? documentHeight;
  const sectionProgress = end > start
    ? clamp((scrollTop - start) / (end - start), 0, 1)
    : 0;
  return { ratio, headingIndex, sectionProgress };
}

export function restoreNoteModeScroll(
  anchor: NoteModeScrollAnchor,
  scrollable: number,
  documentHeight: number,
  headingPositions: number[],
): number {
  if (anchor.headingIndex !== null && headingPositions[anchor.headingIndex] !== undefined) {
    const start = headingPositions[anchor.headingIndex];
    const end = headingPositions[anchor.headingIndex + 1] ?? documentHeight;
    return clamp(start + ((end - start) * anchor.sectionProgress), 0, scrollable);
  }
  return clamp(anchor.ratio * scrollable, 0, scrollable);
}
