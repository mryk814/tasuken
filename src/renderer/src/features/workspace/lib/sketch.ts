export type SketchTool = "select" | "lasso" | "pen" | "highlighter" | "eraser" | "shape" | "arrow" | "text" | "image" | "pan";
export type SketchBackground = "plain" | "dot" | "grid";
export type SketchCanvasMode = "page" | "infinite";
export type SketchEraserMode = "partial" | "stroke";
export interface SketchPageSize {
  width: number;
  height: number;
}
export type SketchShapeKind =
  | "auto"
  | "line"
  | "rectangle"
  | "rounded_rectangle"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "sticky_note"
  | "callout"
  | "bidirectional_arrow";

export interface SketchPoint {
  x: number;
  y: number;
  pressure: number;
}

interface SketchObjectBase {
  id: string;
  color: string;
}

export interface SketchStroke extends SketchObjectBase {
  type: "stroke";
  tool: "pen" | "highlighter";
  width: number;
  points: SketchPoint[];
}

export interface SketchShape extends SketchObjectBase {
  type: "shape";
  shape: Exclude<SketchShapeKind, "auto"> | "arrow";
  width: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SketchText extends SketchObjectBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  font_size: number;
}

export interface SketchImage extends SketchObjectBase {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  data_url: string;
}

export type SketchObject = SketchStroke | SketchShape | SketchText | SketchImage;

export interface SketchPage {
  id: string;
  title: string;
  width: number;
  height: number;
  background: SketchBackground;
  objects: SketchObject[];
}

export interface SketchDocument {
  schema_version: 1;
  mode?: SketchCanvasMode;
  pages: SketchPage[];
}

const sketchImageCache = new Map<string, HTMLImageElement>();

function sketchImage(dataUrl: string): HTMLImageElement {
  const cached = sketchImageCache.get(dataUrl);
  if (cached) return cached;
  const image = new Image();
  image.src = dataUrl;
  sketchImageCache.set(dataUrl, image);
  return image;
}

async function loadSketchImages(page: SketchPage): Promise<void> {
  await Promise.all(page.objects.filter((object) => object.type === "image").map(async (object) => {
    const image = sketchImage(object.data_url);
    if (image.complete && image.naturalWidth) return;
    await image.decode();
  }));
}

export interface SketchBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SketchAlignmentGuides {
  vertical: number[];
  horizontal: number[];
}

export const SKETCH_BACKGROUND_RENDERING = {
  paperColor: "#fffdfb",
  dotColor: "#b9aaad",
  gridColor: "#d0c2c4",
  spacing: 24,
  dotRadius: 1.55,
  gridLineWidth: 1.35,
} as const;

export const SKETCH_PAGE_PRESETS = {
  landscape: { width: 1200, height: 850 },
  portrait: { width: 850, height: 1200 },
  square: { width: 1000, height: 1000 },
} as const satisfies Record<string, SketchPageSize>;

export const SKETCH_PAGE_SIZE_LIMITS = {
  min: 480,
  max: 3000,
} as const;

const INFINITE_PAGE_WIDTH = 2400;
const INFINITE_PAGE_HEIGHT = 1600;
const INFINITE_GROW_MARGIN = 240;
const INFINITE_GROW_STEP = 800;

export function createSketchPage(
  title = "1",
  mode: SketchCanvasMode = "page",
  pageSize: SketchPageSize = SKETCH_PAGE_PRESETS.landscape,
): SketchPage {
  return {
    id: crypto.randomUUID(),
    title,
    width: mode === "infinite" ? INFINITE_PAGE_WIDTH : pageSize.width,
    height: mode === "infinite" ? INFINITE_PAGE_HEIGHT : pageSize.height,
    background: "dot",
    objects: [],
  };
}

export function createEmptySketchDocument(
  mode: SketchCanvasMode = "page",
  pageSize: SketchPageSize = SKETCH_PAGE_PRESETS.landscape,
): SketchDocument {
  return { schema_version: 1, mode, pages: [createSketchPage("1", mode, pageSize)] };
}

export function createSketchDraft(
  title = "新しいSketch",
  projectId: string | null = null,
  originCaptureId: string | null = null,
  mode: SketchCanvasMode = "page",
  pageSize: SketchPageSize = SKETCH_PAGE_PRESETS.landscape,
) {
  return {
    id: crypto.randomUUID(),
    title,
    project_id: projectId,
    origin_capture_id: originCaptureId,
    document: createEmptySketchDocument(mode, pageSize),
  };
}

export function sketchCanvasMode(document: SketchDocument): SketchCanvasMode {
  return document.mode === "infinite" ? "infinite" : "page";
}

export function cloneSketchDocument(document: SketchDocument): SketchDocument {
  return structuredClone(document);
}

export function minimumSketchPageSize(page: SketchPage, padding = 48): SketchPageSize {
  const bounds = combinedObjectBounds(page.objects);
  if (!bounds) return { width: SKETCH_PAGE_SIZE_LIMITS.min, height: SKETCH_PAGE_SIZE_LIMITS.min };
  return {
    width: Math.max(SKETCH_PAGE_SIZE_LIMITS.min, Math.ceil(bounds.x + bounds.w + padding)),
    height: Math.max(SKETCH_PAGE_SIZE_LIMITS.min, Math.ceil(bounds.y + bounds.h + padding)),
  };
}

export function objectBounds(object: SketchObject): SketchBounds {
  if (object.type === "stroke") {
    const xs = object.points.map((point) => point.x);
    const ys = object.points.map((point) => point.y);
    if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 };
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = object.width * 2;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }
  if (object.type === "text") {
    const lines = object.text.split("\n");
    return {
      x: object.x,
      y: object.y - object.font_size,
      w: Math.max(36, Math.max(...lines.map((line) => line.length), 1) * object.font_size * 0.72),
      h: Math.max(1.4, 1 + (lines.length - 1) * 1.3) * object.font_size,
    };
  }
  return { x: Math.min(object.x, object.x + object.w), y: Math.min(object.y, object.y + object.h), w: Math.abs(object.w), h: Math.abs(object.h) };
}

export function expandInfinitePage(page: SketchPage): SketchPage {
  if (!page.objects.length) return page;
  const bounds = combinedObjectBounds(page.objects);
  if (!bounds) return page;
  const requiredWidth = bounds.x + bounds.w + INFINITE_GROW_MARGIN;
  const requiredHeight = bounds.y + bounds.h + INFINITE_GROW_MARGIN;
  const width = requiredWidth > page.width
    ? Math.ceil(requiredWidth / INFINITE_GROW_STEP) * INFINITE_GROW_STEP
    : page.width;
  const height = requiredHeight > page.height
    ? Math.ceil(requiredHeight / INFINITE_GROW_STEP) * INFINITE_GROW_STEP
    : page.height;
  return width === page.width && height === page.height ? page : { ...page, width, height };
}

export function cropSketchPageToContent(page: SketchPage, padding = 80): SketchPage {
  if (!page.objects.length) return page;
  const bounds = combinedObjectBounds(page.objects);
  if (!bounds) return page;
  const minX = Math.max(0, bounds.x - padding);
  const minY = Math.max(0, bounds.y - padding);
  const maxX = Math.min(page.width, bounds.x + bounds.w + padding);
  const maxY = Math.min(page.height, bounds.y + bounds.h + padding);
  return {
    ...page,
    width: Math.max(240, Math.ceil(maxX - minX)),
    height: Math.max(180, Math.ceil(maxY - minY)),
    objects: page.objects.map((object) => translateObject(object, -minX, -minY)),
  };
}

export function combinedObjectBounds(objects: SketchObject[]): SketchBounds | null {
  if (!objects.length) return null;
  const bounds = objects.map(objectBounds);
  const x = Math.min(...bounds.map((entry) => entry.x));
  const y = Math.min(...bounds.map((entry) => entry.y));
  const x2 = Math.max(...bounds.map((entry) => entry.x + entry.w));
  const y2 = Math.max(...bounds.map((entry) => entry.y + entry.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

function closestAlignment(source: number[], targets: number[], threshold: number) {
  let closest: { delta: number; guide: number } | null = null;
  for (const sourceValue of source) {
    for (const target of targets) {
      const delta = target - sourceValue;
      if (Math.abs(delta) > threshold) continue;
      if (!closest || Math.abs(delta) < Math.abs(closest.delta)) closest = { delta, guide: target };
    }
  }
  return closest;
}

export function snapObjectTranslation(
  objects: SketchObject[],
  selectedIds: string[],
  dx: number,
  dy: number,
  threshold = 8,
): { dx: number; dy: number; guides: SketchAlignmentGuides } {
  const selectedBounds = combinedObjectBounds(objects.filter((object) => selectedIds.includes(object.id)));
  const otherBounds = objects.filter((object) => !selectedIds.includes(object.id)).map(objectBounds);
  if (!selectedBounds || !otherBounds.length) return { dx, dy, guides: { vertical: [], horizontal: [] } };
  const targetXs = otherBounds.flatMap((bounds) => [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w]);
  const targetYs = otherBounds.flatMap((bounds) => [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h]);
  const xMatch = closestAlignment(
    [selectedBounds.x + dx, selectedBounds.x + selectedBounds.w / 2 + dx, selectedBounds.x + selectedBounds.w + dx],
    targetXs,
    threshold,
  );
  const yMatch = closestAlignment(
    [selectedBounds.y + dy, selectedBounds.y + selectedBounds.h / 2 + dy, selectedBounds.y + selectedBounds.h + dy],
    targetYs,
    threshold,
  );
  return {
    dx: dx + (xMatch?.delta || 0),
    dy: dy + (yMatch?.delta || 0),
    guides: {
      vertical: xMatch ? [xMatch.guide] : [],
      horizontal: yMatch ? [yMatch.guide] : [],
    },
  };
}

export function snapObjectResize(
  bounds: SketchBounds,
  objects: SketchObject[],
  excludedId: string,
  threshold = 8,
): { bounds: SketchBounds; guides: SketchAlignmentGuides } {
  const otherBounds = objects.filter((object) => object.id !== excludedId).map(objectBounds);
  if (!otherBounds.length) return { bounds, guides: { vertical: [], horizontal: [] } };
  const targetXs = otherBounds.flatMap((entry) => [entry.x, entry.x + entry.w / 2, entry.x + entry.w]);
  const targetYs = otherBounds.flatMap((entry) => [entry.y, entry.y + entry.h / 2, entry.y + entry.h]);
  const xMatch = closestAlignment([bounds.x + bounds.w], targetXs, threshold);
  const yMatch = closestAlignment([bounds.y + bounds.h], targetYs, threshold);
  return {
    bounds: {
      ...bounds,
      w: Math.max(16, bounds.w + (xMatch?.delta || 0)),
      h: Math.max(16, bounds.h + (yMatch?.delta || 0)),
    },
    guides: {
      vertical: xMatch ? [xMatch.guide] : [],
      horizontal: yMatch ? [yMatch.guide] : [],
    },
  };
}

export function boundsContainPoint(bounds: SketchBounds, point: Pick<SketchPoint, "x" | "y">, padding = 8): boolean {
  return point.x >= bounds.x - padding
    && point.x <= bounds.x + bounds.w + padding
    && point.y >= bounds.y - padding
    && point.y <= bounds.y + bounds.h + padding;
}

function distanceToSegment(
  point: Pick<SketchPoint, "x" | "y">,
  start: Pick<SketchPoint, "x" | "y">,
  end: Pick<SketchPoint, "x" | "y">,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

function shapeHit(object: SketchShape, point: Pick<SketchPoint, "x" | "y">, tolerance: number): boolean {
  const x2 = object.x + object.w;
  const y2 = object.y + object.h;
  const lineTolerance = Math.max(tolerance, object.width / 2 + 5);
  if (object.shape === "line" || object.shape === "arrow" || object.shape === "bidirectional_arrow") {
    return distanceToSegment(point, { x: object.x, y: object.y }, { x: x2, y: y2 }) <= lineTolerance;
  }
  if (object.shape === "rectangle" || object.shape === "rounded_rectangle" || object.shape === "sticky_note" || object.shape === "callout") {
    const left = Math.min(object.x, x2);
    const right = Math.max(object.x, x2);
    const top = Math.min(object.y, y2);
    const bottom = Math.max(object.y, y2);
    if (!boundsContainPoint({ x: left, y: top, w: right - left, h: bottom - top }, point, lineTolerance)) return false;
    return Math.min(
      Math.abs(point.x - left),
      Math.abs(point.x - right),
      Math.abs(point.y - top),
      Math.abs(point.y - bottom),
    ) <= lineTolerance;
  }
  if (object.shape === "triangle") {
    const top = { x: object.x + object.w / 2, y: object.y };
    const left = { x: object.x, y: y2 };
    const right = { x: x2, y: y2 };
    return Math.min(
      distanceToSegment(point, top, left),
      distanceToSegment(point, left, right),
      distanceToSegment(point, right, top),
    ) <= lineTolerance;
  }
  if (object.shape === "diamond") {
    const top = { x: object.x + object.w / 2, y: object.y };
    const right = { x: x2, y: object.y + object.h / 2 };
    const bottom = { x: object.x + object.w / 2, y: y2 };
    const left = { x: object.x, y: object.y + object.h / 2 };
    return Math.min(
      distanceToSegment(point, top, right),
      distanceToSegment(point, right, bottom),
      distanceToSegment(point, bottom, left),
      distanceToSegment(point, left, top),
    ) <= lineTolerance;
  }
  const centerX = object.x + object.w / 2;
  const centerY = object.y + object.h / 2;
  const radiusX = Math.max(1, Math.abs(object.w / 2));
  const radiusY = Math.max(1, Math.abs(object.h / 2));
  const normalized = Math.hypot((point.x - centerX) / radiusX, (point.y - centerY) / radiusY);
  return Math.abs(normalized - 1) <= lineTolerance / Math.max(1, Math.min(radiusX, radiusY));
}

function objectHit(object: SketchObject, point: Pick<SketchPoint, "x" | "y">, tolerance: number): boolean {
  if (object.type === "shape") return shapeHit(object, point, tolerance);
  if (object.type === "stroke") {
    const lineTolerance = Math.max(tolerance, object.width / 2 + 4);
    if (object.points.length === 1) return Math.hypot(point.x - object.points[0].x, point.y - object.points[0].y) <= lineTolerance;
    return object.points.slice(1).some((entry, index) => distanceToSegment(point, object.points[index], entry) <= lineTolerance);
  }
  return boundsContainPoint(objectBounds(object), point, tolerance);
}

function samplePath(points: SketchPoint[], spacing: number): SketchPoint[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));
  const sampled: SketchPoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(length / Math.max(1, spacing)));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      sampled.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        pressure: start.pressure + (end.pressure - start.pressure) * ratio,
      });
    }
  }
  return sampled;
}

function distanceToPath(point: Pick<SketchPoint, "x" | "y">, path: SketchPoint[]): number {
  if (!path.length) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return Math.hypot(point.x - path[0].x, point.y - path[0].y);
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    closest = Math.min(closest, distanceToSegment(point, path[index - 1], path[index]));
  }
  return closest;
}

function splitStrokeByEraser(stroke: SketchStroke, eraserPath: SketchPoint[], radius: number): SketchStroke[] {
  const sampled = samplePath(stroke.points, Math.max(1.5, radius / 3));
  const runs: SketchPoint[][] = [];
  let current: SketchPoint[] = [];
  const hitRadius = radius + stroke.width / 2;
  for (const point of sampled) {
    if (distanceToPath(point, eraserPath) <= hitRadius) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length) runs.push(current);
  return runs
    .filter((run) => run.length > 1)
    .map((points, index) => ({
      ...stroke,
      id: index === 0 ? stroke.id : crypto.randomUUID(),
      points,
    }));
}

export function eraseSketchObjects(
  objects: SketchObject[],
  eraserPath: SketchPoint[],
  diameter: number,
  mode: SketchEraserMode,
): SketchObject[] {
  if (!eraserPath.length) return objects;
  const radius = Math.max(3, diameter / 2);
  const hitSamples = samplePath(eraserPath, Math.max(2, radius / 2));
  return objects.flatMap((object) => {
    const isHit = hitSamples.some((point) => objectHit(object, point, radius));
    if (!isHit) return [object];
    if (mode === "stroke" || object.type !== "stroke") return [];
    return splitStrokeByEraser(object, eraserPath, radius);
  });
}

export function hitTest(
  objects: SketchObject[],
  point: Pick<SketchPoint, "x" | "y">,
  tolerance = 6,
): SketchObject | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    if (objectHit(objects[index], point, tolerance)) return objects[index];
  }
  return null;
}

export function moveSketchObjectsToLayer(
  objects: SketchObject[],
  selectedIds: string[],
  layer: "front" | "back",
): SketchObject[] {
  const selected = objects.filter((object) => selectedIds.includes(object.id));
  const rest = objects.filter((object) => !selectedIds.includes(object.id));
  return layer === "front" ? [...rest, ...selected] : [...selected, ...rest];
}

export function pointInPolygon(point: Pick<SketchPoint, "x" | "y">, polygon: SketchPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 0.0001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function lassoSelection(objects: SketchObject[], polygon: SketchPoint[]): string[] {
  if (polygon.length < 3) return [];
  return objects
    .filter((object) => {
      const bounds = objectBounds(object);
      return pointInPolygon({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }, polygon);
    })
    .map((object) => object.id);
}

export function translateObject(object: SketchObject, dx: number, dy: number): SketchObject {
  if (object.type === "stroke") {
    return { ...object, points: object.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })) };
  }
  return { ...object, x: object.x + dx, y: object.y + dy };
}

export function resizeObject(object: SketchObject, bounds: SketchBounds): SketchObject {
  const previous = objectBounds(object);
  const scaleX = previous.w ? bounds.w / previous.w : 1;
  const scaleY = previous.h ? bounds.h / previous.h : 1;
  if (object.type === "stroke") {
    return {
      ...object,
      points: object.points.map((point) => ({
        ...point,
        x: bounds.x + (point.x - previous.x) * scaleX,
        y: bounds.y + (point.y - previous.y) * scaleY,
      })),
    };
  }
  if (object.type === "text") {
    return { ...object, x: bounds.x, y: bounds.y + bounds.h, font_size: Math.max(11, object.font_size * Math.max(scaleX, scaleY)) };
  }
  return { ...object, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
}

function pathLength(points: SketchPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

export function recognizeShape(points: SketchPoint[]): "rectangle" | "ellipse" | "line" {
  if (points.length < 2) return "line";
  const bounds = objectBounds({ id: "", type: "stroke", tool: "pen", color: "", width: 1, points });
  const first = points[0];
  const last = points[points.length - 1];
  const diagonal = Math.max(1, Math.hypot(bounds.w, bounds.h));
  const closed = Math.hypot(last.x - first.x, last.y - first.y) < diagonal * 0.24;
  if (!closed) return "line";

  const perimeter = Math.max(1, 2 * (bounds.w + bounds.h));
  const circularPerimeter = Math.PI * (3 * (bounds.w + bounds.h) - Math.sqrt((3 * bounds.w + bounds.h) * (bounds.w + 3 * bounds.h)));
  const length = pathLength(points);
  return Math.abs(length - perimeter) <= Math.abs(length - circularPerimeter) ? "rectangle" : "ellipse";
}

function drawArrowHead(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  context.moveTo(x2, y2);
  context.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  context.moveTo(x2, y2);
  context.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
}

export function drawSketchPage(
  context: CanvasRenderingContext2D,
  page: SketchPage,
  options: { selectedIds?: string[]; draftObject?: SketchStroke; draftShape?: SketchShape; lassoPoints?: SketchPoint[] } = {},
) {
  context.clearRect(0, 0, page.width, page.height);
  context.fillStyle = SKETCH_BACKGROUND_RENDERING.paperColor;
  context.fillRect(0, 0, page.width, page.height);

  if (page.background !== "plain") {
    context.fillStyle = SKETCH_BACKGROUND_RENDERING.dotColor;
    context.strokeStyle = SKETCH_BACKGROUND_RENDERING.gridColor;
    context.lineWidth = SKETCH_BACKGROUND_RENDERING.gridLineWidth;
    for (let x = SKETCH_BACKGROUND_RENDERING.spacing; x < page.width; x += SKETCH_BACKGROUND_RENDERING.spacing) {
      for (let y = SKETCH_BACKGROUND_RENDERING.spacing; y < page.height; y += SKETCH_BACKGROUND_RENDERING.spacing) {
        if (page.background === "dot") {
          context.beginPath();
          context.arc(x, y, SKETCH_BACKGROUND_RENDERING.dotRadius, 0, Math.PI * 2);
          context.fill();
        }
      }
      if (page.background === "grid") {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, page.height);
        context.stroke();
      }
    }
    if (page.background === "grid") {
      for (let y = SKETCH_BACKGROUND_RENDERING.spacing; y < page.height; y += SKETCH_BACKGROUND_RENDERING.spacing) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(page.width, y);
        context.stroke();
      }
    }
  }

  for (const object of page.objects) {
    drawSketchObject(context, object, () => drawSketchPage(context, page, options));
  }
  if (options.draftObject?.points.length) drawSketchObject(context, options.draftObject);
  if (options.draftShape) drawSketchObject(context, options.draftShape);
  if (options.lassoPoints?.length) {
    context.save();
    context.strokeStyle = "#2f6fa6";
    context.lineWidth = 2;
    context.setLineDash([8, 6]);
    context.beginPath();
    options.lassoPoints.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.stroke();
    context.restore();
  }
  for (const id of options.selectedIds || []) {
    const object = page.objects.find((entry) => entry.id === id);
    if (!object) continue;
    const bounds = objectBounds(object);
    context.save();
    context.strokeStyle = "#2f6fa6";
    context.fillStyle = "#fffdfb";
    context.lineWidth = 2;
    context.setLineDash([7, 5]);
    context.strokeRect(bounds.x - 6, bounds.y - 6, bounds.w + 12, bounds.h + 12);
    context.setLineDash([]);
    const handleX = bounds.x + bounds.w + 6;
    const handleY = bounds.y + bounds.h + 6;
    context.fillRect(handleX - 5, handleY - 5, 10, 10);
    context.strokeRect(handleX - 5, handleY - 5, 10, 10);
    context.restore();
  }
}

export function smoothSketchPoints(points: SketchPoint[], passes = 2): SketchPoint[] {
  if (points.length < 3 || passes <= 0) return points;
  let smoothed = points.map((point) => ({ ...point }));
  for (let pass = 0; pass < passes; pass += 1) {
    const next: SketchPoint[] = [{ ...smoothed[0] }];
    for (let index = 0; index < smoothed.length - 1; index += 1) {
      const current = smoothed[index];
      const following = smoothed[index + 1];
      next.push({
        x: current.x * 0.75 + following.x * 0.25,
        y: current.y * 0.75 + following.y * 0.25,
        pressure: current.pressure * 0.75 + following.pressure * 0.25,
      });
      next.push({
        x: current.x * 0.25 + following.x * 0.75,
        y: current.y * 0.25 + following.y * 0.75,
        pressure: current.pressure * 0.25 + following.pressure * 0.75,
      });
    }
    next.push({ ...smoothed.at(-1)! });
    smoothed = next;
  }
  return smoothed;
}

export function drawSketchObject(
  context: CanvasRenderingContext2D,
  object: SketchObject,
  onImageLoad?: () => void,
) {
  context.save();
  context.strokeStyle = object.color;
  context.fillStyle = object.color;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (object.type === "stroke") {
    const points = smoothSketchPoints(object.points);
    if (points.length < 2) {
      const point = points[0];
      if (point) {
        context.beginPath();
        context.arc(point.x, point.y, object.width / 2, 0, Math.PI * 2);
        context.fill();
      }
    } else {
      context.globalAlpha = object.tool === "highlighter" ? 0.3 : 1;
      if (object.tool === "highlighter") {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        context.lineWidth = object.width;
        for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
        context.stroke();
        context.restore();
        return;
      }
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const point = points[index];
        context.beginPath();
        context.moveTo(previous.x, previous.y);
        context.lineWidth = object.width * (0.65 + (previous.pressure + point.pressure) * 0.35);
        context.lineTo(point.x, point.y);
        context.stroke();
      }
    }
  } else if (object.type === "shape") {
    context.lineWidth = object.width;
    const x2 = object.x + object.w;
    const y2 = object.y + object.h;
    context.beginPath();
    if (object.shape === "rectangle") context.rect(object.x, object.y, object.w, object.h);
    else if (object.shape === "rounded_rectangle") {
      const radius = Math.min(24, Math.abs(object.w) / 5, Math.abs(object.h) / 5);
      context.roundRect(object.x, object.y, object.w, object.h, radius);
    }
    else if (object.shape === "ellipse") context.ellipse(object.x + object.w / 2, object.y + object.h / 2, Math.abs(object.w / 2), Math.abs(object.h / 2), 0, 0, Math.PI * 2);
    else if (object.shape === "triangle") {
      context.moveTo(object.x + object.w / 2, object.y);
      context.lineTo(object.x, y2);
      context.lineTo(x2, y2);
      context.closePath();
    }
    else if (object.shape === "diamond") {
      context.moveTo(object.x + object.w / 2, object.y);
      context.lineTo(x2, object.y + object.h / 2);
      context.lineTo(object.x + object.w / 2, y2);
      context.lineTo(object.x, object.y + object.h / 2);
      context.closePath();
    }
    else if (object.shape === "sticky_note") {
      const fold = Math.min(28, Math.abs(object.w) / 4, Math.abs(object.h) / 4);
      context.moveTo(object.x, object.y);
      context.lineTo(x2 - fold, object.y);
      context.lineTo(x2, object.y + fold);
      context.lineTo(x2, y2);
      context.lineTo(object.x, y2);
      context.closePath();
      context.moveTo(x2 - fold, object.y);
      context.lineTo(x2 - fold, object.y + fold);
      context.lineTo(x2, object.y + fold);
    }
    else if (object.shape === "callout") {
      const tail = Math.min(32, Math.abs(object.w) / 4, Math.abs(object.h) / 3);
      const radius = Math.min(20, Math.abs(object.w) / 6, Math.abs(object.h) / 6);
      const bodyBottom = y2 - tail;
      context.moveTo(object.x + radius, object.y);
      context.lineTo(x2 - radius, object.y);
      context.quadraticCurveTo(x2, object.y, x2, object.y + radius);
      context.lineTo(x2, bodyBottom - radius);
      context.quadraticCurveTo(x2, bodyBottom, x2 - radius, bodyBottom);
      context.lineTo(object.x + object.w * 0.4, bodyBottom);
      context.lineTo(object.x + object.w * 0.16, y2);
      context.lineTo(object.x + object.w * 0.22, bodyBottom);
      context.lineTo(object.x + radius, bodyBottom);
      context.quadraticCurveTo(object.x, bodyBottom, object.x, bodyBottom - radius);
      context.lineTo(object.x, object.y + radius);
      context.quadraticCurveTo(object.x, object.y, object.x + radius, object.y);
      context.closePath();
    }
    else {
      context.moveTo(object.x, object.y);
      context.lineTo(x2, y2);
      if (object.shape === "arrow") drawArrowHead(context, object.x, object.y, x2, y2, Math.max(12, object.width * 5));
      if (object.shape === "bidirectional_arrow") {
        drawArrowHead(context, object.x, object.y, x2, y2, Math.max(12, object.width * 5));
        drawArrowHead(context, x2, y2, object.x, object.y, Math.max(12, object.width * 5));
      }
    }
    context.stroke();
  } else if (object.type === "text") {
    context.font = `${object.font_size}px "Nunito", "Yu Gothic UI", sans-serif`;
    context.textBaseline = "alphabetic";
    object.text.split("\n").forEach((line, index) => context.fillText(line, object.x, object.y + index * object.font_size * 1.3));
  } else {
    const image = sketchImage(object.data_url);
    if (image.complete && image.naturalWidth) {
      context.drawImage(image, object.x, object.y, object.w, object.h);
    } else if (onImageLoad) {
      image.addEventListener("load", onImageLoad, { once: true });
    }
  }
  context.restore();
}

export async function renderSketchPageToDataUrl(page: SketchPage, scale = 2): Promise<string> {
  await loadSketchImages(page);
  const canvas = document.createElement("canvas");
  canvas.width = page.width * scale;
  canvas.height = page.height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Sketch画像を作成できませんでした。");
  context.scale(scale, scale);
  drawSketchPage(context, page);
  return canvas.toDataURL("image/png");
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] || char);
}

export function sketchPageToSvg(page: SketchPage): string {
  const objects = page.objects.map((object) => {
    if (object.type === "stroke") {
      const points = object.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
      return `<polyline points="${points}" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${object.tool === "highlighter" ? 0.3 : 1}"/>`;
    }
    if (object.type === "shape") {
      if (object.shape === "rectangle") return `<rect x="${object.x}" y="${object.y}" width="${object.w}" height="${object.h}" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"/>`;
      if (object.shape === "rounded_rectangle") {
        const radius = Math.min(24, Math.abs(object.w) / 5, Math.abs(object.h) / 5);
        return `<rect x="${object.x}" y="${object.y}" width="${object.w}" height="${object.h}" rx="${radius}" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"/>`;
      }
      if (object.shape === "ellipse") return `<ellipse cx="${object.x + object.w / 2}" cy="${object.y + object.h / 2}" rx="${Math.abs(object.w / 2)}" ry="${Math.abs(object.h / 2)}" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"/>`;
      if (object.shape === "triangle") return `<polygon points="${object.x + object.w / 2},${object.y} ${object.x},${object.y + object.h} ${object.x + object.w},${object.y + object.h}" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"/>`;
      if (object.shape === "diamond") return `<polygon points="${object.x + object.w / 2},${object.y} ${object.x + object.w},${object.y + object.h / 2} ${object.x + object.w / 2},${object.y + object.h} ${object.x},${object.y + object.h / 2}" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"/>`;
      if (object.shape === "sticky_note") {
        const fold = Math.min(28, Math.abs(object.w) / 4, Math.abs(object.h) / 4);
        return `<path d="M ${object.x} ${object.y} H ${object.x + object.w - fold} L ${object.x + object.w} ${object.y + fold} V ${object.y + object.h} H ${object.x} Z M ${object.x + object.w - fold} ${object.y} V ${object.y + fold} H ${object.x + object.w}" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"/>`;
      }
      if (object.shape === "callout") {
        const tail = Math.min(32, Math.abs(object.w) / 4, Math.abs(object.h) / 3);
        const radius = Math.min(20, Math.abs(object.w) / 6, Math.abs(object.h) / 6);
        const bodyBottom = object.y + object.h - tail;
        return `<path d="M ${object.x + radius} ${object.y} H ${object.x + object.w - radius} Q ${object.x + object.w} ${object.y} ${object.x + object.w} ${object.y + radius} V ${bodyBottom - radius} Q ${object.x + object.w} ${bodyBottom} ${object.x + object.w - radius} ${bodyBottom} H ${object.x + object.w * 0.4} L ${object.x + object.w * 0.16} ${object.y + object.h} L ${object.x + object.w * 0.22} ${bodyBottom} H ${object.x + radius} Q ${object.x} ${bodyBottom} ${object.x} ${bodyBottom - radius} V ${object.y + radius} Q ${object.x} ${object.y} ${object.x + radius} ${object.y} Z" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"/>`;
      }
      const markerEnd = object.shape === "arrow" || object.shape === "bidirectional_arrow" ? ' marker-end="url(#arrow)"' : "";
      const markerStart = object.shape === "bidirectional_arrow" ? ' marker-start="url(#arrow-start)"' : "";
      return `<line x1="${object.x}" y1="${object.y}" x2="${object.x + object.w}" y2="${object.y + object.h}" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"${markerStart}${markerEnd}/>`;
    }
    if (object.type === "text") {
      const lines = object.text.split("\n").map((line, index) => (
        `<tspan x="${object.x}" dy="${index === 0 ? 0 : object.font_size * 1.3}">${escapeXml(line)}</tspan>`
      )).join("");
      return `<text x="${object.x}" y="${object.y}" fill="${escapeXml(object.color)}" font-family="Nunito, Yu Gothic UI, sans-serif" font-size="${object.font_size}">${lines}</text>`;
    }
    return `<image href="${escapeXml(object.data_url)}" x="${object.x}" y="${object.y}" width="${object.w}" height="${object.h}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker><marker id="arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto"><path d="M9,0 L9,6 L0,3 z" fill="context-stroke"/></marker></defs><rect width="100%" height="100%" fill="#fffdfb"/>${objects}</svg>`;
}

export function sketchAiPrompt(title: string): string {
  return `添付した手書きSketch「${title}」を読み取り、次の順で整理してください。\n1. 読み取れた文字・数式\n2. 図の構造と矢印の関係\n3. Markdownとして再構成した本文\n4. Mermaidで表現できる図があればコード\n5. 判読に自信がない箇所`;
}
