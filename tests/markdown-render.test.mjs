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
  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
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

  assert.match(html, /class="markdown-document"/);
  assert.match(html, /--markdown-accent:#2D7FB8/);
  assert.match(html, /--markdown-accent-bd:#C3DCEE/);
  assert.match(html, /--markdown-paper-secondary:#6f625b/);
  assert.match(html, /<h4>Detail<\/h4>/);
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
  assert.match(html, /padding:3px var\(--md-space-2\)/);
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
  assert.match(doc, /<h1>Title<\/h1>/);
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
  assert.match(doc, /\.markdown-document \.md-math-inline\{display:inline/);
  assert.doesNotMatch(doc, /\.md-math-inline\{[^}]*font-family:Georgia/);
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

test("markdown preview renders MDX editor html img tags with safe attachment urls", () => {
  const html = markdown.renderMarkdownPreview(`# Title

<img height="280" width="742" alt="image" src="tasken-attachment://local/a5a3a30d-097e-4398-b604-8f80828af63e.png/image" />
`);

  assert.match(html, /class="md-image has-display-width"/);
  assert.match(html, /src="tasken-attachment:\/\/local\/a5a3a30d-097e-4398-b604-8f80828af63e\.png\/image"/);
  assert.match(html, /width="742"/);
  assert.match(html, /height="280"/);
  // 指定幅を px で反映し、max-width:100% で本文を超えない。等比は aspect-ratio + height:auto
  assert.match(html, /width:742px/);
  assert.match(html, /max-width:100%/);
  assert.match(html, /height:auto/);
  assert.match(html, /aspect-ratio:742 \/ 280/);
  assert.doesNotMatch(html, /&lt;img/);
});

test("markdown preview accepts fractional MDX resize widths", () => {
  const html = markdown.renderMarkdownPreview(
    `<img height="120.4" width="333.7" alt="resized" src="tasken-attachment://local/a5a3a30d-097e-4398-b604-8f80828af63e.png/image" />`,
  );
  assert.match(html, /width="334"/);
  assert.match(html, /width:334px/);
  assert.match(html, /aspect-ratio:334 \/ 120/);
  assert.match(html, /has-display-width/);
});

test("notes editor hides north-south only image resizers", () => {
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(css, /_imageResizerN_/);
  assert.match(css, /_imageResizerS_/);
  assert.match(css, /display: none !important/);
  assert.match(css, /height: auto !important/);
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
  const source = readFileSync(path.resolve("src/renderer/src/features/workspace/pages/NotesPage.tsx"), "utf8");
  assert.match(source, /disableImageResize:\s*false/);
  assert.match(source, /allowSetImageDimensions:\s*true/);
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
  assert.match(doc, /border:1px solid #C9D8E2/);
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
  assert.match(off, /<h1>概要<\/h1>/);
  assert.doesNotMatch(off, /md-heading-number/);

  // 既定は h2 から（h1 は番号なし）
  const html = markdown.renderMarkdownPreview(source, { headingNumbers: true });
  assert.match(html, /<h1>概要<\/h1>/);
  assert.doesNotMatch(html, /md-heading-number">1\.<\/span> 概要/);
  assert.match(html, /<h2><span class="md-heading-number">1\.<\/span> 背景<\/h2>/);
  assert.match(html, /<h3><span class="md-heading-number">1\.1<\/span> 詳細<\/h3>/);
  assert.match(html, /<h4><span class="md-heading-number">1\.1\.1<\/span> 補足<\/h4>/);
  assert.match(html, /<h2><span class="md-heading-number">2\.<\/span> 目的<\/h2>/);
  assert.match(html, /<h1>方針<\/h1>/);
  // 手動番号は二重にしない（カウンタは進める）
  assert.match(html, /<h2>1\. 既に番号あり<\/h2>/);
  assert.doesNotMatch(html, /md-heading-number">3\.<\/span> 1\. 既に番号あり/);
  assert.match(html, /<h3><span class="md-heading-number">3\.1<\/span> 通常<\/h3>/);
  assert.match(html, /<h1>第1章 手動章<\/h1>/);
  assert.match(html, /<h2>\(1\) 括弧番号<\/h2>/);
  assert.match(html, /<h3>① 丸数字<\/h3>/);

  // h1 からを明示するとタイトルにも番号が付く
  const fromH1 = markdown.renderMarkdownPreview(source, { headingNumbers: true, headingNumberStart: 1 });
  assert.match(fromH1, /<h1><span class="md-heading-number">1\.<\/span> 概要<\/h1>/);
  assert.match(fromH1, /<h2><span class="md-heading-number">1\.1<\/span> 背景<\/h2>/);

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

  assert.match(html, /<h2><span class="md-heading-number">1\.<\/span> First<\/h2>/);
  assert.match(html, /<h3><span class="md-heading-number">1\.1<\/span> Nested<\/h3>/);
  assert.match(html, /<h2><span class="md-heading-number">2\.<\/span> Second<\/h2>/);
});

test("headingNumberStart skips shallower headings (e.g. h1 unnumbered)", () => {
  const source = `# Title
## Section
### Detail
## Next`;

  const fromH2 = markdown.renderMarkdownPreview(source, { headingNumbers: true, headingNumberStart: 2 });
  assert.match(fromH2, /<h1>Title<\/h1>/);
  assert.doesNotMatch(fromH2, /md-heading-number">1\.<\/span> Title/);
  assert.match(fromH2, /<h2><span class="md-heading-number">1\.<\/span> Section<\/h2>/);
  assert.match(fromH2, /<h3><span class="md-heading-number">1\.1<\/span> Detail<\/h3>/);
  assert.match(fromH2, /<h2><span class="md-heading-number">2\.<\/span> Next<\/h2>/);

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

  const off = markdown.headingNumberOptionsFromProperties({});
  assert.equal(off.preview.headingNumbers, false);
  assert.equal(off.publish.headingNumbers, false);

  const doc = markdown.previewDocument("# Title\n## Section", "markdown", {
    headingNumbers: true,
    headingNumberStart: 2,
  });
  assert.match(doc, /md-heading-number/);
  assert.match(doc, /<h1>Title<\/h1>/);
  assert.match(doc, /1\./);

  const labels = markdown.computeHeadingNumberLabels([
    { level: 2, text: "First" },
    { level: 3, text: "Nested" },
    { level: 2, text: "1. Manual" },
  ]);
  assert.deepEqual(labels, ["1.", "1.1", null]);

  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(notesSource, /heading_numbers/);
  assert.match(notesSource, /heading_number_start/);
  assert.match(notesSource, /headingNumberOptions=\{headingNumberOptions\.preview\}/);
  assert.match(notesSource, /applyHeadingNumberAttributes/);
  assert.match(notesSource, /見出し番号/);
  assert.match(notesSource, /HEADING_NUMBER_START/);
  assert.doesNotMatch(notesSource, /PDFにも番号|heading_numbers_in_publish/);

  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(css, /data-heading-number/);
  assert.match(css, /note-heading-start-select/);
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
