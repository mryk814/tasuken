import assert from "node:assert/strict";
import test from "node:test";

import {
  contextGraphMcpShape,
  explainContextSelection,
  getContextSubgraph,
  projectContextGraph,
  traceProvenance,
} from "../src/shared/contextGraph.mjs";
import { ReadOnlyTaskenContext } from "../src/main/mcp/readOnlyContext.mjs";
import { buildContextSelection, contextSelectionEntry } from "../src/shared/contextSelection.mjs";
import { previewContextSubgraph } from "../src/shared/aiContextPreview.mjs";

const fixture = {
  themes: [{ id: "theme-research", name: "Graph Research", project_id: null }],
  resources: [
    { id: "chat-1", title: "Conversation: SQLite graph", resource_scope: "chat_ref", project_id: "theme-research" },
    { id: "unrelated-resource", title: "Unrelated chat", resource_scope: "chat_ref", project_id: "theme-research" },
    { id: "hidden-resource", title: "Private conversation", resource_scope: "chat_ref", project_id: "theme-research", ai_visibility: [] },
  ],
  notes: [
    { id: "note-1", title: "Graph decision note", project_id: "theme-research", source_record_id: "source-conversation" },
    { id: "note-unrelated", title: "Unrelated note", project_id: "theme-research" },
  ],
  references: [
    { id: "ref-chat-note", source_type: "resource", source_id: "chat-1", target_type: "note", target_id: "note-1", relation_type: "derived_from" },
    { id: "ref-hidden-note", source_type: "resource", source_id: "hidden-resource", target_type: "note", target_id: "note-1", relation_type: "mentions" },
  ],
  artifacts: [
    { id: "artifact-1", title: "Decision export", source_type: "note", source_id: "note-1", origin_note_id: "note-1" },
  ],
  source_records: [{ id: "source-conversation", source_title: "Imported conversation" }],
  capture_entrys: [{ id: "capture-1", title: "Follow up capture", triaged_to_type: "task", triaged_to_id: "task-1", project_id: "theme-research" }],
  tasks: [{ id: "task-1", title: "Implement bounded traversal", project_id: "theme-research" }],
  task_dependencies: [],
  plan_nodes: [],
  plan_dependencies: [],
  schedules: [],
  knowledge_nodes: [
    { id: "decision-1", title: "Use SQLite projection", node_type: "decision", project_id: "theme-research", source_type: "note", source_id: "note-1" },
    { id: "evidence-1", title: "Repository is SQLite canonical", node_type: "evidence", project_id: "theme-research", source_type: "note", source_id: "note-1" },
    { id: "suggested-1", title: "Possibly related", node_type: "insight", project_id: "theme-research" },
    { id: "rejected-1", title: "Rejected relation", node_type: "insight", project_id: "theme-research" },
    { id: "superseded-1", title: "Superseded relation", node_type: "insight", project_id: "theme-research" },
    { id: "unknown-1", title: "Unknown relation", node_type: "insight", project_id: "theme-research" },
  ],
  knowledge_edges: [
    { id: "edge-decision-evidence", source_node_id: "decision-1", target_node_id: "evidence-1", relation_type: "supports" },
    { id: "edge-suggested", source_node_id: "decision-1", target_node_id: "suggested-1", relation_type: "related_to", status: "suggested" },
    { id: "edge-rejected", source_node_id: "decision-1", target_node_id: "rejected-1", relation_type: "related_to", status: "rejected" },
    { id: "edge-superseded", source_node_id: "decision-1", target_node_id: "superseded-1", relation_type: "related_to", status: "superseded" },
    { id: "edge-unknown", source_node_id: "decision-1", target_node_id: "unknown-1", relation_type: "related_to", status: "future_candidate" },
  ],
  change_events: [
    { id: "event-note-1", entity_type: "note", entity_id: "note-1", changed_at: "2026-08-08T09:00:00.000Z", change_type: "updated", source: "manual" },
  ],
  entity_sources: [],
};

test("bounded graph projects explicit relations with typed IDs and no input mutation", () => {
  const before = JSON.stringify(fixture);
  const graph = projectContextGraph(fixture);
  const result = getContextSubgraph(graph, { type: "artifact", id: "artifact-1" }, { maxHops: 2 });
  assert.equal(JSON.stringify(fixture), before);
  assert.deepEqual(result.seed, { type: "artifact", id: "artifact-1" });
  assert.ok(result.nodes.some((node) => node.type === "note" && node.id === "note-1"));
  assert.ok(result.nodes.some((node) => node.type === "resource" && node.id === "chat-1"));
  assert.ok(result.edges.every((edge) => edge.status === "asserted"));
  assert.equal(result.nodes.some((node) => node.id === "suggested-1"), false);
  assert.equal(new Set(result.edges.map((edge) => edge.id)).size, result.edges.length);
  assert.equal(new Set(result.nodes.map((node) => `${node.type}:${node.id}`)).size, result.nodes.length);
  assert.ok(result.edges.every((edge) => Array.isArray(edge.path) && edge.path.length <= 2));
});

test("legacy Theme and canonical Project both expose repository context edges, while canonical members target Project", () => {
  for (const { type, collection } of [
    { type: "theme", collection: "themes" },
    { type: "project", collection: "projects" },
  ]) {
    const workspace = {
      [collection]: [{ id: "scope-1", name: "Scope", state: "active", repository_context_ids: ["repo-1"] }],
      repository_contexts: [{ id: "repo-1", label: "Repository", active: true }],
      tasks: [{ id: "task-1", title: "Task", state: "todo", project_id: "scope-1" }],
    };
    const result = getContextSubgraph(projectContextGraph(workspace), { type, id: "scope-1" }, { maxHops: 1 });
    assert.ok(result.edges.some((edge) => edge.predicate === "uses_repository_context"
      && edge.source.type === type && edge.target.type === "repository_context"));
    assert.ok(result.edges.some((edge) => edge.predicate === "belongs_to_theme"
      && edge.source.type === "task" && edge.target.type === type));
  }
});

test("Context selection preserves colon IDs but rejects path-like and credential-bearing legacy evidence", () => {
  const result = buildContextSelection({
    relations: [{
      id: "edge-1",
      source: { type: "note", id: "note:with:colon" },
      target: { type: "task", id: "task-1" },
      predicate: "supports",
      evidence_refs: [
        { type: "reference", id: "ref:with:colon" },
        "legacy:ref:with:colon",
        "C:\\Users\\private\\evidence.md",
        "\\\\server\\share\\evidence.md",
        "file:///C:/private/evidence.md",
        "https://alice:secret@example.com/private",
      ],
    }],
  });
  assert.deepEqual(result.relations[0].evidence_refs, [
    "legacy:ref:with:colon",
    { type: "reference", id: "ref:with:colon" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /Users|server|alice|secret@example|file:/);
});

test("Context selection re-sanitizes AI metadata and locator arguments at its public boundary", () => {
  const entry = contextSelectionEntry("note", {
    id: "note:stable:id",
    title: "Public title",
    ai: {
      id: "note:stable:id",
      type: "note",
      title: "Public title",
      summary: "Public summary",
      ai_visibility: ["coding_agent"],
      private_path: "C:\\Users\\private\\note.md",
      source_refs: [{ kind: "file", locator: "C:\\Users\\private\\note.md" }],
    },
    locator: {
      tool: "tasken.get_note",
      arguments: { note_id: "note:stable:id", cwd: "C:\\Users\\private" },
    },
  });
  assert.equal(entry.locator.arguments.note_id, "note:stable:id");
  assert.equal("cwd" in entry.locator.arguments, false);
  assert.deepEqual(entry.ai.source_refs, []);
  assert.doesNotMatch(JSON.stringify(entry), /private_path|C:\\\\Users/);
});

test("provenance trace is inbound, bounded, and preserves source evidence", () => {
  const graph = projectContextGraph(fixture);
  const result = traceProvenance(graph, { type: "note", id: "note-1" }, { maxHops: 2 });
  assert.ok(result.nodes.some((node) => node.type === "artifact" && node.id === "artifact-1"));
  assert.ok(result.nodes.some((node) => node.type === "source_record" && node.id === "source-conversation"));
  assert.ok(result.edges.every((edge) => edge.layer === "provenance"));
  assert.ok(result.edges.every((edge) => edge.status === "asserted"));
  assert.deepEqual(explainContextSelection(result).seed, { type: "note", id: "note-1" });
  const upstream = traceProvenance(graph, { type: "note", id: "note-1" }, { direction: "upstream", maxHops: 1 });
  const downstream = traceProvenance(graph, { type: "note", id: "note-1" }, { direction: "downstream", maxHops: 1 });
  assert.ok(upstream.nodes.some((node) => node.type === "source_record" && node.id === "source-conversation"));
  assert.ok(downstream.nodes.some((node) => node.type === "artifact" && node.id === "artifact-1"));
});

test("capture, decision evidence, and temporal Activity entry remain explicit paths", () => {
  const graph = projectContextGraph(fixture);
  const capture = getContextSubgraph(graph, { type: "capture_entry", id: "capture-1" }, { maxHops: 1 });
  assert.ok(capture.nodes.some((node) => node.type === "task" && node.id === "task-1"));
  const decision = getContextSubgraph(graph, { type: "knowledge_node", id: "decision-1" }, { maxHops: 1 });
  assert.ok(decision.edges.some((edge) => edge.predicate === "supports" && edge.target.id === "evidence-1"));
  assert.equal(decision.nodes.some((node) => ["suggested-1", "rejected-1", "superseded-1", "unknown-1"].includes(node.id)), false);
  const activity = getContextSubgraph(graph, { type: "change_event", id: "event-note-1" }, { maxHops: 1 });
  assert.ok(activity.edges.some((edge) => edge.predicate === "records_change_for" && edge.target.id === "note-1"));
});

test("limits, cycle protection, token budget, and MCP shape are deterministic", () => {
  const graph = projectContextGraph({
    themes: [{ id: "theme", name: "Theme" }],
    tasks: [
      { id: "a", title: "A", project_id: "theme", parent_task_id: "b" },
      { id: "b", title: "B", project_id: "theme", parent_task_id: "a" },
    ],
  });
  const result = getContextSubgraph(graph, { type: "task", id: "a" }, { maxHops: 2, maxNodes: 2, maxEdges: 2, tokenBudget: 200 });
  assert.ok(result.nodes.length <= 2);
  assert.ok(result.edges.length <= 2);
  assert.ok(result.estimated_tokens <= 200);
  assert.equal(contextGraphMcpShape(result).policy.suggested_is_fact, false);
  const nodeKeys = new Set(result.nodes.map((node) => JSON.stringify([node.type, node.id])));
  const edgeIds = new Set(result.edges.map((edge) => edge.id));
  assert.ok(result.edges.every((edge) => nodeKeys.has(JSON.stringify([edge.source.type, edge.source.id])) && nodeKeys.has(JSON.stringify([edge.target.type, edge.target.id]))));
  assert.ok(result.paths.every((path) => nodeKeys.has(JSON.stringify([path.from.type, path.from.id])) && nodeKeys.has(JSON.stringify([path.to.type, path.to.id])) && path.edge_ids.every((edgeId) => edgeIds.has(edgeId))));
  const noEdges = getContextSubgraph(graph, { type: "task", id: "a" }, { maxHops: 2, maxEdges: 0 });
  assert.deepEqual(noEdges.nodes.map((node) => `${node.type}:${node.id}`), ["task:a"]);
  assert.deepEqual(noEdges.edges, []);
  assert.deepEqual(noEdges.paths, []);
  const tiny = getContextSubgraph(graph, { type: "task", id: "a" }, { maxHops: 2, maxEdges: 20, tokenBudget: 20 });
  assert.ok(tiny.estimated_tokens <= 20);
  assert.deepEqual(tiny.nodes.map((node) => `${node.type}:${node.id}`), ["task:a"]);
  assert.ok(tiny.edges.every((edge) => tiny.nodes.some((node) => node.type === edge.source.type && node.id === edge.source.id) && tiny.nodes.some((node) => node.type === edge.target.type && node.id === edge.target.id)));
  assert.ok(tiny.paths.every((path) => path.edge_ids.every((edgeId) => tiny.edges.some((edge) => edge.id === edgeId))));
});

test("status is fail-closed, evidence is stable-only, and IDs with colons stay distinct", () => {
  const graph = projectContextGraph(fixture);
  const unknown = graph.edges.find((edge) => edge.target.id === "unknown-1");
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.status_raw, "future_candidate");
  const decision = getContextSubgraph(graph, { type: "knowledge_node", id: "decision-1" }, { maxHops: 1, includeSuggested: true });
  assert.ok(decision.nodes.some((node) => node.id === "suggested-1"));
  assert.equal(decision.nodes.some((node) => ["rejected-1", "superseded-1", "unknown-1"].includes(node.id)), false);
  const refs = projectContextGraph({
    tasks: [{ id: "id:with:colon", title: "Colon" }, { id: "parent", title: "Parent" }],
  });
  const colon = getContextSubgraph(refs, { type: "task", id: "id:with:colon" }, { maxHops: 1 });
  assert.equal(colon.seed.id, "id:with:colon");
  assert.equal(colon.exclusions.length, 0);
});

test("collection ordering does not change the bounded result", () => {
  const reversed = Object.fromEntries(Object.entries(fixture).map(([key, value]) => [key, Array.isArray(value) ? [...value].reverse() : value]));
  const first = getContextSubgraph(projectContextGraph(fixture), { type: "note", id: "note-1" }, { maxHops: 2, includeSuggested: true });
  const second = getContextSubgraph(projectContextGraph(reversed), { type: "note", id: "note-1" }, { maxHops: 2, includeSuggested: true });
  assert.deepEqual(second, first);
});

test("parallel assertions keep stable IDs and inbound/outbound traversal is symmetric", () => {
  const graph = projectContextGraph({
    notes: [{ id: "note-a", title: "A" }],
    tasks: [{ id: "task-a", title: "A" }],
    references: [
      { id: "assertion-a", source_type: "note", source_id: "note-a", target_type: "task", target_id: "task-a", relation_type: "links_to" },
      { id: "assertion-b", source_type: "note", source_id: "note-a", target_type: "task", target_id: "task-a", relation_type: "links_to" },
      { id: "assertion-old", source_type: "note", source_id: "note-a", target_type: "task", target_id: "task-a", relation_type: "links_to", status: "superseded", superseded_by_assertion_id: "assertion-a" },
    ],
  });
  const outbound = getContextSubgraph(graph, { type: "note", id: "note-a" }, { direction: "outgoing", maxHops: 1 });
  const inbound = getContextSubgraph(graph, { type: "task", id: "task-a" }, { direction: "incoming", maxHops: 1 });
  assert.deepEqual(outbound.edges.map((edge) => edge.assertion_id).sort(), ["assertion-a", "assertion-b"]);
  assert.deepEqual(inbound.edges.map((edge) => edge.assertion_id).sort(), ["assertion-a", "assertion-b"]);
  assert.ok(graph.edges.some((edge) => edge.assertion_id === "assertion-old" && edge.status === "superseded"));
});

test("dangling assertions remain diagnostic without inventing the missing node", () => {
  const graph = projectContextGraph({
    notes: [{ id: "note-a", title: "A" }],
    references: [{
      id: "assertion-broken",
      subject: { type: "note", id: "note-a" },
      predicate: "links_to",
      object: { type: "task", id: "deleted-task" },
      layer: "operational",
      status: "asserted",
      origin: "user",
    }],
  });
  const result = getContextSubgraph(graph, { type: "note", id: "note-a" }, { direction: "outgoing", maxHops: 1 });
  assert.deepEqual(result.nodes.map(({ type, id }) => ({ type, id })), [{ type: "note", id: "note-a" }]);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.diagnostics, [{
    kind: "broken_relation",
    assertion_id: "assertion-broken",
    missing_refs: [{ type: "task", id: "deleted-task" }],
  }]);
});

test("dangling diagnostics obey an explicit bound and token budget", () => {
  const graph = projectContextGraph({
    notes: [{ id: "note-a", title: "A" }],
    references: Array.from({ length: 20 }, (_, index) => ({
      id: `assertion-broken-${String(index).padStart(2, "0")}`,
      source_type: "note",
      source_id: "note-a",
      target_type: "task",
      target_id: `missing-${index}`,
      relation_type: "links_to",
    })),
  });
  const result = getContextSubgraph(graph, { type: "note", id: "note-a" }, {
    direction: "outgoing",
    maxHops: 1,
    maxDiagnostics: 3,
    tokenBudget: 220,
  });
  assert.ok(result.diagnostics.length <= 3);
  assert.equal(result.truncated, true);
  assert.ok(result.estimated_tokens <= 220);
  assert.deepEqual(result.edges, []);
});

test("Work Receipt projects a provenance assertion to its Task", () => {
  const graph = projectContextGraph({
    tasks: [{ id: "task-a", title: "A" }],
    work_receipts: [{ id: "receipt-a", task_id: "task-a", executor_kind: "ai_agent", executor_label: "Codex", reported_at: "2026-08-09T00:00:00.000Z", summary: "done" }],
  });
  const upstream = traceProvenance(graph, { type: "work_receipt", id: "receipt-a" }, { direction: "upstream", maxHops: 1 });
  assert.ok(upstream.nodes.some((node) => node.type === "task" && node.id === "task-a"));
  assert.deepEqual(upstream.edges.map((edge) => ({ id: edge.assertion_id, predicate: edge.predicate, layer: edge.layer })), [{
    id: "work_receipt:receipt-a:created_for",
    predicate: "created_for",
    layer: "provenance",
  }]);
});

test("read-only MCP boundary exposes the same pure projection without a database write", () => {
  const context = new ReadOnlyTaskenContext("ignored", { workspace: fixture });
  const result = context.toolGetContextSubgraph({ entity_type: "artifact", entity_id: "artifact-1", max_hops: 2 });
  assert.equal(result.read_only, true);
  assert.equal(result.ai_audience, "coding_agent");
  assert.ok(result.nodes.some((node) => node.type === "note" && node.id === "note-1"));
  assert.equal(result.nodes.some((node) => node.id === "hidden-resource"), false);
  assert.deepEqual(
    previewContextSubgraph(result).included.map((entry) => entry.ref),
    result.context_selection.included.map((entry) => entry.ref),
  );
  const hiddenSeed = context.toolGetContextSubgraph({ entity_type: "resource", entity_id: "hidden-resource", max_hops: 2 });
  assert.deepEqual(hiddenSeed.nodes, []);
  assert.deepEqual(hiddenSeed.exclusions, ["seed_not_allowed"]);
  assert.deepEqual(hiddenSeed.context_selection.excluded, [{
    ref: { type: "resource", id: "hidden-resource" },
    reason: "この項目のAI公開範囲に含まれていません。",
    count: 1,
  }]);
  context.close();
});

test("MCP subgraph applies token budget after safe AI metadata projection", () => {
  const workspace = structuredClone(fixture);
  Object.assign(workspace.notes.find((note) => note.id === "note-1"), {
    ai_summary: "S".repeat(20_000),
    ai_visibility: ["coding_agent"],
    ai_source_refs: [
      { kind: "canonical_document", locator: "ignored", storage_root_id: "C:\\Users\\private", relative_path: "secret.md" },
      { kind: "url", locator: "https://alice:secret@example.com/private" },
    ],
  });
  const context = new ReadOnlyTaskenContext("ignored", { workspace });
  const result = context.toolGetContextSubgraph({
    entity_type: "note",
    entity_id: "note-1",
    max_hops: 1,
    token_budget: 120,
  });
  assert.ok(result.estimated_tokens <= 120);
  assert.equal(result.truncated, true);
  assert.ok(result.exclusions.includes("ai_metadata_budget"));
  assert.doesNotMatch(JSON.stringify(result), /C:\\\\Users|alice:secret|secret\.md/);
  assert.deepEqual(
    previewContextSubgraph(result).included.map((entry) => entry.ref),
    result.context_selection.included.map((entry) => entry.ref),
  );
  context.close();
});
