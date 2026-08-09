import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function importBundled(relativePath) {
  // KaTeX フォント埋め込みで data: URL が肥大化するため、一時ファイル経由で import する。
  const outDir = mkdtempSync(path.join(tmpdir(), "tasken-md-"));
  const outfile = path.join(outDir, "bundle.mjs");
  await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    // micromark 系が browser 条件で document を触るため node で束ねる。
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const markdown = await importBundled("src/renderer/src/features/workspace/lib/markdown.ts");
const markdownEditing = await importBundled("src/renderer/src/features/workspace/lib/markdownEditing.ts");
const mermaid = await importBundled("src/renderer/src/features/workspace/lib/mermaid.ts");
const mermaidSizing = await importBundled("src/renderer/src/features/workspace/lib/mermaidSizing.ts");
const mermaidWidth = await importBundled("src/renderer/src/features/workspace/lib/mermaidWidth.ts");
const markdownSurfaceSource = readFileSync("src/renderer/src/features/workspace/lib/markdownDocumentSurfaces.ts", "utf8");

test("Mermaid SVG presentation enlarges small diagrams without shrinking large ones", () => {
  assert.deepEqual(mermaidSizing.mermaidSvgPresentation("0 0 113.046875 174"), {
    preferredWidth: 170,
    intrinsicWidth: 114,
    intrinsicHeight: 174,
  });
  assert.deepEqual(mermaidSizing.mermaidSvgPresentation("0 0 855.047 174"), {
    preferredWidth: 856,
    intrinsicWidth: 856,
    intrinsicHeight: 174,
  });
  assert.equal(mermaidSizing.mermaidSvgPresentation("0 0 0 100"), null);
});

test("Mermaid lazy viewport fallback renders only within the observer root margin", () => {
  assert.equal(mermaid.isMermaidNearViewport({ top: 760, bottom: 820, left: 20, right: 400 }, 800, 600), true);
  assert.equal(mermaid.isMermaidNearViewport({ top: 1360, bottom: 1420, left: 20, right: 400 }, 800, 600), false);
  assert.equal(mermaid.isMermaidNearViewport({ top: 200, bottom: 260, left: 820, right: 900 }, 800, 600), false);
  assert.equal(mermaid.isMermaidNearViewport({ top: 0, bottom: 0, left: 20, right: 400 }, 800, 600), false);
  assert.equal(mermaid.isMermaidNearViewport({ top: 0, bottom: 60, left: 20, right: 400 }, 0, 600), false);
});

test("Mermaid width metadata normalizes and preserves unrelated fence metadata", () => {
  assert.equal(mermaidWidth.mermaidWidthFromMeta("title=overview width=67%"), 65);
  assert.equal(mermaidWidth.mermaidWidthFromMeta("width=20%"), null);
  assert.equal(mermaidWidth.withMermaidWidthMeta("title=overview width=65%", 80), "title=overview width=80%");
  assert.equal(mermaidWidth.withMermaidWidthMeta("title=overview width=65%", null), "title=overview");
});

test("markdown preview renders tasken images and math markers", () => {
  const html = markdown.renderMarkdownPreview(`# Title

Inline math $a^2 + b^2 = c^2$.

$$
x_{t+1} = \\arg\\max_x \\alpha_t(x)
$$

![Chart](tasken-attachment://local/00000000-0000-0000-0000-000000000000.png/chart)`);

  assert.match(html, /<h1 id="md-h-0"[^>]*>Title<\/h1>/);
  assert.match(html, /class="md-math-inline"/);
  assert.match(html, /class="md-math-block"/);
  assert.match(html, /class="katex"/);
  assert.match(html, /x_\{t\+1\} = \\arg\\max_x \\alpha_t\(x\)/);
  assert.match(html, /<img src="tasken-attachment:\/\/local\/00000000-0000-0000-0000-000000000000.png\/chart" alt="Chart"/);
});

test("markdown preview renders document blocks for decorated output", () => {
  const html = markdown.renderMarkdownPreview(`# Title

## Section

### Finding

#### Detail

> Important note

***

1. First
2. Second

| Metric | Value |
| --- | ---: |
| Lead time | 3 days |

\`\`\`
code line
\`\`\``);

  assert.match(html, /<h1 id="md-h-0"[^>]*>Title<\/h1>/);
  assert.match(html, /<h2 id="md-h-1"[^>]*>Section<\/h2>/);
  assert.match(html, /<h3 id="md-h-2"[^>]*>Finding<\/h3>/);
  assert.match(html, /<h4 id="md-h-3"[^>]*>Detail<\/h4>/);
  assert.match(html, /<blockquote><p>Important note<\/p><\/blockquote>/);
  assert.match(html, /<hr \/>/);
  assert.doesNotMatch(html, /<p>\*\*\*<\/p>/);
  assert.doesNotMatch(html, /<br \/>/);
  assert.match(html, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>Metric<\/th>/);
  assert.match(html, /<td>3 days<\/td>/);
  assert.match(html, /<pre><code>code line\n<\/code><\/pre>/);
});

test("markdown preview renders footnotes and keeps Mermaid code blocks identifiable", () => {
  const html = markdown.renderMarkdownPreview(`結論[^source]。\n\n[^source]: 実験ノートを参照。\n\n\`\`\`mermaid\nflowchart TD\n  A[入力] --> B[判断]\n\`\`\``);

  assert.match(html, /class="md-footnote-ref"/);
  assert.match(html, /<section class="md-footnotes"/);
  assert.match(html, /実験ノートを参照/);
  assert.match(html, /class="md-mermaid-block" data-mermaid="true"/);
  assert.match(html, /class="language-mermaid"/);
});

test("markdown preview applies explicit Mermaid width without changing the diagram source", () => {
  const html = markdown.renderMarkdownPreview("```mermaid width=65%\nflowchart TD\n  A --> B\n```");
  assert.match(html, /data-mermaid-width="65"/);
  assert.match(html, /style="width:min\(100%, 65%\);margin-inline:auto"/);
  assert.match(html, /flowchart TD/);
});

test("rich editor normalization removes only accidental empty fences", () => {
  const accidental = "本文\n```\n```\n次の段落";
  const mermaid = "```mermaid\nflowchart TD\n  A --> B\n```\n本文";
  const code = "```text\nconst value = 1;\n```";

  assert.equal(markdown.normalizeRichEditorMarkdown(accidental), "本文\n\n次の段落");
  assert.equal(markdown.normalizeRichEditorMarkdown(mermaid), mermaid);
  assert.equal(markdown.normalizeRichEditorMarkdown(code), code);
});

test("rich editor escapes ambiguous comparison operators without changing saved Markdown", () => {
  const source = [
    "M<1",
    "x<10",
    "0<a<1",
    "損失<基準値",
    "",
    "`x<10`",
    "",
    "```html",
    "<div>x</div>",
    "```",
  ].join("\n");
  const escaped = markdown.escapeAmbiguousMarkdownComparisons(source);
  assert.match(escaped, /M\\<1/);
  assert.match(escaped, /損失\\<基準値/);
  assert.match(escaped, /`x<10`/);
  assert.match(escaped, /<div>x<\/div>/);
  assert.equal(markdown.restoreAmbiguousMarkdownComparisons(escaped), source);
  const preview = markdown.renderMarkdownPreview(source);
  assert.match(preview, /M&lt;1/);
  assert.match(preview, /損失&lt;基準値/);
});

test("Notes Edit and Preview share the rendered document style contract", () => {
  const source = [
    readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8"),
    readFileSync("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", "utf8"),
  ].join("\n");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.match(source, /contentEditableClassName="note-mdx-content markdown-preview"/);
  assert.match(source, /<MarkdownPreview className="note-main-preview markdown-preview"/);
  assert.match(source, /className="note-main-editor note-main-editor-raw note-editor-footnotes"/);
  assert.match(source, /const mermaidCodeBlockDescriptor/);
  assert.match(source, /Editor:\s*MermaidCodeBlockEditor/);
  assert.match(styles, /\.note-preview-panel \.note-main-preview \{[\s\S]*?padding-bottom:\s*60vh;/);
  assert.match(styles, /\.note-preview-panel \.note-live-editor \[class\*="_rootContentEditableWrapper_"\]::after \{[\s\S]*?flex:\s*0 0 60vh;[\s\S]*?user-select:\s*none;/);
  assert.doesNotMatch(styles, /\.note-mdx-content \{[^}]*padding:[^;]*60vh/);
  assert.match(styles, /\.note-live-editor \[class\*="_rootContentEditableWrapper_"\] \{[\s\S]*?overflow:\s*auto;/);
  assert.match(styles, /\.note-mdx-content\[contenteditable="true"\] \{[\s\S]*?overflow:\s*visible;/);
  assert.doesNotMatch(styles, /\.note-preview-panel \.note-mdx-content::after/);
  assert.doesNotMatch(styles, /scroll-padding-bottom:\s*60vh/);
  assert.match(styles, /:has\(\.cm-editor\)[\s\S]*?width:\s*100%/);
  assert.doesNotMatch(styles, /\.note-footnote-editor/);
});

test("markdown preview renders safe ordinary links and rejects unsafe link urls", () => {
  const html = markdown.renderMarkdownPreview("[OpenAI](https://openai.com) [mail](mailto:test@example.com) [bad](javascript:alert(1)) ![Chart](https://example.com/chart.png) [[Knowledge]]");

  assert.match(html, /<a class="md-link" href="https:\/\/openai\.com\/" target="_blank" rel="noreferrer">OpenAI<\/a>/);
  assert.match(html, /<a class="md-link" href="mailto:test@example.com" target="_blank" rel="noreferrer">mail<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /bad/);
  assert.match(html, /<img src="https:\/\/example\.com\/chart\.png" alt="Chart"/);
  assert.match(html, /class="md-wiki-link"/);
  assert.equal(markdown.safeMarkdownLinkUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(markdown.safeMarkdownLinkUrl("javascript:alert(1)"), "");
  assert.equal(markdown.safeMarkdownLinkUrl("example.com/docs"), "https://example.com/docs");
  assert.equal(markdown.safeMarkdownLinkUrl("//example.com/x"), "https://example.com/x");
  assert.equal(markdown.safeMarkdownLinkUrl("about:blank"), "");
});

test("markdown preview and editor css make ordinary links visible", () => {
  const source = readFileSync("src/renderer/src/styles/app.css", "utf8");
  const notesSource = readFileSync("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", "utf8");
  const documentCss = markdown.previewDocument("[OpenAI](https://openai.com)", "markdown");

  assert.match(source, /--markdown-link:\s*#0B6BCB/);
  assert.match(source, /\.markdown-preview a,\s*\n\.markdown-preview \.md-link/s);
  assert.match(source, /text-decoration: underline/);
  assert.match(source, /\.markdown-preview a:hover/);
  assert.match(source, /\.markdown-preview h2 a/);
  assert.match(source, /\.markdown-preview blockquote a/);
  assert.match(documentCss, /#0B6BCB/);
  assert.match(notesSource, /openSafeMarkdownLink/);
  assert.match(notesSource, /linkDialogPlugin/);
  assert.match(notesSource, /pointerdown/);
  assert.match(notesSource, /metaKey \|\| event\.ctrlKey/);
  assert.match(notesSource, /note-link-hover-card/);
  assert.match(notesSource, /mousemove/);
  assert.match(notesSource, /removeEditorLink|TOGGLE_LINK_COMMAND/);
  assert.match(notesSource, /updateEditorLinkUrl|setURL/);
  assert.match(notesSource, /リンクを編集/);
  assert.match(notesSource, /リンクを削除/);
  assert.match(source, /note-link-hover-card/);
  assert.match(source, /note-link-hover-action/);
  assert.match(source, /_linkDialogPreviewAnchor_/);
});

test("previewDocument styling stays aligned with markdown-preview tokens", () => {
  const html = markdown.previewDocument(
    "# Title\n\n#### Detail\n\n> quote note\n\n***\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    "markdown",
  );
  const previewCss = readFileSync("src/renderer/src/styles/app.css", "utf8");
  const rendererEntry = readFileSync("src/renderer/src/main.tsx", "utf8");

  assert.match(html, /class="markdown-document"/);
  assert.match(rendererEntry, /installMarkdownDocumentSurfaces\(document\)/);
  assert.match(markdownSurfaceSource, /target\.head\.prepend\(style\)/);
  assert.match(html, /--markdown-document-math-bg:\s*#f6f4f1/);
  assert.match(html, /--markdown-document-code-bg:\s*#f5f9fc/);
  assert.match(html, /--markdown-document-quote-bg:\s*#fafcfd/);
  assert.match(markdownSurfaceSource, /\.note-mdx-content,\s*\n\.markdown-preview,\s*\n\.markdown-document/);
  assert.match(html, /--markdown-accent:#2D7FB8/);
  assert.match(html, /--markdown-accent-bd:#C3DCEE/);
  assert.match(html, /--markdown-paper-secondary:#554b46/);
  assert.match(html, /<h4 id="md-h-1"[^>]*>Detail<\/h4>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<hr \/>/);
  assert.match(html, /<table>/);

  // quote: Preview と同じく薄い左線 + 斜体 + 二次色（PDF 独自の強い青面にしない）
  assert.match(html, /\.markdown-document blockquote\{[^}]*border-left:3px solid var\(--markdown-accent-bd\)/s);
  assert.match(html, /\.markdown-document blockquote\{[^}]*font-style:italic/s);
  assert.match(html, /\.markdown-document blockquote\{[^}]*color:var\(--markdown-paper-secondary\)/s);
  assert.match(previewCss, /\.markdown-preview blockquote \{[^}]*border-left: 3px solid var\(--markdown-accent-bd\)/s);
  assert.match(previewCss, /\.markdown-preview blockquote \{[^}]*font-style: italic/s);

  // 見出し階層・表も Preview と同じ骨格
  assert.match(html, /\.markdown-document h2\{[^}]*border-left:6px solid var\(--markdown-accent\)/s);
  assert.match(html, /\.markdown-document h2\{[^}]*border-bottom:2px solid var\(--markdown-accent-bd\)/s);
  assert.match(html, /border-collapse:collapse/);
  assert.match(html, /padding:3px 0/);
  assert.match(previewCss, /\.markdown-preview h2 \{[^}]*border-left: 6px solid var\(--markdown-accent\)/s);
  assert.match(previewCss, /\.markdown-preview table \{[^}]*border-collapse: collapse/s);
});

test("previewDocument hides frontmatter and embeds KaTeX CSS for PDF math", () => {
  const source = `---
type: report
theme: smoke
---
# Title

Inline $a^2+b^2=c^2$ and block:

$$
E = mc^2
$$
`;

  const preview = markdown.renderMarkdownPreview(source);
  assert.match(preview, /class="md-frontmatter"/);
  assert.match(preview, /type: report/);
  assert.match(preview, /class="md-math-inline"/);
  assert.match(preview, /class="md-math-block"/);
  assert.match(preview, /class="katex-mathml"/);
  assert.match(preview, /class="katex-html"/);

  const doc = markdown.previewDocument(source, "markdown");
  assert.doesNotMatch(doc, /class="md-frontmatter"/);
  assert.doesNotMatch(doc, />Frontmatter</);
  assert.doesNotMatch(doc, /type: report/);
  assert.match(doc, /<h1 id="md-h-0"[^>]*>Title<\/h1>/);
  // data: URL の PDF では外部 CSS が使えないため、MathML 二重表示防止 + KaTeX フォントを埋め込む。
  assert.match(doc, /\.katex \.katex-mathml/);
  assert.match(doc, /clip-path:inset\(50%\)|clip:rect/);
  assert.match(doc, /@font-face/);
  assert.match(doc, /data:font\/woff2;base64,/);
  assert.match(doc, /font-family:KaTeX_Main/);
  assert.match(doc, /class="md-math-inline"/);
  assert.match(doc, /class="md-math-block"/);
  assert.match(doc, /class="katex-mathml"/);
  assert.match(doc, /class="katex-html"/);
  // ラッパーが Georgia 固定や inline-block で KaTeX の baseline を壊さない。
  assert.match(doc, /\.markdown-document \.md-math-inline\s*\{[\s\S]*?display:\s*inline/s);
  assert.doesNotMatch(doc, /\.md-math-inline\{[^}]*font-family:Georgia/);
  assert.match(doc, /\.markdown-document \.md-math-block\{\s*overflow:visible/s);
  assert.match(doc, /\.markdown-document \.md-math-block\s*\{[\s\S]*?background:\s*var\(--markdown-document-math-bg\)/s);
  assert.doesNotMatch(doc, /\.markdown-document \.md-math-block\s*\{[^}]*color-mix\(/s);
});

test("previewDocument includes print-safe Mermaid and higher-contrast text styling", () => {
  const doc = markdown.previewDocument("```mermaid width=65%\nflowchart LR\nA --> B\n```", "markdown");
  const mermaidSource = readFileSync("src/renderer/src/features/workspace/lib/mermaid.ts", "utf8");
  const pdfServiceSource = readFileSync("src/main/services/workspaceService.ts", "utf8");

  assert.match(doc, /color:#1f1b1a/);
  assert.match(doc, /print-color-adjust:exact/);
  assert.match(doc, /data-mermaid-width="65"/);
  assert.match(doc, /style="width:min\(100%, 65%\);margin-inline:auto"/);
  assert.match(doc, /\.markdown-document pre\.md-mermaid-block\.is-rendered > code\{display:none\}/);
  assert.match(doc, /\.markdown-document \.md-mermaid-svg svg\{[^}]*max-width:100%/s);
  assert.match(doc, /\.markdown-document \.md-mermaid-svg svg\{[^}]*max-height:205mm/s);
  assert.doesNotMatch(pdfServiceSource, /querySelectorAll\("\.md-mermaid-block"\)[^}]*style\.width/);
  assert.match(doc, /class="md-mermaid-block" data-mermaid="true"/);
  assert.match(mermaidSource, /sequence:\s*\{[\s\S]*mirrorActors:\s*false/);
  assert.match(mermaidSource, /renderMermaidBlocks\(parsed, "print"\)/);
  assert.match(mermaidSource, /svg\.style\.maxHeight = "205mm"/);
  assert.match(mermaidSource, /node\.classList\.add\("is-mermaid-scrollable"\)/);
});

test("markdown preview css separates heading levels and keeps tables compact", () => {
  const source = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.match(source, /\.markdown-preview h2 \{[^}]*border-bottom: 2px solid/s);
  assert.match(source, /\.markdown-preview h3 \{[^}]*border-left: 4px solid/s);
  assert.match(source, /\.markdown-preview h4 \{[^}]*border-bottom: 1px solid var\(--markdown-accent-bd\)/s);
  assert.match(source, /\.markdown-preview h4 \{[^}]*border-left: 0/s);
  assert.match(source, /\.markdown-preview h4 \{[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.markdown-preview table \{[^}]*border-collapse: collapse/s);
  assert.match(source, /\.markdown-preview tbody tr:last-child td \{[^}]*border-bottom: 0/s);
  assert.match(source, /\[class\*="_tableColumnEditorTrigger_"\][^}]*opacity: \.28/s);
});

test("markdown editing surfaces use a white paper background", () => {
  const source = readFileSync("src/renderer/src/styles/app.css", "utf8");
  const artifactSource = readFileSync("src/renderer/src/styles/artifacts.css", "utf8");

  assert.match(source, /--markdown-paper: #fff;/);
  assert.match(source, /--markdown-paper-text: #26211f;/);
  assert.match(source, /\.note-main-editor \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.note-live-editor \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.note-mdx-content \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.note-main-preview \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.note-main-raw \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.markdown-preview \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(artifactSource, /\.artifact-preview-frame \{[^}]*background: var\(--markdown-paper\)/s);
  assert.match(artifactSource, /\.artifact-raw \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
});

test("structured markdown paste detection keeps plain text paste native", () => {
  assert.equal(markdown.isStructuredMarkdownPaste("plain meeting note"), false);
  assert.equal(markdown.isStructuredMarkdownPaste("# Heading\n\nBody"), true);
  assert.equal(markdown.isStructuredMarkdownPaste("This has **bold** text"), true);
  assert.equal(markdown.isStructuredMarkdownPaste("| A | B |\n| --- | --- |\n| 1 | 2 |"), true);
  assert.equal(markdown.isStructuredMarkdownPaste("> quote"), true);
});

test("structured markdown paste inserts near the current rendered text selection", () => {
  const current = "Intro\n\n本文中の式 Live edit smoke$a^2$ を確認します。";
  const next = markdown.insertStructuredMarkdownPaste(
    current,
    "## Pasted Heading\n\n**Pasted Bold**",
    "本文中の式 Live edit smoke",
    "本文中の式 Live edit smoke".length,
  );

  assert.match(next, /Live edit smoke\n\n## Pasted Heading\n\n\*\*Pasted Bold\*\*\n\n\$a\^2\$/);
});

test("structured markdown paste falls back to appending when selection cannot be mapped", () => {
  const next = markdown.insertStructuredMarkdownPaste("Intro", "## Pasted", "", 0);

  assert.equal(next, "Intro\n\n## Pasted\n");
});

test("structured markdown paste fills an empty note without leading blank lines", () => {
  const next = markdown.insertStructuredMarkdownPaste("", "## Pasted", "", 0);

  assert.equal(next, "## Pasted\n");
});

test("rich browser paste converts html links to plain markdown", () => {
  const converted = markdown.htmlToMarkdownPaste(`
    <p>Read <a href="https://example.com/docs?x=1">the docs</a><br>and
    <a href="mailto:team@example.com">mail us</a>.</p>
    <ul><li><a href="javascript:alert(1)">bad link</a></li><li>plain item</li></ul>
  `);

  assert.equal(converted, "Read [the docs](https://example.com/docs?x=1)\nand [mail us](mailto:team@example.com).\n\n- bad link\n- plain item");
  assert.doesNotMatch(converted, /style|script|javascript/);
});

test("markdown editor wires rich paste after image paste and preserves mode scroll", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/components/MarkdownEditorPanel.tsx",
    "utf8",
  );

  assert.match(source, /clipboardImageFile\(event\.clipboardData\)/);
  assert.match(source, /getData\("text\/html"\)/);
  assert.match(source, /htmlToMarkdownPaste/);
  assert.match(source, /standalonePreviewRef/);
  assert.match(source, /function switchMode/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /switchMode\("preview"\)/);
});

test("markdown editing helpers format safely, find matches, and build a line diff", () => {
  const source = "# Title  \n\n\n本文\n\n```python\nvalue = 1  \n\n\n```\n";
  assert.equal(
    markdownEditing.formatMarkdown(source),
    "# Title\n\n本文\n\n```python\nvalue = 1  \n\n\n```",
  );
  assert.deepEqual(markdownEditing.findMarkdownMatches("Alpha\nalpha", "alp"), [
    { index: 0, length: 3 },
    { index: 6, length: 3 },
  ]);
  assert.deepEqual(markdownEditing.diffMarkdownLines("A\nB", "A\nC"), [
    { kind: "same", text: "A", beforeLine: 1, afterLine: 1 },
    { kind: "removed", text: "B", beforeLine: 2, afterLine: null },
    { kind: "added", text: "C", beforeLine: null, afterLine: 2 },
  ]);
  const restoreDiff = markdownEditing.diffMarkdownLines("a\nb\nc\nd", "a\nX\nc\nY\nd");
  const restoreHunks = markdownEditing.buildMarkdownDiffHunks(restoreDiff, 0);
  assert.equal(markdownEditing.restoreMarkdownDiffHunk("a\nX\nc\nY\nd", restoreHunks[0]), "a\nb\nc\nY\nd");
  assert.equal(markdownEditing.restoreMarkdownDiffHunk("a\nX\nc\nY\nd", restoreHunks[1]), "a\nX\nc\nd");
  const consecutiveDiff = markdownEditing.diffMarkdownLines("a\nb\nc\nd", "a\nX\nY\nd");
  assert.equal(markdownEditing.buildMarkdownDiffMarkers(consecutiveDiff, 0).length, 1);
  const separatedDiff = markdownEditing.diffMarkdownLines("a\nb\nc\nd", "a\nX\nc\nY");
  assert.equal(markdownEditing.buildMarkdownDiffMarkers(separatedDiff, 2).length, 2);
  const nearbyAdditions = markdownEditing.buildMarkdownDiffMarkers(
    markdownEditing.diffMarkdownLines(
      "開始\n中間\n次",
      "開始\n前の追加段落\n中間\nfda\n次",
    ),
    2,
  );
  assert.deepEqual(
    markdownEditing.buildMarkdownDiffMarkerAnchorTexts(nearbyAdditions[1]),
    ["fda", "中間"],
  );
  const overlappingContextDiff = markdownEditing.diffMarkdownLines("same", "A\nsame\nB");
  const overlappingContextHunks = markdownEditing.buildMarkdownDiffHunks(overlappingContextDiff, 2);
  assert.deepEqual(overlappingContextHunks.map((hunk) => ({
    focusStart: hunk.focusStart,
    focusEnd: hunk.focusEnd,
    addedLines: hunk.addedLines,
  })), [
    { focusStart: 0, focusEnd: 0, addedLines: 1 },
    { focusStart: 2, focusEnd: 2, addedLines: 1 },
  ]);
  assert.equal(markdownEditing.restoreMarkdownDiffHunk("A\nsame\nB", overlappingContextHunks[0]), "same\nB");
  assert.equal(markdownEditing.restoreMarkdownDiffHunk("A\nsame\nB", overlappingContextHunks[1]), "A\nsame");
  const deletionHunk = markdownEditing.buildMarkdownDiffHunks(
    markdownEditing.diffMarkdownLines("a\nb\nc", "a\nc"),
    1,
  )[0];
  assert.equal(markdownEditing.restoreMarkdownDiffHunk("a\nc", deletionHunk), "a\nb\nc");
  const diff = markdownEditing.diffMarkdownLines(
    "a\nb\nc\nd\ne\nf\ng\nh\ni\nj",
    "a\nb\nX\nd\ne\nf\ng\nh\nY\nj",
  );
  assert.deepEqual(markdownEditing.buildMarkdownDiffHunks(diff, 1), [
    {
      lines: [
        { kind: "same", text: "b", beforeLine: 2, afterLine: 2 },
        { kind: "removed", text: "c", beforeLine: 3, afterLine: null },
        { kind: "added", text: "X", beforeLine: null, afterLine: 3 },
        { kind: "same", text: "d", beforeLine: 4, afterLine: 4 },
      ],
      focusStart: 1,
      focusEnd: 2,
      changedLines: 2,
      addedLines: 1,
      removedLines: 1,
      omittedBefore: 1,
      omittedAfter: 7,
    },
    {
      lines: [
        { kind: "same", text: "h", beforeLine: 8, afterLine: 8 },
        { kind: "removed", text: "i", beforeLine: 9, afterLine: null },
        { kind: "added", text: "Y", beforeLine: null, afterLine: 9 },
        { kind: "same", text: "j", beforeLine: 10, afterLine: 10 },
      ],
      focusStart: 1,
      focusEnd: 2,
      changedLines: 2,
      addedLines: 1,
      removedLines: 1,
      omittedBefore: 8,
      omittedAfter: 0,
    },
  ]);
  assert.deepEqual(markdownEditing.buildMarkdownDiffMarkers(diff, 1).map(({ lineNumber, kind, hunk }) => ({
    lineNumber,
    kind,
    addedLines: hunk.addedLines,
    removedLines: hunk.removedLines,
  })), [
    { lineNumber: 3, kind: "changed", addedLines: 1, removedLines: 1 },
    { lineNumber: 9, kind: "changed", addedLines: 1, removedLines: 1 },
  ]);
});

test("markdown replace updates one match or every match without rescanning inserted text", () => {
  const source = "旧名称はAlpha、alphaも旧名称。";

  const single = markdownEditing.replaceMarkdownMatch(source, "旧名称", 0, "新名称");
  assert.equal(single.text, "新名称はAlpha、alphaも旧名称。");
  assert.equal(single.count, 1);
  // 置換文字列より後ろの一致へ進む（自分自身を選び直さない）。
  assert.equal(single.nextIndex, 0);
  assert.deepEqual(markdownEditing.findMarkdownMatches(single.text, "旧名称"), [{ index: 16, length: 3 }]);

  // 置換後の文字列が検索語を含んでも、次の一致は挿入部分より後ろから探す。
  const growing = markdownEditing.replaceMarkdownMatch("aa", "a", 0, "aa");
  assert.equal(growing.text, "aaa");
  assert.equal(growing.nextIndex, 2);

  const all = markdownEditing.replaceAllMarkdownMatches(source, "旧名称", "新名称");
  assert.equal(all.text, "新名称はAlpha、alphaも新名称。");
  assert.equal(all.count, 2);
  assert.equal(markdownEditing.replaceAllMarkdownMatches("aaa", "a", "aa").text, "aaaaaa");

  // 一致が無い・検索語が空の場合は本文を変えない。
  assert.deepEqual(markdownEditing.replaceMarkdownMatch(source, "存在しない語", 0, "x"), { text: source, count: 0, nextIndex: 0 });
  assert.deepEqual(markdownEditing.replaceAllMarkdownMatches(source, "  ", "x"), { text: source, count: 0, nextIndex: 0 });

  // 大文字・小文字を区別せずに一致し、置換文字列はそのまま入る（検索の挙動と揃える）。
  assert.equal(markdownEditing.replaceAllMarkdownMatches("Alpha alpha", "ALPHA", "Beta").text, "Beta Beta");
});

test("notes search bar exposes replace controls and reload-safe Ctrl+R", () => {
  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(notesSource, /event\.key\.toLowerCase\(\) === "r"[\s\S]*?openReplaceRef\.current\(\)/);
  assert.match(notesSource, /すべて置換/);
  // 置換はEditor標準のUndo/Redoで戻す（#286）。置換バー独自の「元に戻す」は持たない。
  assert.doesNotMatch(notesSource, /onClick=\{undoReplace\}/);
  assert.match(notesSource, /function applyReplacedBody\(nextBody: string\): void \{/);
  // Rich Editorはroot入れ替えが1つのHISTORY_PUSHになる。Rawは制御値なので
  // execCommandでブラウザのUndo履歴へ1手として乗せる。
  assert.match(notesSource, /document\.execCommand\("insertText", false, nextBody\)/);
  assert.match(notesSource, /Ctrl\+Zで一度に戻せます。/);
  const mainSource = readFileSync("src/main/index.ts", "utf8");
  // 既定メニューのCtrl+R再読み込みを外し、Ctrl+Shift+Rへ分離していること。
  assert.match(mainSource, /Menu\.setApplicationMenu/);
  assert.match(mainSource, /role: "forceReload", accelerator: "CmdOrCtrl\+Shift\+R"/);
  assert.doesNotMatch(mainSource, /role: "reload"/);
});

test("markdown preview does not render unsafe image urls", () => {
  const html = markdown.renderMarkdownPreview("![bad](javascript:alert(1))");

  assert.doesNotMatch(html, /<img /);
  assert.match(html, /\[画像: bad\]/);
});

test("markdown preview renders MDX editor html img tags with safe attachment urls", () => {
  const html = markdown.renderMarkdownPreview(`# Title

<img height="280" width="742" alt="image" src="tasken-attachment://local/a5a3a30d-097e-4398-b604-8f80828af63e.png/image" />
`);

  assert.match(html, /class="md-image has-display-width"/);
  assert.match(html, /src="tasken-attachment:\/\/local\/a5a3a30d-097e-4398-b604-8f80828af63e\.png\/image"/);
  // 指定幅は figure に載せ、img は 100% で埋める（Preview で潰れない）
  assert.match(html, /<figure class="md-image has-display-width" style="width:min\(100%, 742px\)"/);
  assert.match(html, /width="742"/);
  assert.match(html, /style="width:100%;height:auto;display:block"/);
  // height 属性は壊れた比率の原因になるので Preview には出さない
  assert.doesNotMatch(html, /\sheight="/);
  assert.doesNotMatch(html, /&lt;img/);
});

test("markdown preview accepts fractional MDX resize widths and ignores stale height", () => {
  const html = markdown.renderMarkdownPreview(
    `<img height="900.4" width="333.7" alt="resized" src="tasken-attachment://local/a5a3a30d-097e-4398-b604-8f80828af63e.png/image" />`,
  );
  assert.match(html, /style="width:min\(100%, 334px\)"/);
  assert.match(html, /width="334"/);
  assert.doesNotMatch(html, /\sheight="/);
  assert.match(html, /has-display-width/);
});

test("notes page flushes MDX markdown before leaving edit mode", () => {
  const source = [
    readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8"),
    readFileSync("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", "utf8"),
  ].join("\n");
  assert.match(source, /markdownSourceRef/);
  assert.match(source, /getMarkdown\(\)/);
  assert.match(source, /previewMode === "edit" && nextMode !== "edit"/);
});

test("long note Edit keeps full-document work off the urgent keystroke path", () => {
  const notesPage = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const richEditor = readFileSync("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", "utf8");
  const headingIndex = readFileSync("src/renderer/src/features/workspace/components/MarkdownHeadingIndex.tsx", "utf8");

  assert.match(notesPage, /startTransition\(\(\) => \{\s*setDraftOwner\(selectedOwnerRef\.current\)/);
  assert.match(notesPage, /setDraftBodyState\(value\)/);
  assert.match(notesPage, /diffOpen && draftDirty \? diffMarkdownLines/);
  assert.match(notesPage, /setTimeout\(\(\) => setIndexedDraftBody\(draftBody\), 240\)/);
  assert.match(headingIndex, /querySelectorAll<HTMLElement>\("\.note-mdx-content h1,/);
  assert.doesNotMatch(headingIndex, /function findHeadingElement/);
  assert.match(headingIndex, /observer\?\.observe\(surface!, \{ childList: true \}\)/);
  assert.match(richEditor, /observer\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(richEditor, /characterData: true/);
});

test("notes editor hides north-south only image resizers", () => {
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(css, /_imageResizerN_/);
  assert.match(css, /_imageResizerS_/);
  assert.match(css, /display: none !important/);
  assert.match(css, /height: auto !important/);
  // width:auto があると <img width> が無効になり Edit 再入場で全幅化する
  assert.match(css, /width は指定しない/);
  const imgRule = (css.match(/\.note-mdx-content img \{[^}]+\}/s)?.[0] || "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(imgRule, /height:\s*auto\s*!important/);
  // max-width は可。width プロパティ自体は不可（HTML width 属性を潰す）
  // gutter を引いた calc も max-width の一種として許容する（#287）
  assert.match(imgRule, /max-width:\s*(100%|calc\(100% - )/);
  assert.doesNotMatch(imgRule, /(?<!max-)width\s*:/);
});

test("markdown preview keeps unsized images within content width", () => {
  const html = markdown.renderMarkdownPreview(
    `![Chart](tasken-attachment://local/00000000-0000-0000-0000-000000000000.png/chart)`,
  );
  assert.match(html, /max-width:100%/);
  assert.match(html, /height:auto/);
  assert.doesNotMatch(html, /has-display-width/);
});

test("notes page enables image resize and dimension controls", () => {
  const source = readFileSync(
    path.resolve("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx"),
    "utf8",
  );
  assert.match(source, /disableImageResize:\s*false/);
  assert.match(source, /allowSetImageDimensions:\s*true/);
});

test("notes editor exposes persisted Mermaid width controls", () => {
  const source = readFileSync(
    path.resolve("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx"),
    "utf8",
  );
  const styles = readFileSync(
    path.resolve("src/renderer/src/styles/app.css"),
    "utf8",
  );
  assert.match(source, /useCodeBlockEditorContext/);
  assert.match(source, /type="range"/);
  assert.match(source, /setMeta\(withMermaidWidthMeta/);
  assert.match(source, /Mermaidの表示幅/);
  assert.match(source, /onChange=\{\(event\) => setDraftWidth\(Number\(event\.target\.value\)\)\}/);
  assert.match(source, /onPointerUp=\{\(event\) => \{[\s\S]*commitWidth\(width\);/);
  assert.match(source, /setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /preserveEditorViewport\(editorRootRef\.current/);
  assert.match(source, /const previewMeta = withMermaidWidthMeta\(props\.meta, null\)/);
  assert.match(source, /const LazyMermaidPreview = memo\(MarkdownPreview, \(\) => true\)/);
  assert.match(source, /<LazyMermaidPreview key=\{rendered\}/);
  assert.match(source, /draftWidth === null \? "" : " is-custom-width"/);
  assert.match(styles, /\.note-mermaid-preview-frame\.is-custom-width \.md-mermaid-svg svg \{ width: 100% !important;/);
});

test("markdown preview rejects unsafe html img tags", () => {
  const html = markdown.renderMarkdownPreview(`<img src="javascript:alert(1)" alt="x" onerror="alert(1)" />`);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;img/);
});

test("renderedText converts markdown report bodies into readable email text", () => {
  const text = markdown.renderedText(`---
type: report
---
# 週報

## 進捗

- 試作条件を整理
- CAE結果を確認

$$
x = T_a(x)
$$

![Chart](tasken-attachment://local/image.png/chart)`, "markdown");

  assert.match(text, /Frontmatter/);
  assert.match(text, /週報/);
  assert.match(text, /- 試作条件を整理/);
  assert.match(text, /- CAE結果を確認/);
  assert.match(text, /x = T_a\(x\)/);
  assert.match(text, /\[画像: Chart\]/);
  assert.doesNotMatch(text, /#/);
  assert.doesNotMatch(text, /\$\$/);
});

test("markdown preview renders multiple inline math on one line and inside list items", () => {
  const html = markdown.renderMarkdownPreview("- 式 $a+b$ と $c^2$ を併記\n- 通常項目");

  const mathCount = (html.match(/class="md-math-inline"/g) || []).length;
  assert.equal(mathCount, 2);
  assert.match(html, /<ul><li>式 /);
  assert.match(html, /<li>通常項目<\/li>/);
});

test("markdown preview keeps escaped markdown characters literal", () => {
  const html = markdown.renderMarkdownPreview("価格は \\$100 で、記号 \\* と \\- はそのまま。");

  assert.doesNotMatch(html, /md-math-inline/);
  assert.doesNotMatch(html, /\\/);
  assert.match(html, /\$100/);
  assert.match(html, /記号 \* と - はそのまま。/);
});

test("markdown preview and PDF keep MDXEditor underline html tags", () => {
  // MDXEditor の下線トグルは Markdown に <u>...</u> として書き出される。
  const html = markdown.renderMarkdownPreview('本文に <u>下線</u> と <u>**強調下線**</u> がある。');
  assert.match(html, /<u class="md-underline">下線<\/u>/);
  assert.match(html, /<u class="md-underline"><strong>強調下線<\/strong><\/u>/);
  assert.doesNotMatch(html, /&lt;u&gt;/);

  const doc = markdown.previewDocument("見出し\n\n<u>PDF下線</u>", "markdown");
  assert.match(doc, /<u class="md-underline">PDF下線<\/u>/);
  assert.match(doc, /\.markdown-document u,\.markdown-document \.md-underline/);
  assert.match(doc, /text-decoration:underline/);

  // コード内の <u> はタグとして解釈しない
  const codeHtml = markdown.renderMarkdownPreview("`<u>not underline</u>`");
  assert.match(codeHtml, /&lt;u&gt;not underline&lt;\/u&gt;/);
  assert.doesNotMatch(codeHtml, /class="md-underline"/);
});

test("markdown preview nests indented lists", () => {
  const html = markdown.renderMarkdownPreview("- parent\n    - child\n- next");

  assert.equal(html, "<ul><li>parent<ul><li>child</li></ul></li><li>next</li></ul>");
});

test("markdown preview keeps loose lists as one list", () => {
  const html = markdown.renderMarkdownPreview("- one\n\n- two");

  assert.equal(html, "<ul><li>one</li><li>two</li></ul>");
});

test("markdown table cells keep escaped pipes inside a cell", () => {
  const html = markdown.renderMarkdownPreview("| A | B |\n| --- | --- |\n| a \\| b | c |");

  assert.match(html, /<td>a \| b<\/td>/);
  assert.match(html, /<td>c<\/td>/);
});

test("markdown preview accepts GFM single-dash table separators from MDXEditor", () => {
  // mdast-util-gfm-table / MDXEditor は | - | -: | のような1本ハイフン区切りを出す。
  const html = markdown.renderMarkdownPreview("| A |  B |\n| - | -: |\n| 1 |  2 |");
  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<th>B<\/th>/);
  assert.match(html, /<td>1<\/td>/);
  assert.match(html, /<td>2<\/td>/);
  assert.doesNotMatch(html, /<p>\| A \|/);

  const compact = markdown.renderMarkdownPreview("|A|B|\n|-|-|\n|1|2|");
  assert.match(compact, /<table>/);
  assert.match(compact, /<td>1<\/td>/);

  // PDF 経路: publish が付ける frontmatter 付きでも表が残る（showFrontmatter:false）。
  const published = [
    "---",
    'title: "report"',
    "---",
    "",
    "| Metric | Value |",
    "| - | -: |",
    "| Lead time | 3 |",
    "",
  ].join("\n");
  const doc = markdown.previewDocument(published, "markdown");
  assert.match(doc, /<table>/);
  assert.match(doc, /<th>Metric<\/th>/);
  assert.match(doc, /<td>Lead time<\/td>/);
  assert.match(doc, /border:1px solid var\(--markdown-document-block-border\)/);
  assert.doesNotMatch(doc, />Frontmatter</);
});

test("markdown preview list css restores bullets against tailwind preflight", () => {
  const source = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(source, /\.markdown-preview ul \{[^}]*list-style-type:\s*disc/s);
  assert.match(source, /\.markdown-preview ol \{[^}]*list-style-type:\s*decimal/s);
  assert.match(source, /\.markdown-preview li \{[^}]*display:\s*list-item/s);

  const html = markdown.renderMarkdownPreview("- one\n- two\n\n1. a\n2. b");
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/);

  const doc = markdown.previewDocument("- item", "markdown");
  assert.match(doc, /\.markdown-document ul\{[^}]*list-style-type:disc/s);
  assert.match(doc, /<ul><li>item<\/li><\/ul>/);
});

test("markdown preview renders strikethrough from gfm delete markers", () => {
  const html = markdown.renderMarkdownPreview("これは ~~古い~~ 文です。");
  assert.match(html, /<del>古い<\/del>/);
});

test("math editor plugin transforms inline math beyond top-level paragraphs", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/components/markdownMathPlugin.tsx",
    "utf8",
  );

  assert.match(source, /\$collectInlineMathTextNodes/);
  assert.match(source, /transformInlineMathInTextNode/);
  assert.match(source, /hasFormat\("code"\)/);
});

test("notes page keeps mode switches draft-only and autosaves when the note leaves the screen", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/pages/NotesPage.tsx",
    "utf8",
  );

  assert.match(source, /autosaveRef/);
  assert.match(source, /function autoSaveDraft/);
  assert.match(source, /自動保存に失敗しました/);
  const switchStart = source.indexOf("function switchPreviewMode");
  const switchEnd = source.indexOf("\n  function insertDraftMarkdown", switchStart);
  const switchSource = source.slice(switchStart, switchEnd);
  assert.match(switchSource, /previewMode === "edit" && nextMode !== "edit"/);
  assert.doesNotMatch(switchSource, /autoSaveDraft/);
  // Route/unmount cleanup hands the dirty snapshot to the serialized owner
  // queue; the app-level registry keeps it awaitable after this page unmounts.
  assert.match(source, /import \{ flushPendingNoteDraftSaves, trackPendingNoteDraftSave \} from "\.\.\/lib\/noteDraftFlushRegistry";/);
  assert.match(source, /useEffect\(\(\) => \(\) => \{\s*cancelAutosaveTimer\(\);\s*const pending = autosaveRef\.current;\s*if \(pending\?\.snapshot\.dirty\) void saveQueuedDraft\(pending\);/);
  assert.match(source, /\}, \[\]\);/);
  assert.doesNotMatch(source, /\[selected\?\.id, saveEntity, setToast\]/);
});

test("notes page keeps scroll position when switching edit, preview, and raw modes", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/pages/NotesPage.tsx",
    "utf8",
  );

  assert.match(source, /function switchPreviewMode/);
  assert.match(source, /function captureModeScroll/);
  assert.match(source, /function restoreModeScroll/);
  assert.match(source, /headingIndex/);
  assert.match(source, /sectionProgress/);
  assert.match(source, /captureNoteModeScroll/);
  assert.match(source, /restoreNoteModeScroll/);
  assert.match(source, /new MutationObserver/);
  // Edit 面は contenteditable の外枠がスクロールし、末尾余白を選択範囲から分離する。
  assert.match(source, /querySelector<HTMLElement>\("\.note-live-editor \[class\*='_rootContentEditableWrapper_'\]"\)/);
  assert.match(source, /switchPreviewMode\("edit"\)/);
  assert.match(source, /switchPreviewMode\("preview"\)/);
  assert.match(source, /switchPreviewMode\("raw"\)/);
  assert.doesNotMatch(source, /onClick=\{\(\) => setPreviewMode\(/);
});

test("heading auto-numbering prefixes h1-h4 and skips manual numbers", () => {
  const source = `# 概要
## 背景
### 詳細
#### 補足
## 目的
# 方針
## 1. 既に番号あり
### 通常
# 第1章 手動章
## (1) 括弧番号
### ① 丸数字`;

  const off = markdown.renderMarkdownPreview(source);
  assert.match(off, /<h1 id="md-h-0"[^>]*>概要<\/h1>/);
  assert.doesNotMatch(off, /md-heading-number/);

  // 既定は h2 から（h1 は番号なし）
  const html = markdown.renderMarkdownPreview(source, { headingNumbers: true });
  assert.match(html, /<h1 id="md-h-0"[^>]*>概要<\/h1>/);
  assert.doesNotMatch(html, /md-heading-number">1\.<\/span> 概要/);
  assert.match(html, /<h2 id="md-h-1"[^>]*><span class="md-heading-number">1\.<\/span> 背景<\/h2>/);
  assert.match(html, /<h3 id="md-h-2"[^>]*><span class="md-heading-number">1\.1<\/span> 詳細<\/h3>/);
  assert.match(html, /<h4 id="md-h-3"[^>]*><span class="md-heading-number">1\.1\.1<\/span> 補足<\/h4>/);
  assert.match(html, /<h2 id="md-h-4"[^>]*><span class="md-heading-number">2\.<\/span> 目的<\/h2>/);
  assert.match(html, /<h1 id="md-h-5"[^>]*>方針<\/h1>/);
  // 手動番号は二重にしない（カウンタは進める）
  assert.match(html, /<h2 id="md-h-6"[^>]*>1\. 既に番号あり<\/h2>/);
  assert.doesNotMatch(html, /md-heading-number">3\.<\/span> 1\. 既に番号あり/);
  assert.match(html, /<h3 id="md-h-7"[^>]*><span class="md-heading-number">3\.1<\/span> 通常<\/h3>/);
  assert.match(html, /<h1 id="md-h-8"[^>]*>第1章 手動章<\/h1>/);
  assert.match(html, /<h2 id="md-h-9"[^>]*>\(1\) 括弧番号<\/h2>/);
  assert.match(html, /<h3 id="md-h-10"[^>]*>① 丸数字<\/h3>/);

  // h1 からを明示するとタイトルにも番号が付く
  const fromH1 = markdown.renderMarkdownPreview(source, { headingNumbers: true, headingNumberStart: 1 });
  assert.match(fromH1, /<h1 id="md-h-0"[^>]*><span class="md-heading-number">1\.<\/span> 概要<\/h1>/);
  assert.match(fromH1, /<h2 id="md-h-1"[^>]*><span class="md-heading-number">1\.1<\/span> 背景<\/h2>/);

  assert.equal(markdown.hasManualHeadingNumber("1. 概要"), true);
  assert.equal(markdown.hasManualHeadingNumber("1.1 背景"), true);
  assert.equal(markdown.hasManualHeadingNumber("第1章 概要"), true);
  assert.equal(markdown.hasManualHeadingNumber("(1) 概要"), true);
  assert.equal(markdown.hasManualHeadingNumber("① 概要"), true);
  assert.equal(markdown.hasManualHeadingNumber("概要"), false);
  assert.equal(markdown.formatHeadingNumber([1]), "1.");
  assert.equal(markdown.formatHeadingNumber([1, 2, 3]), "1.2.3");
});

test("heading auto-numbering starts from shallowest heading in the document", () => {
  const html = markdown.renderMarkdownPreview(`## First
### Nested
## Second`, { headingNumbers: true });

  assert.match(html, /<h2 id="md-h-0"[^>]*><span class="md-heading-number">1\.<\/span> First<\/h2>/);
  assert.match(html, /<h3 id="md-h-1"[^>]*><span class="md-heading-number">1\.1<\/span> Nested<\/h3>/);
  assert.match(html, /<h2 id="md-h-2"[^>]*><span class="md-heading-number">2\.<\/span> Second<\/h2>/);
});

test("headingNumberStart skips shallower headings (e.g. h1 unnumbered)", () => {
  const source = `# Title
## Section
### Detail
## Next`;

  const fromH2 = markdown.renderMarkdownPreview(source, { headingNumbers: true, headingNumberStart: 2 });
  assert.match(fromH2, /<h1 id="md-h-0"[^>]*>Title<\/h1>/);
  assert.doesNotMatch(fromH2, /md-heading-number">1\.<\/span> Title/);
  assert.match(fromH2, /<h2 id="md-h-1"[^>]*><span class="md-heading-number">1\.<\/span> Section<\/h2>/);
  assert.match(fromH2, /<h3 id="md-h-2"[^>]*><span class="md-heading-number">1\.1<\/span> Detail<\/h3>/);
  assert.match(fromH2, /<h2 id="md-h-3"[^>]*><span class="md-heading-number">2\.<\/span> Next<\/h2>/);

  const labels = markdown.computeHeadingNumberLabels(
    [
      { level: 1, text: "Title" },
      { level: 2, text: "A" },
      { level: 3, text: "B" },
    ],
    2,
  );
  assert.deepEqual(labels, [null, "1.", "1.1"]);
});

test("heading number options follow heading_numbers for both preview and PDF", () => {
  const on = markdown.headingNumberOptionsFromProperties({
    heading_numbers: true,
    heading_number_start: 2,
  });
  assert.equal(on.preview.headingNumbers, true);
  assert.equal(on.publish.headingNumbers, true);
  assert.equal(on.preview.headingNumberStart, 2);
  assert.deepEqual(on.preview.headingNumberLevels, [2, 3, 4]);
  assert.equal(on.publish.headingNumberStart, 2);

  // 旧キー heading_numbers_in_publish は無視し、heading_numbers だけを見る
  const legacy = markdown.headingNumberOptionsFromProperties({
    heading_numbers: true,
    heading_numbers_in_publish: false,
  });
  assert.equal(legacy.publish.headingNumbers, true);
  assert.equal(legacy.preview.headingNumberStart, 2);
  assert.equal(markdown.DEFAULT_HEADING_NUMBER_START, 2);
  assert.equal(markdown.normalizeHeadingNumberStart(undefined), 2);
  assert.equal(markdown.normalizeHeadingNumberStart(1), 1);

  const selected = markdown.headingNumberOptionsFromProperties({
    heading_numbers: true,
    heading_number_levels: [1, 3],
  });
  assert.deepEqual(selected.preview.headingNumberLevels, [1, 3]);
  const selectedLabels = markdown.computeHeadingNumberLabels([
    { level: 1, text: "First" },
    { level: 2, text: "Unnumbered" },
    { level: 3, text: "Detail A" },
    { level: 3, text: "Detail B" },
    { level: 1, text: "Second" },
    { level: 3, text: "Detail C" },
  ], [1, 3]);
  assert.deepEqual(selectedLabels, ["1.", null, "1.1", "1.2", "2.", "2.1"]);
  const nonContiguous = markdown.renderMarkdownPreview("# Title\n### Detail\n# Next", selected.preview);
  assert.match(nonContiguous, /<h1 id="md-h-0"[^>]*><span class="md-heading-number">1\.<\/span> Title<\/h1>/);
  assert.match(nonContiguous, /<h3 id="md-h-1"[^>]*><span class="md-heading-number">1\.1<\/span> Detail<\/h3>/);
  assert.match(nonContiguous, /<h1 id="md-h-2"[^>]*><span class="md-heading-number">2\.<\/span> Next<\/h1>/);

  const off = markdown.headingNumberOptionsFromProperties({});
  assert.equal(off.preview.headingNumbers, false);
  assert.equal(off.publish.headingNumbers, false);

  const doc = markdown.previewDocument("# Title\n## Section", "markdown", {
    headingNumbers: true,
    headingNumberStart: 2,
  });
  assert.match(doc, /md-heading-number/);
  assert.match(doc, /<h1 id="md-h-0"[^>]*>Title<\/h1>/);
  assert.match(doc, /1\./);

  const labels = markdown.computeHeadingNumberLabels([
    { level: 2, text: "First" },
    { level: 3, text: "Nested" },
    { level: 2, text: "1. Manual" },
  ]);
  assert.deepEqual(labels, ["1.", "1.1", null]);

  const notesSource = [
    readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8"),
    readFileSync("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", "utf8"),
    readFileSync("src/renderer/src/features/workspace/components/MarkdownDiffMarkerRail.tsx", "utf8"),
  ].join("\n");
  assert.match(notesSource, /heading_numbers/);
  assert.match(notesSource, /heading_number_start/);
  assert.match(notesSource, /heading_number_levels/);
  assert.match(notesSource, /headingNumberOptions=\{headingNumberOptions\.preview\}/);
  assert.match(notesSource, /headingNumberLevels,/);
  assert.doesNotMatch(notesSource, /整形を戻す|formatUndoBody/);
  assert.match(notesSource, /applyHeadingNumberAttributes/);
  assert.match(notesSource, /見出し番号/);
  assert.match(notesSource, /HEADING_NUMBER_LEVELS/);
  // 見出し番号レベルの選択は出力menuの項目になった（#331）。
  assert.match(notesSource, /id: `heading-level-\$\{level\}`/);
  assert.doesNotMatch(notesSource, /PDFにも番号|heading_numbers_in_publish/);

  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(css, /data-heading-number/);
  assert.match(css, /note-heading-start-select/);
  assert.match(css, /markdown-diff-marker\.is-added/);
  assert.match(css, /markdown-diff-marker\.is-removed/);
  assert.match(css, /markdown-diff-marker\.is-changed/);
  assert.match(css, /markdown-diff-marker\.is-changed[^}]*linear-gradient/);
  assert.match(css, /markdown-diff-panel[^}]*height: min\(42vh, 360px\)/);
  assert.match(css, /markdown-diff-navigation[^}]*flex-wrap: nowrap/);
  assert.match(css, /markdown-diff-navigation > span[^}]*min-width: 5ch/);
  assert.match(css, /markdown-diff-count\.is-added/);
  assert.match(css, /markdown-diff-count\.is-removed/);
  assert.match(css, /markdown-diff-line\.is-current-change/);
  assert.match(css, /markdown-diff-line\.is-other-change/);
  assert.match(notesSource, /保存済み → 編集中/);
  assert.match(notesSource, /aria-current=\{isCurrentChange \? "true" : undefined\}/);
  assert.match(notesSource, /MarkdownDiffMarkerRail/);
  assert.doesNotMatch(notesSource, /className="note-preview-theme"/);
  assert.match(notesSource, /selected\.created_at \|\| selected\.updated_at \|\| draftState/);
  assert.doesNotMatch(notesSource, /draftState \|\| "\\u00a0"/);
  assert.match(notesSource, /containerLeft/);
  assert.match(notesSource, /left: markerLeft/);
  assert.match(notesSource, /contentHeight/);
  assert.match(notesSource, /lineHeight/);
  assert.match(notesSource, /findMarkerAnchor/);
  assert.match(notesSource, /anchorTops/);
  assert.match(notesSource, /metrics\.lineHeight \/ 2/);
  assert.match(notesSource, /compositionstart/);
  assert.match(notesSource, /compositionupdate/);
  assert.match(notesSource, /withEditContext\.editContext = null/);
  assert.match(notesSource, /markdown-diff-panel/);
  assert.match(notesSource, /const bottomMargin = 96/);
  assert.match(notesSource, /previewMode !== "preview"/);
  assert.match(notesSource, /note-main-editor-raw/);
  assert.match(notesSource, /scrollToMarker/);
  assert.match(notesSource, /setActiveIndex\(markers\.length > 0 \? 0 : null\)/);
  assert.match(notesSource, /scrollToMarker\(0\)/);
  assert.match(notesSource, /onRestoreHunk/);
  assert.match(notesSource, /restoreMarkdownDiffHunk/);
  assert.match(notesSource, /元に戻す/);
  assert.match(notesSource, /前へ/);
  assert.match(notesSource, /次へ/);
  assert.match(css, /markdown-diff-marker-rail/);
  assert.match(css, /markdown-diff-panel/);
  assert.doesNotMatch(notesSource, /markdown-diff-popover/);
  assert.match(css, /white-space: pre-wrap/);
});

test("outlookHtml creates simple styled HTML without tasken image references", () => {
  const html = markdown.outlookHtml(`---
type: report
---
# 週報

- 試作条件を整理
- CAE結果を確認

![Chart](tasken-attachment://local/image.png/chart)`, "markdown");

  assert.match(html, /font-family/);
  assert.match(html, /<h1 style=/);
  assert.match(html, /<li style=/);
  assert.match(html, /\[画像: Chart\]/);
  assert.doesNotMatch(html, /tasken-attachment:/);
  assert.doesNotMatch(html, /Frontmatter/);
});

test("lightweight callout renders existing INSIGHT syntax as MEMO and keeps plain blockquotes", () => {
  const html = markdown.renderMarkdownPreview(`> [!INSIGHT]
> コメントを書く

> 普通の引用

> [!NOTE]
> 旧記法も同じ見た目
`);

  assert.match(html, /class="md-callout"/);
  assert.match(html, /data-callout="insight"/);
  assert.match(html, /class="md-callout-label">MEMO<\/div>/);
  assert.match(html, /コメントを書く/);
  assert.doesNotMatch(html, /\[!INSIGHT\]/);
  assert.match(html, /<blockquote><p>普通の引用<\/p><\/blockquote>/);
  assert.match(html, /旧記法も同じ見た目/);

  assert.deepEqual(markdown.parseCalloutMarker("[!INSIGHT]"), { kind: "INSIGHT", rest: "" });
  assert.equal(markdown.parseCalloutMarker("[!note] rest text")?.kind, "INSIGHT");
  assert.equal(markdown.parseCalloutMarker("[!note] rest text")?.rest, "rest text");
  assert.equal(markdown.parseCalloutMarker("not a callout"), null);
  assert.match(markdown.INSIGHT_CALLOUT_SNIPPET, /> \[!INSIGHT\]/);
  assert.match(markdown.INSIGHT_CALLOUT_SNIPPET, /> メモを書く/);
  assert.equal(markdown.CALLOUT_LABEL, "MEMO");
  assert.equal(markdown.CALLOUT_INPUT_PLACEHOLDER, "メモを書く");

  const doc = markdown.previewDocument("> [!INSIGHT]\n> PDFでも見える", "markdown");
  assert.match(doc, /class="md-callout"/);
  assert.match(doc, /\.markdown-document \.md-callout\{/);
  assert.match(doc, /--markdown-document-callout-marker:\s*#c77d29/i);
  assert.match(doc, /PDFでも見える/);

  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(css, /\.markdown-preview \.md-callout/);
  assert.match(css, /--color-warning/);
  assert.match(css, /blockquote\.md-callout/);
  assert.match(css, /md-callout-marker/);
  assert.match(css, /md-callout-marker-only/);
  assert.match(css, /md-callout-marker-multiline/);
  assert.match(css, /content: attr\(data-callout-label\)/);

  const richEditorSource = readFileSync("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", "utf8");
  const notesSource = [
    readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8"),
    richEditorSource,
  ].join("\n");
  assert.match(notesSource, /applyCalloutDecorations/);
  assert.doesNotMatch(notesSource, /insertNoteCallout/);

  // Edit 装飾: マーカー専用段落なら「MEMO」表示用 class を付ける（軽量 DOM モック）
  class FakeClassList {
    constructor() { this._set = new Set(); }
    contains(name) { return this._set.has(name); }
    add(name) { this._set.add(name); }
    remove(name) { this._set.delete(name); }
  }
  function el(tag, text = "") {
    const node = {
      tagName: tag.toUpperCase(),
      textContent: text,
      classList: new FakeClassList(),
      _attrs: {},
      children: [],
      getAttribute(name) { return this._attrs[name] ?? null; },
      setAttribute(name, value) { this._attrs[name] = value; },
      removeAttribute(name) { delete this._attrs[name]; },
      hasAttribute(name) { return name in this._attrs; },
      querySelector(sel) {
        if (sel === ":scope > p") return this.children.find((c) => c.tagName === "P") || null;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === "blockquote") return this.children.filter((c) => c.tagName === "BLOCKQUOTE");
        return [];
      },
    };
    return node;
  }
  const pMarker = el("p", "[!NOTE]");
  const pBody = el("p", "本文");
  const quote = el("blockquote");
  quote.children = [pMarker, pBody];
  const root = el("div");
  root.children = [quote];
  markdown.applyCalloutDecorations(root);
  assert.equal(quote.classList.contains("md-callout"), true);
  assert.equal(quote.getAttribute("data-callout-label"), "MEMO");
  assert.equal(pMarker.classList.contains("md-callout-marker-only"), true);
  assert.equal(pMarker.getAttribute("data-callout-label"), "MEMO");
  assert.match(notesSource, /title="MEMOを挿入"/);
  assert.match(notesSource, /editor\.insertMarkdown\(INSIGHT_CALLOUT_SNIPPET\)/);
  assert.match(notesSource, /selectInsertedMemoPlaceholder\(editorScopeRef\.current\)/);
  assert.match(notesSource, /\$getNearestNodeFromDOMNode\(node\)/);
  assert.match(notesSource, /lexicalNode\.select\(start, start \+ CALLOUT_INPUT_PLACEHOLDER\.length\)/);
  assert.doesNotMatch(richEditorSource, /document\.createRange\(\)/);
  assert.match(richEditorSource, /handleCalloutMarkerEnter/);
  assert.match(richEditorSource, /quoteNode\.append\(\$createLineBreakNode\(\), placeholder\)/);
  assert.match(richEditorSource, /placeholder\.select\(0, CALLOUT_INPUT_PLACEHOLDER\.length\)/);
  assert.match(richEditorSource, /onKeyDownCapture=.*handleCalloutMarkerEnter/);
  assert.match(richEditorSource, /parseCalloutMarker\(quoteNode\.getTextContent\(\)\.trim\(\)\)/);
});

test("extractMarkdownHeadings builds index items and skips code fences", () => {
  const headings = markdown.extractMarkdownHeadings(`---
title: t
---
# 概要

\`\`\`
# not a heading
\`\`\`

## 背景
### 詳細
#### 補足
`);

  assert.deepEqual(headings, [
    { index: 0, level: 1, text: "概要", id: "md-h-0", sourceLine: 3 },
    { index: 1, level: 2, text: "背景", id: "md-h-1", sourceLine: 9 },
    { index: 2, level: 3, text: "詳細", id: "md-h-2", sourceLine: 10 },
    { index: 3, level: 4, text: "補足", id: "md-h-3", sourceLine: 11 },
  ]);
  assert.equal(markdown.HEADING_INDEX_MIN_COUNT, 2);
  assert.equal(markdown.markdownHeadingId(2), "md-h-2");

  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(notesSource, /MarkdownHeadingIndex/);
  assert.match(notesSource, /extractMarkdownHeadings/);
  assert.match(notesSource, /jumpToMarkdownHeading/);
  assert.match(notesSource, /note-markdown-surface/);

  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(css, /\.md-heading-index-trigger/);
  assert.match(css, /\.md-heading-index-bars/);
  assert.match(css, /\.md-heading-index-panel/);
  assert.match(css, /\.md-heading-index-item/);
  assert.match(css, /top: 50%/);
  assert.match(css, /right: 18px/);

  const indexSource = readFileSync("src/renderer/src/features/workspace/components/MarkdownHeadingIndex.tsx", "utf8");
  assert.match(indexSource, /onMouseEnter/);
  assert.match(indexSource, /onMouseLeave/);
  assert.match(indexSource, /level === 2/);
  assert.match(indexSource, /barCount|barHeadings/);
  assert.match(indexSource, /activeBarIndex|is-active/);
  assert.match(indexSource, /addEventListener\("scroll"/);
  assert.match(indexSource, /resolveActiveIndex/);
  assert.match(indexSource, /rawHeadingScrollTop\(heading\.sourceLine, sourceLineCount, scroller\.scrollHeight\)/);
  assert.match(notesSource, /sourceLineCount=\{indexedLineCount\}/);
  assert.match(notesSource, /mode=\{previewMode\}/);
  // Edit 面は contenteditable 外側のスクロールラッパへ追従する。
  assert.match(indexSource, /querySelector<HTMLElement>\("\.note-live-editor \[class\*='_rootContentEditableWrapper_'\]"\)/);
  assert.match(indexSource, /computeHeadingNumberLabels/);
  assert.match(indexSource, /headingNumberOptions/);
  assert.match(indexSource, /md-heading-index-item-number/);
  assert.doesNotMatch(indexSource, /onClick=\{\(\) => setOpen/);
  assert.match(css, /span\.is-active/);
  assert.match(css, /md-heading-index-item-number/);
  assert.match(css, /max-height: min\(640px, 78vh\)/);
});

test("CJK隣接の強調が Preview で太字になる（#285）", () => {
  // 素の CommonMark では約物が ** の内側・日本語が外側だと強調にならない。
  const cases = [
    "文章中の**（重要）**です",
    "これは**（重要）**です",
    "本文の**「引用」**が続く",
    "見出しの**【要点】**を読む",
    "**重要。**続く",
    "項目**・一覧**です",
  ];
  for (const source of cases) {
    const html = markdown.previewHtml(source, "markdown");
    assert.match(html, /<strong>/, `強調にならなかった: ${source}`);
  }
});

test("既存の強調・非強調の判定が変わらない（#285）", () => {
  const strong = [
    "This is **bold** text",
    "(**important**)",
    "**（重要）**",
    "（**重要**）",
    "これは**重要**です",
    "日本語**bold English**日本語",
    "[**リンク文字**](https://example.com)",
  ];
  for (const source of strong) {
    assert.match(markdown.previewHtml(source, "markdown"), /<strong>/, `強調が消えた: ${source}`);
  }
  // 閉じていない ** は強調にしない。
  assert.doesNotMatch(markdown.previewHtml("**未閉じ", "markdown"), /<strong>/);
});

test("CJK隣接の取り消し線が Preview で反映される（#285）", () => {
  const cases = [
    "文章中の~~（削除）~~です",
    "これは~~取り消し。~~続く",
    "本文の~~「引用」~~が続く",
  ];
  for (const source of cases) {
    assert.match(markdown.previewHtml(source, "markdown"), /<del>/, `取り消し線にならなかった: ${source}`);
  }
  assert.match(markdown.previewHtml("This is ~~struck~~ text", "markdown"), /<del>/);
});

test("Editor も Preview と同じ CJK 拡張を使う（#285）", () => {
  const pluginSource = readFileSync("src/renderer/src/features/workspace/components/markdownCjkFriendlyPlugin.ts", "utf8");
  assert.match(pluginSource, /cjkFriendlyExtension/);
  assert.match(pluginSource, /gfmStrikethroughCjkFriendly/);
  assert.match(pluginSource, /addSyntaxExtension\$/);
  const editorSource = readFileSync("src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx", "utf8");
  assert.match(editorSource, /markdownCjkFriendlyPlugin\(\)/);
});

test("縦長画像を max-height で切らない（#289）", () => {
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  // Notes の preview panel は以前 max-height: min(70vh, 720px) で縦を切っていた。
  const block = css.match(/\.note-preview-panel \.note-mdx-content img,[\s\S]*?\}/);
  assert.ok(block, "note-preview-panel の画像ルールが見つからない");
  assert.match(block[0], /max-height:\s*none/);
  assert.doesNotMatch(block[0], /max-height:\s*min\(/);
  assert.doesNotMatch(css, /\.note-preview-panel[^{]*img[^{]*\{[^}]*max-height:\s*\d+px/);
});

test("Markdown 画像は幅を正本にして高さを自動計算する（#289）", () => {
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  const previewImg = css.match(/\.markdown-preview \.md-image img \{[\s\S]*?\}/);
  assert.ok(previewImg, "markdown-preview の画像ルールが見つからない");
  assert.match(previewImg[0], /height:\s*auto/);
  assert.doesNotMatch(previewImg[0], /object-fit:\s*cover/);
  // PDF / document 面も同じ契約にする。
  const docCss = readFileSync("src/renderer/src/features/workspace/lib/markdown.ts", "utf8");
  assert.match(docCss, /\.markdown-document \.md-image img\{[^}]*height:auto/);
  assert.doesNotMatch(docCss, /\.markdown-document \.md-image img\{[^}]*object-fit:cover/);
});

test("画像は width 指定がなければ元幅を超えない（#289）", () => {
  const withWidth = markdown.previewHtml('<img src="https://example.com/a.png" alt="x" width="300">', "markdown");
  assert.match(withWidth, /width:min\(100%, 300px\)/);
  assert.match(withWidth, /height:auto/);
  const withoutWidth = markdown.previewHtml('<img src="https://example.com/a.png" alt="x">', "markdown");
  assert.match(withoutWidth, /max-width:100%/);
  assert.match(withoutWidth, /height:auto/);
});

test("画像の左右にリサイズ用の余白を残す（#287）", () => {
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  // gutter と既定幅はトークン変数から取る。
  assert.match(css, /--image-resize-gutter:\s*var\(--space-\d+\)/);
  assert.match(css, /--image-default-width:\s*\d+%/);
  assert.match(css, /--image-resize-hit-slop:\s*var\(--space-\d+\)/);

  const editorImg = css.match(/\.note-mdx-content img \{[\s\S]*?\}/);
  assert.ok(editorImg, "note-mdx-content の画像ルールが見つからない");
  // 幅いっぱいだとハンドルが編集領域の端に張り付く。
  assert.match(editorImg[0], /max-width:\s*calc\(100% - var\(--image-resize-gutter\) \* 2\)/);
});

test("幅未指定の画像は本文幅より狭く置く（#287）", () => {
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  // 挿入直後（width 属性なし）は既定幅。利用者が決めた幅は尊重する。
  assert.match(css, /\.note-mdx-content img:not\(\[width\]\) \{[^}]*max-width:\s*var\(--image-default-width\)/);
  assert.match(css, /\.markdown-preview \.md-image:not\(\.has-display-width\) img \{[^}]*max-width:\s*var\(--image-default-width\)/);
});

test("リサイズハンドルがクリップされない（#287）", () => {
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(css, /\[class\*="_imageResizer_"\]::before \{[\s\S]*?inset:\s*calc\(var\(--image-resize-hit-slop\) \* -1\)/);
  const overflowRule = css.match(/\.note-mdx-content \[class\*="_imageWrapper_"\] > div \{\s*\n\s*overflow: visible;/);
  assert.ok(overflowRule || /overflow:\s*visible/.test(css), "wrapper に overflow: visible がない");
});
