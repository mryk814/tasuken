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

test("knowledge backlinks and unlinked mentions separate explicit and candidate links", () => {
  const node = { id: "k1", title: "仮説A", node_type: "claim" };
  const result = knowledgeLinks.buildKnowledgeLinkContext(node, {
    notes: [
      { id: "n1", title: "明示", body_markdown: "これは [[仮説A]] です。" },
      { id: "n2", title: "候補", body_markdown: "仮説A をあとでつなぐ。" },
      { id: "n3", title: "別名", body_markdown: "[[仮説A|この仮説]]" },
    ],
    knowledge_nodes: [
      { id: "k1", title: "仮説A", body: "" },
      { id: "k2", title: "関連", body: "仮説A と関係する" },
    ],
  });

  assert.deepEqual(result.backlinks.map((entry) => entry.id), ["n1", "n3"]);
  assert.deepEqual(result.unlinkedMentions.map((entry) => entry.id), ["k2", "n2"]);
});

test("markdown preview renders wiki links as knowledge chips", () => {
  const html = markdown.renderMarkdownPreview("関連: [[仮説A|この仮説]]");
  assert.match(html, /class="md-wiki-link"/);
  assert.match(html, /data-knowledge-target="仮説A"/);
  assert.match(html, />この仮説</);
});

test("Knowledge detail and page expose quick creation, backlinks, unlinked mentions, and graph", () => {
  const pageSource = readFileSync("src/renderer/src/features/workspace/pages/KnowledgePage.tsx", "utf8");
  const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");

  assert.match(pageSource, /quickKnowledgeTitle/);
  assert.match(pageSource, /Knowledge Graph/);
  assert.match(drawerSource, /buildKnowledgeLinkContext/);
  assert.match(drawerSource, /Backlinks/);
  assert.match(drawerSource, /未リンク候補/);
  assert.match(drawerSource, /relation_type: "mentions"/);
});
