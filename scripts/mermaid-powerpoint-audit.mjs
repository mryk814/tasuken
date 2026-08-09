import { _electron as electron } from "playwright";
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outputDirectory = path.resolve(process.argv[2] || "audit-shots/mermaid-powerpoint");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "tasken-mermaid-powerpoint-audit-"));
const userDataDirectory = path.join(tempRoot, "userData");
const browserBundlePath = path.join(tempRoot, "mermaid-powerpoint-browser.mjs");
const nodeBundlePath = path.join(tempRoot, "mermaid-powerpoint-node.mjs");
const noteTitle = "#284 Mermaid PowerPoint audit";

mkdirSync(outputDirectory, { recursive: true });

await build({
  entryPoints: ["src/renderer/src/features/workspace/lib/mermaidPowerPoint.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "TaskenMermaidPowerPoint",
  outfile: browserBundlePath,
  logLevel: "silent",
});
await build({
  entryPoints: ["src/main/services/mermaidPowerPointService.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: nodeBundlePath,
  logLevel: "silent",
});
const browserBundle = readFileSync(browserBundlePath, "utf8");
const { buildMermaidPptxBuffer } = await import(pathToFileURL(nodeBundlePath).href);
let flowchartClipboardSvg = "";
let sequenceClipboardSvg = "";

function assertOfficeSvgText(svg, expectedText, name) {
  if (/<(?:foreignObject|script|style)\b/i.test(svg)) throw new Error(`${name} clipboard SVG retained a forbidden element.`);
  if (!/<(?:text|tspan)\b/i.test(svg) || !expectedText.every((text) => svg.includes(text))) {
    throw new Error(`${name} clipboard SVG did not retain Japanese text/tspan content.`);
  }
}

const flowchartSource = [
  "flowchart TD",
  "  A[入力] -->|承認| B{判断}",
  "  B --> C(完了)",
].join("\n");
const sequenceSource = [
  "sequenceDiagram",
  "  利用者->>Tasken: 日本語通知",
].join("\n");
const auditMarkdown = [
  "# Mermaid PowerPoint audit",
  "",
  "```mermaid",
  flowchartSource,
  "```",
  "",
  "```mermaid",
  flowchartSource.replace("flowchart TD", "graph TD"),
  "```",
  "",
  "```mermaid",
  sequenceSource,
  "```",
].join("\n");

const app = await electron.launch({
  args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userDataDirectory}`],
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
  await page.evaluate(async ({ title, body }) => {
    await window.api.entities.save("note", {
      id: "issue-284-mermaid-powerpoint-audit",
      title,
      body_markdown: body,
      note_type: "note",
      content_format: "markdown",
    });
  }, { title: noteTitle, body: auditMarkdown });
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.waitForTimeout(1_500);
  const allNotes = page.getByRole("button", { name: "すべて", exact: true }).first();
  if (await allNotes.count()) await allNotes.click();
  const noteRow = page.locator(".note-row").filter({ hasText: noteTitle }).first();
  await noteRow.click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.locator(".note-main-preview");
  await preview.locator("pre[data-mermaid='true']").nth(2).waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1_500);

  const triggerCount = await preview.locator(".md-mermaid-export-trigger").count();
  if (triggerCount !== 3) throw new Error(`Mermaid output trigger count was ${triggerCount}, expected 3.`);

  for (const [index, expectedBlockId] of ["mermaid-block-1", "mermaid-block-2", "mermaid-block-3"].entries()) {
    const trigger = preview.locator(".md-mermaid-export-trigger").nth(index);
    await trigger.scrollIntoViewIfNeeded();
    const firstBox = await trigger.boundingBox();
    await page.waitForTimeout(120);
    const secondBox = await trigger.boundingBox();
    if (!firstBox || !secondBox || Math.abs(firstBox.x - secondBox.x) > 1 || Math.abs(firstBox.y - secondBox.y) > 1) {
      throw new Error(`Mermaid trigger position did not stabilize for ${expectedBlockId}.`);
    }
    await trigger.click();
    const menu = page.locator(`#mermaid-export-menu-${expectedBlockId}`);
    await menu.waitFor({ state: "visible", timeout: 5_000 });
    const headingLocator = menu.locator(".mermaid-export-menu-heading");
    const heading = await headingLocator.innerText();
    if (!heading.includes(expectedBlockId)) throw new Error(`Menu routing mismatch: ${heading}`);
    const nativeButton = menu.getByRole("menuitem", { name: "編集可能なPowerPointを作成" });
    const nativeButtonCount = await nativeButton.count();
    if (nativeButtonCount !== 1) throw new Error(`Native capability menu item missing for ${expectedBlockId}.`);
    if ((index < 2) !== !(await nativeButton.isDisabled())) throw new Error(`Native capability mismatch for ${expectedBlockId}.`);
    if (index === 0 || index === 2) {
      await menu.getByRole("menuitem", { name: "PowerPoint編集用SVGをコピー" }).click();
      await menu.waitFor({ state: "hidden", timeout: 20_000 });
      const successToast = page.getByRole("status").filter({ hasText: "PowerPoint編集用SVGをクリップボードへコピーしました。" });
      try {
        await successToast.waitFor({ state: "visible", timeout: 3_000 });
      } catch {
        throw new Error(`PowerPoint SVG copy toast was not shown for ${expectedBlockId}.`);
      }
      const clipboardResult = await app.evaluate(({ clipboard }) => ({
        formats: clipboard.availableFormats(),
        svg: clipboard.readBuffer("image/svg+xml").toString("utf8"),
      }));
      if (!clipboardResult.svg || !clipboardResult.formats.some((format) => /svg/i.test(format))) throw new Error(`Windows SVG clipboard read-back failed: ${clipboardResult.formats.join(", ")}`);
      if (index === 0) {
        flowchartClipboardSvg = clipboardResult.svg;
        assertOfficeSvgText(flowchartClipboardSvg, ["入力", "判断", "承認"], "flowchart");
      } else {
        sequenceClipboardSvg = clipboardResult.svg;
        assertOfficeSvgText(sequenceClipboardSvg, ["日本語通知"], "sequence");
      }
    } else {
      await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1 })));
      await menu.waitFor({ state: "hidden" });
    }
    const remainingTriggers = await preview.locator(".md-mermaid-export-trigger").count();
    if (remainingTriggers !== 3) throw new Error(`Mermaid output triggers changed after closing menu: ${remainingTriggers}.`);
    const renderedBlocks = await preview.locator("pre[data-mermaid='true'].is-rendered").count();
    if (renderedBlocks !== 3) throw new Error(`Mermaid SVG render count changed after closing ${expectedBlockId}: ${renderedBlocks}.`);
  }

  if (!flowchartClipboardSvg || !sequenceClipboardSvg) throw new Error("Product clipboard menus did not provide both SVG read-backs.");
  const normalPreviewFonts = await preview.locator("pre[data-mermaid='true'] svg").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontFamily));
  if (!normalPreviewFonts.every((fontFamily) => /Nunito/i.test(fontFamily))) throw new Error(`Normal Mermaid preview font was not restored: ${normalPreviewFonts.join(" | ")}`);
  const officeSvg = flowchartClipboardSvg;
  writeFileSync(path.join(outputDirectory, "mermaid-flowchart.office.svg"), officeSvg, "utf8");
  writeFileSync(path.join(outputDirectory, "mermaid-sequence.office.svg"), sequenceClipboardSvg, "utf8");
  await app.evaluate(async ({ BrowserWindow }, script) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Electron audit window was not found for page-side extraction.");
    await window.webContents.executeJavaScript(script);
  }, browserBundle);

  const diagram = await page.evaluate(({ svg, source }) => window.TaskenMermaidPowerPoint.extractMermaidPptxDiagram(svg, source), {
    svg: officeSvg,
    source: flowchartSource,
  });
  if (diagram.nodes.length !== 3 || diagram.edges.length !== 2) {
    throw new Error(`Extracted Mermaid diagram shape count was nodes=${diagram.nodes.length}, edges=${diagram.edges.length}.`);
  }
  if (!diagram.nodes.some((node) => node.label.includes("入力")) || !diagram.nodes.some((node) => node.label.includes("判断"))) {
    throw new Error("Extracted Mermaid node labels did not retain Japanese text.");
  }
  if (!diagram.edges.some((edge) => edge.label === "承認")) throw new Error("Extracted Mermaid edge label was lost.");
  if (!diagram.warnings.some((warning) => /曲線|arc|直線/.test(warning))) {
    throw new Error("Unsupported curved edge approximation did not leave a warning.");
  }
  const pptxBuffer = await buildMermaidPptxBuffer(diagram, "#284 Mermaid audit");
  const pptxPath = path.join(outputDirectory, "mermaid-flowchart.editable.pptx");
  writeFileSync(pptxPath, pptxBuffer);
  console.log(JSON.stringify({
    outputDirectory,
    triggerCount,
    clipboardFormats: (await app.evaluate(({ clipboard }) => clipboard.availableFormats())),
    officeSvgPath: path.join(outputDirectory, "mermaid-flowchart.office.svg"),
    pptxPath,
    pptxBytes: pptxBuffer.byteLength,
  }, null, 2));
} finally {
  await app.close();
  if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
}
