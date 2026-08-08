import PptxGenJS from "pptxgenjs";

import { validateMermaidPptxDiagram, type MermaidPptxDiagram, type MermaidPptxNode } from "../../shared/mermaidPowerPoint";

const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;
const SLIDE_PADDING = 0.45;
const DEFAULT_FILL = "FFFDFB";
const DEFAULT_STROKE = "8A2F3B";
const FONT_FACE = "Yu Gothic UI";

function color(value: string): string {
  return value.replace(/^#/, "").toUpperCase();
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function slideTransform(diagram: MermaidPptxDiagram): { scale: number; x: number; y: number; viewBoxX: number; viewBoxY: number } {
  const width = finitePositive(diagram.viewBoxWidth, 1);
  const height = finitePositive(diagram.viewBoxHeight, 1);
  const scale = Math.min(
    (SLIDE_WIDTH - SLIDE_PADDING * 2) / width,
    (SLIDE_HEIGHT - SLIDE_PADDING * 2) / height,
  );
  return {
    scale,
    x: (SLIDE_WIDTH - width * scale) / 2,
    y: (SLIDE_HEIGHT - height * scale) / 2,
    viewBoxX: diagram.viewBoxX,
    viewBoxY: diagram.viewBoxY,
  };
}

function point(transform: ReturnType<typeof slideTransform>, x: number, y: number): { x: number; y: number } {
  return {
    x: transform.x + (x - transform.viewBoxX) * transform.scale,
    y: transform.y + (y - transform.viewBoxY) * transform.scale,
  };
}

function bounds(transform: ReturnType<typeof slideTransform>, item: { x: number; y: number; w: number; h: number }) {
  const topLeft = point(transform, item.x, item.y);
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: Math.max(0.05, item.w * transform.scale),
    h: Math.max(0.05, item.h * transform.scale),
  };
}

function nodeShape(pptx: PptxGenJS, node: MermaidPptxNode): PptxGenJS.ShapeType {
  switch (node.shape) {
    case "rounded":
      return pptx.ShapeType.roundRect;
    case "circle":
      return pptx.ShapeType.ellipse;
    case "diamond":
      return pptx.ShapeType.diamond;
    default:
      return pptx.ShapeType.rect;
  }
}

function addSubgraphs(pptx: PptxGenJS, slide: PptxGenJS.Slide, diagram: MermaidPptxDiagram, transform: ReturnType<typeof slideTransform>): void {
  for (const subgraph of diagram.subgraphs) {
    const box = bounds(transform, subgraph);
    slide.addShape(pptx.ShapeType.rect, {
      ...box,
      fill: { color: color(subgraph.fill), transparency: 72 },
      line: { color: color(subgraph.stroke), width: 1, dashType: "dash" },
      objectName: `Mermaid subgraph ${subgraph.id}`,
    });
    if (subgraph.label) {
      slide.addText(subgraph.label, {
        x: box.x + 0.06,
        y: box.y + 0.03,
        w: Math.max(0.4, box.w - 0.12),
        h: 0.22,
        fontFace: FONT_FACE,
        fontSize: 9,
        bold: true,
        color: color(subgraph.stroke),
        margin: 0,
        breakLine: false,
        fit: "shrink",
        objectName: `Mermaid subgraph label ${subgraph.id}`,
      });
    }
  }
}

function addEdges(pptx: PptxGenJS, slide: PptxGenJS.Slide, diagram: MermaidPptxDiagram, transform: ReturnType<typeof slideTransform>): void {
  // Edges are intentionally created before nodes so they remain behind the editable shapes.
  for (const edge of diagram.edges) {
    const start = point(transform, edge.x1, edge.y1);
    const end = point(transform, edge.x2, edge.y2);
    slide.addShape(pptx.ShapeType.line, {
      x: start.x,
      y: start.y,
      w: end.x - start.x,
      h: end.y - start.y,
      line: {
        color: color(edge.stroke),
        width: 1.25,
        endArrowType: edge.arrow ? "triangle" : "none",
      },
      objectName: `Mermaid edge ${edge.id}`,
    });
    if (edge.label) {
      const labelWidth = Math.max(0.35, Math.min(2.4, edge.label.length * 0.13));
      slide.addText(edge.label, {
        x: (start.x + end.x) / 2 - labelWidth / 2,
        y: (start.y + end.y) / 2 - 0.13,
        w: labelWidth,
        h: 0.26,
        fontFace: FONT_FACE,
        fontSize: 9,
        color: "554B46",
        fill: { color: DEFAULT_FILL, transparency: 5 },
        margin: 0.03,
        align: "center",
        valign: "middle",
        fit: "shrink",
        objectName: `Mermaid edge label ${edge.id}`,
      });
    }
  }
}

function addNodes(pptx: PptxGenJS, slide: PptxGenJS.Slide, diagram: MermaidPptxDiagram, transform: ReturnType<typeof slideTransform>): void {
  for (const node of diagram.nodes) {
    const box = bounds(transform, node);
    slide.addShape(nodeShape(pptx, node), {
      ...box,
      fill: { color: color(node.fill || `#${DEFAULT_FILL}`) },
      line: { color: color(node.stroke || `#${DEFAULT_STROKE}`), width: 1.25 },
      objectName: `Mermaid node ${node.id}`,
    });
    slide.addText(node.label, {
      ...box,
      fontFace: FONT_FACE,
      fontSize: 13,
      color: "211E1D",
      margin: 0.08,
      align: "center",
      valign: "middle",
      fit: "shrink",
      breakLine: false,
      objectName: `Mermaid node label ${node.id}`,
    });
  }
}

export async function buildMermaidPptxBuffer(value: unknown, title: string): Promise<Buffer> {
  const diagram = validateMermaidPptxDiagram(value);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Tasken";
  pptx.company = "Tasken";
  pptx.subject = "Mermaid flowchart";
  pptx.title = title.slice(0, 200) || "Mermaid flowchart";

  const slide = pptx.addSlide();
  slide.background = { color: DEFAULT_FILL };
  const transform = slideTransform(diagram);
  addEdges(pptx, slide, diagram, transform);
  addSubgraphs(pptx, slide, diagram, transform);
  addNodes(pptx, slide, diagram, transform);
  slide.addNotes(`[Sources]\n- Tasken Mermaid source (embedded for traceability)\n\n${diagram.source.slice(0, 100_000)}\n\n[Conversion]\n- Mermaid computed SVG viewBox was scaled to a 16:9 slide.\n- Native shapes are a flowchart MVP; warnings: ${diagram.warnings.join(" / ") || "none"}`);

  const output = await pptx.write({ outputType: "nodebuffer" });
  if (!(output instanceof Uint8Array)) throw new Error("PPTXバイナリを作成できませんでした。");
  return Buffer.from(output);
}
