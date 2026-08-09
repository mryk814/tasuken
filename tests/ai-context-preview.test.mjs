import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_CONTEXT_PREVIEW_SCHEMA,
  previewContextSubgraph,
  previewTaskCoding,
  previewThemeCoding,
  previewThemeM365,
} from "../src/shared/aiContextPreview.mjs";
import { buildThemeAiPackPlan } from "../src/shared/themeAiPack.mjs";

test("Theme M365はAI Pack planを再選択せずaggregate_onlyとして投影する（#296）", () => {
  const input = {
    audience: "m365",
    theme_id: "theme-1",
    included_entity_ids: ["note-2", "task-1"],
    excluded_count: 3,
    excluded_reasons: [{ type: "note", reason: "M365非公開", count: 3 }],
    files: [{ name: "01 Current Work.md", content: "secret body", content_hash: "sha256:abc", includedEntityIds: ["task-1"] }],
    manifest: { audience: "m365", includedEntityIds: ["note-2", "task-1"] },
    preview: {
      files: [{ name: "01 Current Work.md", includedCount: 1, characterCount: 11 }],
      includedCount: 2,
      excludedCount: 3,
      totalCharacterCount: 11,
      warnings: [{ kind: "stale", type: "note", id: "note-2", title: "Old", reason: "要確認" }],
    },
  };
  const before = structuredClone(input);
  const result = previewThemeM365(input);

  assert.deepEqual(input, before);
  assert.equal(result.schema, AI_CONTEXT_PREVIEW_SCHEMA);
  assert.deepEqual(result.scope.seed, { type: "theme", id: "theme-1" });
  assert.equal(result.capabilities.entityDetails, "aggregate_only");
  assert.equal(result.capabilities.exclusionDetails, "aggregate_only");
  assert.deepEqual(result.included, []);
  assert.deepEqual(result.untypedIncludedIds, ["note-2", "task-1"]);
  assert.deepEqual(result.counts, {
    included: 2,
    representedIncluded: 0,
    relations: 0,
    representedRelations: 0,
    excluded: 3,
    representedExcluded: 1,
  });
  assert.deepEqual(result.excluded[0], {
    kind: "aggregate",
    ref: null,
    edge: null,
    entityType: "note",
    reason: "M365非公開",
    count: 3,
  });
  assert.equal(result.files[0].contentHash, "sha256:abc");
  assert.deepEqual(result.files[0].content, { mode: "full", text: "secret body", truncated: false, sourceField: "content" });
  assert.equal(result.estimates.characters, 11);
});

test("Theme M365 adapterは実plannerの7ファイル・件数・本文をそのまま受け取る（#295 / #296）", () => {
  const plan = buildThemeAiPackPlan({
    theme: {
      id: "theme-live",
      name: "Live planner",
      ai_visibility: ["m365"],
      default_ai_visibility: ["m365"],
      ai_freshness: "current",
      ai_authority: "user_confirmed",
      ai_summary: "実planner fixture",
      ai_summary_authority: "user_confirmed",
    },
    candidates: [{
      type: "task",
      entity: {
        id: "task-live",
        title: "実producerのTask",
        project_id: "theme-live",
        state: "doing",
        ai_visibility: ["m365"],
        ai_freshness: "current",
        ai_authority: "user_confirmed",
        ai_summary: "実producerのsummary",
        ai_summary_authority: "user_confirmed",
      },
    }],
  });
  const result = previewThemeM365(plan);

  assert.equal(result.files.length, 7);
  assert.equal(result.counts.included, plan.preview.includedCount);
  assert.equal(result.estimates.characters, plan.preview.totalCharacterCount);
  assert.equal(result.files.find((file) => file.name === "01 Current Work.md").content.text.includes("実producerのTask"), true);
  assert.deepEqual(result.untypedIncludedIds, plan.included_entity_ids);
});

test("Task Codingは実responseのtyped ref・metadata・relation path・locatorを保持する（#296）", () => {
  const input = {
    ai_audience: "coding_agent",
    task: { id: "task-1", title: "Implement", description: "request", ai_visibility: ["coding_agent"], ai_freshness: "current", ai_authority: "user_confirmed" },
    theme: { id: "theme-1", name: "Research" },
    related: {
      notes: [{
        id: "note-1",
        title: "Decision",
        excerpt: "body excerpt must not be copied",
        included_because: "explicitly_linked",
        relation_path: [{ from: { type: "task", id: "task-1" }, predicate: "context", to: { type: "note", id: "note-1" }, layer: "operational", origin: "reference" }],
        locator: { tool: "tasken.get_note", arguments: { note_id: "note-1" }, unsafe: "ignored" },
        ai: { freshness: "stale", authority: "imported", ai_visibility: ["coding_agent"], source_refs: [{ kind: "url", locator: "https://example.com/note" }] },
      }],
      artifacts: [{ id: "artifact-1", title: "Report", included_because: "provenance", relation_path: [] }],
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
  assert.equal(result.audience, "coding_agent");
  assert.deepEqual(result.included.map((entry) => entry.ref), [
    { type: "artifact", id: "artifact-1" },
    { type: "note", id: "note-1" },
    { type: "task", id: "task-1" },
    { type: "theme", id: "theme-1" },
  ]);
  const note = result.included.find((entry) => entry.ref.id === "note-1");
  assert.equal(note.bodyMode, "excerpt");
  assert.deepEqual(note.content, { mode: "excerpt", text: "body excerpt must not be copied", truncated: false, sourceField: "excerpt" });
  assert.equal(note.freshness, "stale");
  assert.equal(note.authority, "imported");
  assert.equal(note.includedReason, "explicitly_linked");
  assert.equal(note.relationPath[0].predicate, "context");
  assert.deepEqual(note.sourceLocator, { tool: "tasken.get_note", arguments: { note_id: "note-1" } });
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

test("Theme CodingはTheme response内のEntityとKnowledge relationだけを投影する（#296）", () => {
  const result = previewThemeCoding({
    ai_audience: "coding_agent",
    themes: [{ id: "theme-1", name: "Theme", ai: { freshness: "current", authority: "user_confirmed", ai_visibility: ["coding_agent"] } }],
    repository_contexts: [{ id: "repo-1", label: "Tasuken" }],
    open_items: [{ id: "item-1", title: "Open" }],
    recent_notes: [{ id: "note-1", title: "Recent", body_excerpt: "not copied" }],
    knowledge: {
      knowledge_nodes: [{ id: "claim-1", title: "Claim" }, { id: "evidence-1", title: "Evidence" }],
      knowledge_edges: [{ id: "edge-1", source_node_id: "claim-1", target_node_id: "evidence-1", relation_type: "supported_by", status: "asserted" }],
    },
    excluded_count: 2,
    excluded_reasons: [{ type: "note", reason: "非公開", count: 2 }],
  });

  assert.deepEqual(result.scope.seed, { type: "theme", id: "theme-1" });
  assert.equal(result.included.length, 6);
  assert.deepEqual(result.relations[0].source, { type: "knowledge_node", id: "claim-1" });
  assert.deepEqual(result.relations[0].target, { type: "knowledge_node", id: "evidence-1" });
  assert.equal(result.relations[0].predicate, "supported_by");
  assert.equal(result.capabilities.relationDetails, "partial");
  assert.equal(result.capabilities.exclusionDetails, "aggregate_only");
  assert.equal(result.included.find((entry) => entry.ref.id === "note-1").content.text, "not copied");
});

test("Context subgraphはnode・edge・path・limits・tokenを安定順でlossless投影する（#296）", () => {
  const input = {
    ai_audience: "coding_agent",
    seed: { type: "task", id: "task-1" },
    nodes: [
      { type: "note", id: "note-1", title: "Note", ai_visibility: "coding_agent", ai_freshness: "stale", source_refs: ["note:source"] },
      { type: "task", id: "task-1", title: "Task" },
    ],
    edges: [{
      id: "edge-1",
      source: { type: "task", id: "task-1" },
      target: { type: "note", id: "note-1" },
      predicate: "context",
      layer: "operational",
      status: "asserted",
      origin: "reference",
      evidence_refs: [
        "note:id:with:colon",
        { type: "note", id: "id:with:colon" },
        { type: "note", id: "id:with:colon" },
      ],
      reason: "direct_relation",
      path: ["edge-1"],
    }],
    paths: [{ from: { type: "task", id: "task-1" }, to: { type: "note", id: "note-1" }, hops: 1, edge_ids: ["edge-1"] }],
    limits: { maxHops: 2, maxNodes: 24, maxEdges: 48, tokenBudget: 2400 },
    estimated_tokens: 123,
    truncated: true,
    exclusions: ["token_budget"],
  };
  const reverse = { ...input, nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse(), paths: [...input.paths].reverse() };
  const first = previewContextSubgraph(input);
  const second = previewContextSubgraph(reverse);

  assert.deepEqual(second, first);
  assert.equal(first.estimates.tokens, 123);
  assert.deepEqual(first.limits, input.limits);
  assert.equal(first.relations[0].reason, "direct_relation");
  assert.deepEqual(first.relations[0].evidenceRefs, ["note:id:with:colon", { type: "note", id: "id:with:colon" }]);
  const note = first.included.find((entry) => entry.ref.id === "note-1");
  assert.equal(note.includedReason, "direct_relation");
  assert.deepEqual(note.relationPath[0], {
    edgeId: "edge-1",
    source: { type: "task", id: "task-1" },
    target: { type: "note", id: "note-1" },
    predicate: "context",
    layer: "operational",
    status: "asserted",
    origin: "reference",
  });
  assert.deepEqual(note.sourceRefs, [{ locator: "note:source" }]);
  assert.equal(first.truncation.truncated, true);
  assert.deepEqual(first.truncation.reasons, ["token_budget"]);
});

test("adapterはunknown fieldをコピーせず、異常入力と過大入力をfail-safeかつboundedに扱う（#296）", () => {
  const nodes = Array.from({ length: 600 }, (_, index) => ({
    type: "note",
    id: `note-${String(index).padStart(3, "0")}`,
    title: `T${"x".repeat(5_000)}`,
    ...(index === 0 ? { body_markdown: "b".repeat(5_000) } : {}),
    future_body: "must not leak",
  })).reverse();
  const result = previewContextSubgraph({
    seed: { type: "note", id: "note-000" },
    nodes,
    future_payload: { secret: "must not leak" },
  });

  assert.equal(result.included.length, 500);
  assert.equal(result.counts.included, 600);
  assert.equal(result.counts.representedIncluded, 500);
  assert.equal(result.included[0].ref.id, "note-000");
  assert.ok(result.included.every((entry) => entry.title.length <= 1_000));
  assert.deepEqual(result.included[0].content, { mode: "full", text: "b".repeat(4_000), truncated: true, sourceField: "body_markdown" });
  assert.equal(result.truncation.truncated, true);
  assert.ok(result.truncation.reasons.includes("adapter_max_included"));
  assert.ok(result.truncation.reasons.includes("adapter_max_content_text"));
  assert.equal(JSON.stringify(result).includes("must not leak"), false);

  assert.doesNotThrow(() => previewTaskCoding(null));
  assert.doesNotThrow(() => previewThemeCoding({ themes: "invalid", knowledge: 42 }));
  assert.doesNotThrow(() => previewThemeM365({ preview: { files: "invalid" } }));
  assert.doesNotThrow(() => previewContextSubgraph({ nodes: [null, 42, "x"] }));
});
