import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import AdmZip from "adm-zip";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const outDir = mkdtempSync(path.join(tmpdir(), "tasken-pptx-test-"));
  const outfile = path.join(outDir, "bundle.mjs");
  await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const shared = await importBundled("src/shared/mermaidPowerPoint.ts");
const renderer = await importBundled("src/renderer/src/features/workspace/lib/mermaidPowerPoint.ts");
const pptx = await importBundled("src/main/services/mermaidPowerPointService.ts");

const diagram = {
  source: "flowchart TD\n  A[入力] -->|承認| B{判断}",
  viewBoxX: 0,
  viewBoxY: 0,
  viewBoxWidth: 400,
  viewBoxHeight: 240,
  nodes: [
    { id: "A", shape: "rectangle", x: 20, y: 80, w: 120, h: 50, label: "入力", fill: "#FFFDFB", stroke: "#8A2F3B" },
    { id: "B", shape: "diamond", x: 250, y: 80, w: 120, h: 70, label: "判断", fill: "#FFFDFB", stroke: "#8A2F3B" },
  ],
  edges: [{ id: "edge-1", x1: 140, y1: 105, x2: 250, y2: 115, label: "承認", stroke: "#8A2F3B", arrow: true }],
  subgraphs: [],
  warnings: [],
};

test("Office SVG validation rejects executable, external, and CSS content while retaining Japanese text contracts", () => {
  const safe = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><defs><marker id="arrow" /></defs><path marker-end="url(#arrow)" d="M 1 2 L 90 50" /><text>判断</text></svg>';
  assert.equal(shared.validateOfficeSvg(safe), safe);
  for (const unsafe of [
    safe.replace("<text>", '<script>alert(1)</script><text>'),
    safe.replace("<text>", '<foreignObject><div>x</div></foreignObject><text>'),
    safe.replace("<text>", '<text onclick="alert(1)">'),
    safe.replace("<text>", '<text href="https://example.com">'),
    safe.replace("<text>", '<style>.x{fill:red}</style><text>'),
  ]) assert.throws(() => shared.validateOfficeSvg(unsafe));
});

test("edge labels are matched by stable path/group id before DOM order", () => {
  assert.deepEqual(
    renderer.matchMermaidEdgeLabels(
      ["path-2", "path-1", null],
      ["group-2", "group-1", "group-3"],
      [
        { id: "path-1", text: "承認" },
        { id: null, text: "却下" },
        { id: "group-3", text: "再試行" },
      ],
    ),
    ["却下", "承認", "再試行"],
  );
  assert.equal(shared.validateMermaidPptxDiagram(diagram).edges[0].label, "承認");
});

test("native PPTX output contains editable edge label, node text, notes, and slide relationships", async () => {
  const buffer = await pptx.buildMermaidPptxBuffer(diagram, "日本語 Mermaid");
  assert.ok(buffer.byteLength > 1_000);
  const zip = new AdmZip(buffer);
  const names = zip.getEntries().map((entry) => entry.entryName);
  assert.ok(names.includes("[Content_Types].xml"));
  assert.ok(names.includes("ppt/presentation.xml"));
  assert.ok(names.includes("ppt/slides/slide1.xml"));
  assert.ok(names.includes("ppt/slides/_rels/slide1.xml.rels"));
  const slideXml = zip.readAsText("ppt/slides/slide1.xml");
  assert.match(slideXml, /承認/);
  assert.match(slideXml, /入力/);
  assert.match(slideXml, /Mermaid edge label edge-1/);
  assert.match(slideXml, /Mermaid node A/);
  assert.ok(slideXml.indexOf("Mermaid edge edge-1") < slideXml.indexOf("Mermaid node A"));
  const notesXml = zip.readAsText("ppt/notesSlides/notesSlide1.xml");
  assert.match(notesXml, /flowchart TD/);
  assert.match(notesXml, /承認/);
});

test("native PPTX transform honors negative Mermaid viewBox origins", async () => {
  const negativeOriginDiagram = {
    ...diagram,
    viewBoxX: -1_000,
    viewBoxY: -500,
    viewBoxWidth: 100,
    viewBoxHeight: 80,
    nodes: [
      { ...diagram.nodes[0], x: -995, y: -495, w: 20, h: 15 },
      { ...diagram.nodes[1], x: -920, y: -490, w: 20, h: 20 },
    ],
    edges: [{ ...diagram.edges[0], x1: -975, y1: -487, x2: -920, y2: -480 }],
  };
  const buffer = await pptx.buildMermaidPptxBuffer(negativeOriginDiagram, "negative origin");
  const slideXml = new AdmZip(buffer).readAsText("ppt/slides/slide1.xml");
  assert.doesNotMatch(slideXml, /<a:off x="-/);
  assert.doesNotMatch(slideXml, /<a:off y="-/);
  assert.equal(shared.validateMermaidPptxDiagram(negativeOriginDiagram).viewBoxX, -1_000);
});

test("PPTX diagram validation bounds edge coordinates and requires arrow boolean", () => {
  assert.throws(() => shared.validateMermaidPptxDiagram({ ...diagram, edges: [{ ...diagram.edges[0], x1: 100_001 }] }));
  assert.throws(() => shared.validateMermaidPptxDiagram({ ...diagram, edges: [{ ...diagram.edges[0], arrow: "true" }] }));
});

test("multiple Mermaid blocks keep visible routing attributes and unsupported native capability explicit", () => {
  const previewSource = readFileSync("src/renderer/src/features/workspace/components/MarkdownPreview.tsx", "utf8");
  const pageSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(previewSource, /dataset\.mermaidBlockId/);
  assert.match(previewSource, /if \(hasMermaidAction\)/);
  assert.match(previewSource, /if \(!mermaidActionRef\.current\) return/);
  assert.match(previewSource, /dataset\.mermaidSource/);
  assert.match(previewSource, /const MarkdownPreviewContent = memo\(forwardRef/);
  assert.match(previewSource, /ResizeObserver/);
  assert.match(previewSource, /return previous;/);
  assert.match(previewSource, /aria-controls/);
  assert.match(previewSource, /openMermaidMenu\(blockId, source, event\.currentTarget\)/);
  assert.match(pageSource, /blockId: string; source: string/);
  assert.match(pageSource, /extractMermaidPptxDiagram\(svg, request\.source\)/);
  assert.deepEqual(renderer.mermaidPowerPointCapabilities("sequenceDiagram\n  A->>B: 日本語"), {
    nativePptx: false,
    reason: "ネイティブPPTXはflowchart / graphだけに対応しています。",
  });
});
