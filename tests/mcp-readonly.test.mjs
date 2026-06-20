import assert from "node:assert/strict";
import test from "node:test";

import { ReadOnlyTaskenContext } from "../src/main/mcp/readOnlyContext.mjs";

function setupContext() {
  const theme = { id: "theme-1", name: "材料A評価", updated_at: "2026-06-18T00:00:00.000Z" };
  const item = {
    id: "item-1",
    title: "測定結果を確認",
    theme_id: theme.id,
    status: "todo",
    planned_end: "2026-06-20",
    description: "条件Bを見る",
    updated_at: "2026-06-18T00:00:00.000Z",
  };
  const note = {
    id: "note-1",
    title: "解析メモ",
    body_markdown: "raw body should be protected",
    theme_id: theme.id,
    updated_at: "2026-06-18T00:00:00.000Z",
  };
  const claim = {
    id: "claim-1",
    node_type: "claim",
    title: "条件Bが遅延要因",
    theme_id: theme.id,
    source_note_id: note.id,
    updated_at: "2026-06-18T00:00:00.000Z",
  };
  const evidence = {
    id: "evidence-1",
    node_type: "evidence",
    title: "測定ログ",
    theme_id: theme.id,
    source_item_id: item.id,
    updated_at: "2026-06-18T00:00:00.000Z",
  };
  const relation = {
    id: "relation-1",
    source_node_id: claim.id,
    target_node_id: evidence.id,
    relation_type: "supports",
    updated_at: "2026-06-18T00:00:00.000Z",
  };
  return new ReadOnlyTaskenContext("in-memory.sqlite", {
    workspace: {
      themes: [theme],
      items: [item],
      notes: [note],
      links: [],
      status_updates: [],
      knowledge_nodes: [claim, evidence],
      knowledge_edges: [relation],
    },
  });
}

test("read-only MCP context searches items and knowledge without raw note bodies by default", () => {
  const context = setupContext();
  try {
    const items = context.toolSearchItems({ query: "測定", limit: 5 });
    assert.equal(items.items.length, 1);
    assert.equal(items.items[0].title, "測定結果を確認");

    const notes = context.toolGetRecentNotes({ limit: 5 });
    assert.equal(notes.notes.length, 1);
    assert.equal("body_markdown" in notes.notes[0], false);
    assert.match(notes.notes[0].body_excerpt, /raw body/);

    const rawNotes = context.toolGetRecentNotes({ limit: 5, include_raw_body: true });
    assert.equal(rawNotes.notes[0].body_markdown, "raw body should be protected");

    const knowledge = context.toolSearchKnowledge({ query: "遅延", limit: 5 });
    assert.equal(knowledge.knowledge_nodes[0].title, "条件Bが遅延要因");
  } finally {
    context.close();
  }
});

test("read-only MCP context exports AI context and health", () => {
  const context = setupContext();
  try {
    const health = context.toolGetKnowledgeHealth({ theme_id: "theme-1" });
    assert.equal(health.claims_without_evidence.length, 0);
    assert.equal(health.evidence_without_source.length, 0);

    const markdown = context.toolExportAiContext({ theme_id: "theme-1", format: "markdown" });
    assert.match(markdown, /# Tasken Context/);
    assert.match(markdown, /条件Bが遅延要因/);

    const json = context.toolExportAiContext({ theme_id: "theme-1", format: "json" });
    assert.equal(json.knowledge_nodes.length, 2);
    assert.equal(json.health.claims_without_evidence.length, 0);
  } finally {
    context.close();
  }
});
