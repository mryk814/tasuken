import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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

test("previewDocument includes readable markdown document styling", () => {
  const html = markdown.previewDocument("# Title\n\n#### Detail\n\n***\n\n| A | B |\n| --- | --- |\n| 1 | 2 |", "markdown");

  assert.match(html, /class="markdown-document"/);
  assert.match(html, /#2D7FB8/);
  assert.match(html, /\.markdown-document h4/);
  assert.match(html, /<h4>Detail<\/h4>/);
  assert.match(html, /\.markdown-document p\{margin:5px 0\}/);
  assert.match(html, /\.markdown-document hr/);
  assert.match(html, /<hr \/>/);
  assert.match(html, /blockquote/);
  assert.match(html, /border-collapse:collapse/);
  assert.match(html, /padding:5px 7px/);
  assert.match(html, /<table>/);
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
