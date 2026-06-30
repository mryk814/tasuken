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
