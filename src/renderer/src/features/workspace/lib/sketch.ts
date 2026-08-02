export type SketchTool = "select" | "lasso" | "pen" | "highlighter" | "eraser" | "shape" | "arrow" | "text" | "image" | "pan";
export type SketchBackground = "plain" | "dot" | "grid";

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
  shape: "rectangle" | "ellipse" | "line" | "arrow";
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

const DEFAULT_PAGE_WIDTH = 1200;
const DEFAULT_PAGE_HEIGHT = 850;

export function createSketchPage(title = "1"): SketchPage {
  return {
    id: crypto.randomUUID(),
    title,
    width: DEFAULT_PAGE_WIDTH,
    height: DEFAULT_PAGE_HEIGHT,
    background: "dot",
    objects: [],
  };
}

export function createEmptySketchDocument(): SketchDocument {
  return { schema_version: 1, pages: [createSketchPage()] };
}

export function createSketchDraft(title = "新しいSketch", projectId: string | null = null, originCaptureId: string | null = null) {
  return {
    id: crypto.randomUUID(),
    title,
    project_id: projectId,
    origin_capture_id: originCaptureId,
    document: createEmptySketchDocument(),
  };
}

export function cloneSketchDocument(document: SketchDocument): SketchDocument {
  return structuredClone(document);
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
    return { x: object.x, y: object.y - object.font_size, w: Math.max(36, object.text.length * object.font_size * 0.72), h: object.font_size * 1.4 };
  }
  return { x: Math.min(object.x, object.x + object.w), y: Math.min(object.y, object.y + object.h), w: Math.abs(object.w), h: Math.abs(object.h) };
}

export function boundsContainPoint(bounds: SketchBounds, point: Pick<SketchPoint, "x" | "y">, padding = 8): boolean {
  return point.x >= bounds.x - padding
    && point.x <= bounds.x + bounds.w + padding
    && point.y >= bounds.y - padding
    && point.y <= bounds.y + bounds.h + padding;
}

export function hitTest(objects: SketchObject[], point: Pick<SketchPoint, "x" | "y">): SketchObject | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    if (boundsContainPoint(objectBounds(objects[index]), point)) return objects[index];
  }
  return null;
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
  options: { selectedIds?: string[]; draftPoints?: SketchPoint[]; lassoPoints?: SketchPoint[] } = {},
) {
  context.clearRect(0, 0, page.width, page.height);
  context.fillStyle = "#fffdfb";
  context.fillRect(0, 0, page.width, page.height);

  if (page.background !== "plain") {
    context.fillStyle = "#dccfd0";
    context.strokeStyle = "#eadfe0";
    context.lineWidth = 1;
    for (let x = 24; x < page.width; x += 24) {
      for (let y = 24; y < page.height; y += 24) {
        if (page.background === "dot") {
          context.beginPath();
          context.arc(x, y, 1.1, 0, Math.PI * 2);
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
      for (let y = 24; y < page.height; y += 24) {
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
  if (options.draftPoints?.length) {
    drawSketchObject(context, { id: "draft", type: "stroke", tool: "pen", color: "#8A2F3B", width: 2, points: options.draftPoints });
  }
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
    for (const [x, y] of [[bounds.x - 6, bounds.y - 6], [bounds.x + bounds.w + 6, bounds.y + bounds.h + 6]]) {
      context.fillRect(x - 5, y - 5, 10, 10);
      context.strokeRect(x - 5, y - 5, 10, 10);
    }
    context.restore();
  }
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
    if (object.points.length < 2) {
      const point = object.points[0];
      if (point) {
        context.beginPath();
        context.arc(point.x, point.y, object.width / 2, 0, Math.PI * 2);
        context.fill();
      }
    } else {
      context.globalAlpha = object.tool === "highlighter" ? 0.3 : 1;
      context.beginPath();
      context.moveTo(object.points[0].x, object.points[0].y);
      for (let index = 1; index < object.points.length; index += 1) {
        const point = object.points[index];
        context.lineWidth = object.width * (object.tool === "pen" ? 0.65 + point.pressure * 0.7 : 1);
        context.lineTo(point.x, point.y);
      }
      context.stroke();
    }
  } else if (object.type === "shape") {
    context.lineWidth = object.width;
    const x2 = object.x + object.w;
    const y2 = object.y + object.h;
    context.beginPath();
    if (object.shape === "rectangle") context.rect(object.x, object.y, object.w, object.h);
    else if (object.shape === "ellipse") context.ellipse(object.x + object.w / 2, object.y + object.h / 2, Math.abs(object.w / 2), Math.abs(object.h / 2), 0, 0, Math.PI * 2);
    else {
      context.moveTo(object.x, object.y);
      context.lineTo(x2, y2);
      if (object.shape === "arrow") drawArrowHead(context, object.x, object.y, x2, y2, Math.max(12, object.width * 5));
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
      if (object.shape === "ellipse") return `<ellipse cx="${object.x + object.w / 2}" cy="${object.y + object.h / 2}" rx="${Math.abs(object.w / 2)}" ry="${Math.abs(object.h / 2)}" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"/>`;
      const marker = object.shape === "arrow" ? ' marker-end="url(#arrow)"' : "";
      return `<line x1="${object.x}" y1="${object.y}" x2="${object.x + object.w}" y2="${object.y + object.h}" stroke="${escapeXml(object.color)}" stroke-width="${object.width}"${marker}/>`;
    }
    if (object.type === "text") return `<text x="${object.x}" y="${object.y}" fill="${escapeXml(object.color)}" font-family="Nunito, Yu Gothic UI, sans-serif" font-size="${object.font_size}">${escapeXml(object.text)}</text>`;
    return `<image href="${escapeXml(object.data_url)}" x="${object.x}" y="${object.y}" width="${object.w}" height="${object.h}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker></defs><rect width="100%" height="100%" fill="#fffdfb"/>${objects}</svg>`;
}

export function sketchAiPrompt(title: string): string {
  return `添付した手書きSketch「${title}」を読み取り、次の順で整理してください。\n1. 読み取れた文字・数式\n2. 図の構造と矢印の関係\n3. Markdownとして再構成した本文\n4. Mermaidで表現できる図があればコード\n5. 判読に自信がない箇所`;
}
