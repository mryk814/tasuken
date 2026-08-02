export const SKETCH_ZOOM_MIN = 0.35;
export const SKETCH_ZOOM_MAX = 1.6;

export function clampSketchZoom(value: number): number {
  return Math.min(SKETCH_ZOOM_MAX, Math.max(SKETCH_ZOOM_MIN, Number(value.toFixed(3))));
}

export function sketchZoomFromWheel(current: number, deltaY: number): number {
  return clampSketchZoom(current * Math.exp(-deltaY * 0.002));
}

export function anchoredSketchScroll({
  zoom,
  nextZoom,
  scrollLeft,
  scrollTop,
  pointerX,
  pointerY,
}: {
  zoom: number;
  nextZoom: number;
  scrollLeft: number;
  scrollTop: number;
  pointerX: number;
  pointerY: number;
}) {
  const canvasX = (scrollLeft + pointerX) / zoom;
  const canvasY = (scrollTop + pointerY) / zoom;
  return {
    left: canvasX * nextZoom - pointerX,
    top: canvasY * nextZoom - pointerY,
  };
}
