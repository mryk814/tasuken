import assert from "node:assert/strict";
import test from "node:test";

import { previewTaskCoding } from "../src/shared/aiContextPreview.mjs";

test("Task Codingは実responseのtyped ref・metadata・relation path・locatorを保持する（#296）", () => {
  const input = {
    task: {
      id: "task-1",
      title: "Implement",
      description: "request",
      ai_freshness: "current",
      ai_authority: "user_confirmed",
    },
    theme: { id: "theme-1", name: "Research" },
    related: {
      notes: [
        {
          id: "note-1",
          title: "Decision",
          excerpt: "body excerpt must not be copied",
          included_because: "explicitly_linked",
          relation_path: [
            {
              from: { type: "task", id: "task-1" },
              predicate: "context",
              to: { type: "note", id: "note-1" },
              layer: "operational",
              origin: "reference",
            },
          ],
          locator: { tool: "tasken.get_note", arguments: { note_id: "note-1" }, unsafe: "ignored" },
          ai: {
            freshness: "stale",
            authority: "imported",
            source_refs: [{ kind: "url", locator: "https://example.com/note" }],
          },
        },
      ],
      artifacts: [
        { id: "artifact-1", title: "Report", included_because: "provenance", relation_path: [] },
      ],
    },
    limits: { max_items_per_type: 10, max_text_length: 50000 },
    truncation: { notes: { reason: "max_items_per_type", omitted_count: 2 } },
    warnings: [{ code: "relation_graph_truncated", message: "上限" }],
    truncated: true,
    excluded_count: 4,
    excluded_reasons: [{ type: "note", reason: "非公開", count: 4 }],
    unknown_private_field: "PRIVATE-UNKNOWN-TOP-LEVEL",
  };
  const before = structuredClone(input);
  const result = previewTaskCoding(input);

  assert.deepEqual(input, before);
  assert.deepEqual(
    result.included.map((entry) => entry.ref),
    [
      { type: "artifact", id: "artifact-1" },
      { type: "note", id: "note-1" },
      { type: "task", id: "task-1" },
      { type: "theme", id: "theme-1" },
    ],
  );
  const note = result.included.find((entry) => entry.ref.id === "note-1");
  assert.equal(note.bodyMode, "excerpt");
  assert.deepEqual(note.content, {
    mode: "excerpt",
    text: "body excerpt must not be copied",
    truncated: false,
    sourceField: "excerpt",
  });
  assert.equal(note.freshness, "stale");
  assert.equal(note.authority, "imported");
  assert.equal(note.includedReason, "explicitly_linked");
  assert.equal(note.relationPath[0].predicate, "context");
  assert.deepEqual(note.sourceLocator, {
    tool: "tasken.get_note",
    arguments: { note_id: "note-1" },
  });
  assert.deepEqual(note.sourceRefs, [{ kind: "url", locator: "https://example.com/note" }]);
  assert.equal(result.truncation.truncated, true);
  assert.ok(result.truncation.reasons.includes("max_items_per_type"));
  assert.equal(result.capabilities.relationDetails, "partial");
  assert.equal(result.capabilities.aiMetadata, "partial");
  assert.equal(result.capabilities.sourceLocators, "partial");
  assert.equal(result.counts.excluded, 4);
  assert.equal(JSON.stringify(result).includes("body excerpt must not be copied"), true);
  assert.equal(JSON.stringify(result).includes("PRIVATE-UNKNOWN-TOP-LEVEL"), false);
});

test("adapterはunknown fieldをコピーせず、異常入力と過大入力をfail-safeかつboundedに扱う（#296）", () => {
  const nodes = Array.from({ length: 600 }, (_, index) => ({
    type: "note",
    id: `note-${String(index).padStart(3, "0")}`,
    title: `T${"x".repeat(5_000)}`,
    ...(index === 0 ? { body_markdown: "b".repeat(5_000) } : {}),
    future_body: "must not leak",
  })).reverse();
  // Context subgraphの投影は#755 束2で外したので、同じ上限をTask Codingの関連Noteで確かめる。
  const result = previewTaskCoding({
    related: { notes: nodes },
    future_payload: { secret: "must not leak" },
  });

  assert.equal(result.included.length, 500);
  assert.equal(result.counts.included, 600);
  assert.equal(result.counts.representedIncluded, 500);
  assert.equal(result.included[0].ref.id, "note-000");
  assert.ok(result.included.every((entry) => entry.title.length <= 1_000));
  assert.deepEqual(result.included[0].content, {
    mode: "full",
    text: "b".repeat(4_000),
    truncated: true,
    sourceField: "body_markdown",
  });
  assert.equal(result.truncation.truncated, true);
  assert.ok(result.truncation.reasons.includes("adapter_max_included"));
  assert.ok(result.truncation.reasons.includes("adapter_max_content_text"));
  assert.equal(JSON.stringify(result).includes("must not leak"), false);

  assert.doesNotThrow(() => previewTaskCoding(null));
  assert.doesNotThrow(() => previewTaskCoding({ related: { notes: [null, 42, "x"] } }));
});
