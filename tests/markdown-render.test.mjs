import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const markdown = await importBundled("src/renderer/src/features/workspace/lib/markdown.ts");

test("markdown preview renders tasken images and math markers", () => {
  const html = markdown.renderMarkdownPreview(`# Title

Inline math $a^2 + b^2 = c^2$.

$$
x_{t+1} = \\arg\\max_x \\alpha_t(x)
$$

![Chart](tasken-attachment://local/00000000-0000-0000-0000-000000000000.png/chart)`);

  assert.match(html, /<h1>Title<\/h1>/);
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

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<h2>Section<\/h2>/);
  assert.match(html, /<h3>Finding<\/h3>/);
  assert.match(html, /<h4>Detail<\/h4>/);
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

test("markdown preview renders safe ordinary links and rejects unsafe link urls", () => {
  const html = markdown.renderMarkdownPreview("[OpenAI](https://openai.com) [mail](mailto:test@example.com) [bad](javascript:alert(1)) ![Chart](https://example.com/chart.png) [[Knowledge]]");

  assert.match(html, /<a href="https:\/\/openai\.com\/" target="_blank" rel="noreferrer">OpenAI<\/a>/);
  assert.match(html, /<a href="mailto:test@example.com" target="_blank" rel="noreferrer">mail<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /bad/);
  assert.match(html, /<img src="https:\/\/example\.com\/chart\.png" alt="Chart"/);
  assert.match(html, /class="md-wiki-link"/);
});

test("previewDocument includes readable markdown document styling", () => {
  const html = markdown.previewDocument("# Title\n\n#### Detail\n\n***\n\n| A | B |\n| --- | --- |\n| 1 | 2 |", "markdown");

  assert.match(html, /class="markdown-document"/);
  assert.match(html, /#2D7FB8/);
  assert.match(html, /\.markdown-document h4/);
  assert.match(html, /<h4>Detail<\/h4>/);
  assert.match(html, /border-bottom:1px solid #C3DCEE/);
  assert.match(html, /\.markdown-document p\{margin:5px 0\}/);
  assert.match(html, /\.markdown-document hr/);
  assert.match(html, /<hr \/>/);
  assert.match(html, /blockquote/);
  assert.match(html, /border-collapse:separate/);
  assert.match(html, /border-spacing:0/);
  assert.match(html, /padding:4px 7px/);
  assert.match(html, /<table>/);
});

test("markdown preview css separates heading levels and keeps tables compact", () => {
  const source = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.match(source, /\.markdown-preview h2 \{[^}]*border-bottom: 2px solid/s);
  assert.match(source, /\.markdown-preview h3 \{[^}]*border-left: 4px solid/s);
  assert.match(source, /\.markdown-preview h4 \{[^}]*font-size: var\(--text-base\)/s);
  assert.match(source, /\.markdown-preview table \{[^}]*border-collapse: collapse/s);
  assert.match(source, /\.markdown-preview tbody tr:last-child td \{[^}]*border-bottom: 0/s);
  assert.match(source, /\[class\*="_tableColumnEditorTrigger_"\][^}]*opacity: \.28/s);
});

test("markdown editing surfaces use a white paper background", () => {
  const source = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.match(source, /--markdown-paper: #fff;/);
  assert.match(source, /--markdown-paper-text: #26211f;/);
  assert.match(source, /\.note-main-editor \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.note-live-editor \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.note-mdx-content \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.note-main-preview \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.note-main-raw \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.markdown-preview \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
  assert.match(source, /\.artifact-preview-frame \{[^}]*background: var\(--markdown-paper\)/s);
  assert.match(source, /\.artifact-raw \{[^}]*background: var\(--markdown-paper\)[^}]*color: var\(--markdown-paper-text\)/s);
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

test("markdown preview does not render unsafe image urls", () => {
  const html = markdown.renderMarkdownPreview("![bad](javascript:alert(1))");

  assert.doesNotMatch(html, /<img /);
  assert.match(html, /\[画像: bad\]/);
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

test("math editor plugin transforms inline math beyond top-level paragraphs", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/components/markdownMathPlugin.tsx",
    "utf8",
  );

  assert.match(source, /\$collectInlineMathTextNodes/);
  assert.match(source, /transformInlineMathInTextNode/);
  assert.match(source, /hasFormat\("code"\)/);
});

test("notes page autosaves dirty drafts when switching notes or leaving the page", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/pages/NotesPage.tsx",
    "utf8",
  );

  assert.match(source, /autosaveRef/);
  assert.match(source, /自動保存に失敗しました/);
  assert.match(source, /\[selected\?\.id, saveEntity, setToast\]/);
});

test("notes page keeps scroll position when switching edit, preview, and raw modes", () => {
  const source = readFileSync(
    "src/renderer/src/features/workspace/pages/NotesPage.tsx",
    "utf8",
  );

  assert.match(source, /function switchPreviewMode/);
  assert.match(source, /function restoreModeScroll/);
  assert.match(source, /_rootContentEditableWrapper_/);
  assert.match(source, /switchPreviewMode\("edit"\)/);
  assert.match(source, /switchPreviewMode\("preview"\)/);
  assert.match(source, /switchPreviewMode\("raw"\)/);
  assert.doesNotMatch(source, /onClick=\{\(\) => setPreviewMode\(/);
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
