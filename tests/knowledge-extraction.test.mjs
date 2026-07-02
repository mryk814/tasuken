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

const knowledgeExtraction = await importBundled("src/renderer/src/features/workspace/lib/knowledgeExtraction.ts");

function note(extra = {}) {
  return {
    id: "note-1",
    title: "長文メモ",
    body_markdown: "本文",
    theme_id: "theme-1",
    ...extra,
  };
}

test("knowledge extraction detects bodies that should not be copied directly into one node", () => {
  assert.equal(knowledgeExtraction.isLongKnowledgeSource("x".repeat(knowledgeExtraction.KNOWLEDGE_DIRECT_BODY_LIMIT)), false);
  assert.equal(knowledgeExtraction.isLongKnowledgeSource("x".repeat(knowledgeExtraction.KNOWLEDGE_DIRECT_BODY_LIMIT + 1)), true);
});

test("direct knowledge drafts keep source references for short notes", () => {
  const draft = knowledgeExtraction.buildKnowledgeNodeDraftFromNote(note({ body_markdown: "短い気づき" }));

  assert.equal(draft.title, "長文メモ");
  assert.equal(draft.body, "短い気づき");
  assert.equal(draft.source_type, "note");
  assert.equal(draft.source_id, "note-1");
  assert.equal(draft.source_note_id, "note-1");
});

test("manual drafts for long notes keep source references without copying the huge body", () => {
  const draft = knowledgeExtraction.buildKnowledgeNodeDraftFromNote(
    note({ body_markdown: "x".repeat(knowledgeExtraction.KNOWLEDGE_DIRECT_BODY_LIMIT + 1) }),
    { bodyMode: "empty" },
  );

  assert.equal(draft.body, "");
  assert.equal(draft.source_type, "note");
  assert.equal(draft.source_id, "note-1");
  assert.equal(draft.source_note_id, "note-1");
});
