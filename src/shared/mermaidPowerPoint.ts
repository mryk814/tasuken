export const MERMAID_POWERPOINT_ACTIONS = ["copy-svg", "export-svg", "export-pptx"] as const;
export type MermaidPowerPointAction = (typeof MERMAID_POWERPOINT_ACTIONS)[number];

export type MermaidPptxNodeShape = "rectangle" | "rounded" | "circle" | "diamond";

export interface MermaidSvgClipboardRequest {
  svg: string;
}

export interface MermaidSvgClipboardResult {
  verified: boolean;
  formats: string[];
}

export interface MermaidPowerPointSvgExportRequest {
  title: string;
  svg: string;
}

export interface MermaidPowerPointSvgExportResult {
  canceled: boolean;
  filePath?: string;
}

export interface MermaidPptxNode {
  id: string;
  shape: MermaidPptxNodeShape;
  originalShape?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  fill: string;
  stroke: string;
}

export interface MermaidPptxEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  stroke: string;
  arrow: boolean;
}

export interface MermaidPptxSubgraph {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  fill: string;
  stroke: string;
}

export interface MermaidPptxDiagram {
  source: string;
  viewBoxX: number;
  viewBoxY: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
  nodes: MermaidPptxNode[];
  edges: MermaidPptxEdge[];
  subgraphs: MermaidPptxSubgraph[];
  warnings: string[];
}

export interface MermaidPowerPointPptxExportRequest {
  title: string;
  diagram: MermaidPptxDiagram;
}

export interface MermaidPowerPointPptxExportResult {
  canceled: boolean;
  filePath?: string;
  warnings: string[];
}

const MAX_SVG_CHARS = 1_000_000;
const MAX_SOURCE_CHARS = 100_000;
const SAFE_ID = /^[A-Za-z_][\w:.-]*$/;
const SAFE_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function validateOfficeSvg(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_SVG_CHARS) {
    throw new Error("PowerPoint用SVGは1〜100万文字にしてください。");
  }
  const svg = value.trim();
  if (!/^<svg(?:\s|>)/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
    throw new Error("完全なSVG文書を指定してください。");
  }
  if (/<!DOCTYPE|<!ENTITY|<!--|<\?|<script\b|<style\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|<image\b/i.test(svg)) {
    throw new Error("PowerPoint用SVGに実行可能要素、CSS、HTMLラベル、外部要素は使用できません。");
  }
  if (/\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=\s*["'](?!#)|url\s*\(\s*["']?(?!#)[^)]*\)|javascript\s*:/i.test(svg)) {
    throw new Error("PowerPoint用SVGにイベント、外部参照、実行可能なURLは使用できません。");
  }
  if (!/\bxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(svg)) {
    throw new Error("PowerPoint用SVGにSVG namespaceがありません。");
  }
  if (!/\bviewBox\s*=\s*["'][^"']+["']/i.test(svg)) {
    throw new Error("PowerPoint用SVGにviewBoxがありません。");
  }
  return svg;
}

function assertFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`PPTX変換データの${name}が不正です。`);
  }
}

function assertString(value: unknown, name: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`PPTX変換データの${name}が不正です。`);
  }
}

function assertColor(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_COLOR.test(value)) {
    throw new Error(`PPTX変換データの${name}が不正です。`);
  }
}

function assertBounds(value: { x: unknown; y: unknown; w: unknown; h: unknown }, name: string): void {
  assertFinite(value.x, `${name}.x`);
  assertFinite(value.y, `${name}.y`);
  assertFinite(value.w, `${name}.w`);
  assertFinite(value.h, `${name}.h`);
  if (value.w <= 0 || value.h <= 0 || Math.abs(value.x) > 100_000 || Math.abs(value.y) > 100_000 || value.w > 100_000 || value.h > 100_000) {
    throw new Error(`PPTX変換データの${name}の範囲が不正です。`);
  }
}

export function validateMermaidPptxDiagram(value: unknown): MermaidPptxDiagram {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MermaidのPPTX変換データが不正です。再度出力してください。");
  }
  const diagram = value as Partial<MermaidPptxDiagram>;
  assertString(diagram.source, "source", MAX_SOURCE_CHARS);
  assertFinite(diagram.viewBoxX, "viewBoxX");
  assertFinite(diagram.viewBoxY, "viewBoxY");
  assertFinite(diagram.viewBoxWidth, "viewBoxWidth");
  assertFinite(diagram.viewBoxHeight, "viewBoxHeight");
  if (Math.abs(diagram.viewBoxX) > 100_000 || Math.abs(diagram.viewBoxY) > 100_000 || diagram.viewBoxWidth <= 0 || diagram.viewBoxHeight <= 0 || diagram.viewBoxWidth > 100_000 || diagram.viewBoxHeight > 100_000) {
    throw new Error("MermaidのviewBox範囲が不正です。");
  }
  if (!Array.isArray(diagram.nodes) || diagram.nodes.length > 1_000 || !Array.isArray(diagram.edges) || diagram.edges.length > 2_000 || !Array.isArray(diagram.subgraphs) || diagram.subgraphs.length > 200 || !Array.isArray(diagram.warnings) || diagram.warnings.length > 200) {
    throw new Error("MermaidのPPTX変換要素数が不正です。");
  }
  for (const [index, nodeValue] of diagram.nodes.entries()) {
    if (!nodeValue || typeof nodeValue !== "object" || Array.isArray(nodeValue)) throw new Error("Mermaidのnodeが不正です。");
    const node = nodeValue as Partial<MermaidPptxNode>;
    assertString(node.id, `nodes[${index}].id`, 160);
    if (!SAFE_ID.test(node.id)) throw new Error("Mermaidのnode idが不正です。");
    if (!["rectangle", "rounded", "circle", "diamond"].includes(String(node.shape))) throw new Error("Mermaidのnode shapeが不正です。");
    assertBounds(node as MermaidPptxNode, `nodes[${index}]`);
    assertString(node.label, `nodes[${index}].label`, 4_000);
    assertColor(node.fill, `nodes[${index}].fill`);
    assertColor(node.stroke, `nodes[${index}].stroke`);
  }
  for (const [index, edgeValue] of diagram.edges.entries()) {
    if (!edgeValue || typeof edgeValue !== "object" || Array.isArray(edgeValue)) throw new Error("Mermaidのedgeが不正です。");
    const edge = edgeValue as Partial<MermaidPptxEdge>;
    assertString(edge.id, `edges[${index}].id`, 160);
    if (!SAFE_ID.test(edge.id)) throw new Error("Mermaidのedge idが不正です。");
    assertFinite(edge.x1, `edges[${index}].x1`);
    assertFinite(edge.y1, `edges[${index}].y1`);
    assertFinite(edge.x2, `edges[${index}].x2`);
    assertFinite(edge.y2, `edges[${index}].y2`);
    if ([edge.x1, edge.y1, edge.x2, edge.y2].some((coordinate) => typeof coordinate !== "number" || Math.abs(coordinate) > 100_000)) {
      throw new Error(`Mermaidのedge ${index + 1}の座標範囲が不正です。`);
    }
    assertString(edge.label || "", `edges[${index}].label`, 2_000);
    assertColor(edge.stroke, `edges[${index}].stroke`);
    if (typeof edge.arrow !== "boolean") throw new Error(`Mermaidのedge ${index + 1}のarrowが不正です。`);
  }
  for (const [index, subgraphValue] of diagram.subgraphs.entries()) {
    if (!subgraphValue || typeof subgraphValue !== "object" || Array.isArray(subgraphValue)) throw new Error("Mermaidのsubgraphが不正です。");
    const subgraph = subgraphValue as Partial<MermaidPptxSubgraph>;
    assertString(subgraph.id, `subgraphs[${index}].id`, 160);
    if (!SAFE_ID.test(subgraph.id)) throw new Error("Mermaidのsubgraph idが不正です。");
    assertBounds(subgraph as MermaidPptxSubgraph, `subgraphs[${index}]`);
    assertString(subgraph.label, `subgraphs[${index}].label`, 2_000);
    assertColor(subgraph.fill, `subgraphs[${index}].fill`);
    assertColor(subgraph.stroke, `subgraphs[${index}].stroke`);
  }
  for (const [index, warning] of diagram.warnings.entries()) assertString(warning, `warnings[${index}]`, 500);
  return diagram as MermaidPptxDiagram;
}
