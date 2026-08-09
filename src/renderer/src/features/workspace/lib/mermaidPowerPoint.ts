import {
  validateOfficeSvg,
  type MermaidPptxDiagram,
  type MermaidPptxEdge,
  type MermaidPptxNode,
  type MermaidPptxNodeShape,
  type MermaidPptxSubgraph,
} from "../../../../../shared/mermaidPowerPoint";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const DEFAULT_FILL = "#FFFDFB";
const DEFAULT_STROKE = "#8A2F3B";
const DEFAULT_SUBGRAPH_FILL = "#F6F1ED";
const DEFAULT_SUBGRAPH_STROKE = "#746A65";

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
type Point = { x: number; y: number };
type Bounds = { x: number; y: number; w: number; h: number };

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function apply(matrix: Matrix, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function numberList(value: string | null): number[] {
  return value ? [...value.matchAll(/-?(?:\d+\.?\d*|\.\d+)/g)].map((match) => Number(match[0])).filter(Number.isFinite) : [];
}

function parseTransform(value: string | null): Matrix {
  if (!value) return IDENTITY;
  let result = IDENTITY;
  for (const match of value.matchAll(/(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g)) {
    const values = numberList(match[2]);
    let next = IDENTITY;
    if (match[1] === "matrix" && values.length >= 6) next = { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] };
    if (match[1] === "translate" && values.length >= 1) next = { ...IDENTITY, e: values[0], f: values[1] || 0 };
    if (match[1] === "scale" && values.length >= 1) next = { ...IDENTITY, a: values[0], d: values[1] ?? values[0] };
    if (match[1] === "rotate" && values.length >= 1) {
      const radians = values[0] * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      next = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
    }
    result = multiply(result, next);
  }
  return result;
}

function elementMatrix(element: Element, root: Element): Matrix {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current && current !== root.parentElement) {
    chain.unshift(current);
    current = current.parentElement;
  }
  return chain.reduce((matrix, item) => multiply(matrix, parseTransform(item.getAttribute("transform"))), IDENTITY);
}

function boundsFromPoints(points: Point[]): Bounds | null {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(0.01, Math.max(...xs) - x), h: Math.max(0.01, Math.max(...ys) - y) };
}

function shapeBounds(shape: Element, root: Element): Bounds | null {
  const localName = shape.localName.toLowerCase();
  let points: Point[] = [];
  if (localName === "rect") {
    const x = Number(shape.getAttribute("x") || 0);
    const y = Number(shape.getAttribute("y") || 0);
    const w = Number(shape.getAttribute("width") || 0);
    const h = Number(shape.getAttribute("height") || 0);
    points = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  } else if (localName === "circle") {
    const cx = Number(shape.getAttribute("cx") || 0);
    const cy = Number(shape.getAttribute("cy") || 0);
    const r = Number(shape.getAttribute("r") || 0);
    points = [{ x: cx - r, y: cy - r }, { x: cx + r, y: cy + r }];
  } else if (localName === "ellipse") {
    const cx = Number(shape.getAttribute("cx") || 0);
    const cy = Number(shape.getAttribute("cy") || 0);
    const rx = Number(shape.getAttribute("rx") || 0);
    const ry = Number(shape.getAttribute("ry") || 0);
    points = [{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy + ry }];
  } else if (localName === "polygon" || localName === "polyline") {
    const values = numberList(shape.getAttribute("points"));
    points = Array.from({ length: Math.floor(values.length / 2) }, (_, index) => ({ x: values[index * 2], y: values[index * 2 + 1] }));
  } else if (localName === "path") {
    return measuredShapeBounds(shape);
  }
  const matrix = elementMatrix(shape, root);
  return boundsFromPoints(points.map((point) => apply(matrix, point)));
}

function measuredShapeBounds(shape: Element): Bounds | null {
  try {
    const graphics = shape as SVGGraphicsElement;
    const box = graphics.getBBox();
    const ctm = graphics.getCTM();
    if (!ctm || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) return null;
    const matrix: Matrix = { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f };
    return boundsFromPoints([
      apply(matrix, { x: box.x, y: box.y }),
      apply(matrix, { x: box.x + box.width, y: box.y }),
      apply(matrix, { x: box.x + box.width, y: box.y + box.height }),
      apply(matrix, { x: box.x, y: box.y + box.height }),
    ]);
  } catch {
    return null;
  }
}

function parseStyle(value: string | null): Map<string, string> {
  const result = new Map<string, string>();
  for (const declaration of (value || "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (name && propertyValue) result.set(name, propertyValue);
  }
  return result;
}

function serializeStyle(style: Map<string, string>): string {
  return [...style.entries()].map(([name, value]) => `${name}:${value}`).join(";");
}

function applyCssRules(root: SVGSVGElement): void {
  const rules: Array<{ selectors: string; declarations: string }> = [];
  for (const style of Array.from(root.querySelectorAll("style"))) {
    for (const match of style.textContent?.matchAll(/([^{}]+)\{([^{}]*)\}/g) || []) {
      rules.push({ selectors: match[1].trim(), declarations: match[2] });
    }
    style.remove();
  }
  const stylesheetStyles = new Map<Element, Map<string, string>>();
  for (const rule of rules) {
    const declarations = parseStyle(rule.declarations);
    if (!declarations.size) continue;
    for (const selector of rule.selectors.split(",").map((item) => item.trim()).filter(Boolean)) {
      try {
        const elements = [
          ...(root.matches(selector) ? [root] : []),
          ...Array.from(root.querySelectorAll(selector)),
        ];
        for (const element of elements) {
          if (!(element instanceof Element)) continue;
          const current = stylesheetStyles.get(element) || new Map<string, string>();
          for (const [name, value] of declarations) current.set(name, value);
          stylesheetStyles.set(element, current);
        }
      } catch {
        // Mermaid can emit selectors for browser-only interaction states. They are not needed in a static Office export.
      }
    }
  }
  const variables = new Map<string, string>();
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    const merged = new Map(stylesheetStyles.get(element) || []);
    for (const [name, value] of parseStyle(element.getAttribute("style"))) {
      // Inline declarations are intentionally applied after stylesheet rules.
      merged.set(name, value);
    }
    for (const [name, value] of merged) {
      if (name.startsWith("--")) variables.set(name, value);
    }
  }
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    const style = new Map(stylesheetStyles.get(element) || []);
    for (const [name, value] of parseStyle(element.getAttribute("style"))) style.set(name, value);
    for (const [name, value] of style) {
      style.set(name, value.replace(/var\(\s*(--[\w-]+)(?:\s*,\s*([^)]*))?\)/g, (_match, variable: string, fallback: string) => variables.get(variable) || fallback || ""));
    }
    if (style.size) element.setAttribute("style", serializeStyle(style));
  }
}

function normalizeIds(root: SVGSVGElement): void {
  const seen = new Map<string, string>();
  const used = new Set<string>();
  for (const element of [root, ...Array.from(root.querySelectorAll("[id]"))]) {
    const original = element.getAttribute("id");
    if (!original) continue;
    const base = original.replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/^[^A-Za-z_]+/, "_") || "svg-id";
    let next = base;
    let suffix = 2;
    while (used.has(next)) next = `${base}-${suffix++}`;
    used.add(next);
    if (!seen.has(original)) seen.set(original, next);
    element.setAttribute("id", next);
  }
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      const updated = attribute.value
        .replace(/url\(\s*#([^\s)]+)\s*\)/g, (_match, id: string) => `url(#${seen.get(id) || id})`)
        .replace(/^#([^\s]+)$/, (_match, id: string) => seen.get(id) ? `#${seen.get(id)}` : `#${id}`);
      if (updated !== attribute.value) element.setAttribute(attribute.name, updated);
    }
  }
}

export function normalizeMermaidOfficeSvg(input: string): string {
  const document = new DOMParser().parseFromString(input, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg" || document.querySelector("parsererror")) {
    throw new Error("MermaidのSVGを解析できませんでした。図を再描画してから試してください。");
  }
  applyCssRules(root as unknown as SVGSVGElement);
  for (const element of Array.from(root.querySelectorAll("script,foreignObject,iframe,object,embed,image,style"))) element.remove();
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "src") element.removeAttribute(attribute.name);
      else if ((name === "href" || name === "xlink:href") && value && !value.startsWith("#")) element.removeAttribute(attribute.name);
      else if ((name === "filter" || name === "mask") && value) element.removeAttribute(attribute.name);
      else if (/url\(\s*["']?(?!#)[^)]*\)/i.test(value)) element.removeAttribute(attribute.name);
      else if (name === "style" && /(?:javascript:|url\(\s*["']?(?!#)[^)]*\))/i.test(value)) element.removeAttribute(attribute.name);
    }
  }
  const viewBox = numberList(root.getAttribute("viewBox"));
  const width = viewBox.length >= 4 && viewBox[2] > 0 ? viewBox[2] : Number(root.getAttribute("width"));
  const height = viewBox.length >= 4 && viewBox[3] > 0 ? viewBox[3] : Number(root.getAttribute("height"));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("MermaidのSVGサイズを確定できませんでした。");
  root.setAttribute("xmlns", SVG_NAMESPACE);
  root.setAttribute("viewBox", viewBox.length >= 4 ? viewBox.slice(0, 4).join(" ") : `0 0 ${width} ${height}`);
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  normalizeIds(root as unknown as SVGSVGElement);
  const svg = new XMLSerializer().serializeToString(root);
  return validateOfficeSvg(svg);
}

function colorFrom(value: string | null, fallback: string): string {
  const raw = (value || "").trim().toLowerCase();
  if (!raw || raw === "none" || raw === "transparent") return fallback;
  const hex = raw.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 || hex.length === 4 ? [...hex.slice(0, 3)].map((part) => part + part).join("") : hex.slice(0, 6);
    return `#${expanded.toUpperCase()}`;
  }
  const rgb = raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  const named: Record<string, string> = { black: "#000000", white: "#FFFFFF", red: "#FF0000", blue: "#0000FF", gray: "#808080", grey: "#808080" };
  return named[raw] || fallback;
}

function styleValue(element: Element, name: string): string | null {
  const direct = element.getAttribute(name);
  if (direct) return direct;
  return parseStyle(element.getAttribute("style")).get(name) || null;
}

function textValue(element: Element | null): string {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
}

function sourceIsFlowchart(source: string): boolean {
  return /(?:^|\n)\s*(?:%%[^\n]*\n\s*)*(?:flowchart|graph)\b/i.test(source);
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

export function matchMermaidEdgeLabels(
  edgePathIds: readonly (string | null)[],
  edgeGroupIds: readonly (string | null)[],
  labels: readonly { id: string | null; text: string }[],
): Array<string | undefined> {
  const assigned: Array<string | undefined> = Array.from({ length: edgePathIds.length });
  const consumedLabelIndexes = new Set<number>();
  for (const [edgeIndex, pathId] of edgePathIds.entries()) {
    const groupId = edgeGroupIds[edgeIndex];
    const labelIndex = labels.findIndex((label, index) => {
      if (consumedLabelIndexes.has(index) || !label.id) return false;
      return label.id === pathId || label.id === groupId;
    });
    if (labelIndex < 0) continue;
    consumedLabelIndexes.add(labelIndex);
    assigned[edgeIndex] = labels[labelIndex].text.trim() || undefined;
  }
  let nextDomLabelIndex = 0;
  for (const [edgeIndex] of edgePathIds.entries()) {
    if (assigned[edgeIndex]) continue;
    while (nextDomLabelIndex < labels.length && consumedLabelIndexes.has(nextDomLabelIndex)) nextDomLabelIndex += 1;
    if (nextDomLabelIndex >= labels.length) break;
    consumedLabelIndexes.add(nextDomLabelIndex);
    assigned[edgeIndex] = labels[nextDomLabelIndex].text.trim() || undefined;
    nextDomLabelIndex += 1;
  }
  return assigned;
}

function classifyNodeShape(shape: Element, warnings: string[]): MermaidPptxNodeShape {
  const localName = shape.localName.toLowerCase();
  if (localName === "rect") return Number(shape.getAttribute("rx") || 0) > 0 || Number(shape.getAttribute("ry") || 0) > 0 ? "rounded" : "rectangle";
  if (localName === "circle" || localName === "ellipse") return "circle";
  if (localName === "polygon" && numberList(shape.getAttribute("points")).length === 8) return "diamond";
  addWarning(warnings, `未対応のnode shape (${localName})はrectangleへ近似しました。`);
  return "rectangle";
}

function pathEndpoints(path: Element, root: Element): { start: Point; end: Point } | null {
  const values = numberList(path.getAttribute("d"));
  if (values.length < 4) return null;
  const start = { x: values[0], y: values[1] };
  const end = { x: values[values.length - 2], y: values[values.length - 1] };
  const matrix = elementMatrix(path, root);
  return { start: apply(matrix, start), end: apply(matrix, end) };
}

function parseViewBox(root: SVGSVGElement): { x: number; y: number; width: number; height: number } {
  const values = numberList(root.getAttribute("viewBox"));
  if (values.length < 4 || values[2] <= 0 || values[3] <= 0) throw new Error("MermaidのviewBoxを取得できませんでした。");
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

export function extractMermaidPptxDiagram(svg: string, source: string): MermaidPptxDiagram {
  const officeSvg = validateOfficeSvg(svg);
  const document = new DOMParser().parseFromString(officeSvg, "image/svg+xml");
  const root = document.documentElement as unknown as SVGSVGElement;
  const { x: viewBoxX, y: viewBoxY, width, height } = parseViewBox(root);
  const warnings: string[] = [];
  if (!sourceIsFlowchart(source)) addWarning(warnings, "ネイティブPPTXはflowchart / graphだけに対応しています。SVG出力を利用してください。");

  const nodes: MermaidPptxNode[] = [];
  for (const [index, group] of Array.from(root.querySelectorAll("g.node")).entries()) {
    const shape = group.querySelector("rect,circle,ellipse,polygon,path");
    const shapeName = shape?.localName.toLowerCase();
    if (shapeName && !["rect", "circle", "ellipse", "polygon"].includes(shapeName)) {
      addWarning(warnings, `未対応のnode shape (${shapeName})はDOMの実測bboxを優先し、取得できない場合はPPTX nodeを省略します。`);
    }
    const nodeBounds = shape ? shapeBounds(shape, root) : null;
    if (!shape || !nodeBounds) {
      addWarning(warnings, `node ${index + 1} の図形を取得できませんでした。`);
      continue;
    }
    const nodeShape = classifyNodeShape(shape, warnings);
    const label = textValue(group.querySelector("text")) || textValue(group.querySelector(".label"));
    const id = (group.getAttribute("id") || `node-${index + 1}`).replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/^[^A-Za-z_]+/, "_");
    nodes.push({
      id,
      shape: nodeShape,
      originalShape: shape.localName,
      ...nodeBounds,
      label,
      fill: colorFrom(styleValue(shape, "fill"), DEFAULT_FILL),
      stroke: colorFrom(styleValue(shape, "stroke"), DEFAULT_STROKE),
    });
  }

  const edges: MermaidPptxEdge[] = [];
  const edgePaths = Array.from(root.querySelectorAll("g.edgePath path, g.edgePaths path"));
  const edgeLabels = Array.from(root.querySelectorAll("g.edgeLabels g.edgeLabel, g.edgeLabel"));
  const edgeLabelValues = matchMermaidEdgeLabels(
    edgePaths.map((path) => path.getAttribute("id")),
    edgePaths.map((path) => path.closest("g.edgePath, g.edgePaths")?.getAttribute("id") || null),
    edgeLabels.map((label) => ({ id: label.getAttribute("id"), text: textValue(label.querySelector("text") || label) })),
  );
  for (const [index, path] of edgePaths.entries()) {
    if (/[cCsSqQtTaA]/.test(path.getAttribute("d") || "")) {
      addWarning(warnings, `edge ${index + 1} の曲線/arcをPowerPointでは直線へ近似しました。`);
    }
    const endpoints = pathEndpoints(path, root);
    if (!endpoints) {
      addWarning(warnings, `edge ${index + 1} の曲線を直線へ変換できませんでした。`);
      continue;
    }
    const group = path.closest("g.edgePath, g.edgePaths");
    const id = (path.getAttribute("id") || group?.getAttribute("id") || `edge-${index + 1}`).replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/^[^A-Za-z_]+/, "_");
    edges.push({
      id,
      x1: endpoints.start.x,
      y1: endpoints.start.y,
      x2: endpoints.end.x,
      y2: endpoints.end.y,
      stroke: colorFrom(styleValue(path, "stroke"), DEFAULT_STROKE),
      arrow: Boolean(path.getAttribute("marker-end")),
      label: edgeLabelValues[index],
    });
  }

  const subgraphs: MermaidPptxSubgraph[] = [];
  for (const [index, group] of Array.from(root.querySelectorAll("g.cluster")).entries()) {
    const shape = group.querySelector("rect");
    const clusterBounds = shape ? shapeBounds(shape, root) : null;
    if (!shape || !clusterBounds) continue;
    subgraphs.push({
      id: (group.getAttribute("id") || `subgraph-${index + 1}`).replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/^[^A-Za-z_]+/, "_"),
      ...clusterBounds,
      label: textValue(group.querySelector("text")),
      fill: colorFrom(styleValue(shape, "fill"), DEFAULT_SUBGRAPH_FILL),
      stroke: colorFrom(styleValue(shape, "stroke"), DEFAULT_SUBGRAPH_STROKE),
    });
  }

  if (sourceIsFlowchart(source) && !nodes.length) addWarning(warnings, "flowchartのnodeを取得できませんでした。SVGを書き出してください。");
  return { source, viewBoxX, viewBoxY, viewBoxWidth: width, viewBoxHeight: height, nodes, edges, subgraphs, warnings };
}

export function mermaidPowerPointCapabilities(source: string): { nativePptx: boolean; reason?: string } {
  return sourceIsFlowchart(source)
    ? { nativePptx: true }
    : { nativePptx: false, reason: "ネイティブPPTXはflowchart / graphだけに対応しています。" };
}
