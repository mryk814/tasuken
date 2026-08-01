/**
 * Edit / Preview / PDF の文書面で共有するスタイル。
 * 画面では head へ一度だけ挿入し、PDFでは同じ文字列をスタンドアロンHTMLへ埋め込む。
 * 色を明示値にすることで、印刷時の color-mix() 再計算による色差も避ける。
 */
export const MARKDOWN_DOCUMENT_SURFACES_CSS = `
.note-mdx-content,
.markdown-preview,
.markdown-document {
  --markdown-document-heading-bg: #ecf3f9;
  --markdown-document-heading-marker: #4b90c3;
  --markdown-document-quote-bg: #fafcfd;
  --markdown-document-code-bg: #f5f9fc;
  --markdown-document-inline-code-bg: #f2f7fb;
  --markdown-document-table-head-bg: #f5f9fc;
  --markdown-document-table-stripe-bg: #fcfdfe;
  --markdown-document-block-border: #ded8d1;
  --markdown-document-math-bg: #f6f4f1;
  --markdown-document-math-text: #26211f;
  --markdown-document-callout-bg: #fbf0dd;
  --markdown-document-callout-border: #efd9b0;
  --markdown-document-callout-marker: #c77d29;
  --markdown-document-callout-label: #8a5212;
  --markdown-document-space-3: var(--space-3, var(--md-space-3, 12px));
  --markdown-document-radius-md: var(--radius-md, var(--md-radius-md, 7px));
}

.note-mdx-content .note-editor-math-inline,
.markdown-preview .md-math-inline,
.markdown-document .md-math-inline {
  display: inline;
  padding: 0 .12em;
  color: var(--markdown-document-math-text);
  vertical-align: baseline;
}

.note-mdx-content .note-editor-math-block,
.markdown-preview .md-math-block,
.markdown-document .md-math-block {
  overflow-x: auto;
  margin: var(--markdown-document-space-3) 0;
  padding: var(--markdown-document-space-3);
  border: 1px solid var(--markdown-document-block-border);
  border-radius: var(--markdown-document-radius-md);
  background: var(--markdown-document-math-bg);
  color: var(--markdown-document-math-text);
  line-height: 1.72;
  text-align: center;
}

.markdown-preview .md-math-inline .katex,
.markdown-preview .md-math-block .katex,
.markdown-document .md-math-inline .katex,
.markdown-document .md-math-block .katex {
  color: inherit;
}

.markdown-preview .md-math-block .katex-display,
.markdown-document .md-math-block .katex-display {
  margin: 0;
}

.markdown-preview .md-math-operator,
.markdown-document .md-math-operator {
  margin-right: .18em;
  font-style: normal;
}

.markdown-preview .md-math-inline sub,
.markdown-preview .md-math-block sub,
.markdown-document .md-math-inline sub,
.markdown-document .md-math-block sub {
  font-size: .68em;
  vertical-align: -.35em;
}

.markdown-preview .md-math-inline sup,
.markdown-preview .md-math-block sup,
.markdown-document .md-math-inline sup,
.markdown-document .md-math-block sup {
  font-size: .68em;
  vertical-align: .55em;
}
`;

export function installMarkdownDocumentSurfaces(target: Document): void {
  if (target.head.querySelector("style[data-tasken-markdown-surfaces]")) return;
  const style = target.createElement("style");
  style.dataset.taskenMarkdownSurfaces = "true";
  style.textContent = MARKDOWN_DOCUMENT_SURFACES_CSS;
  // app.css を後勝ちにし、Edit 固有の hover / editing 状態は上書きできるようにする。
  target.head.prepend(style);
}
