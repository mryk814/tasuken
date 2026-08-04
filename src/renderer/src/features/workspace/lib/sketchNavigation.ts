export const SKETCH_ZOOM_MIN = 0.35;
export const SKETCH_ZOOM_MAX = 1.6;

export interface SketchViewport {
  x: number;
  y: number;
  zoom: number;
}

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

export function normalizeSketchViewport(
  viewport?: Partial<SketchViewport> | null,
  fallbackZoom = 0.82,
): SketchViewport {
  return {
    x: Number.isFinite(viewport?.x) ? Number(viewport?.x) : 0,
    y: Number.isFinite(viewport?.y) ? Number(viewport?.y) : 0,
    zoom: clampSketchZoom(Number.isFinite(viewport?.zoom) ? Number(viewport?.zoom) : fallbackZoom),
  };
}

export function screenToSketchWorld(
  viewport: SketchViewport,
  screenX: number,
  screenY: number,
) {
  return {
    x: viewport.x + screenX / viewport.zoom,
    y: viewport.y + screenY / viewport.zoom,
  };
}

export function sketchWorldToScreen(
  viewport: SketchViewport,
  worldX: number,
  worldY: number,
) {
  return {
    x: (worldX - viewport.x) * viewport.zoom,
    y: (worldY - viewport.y) * viewport.zoom,
  };
}

export function panSketchViewport(
  viewport: SketchViewport,
  deltaScreenX: number,
  deltaScreenY: number,
): SketchViewport {
  return {
    ...viewport,
    x: viewport.x - deltaScreenX / viewport.zoom,
    y: viewport.y - deltaScreenY / viewport.zoom,
  };
}

export function anchoredSketchViewportZoom(
  viewport: SketchViewport,
  nextZoom: number,
  pointerX: number,
  pointerY: number,
): SketchViewport {
  const world = screenToSketchWorld(viewport, pointerX, pointerY);
  const zoom = clampSketchZoom(nextZoom);
  return {
    x: world.x - pointerX / zoom,
    y: world.y - pointerY / zoom,
    zoom,
  };
}
