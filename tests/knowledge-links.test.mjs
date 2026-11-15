import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function importBundled(relativePath) {
  // KaTeX フォント埋め込みで data: URL が肥大化するため、一時ファイル経由で import する。
  const outDir = mkdtempSync(path.join(tmpdir(), "tasken-kl-"));
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

const knowledgeLinks = await importBundled("src/renderer/src/features/workspace/lib/knowledgeLinks.ts");
const markdown = await importBundled("src/renderer/src/features/workspace/lib/markdown.ts");

test("wiki links parse target and alias from markdown text", () => {
  assert.deepEqual(knowledgeLinks.parseWikiLinks("メモ [[仮説A]] と [[根拠B|根拠]]"), [
    { raw: "[[仮説A]]", target: "仮説A", alias: "仮説A" },
    { raw: "[[根拠B|根拠]]", target: "根拠B", alias: "根拠" },
  ]);
});

test("markdown preview renders wiki links as knowledge chips", () => {
  const html = markdown.renderMarkdownPreview("関連: [[仮説A|この仮説]]");
  assert.match(html, /class="md-wiki-link"/);
  assert.match(html, /data-knowledge-target="仮説A"/);
  assert.match(html, />この仮説</);
});
