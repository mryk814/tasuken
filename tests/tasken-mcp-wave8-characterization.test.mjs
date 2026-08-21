import assert from "node:assert/strict";
import test from "node:test";

import { ReadOnlyTaskenContext } from "./fixtures/legacyReadOnlyContext.mjs";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";

const THEME_ID = "theme-wave8";
const now = "2026-08-21T00:00:00.000Z";

function visibleTheme() {
  return {
    id: THEME_ID,
    name: "Wave 8 theme",
    description: "Characterization fixture",
    state: "active",
    repository_context_ids: ["repo-visible"],
    default_ai_visibility: ["coding_agent"],
    updated_at: now,
  };
}

function task(id, overrides = {}) {
  return {
    id,
    title: id,
    state: "doing",
    project_id: THEME_ID,
    updated_at: now,
    ...overrides,
  };
}

function activityEvent(id, occurredAt, entity, overrides = {}) {
  return buildActivityEvent({
    id,
    entity_type: "task",
    entity_id: entity.id,
    event_kind: "task_work_recorded",
    occurred_at: occurredAt,
    after: entity,
    summary: id,
    metadata: { dedupe_key: `wave8:${id}`, ...overrides.metadata },
    ...overrides,
  });
}

function activityFixture() {
  const theme = visibleTheme();
  const seed = task("task-seed");
  const hidden = task("task-hidden", { ai_visibility: [] });
  const archived = task("task-archived", { deleted_at: "2026-08-19T00:00:00.000Z" });
  const events = [
    activityEvent("event-prior", "2026-08-20T14:59:00.000Z", seed),
    activityEvent("event-b", "2026-08-20T15:30:00.000Z", seed),
    activityEvent("event-a", "2026-08-20T15:30:00.000Z", seed),
    activityEvent("event-hidden", "2026-08-20T15:31:00.000Z", hidden),
    activityEvent("event-archived", "2026-08-20T15:32:00.000Z", archived),
    activityEvent("event-suppressed", "2026-08-20T15:33:00.000Z", seed, {
      metadata: { include_in_activity: false },
    }),
    activityEvent("event-unsafe", "2026-08-20T15:34:00.000Z", {
      ...seed,
      canonical_refs: [{ kind: "canonical_document", web_url: "https://user:pass@example.com/private?token=LEAK#fragment" }],
    }, {
      canonical_refs: [{ kind: "canonical_document", web_url: "https://user:pass@example.com/private?token=LEAK#fragment" }],
      source_refs: [{ kind: "url", locator: "https://user:pass@example.com/source?token=LEAK#fragment" }],
      relation_refs: [{ type: "note", id: "Bearer LEAK", relation: "context" }],
      actor: { kind: "agent", id: "Bearer LEAK" },
      origin: { kind: "mcp", command_id: "command-safe", session_id: "Bearer LEAK" },
      metadata: { activity_summary: "safe", token: "LEAK" },
    }),
  ];
  return {
    themes: [theme],
    tasks: [seed, hidden, archived],
    change_events: events,
  };
}

function contextFixture() {
  const theme = visibleTheme();
  const seed = task("task-seed");
  const suggested = task("task-suggested", { title: "Suggested endpoint", project_id: null });
  const hiddenNote = {
    id: "note-hidden",
    title: "Hidden note",
    body_markdown: "must not be returned",
    project_id: THEME_ID,
    ai_visibility: [],
    updated_at: now,
  };
  const note = {
    id: "note-visible",
    title: "Visible note",
    body_markdown: "visible body",
    project_id: THEME_ID,
    updated_at: now,
  };
  const knowledge = {
    id: "knowledge-visible",
    node_type: "claim",
    title: "Visible claim",
    body: "claim body",
    theme_id: THEME_ID,
    updated_at: now,
  };
  const references = [
    { id: "ref-seed-note", source_type: "task", source_id: seed.id, target_type: "note", target_id: note.id, relation_type: "related_to" },
    { id: "ref-note-knowledge", source_type: "note", source_id: note.id, target_type: "knowledge_node", target_id: knowledge.id, relation_type: "supports" },
    { id: "ref-cycle", source_type: "knowledge_node", source_id: knowledge.id, target_type: "task", target_id: seed.id, relation_type: "answers" },
    { id: "ref-suggested", source_type: "task", source_id: seed.id, target_type: "task", target_id: suggested.id, relation_type: "related_to", status: "suggested" },
    { id: "ref-hidden", source_type: "task", source_id: seed.id, target_type: "note", target_id: hiddenNote.id, relation_type: "related_to" },
    { id: "ref-dangling", source_type: "task", source_id: seed.id, target_type: "note", target_id: "note-missing", relation_type: "related_to" },
  ];
  return {
    themes: [theme],
    tasks: [seed, suggested],
    notes: [note, hiddenNote],
    knowledge_nodes: [knowledge],
    references,
  };
}

function exportFixture() {
  const theme = visibleTheme();
  const hiddenTheme = {
    id: "theme-hidden",
    name: "Hidden theme",
    default_ai_visibility: [],
    updated_at: now,
  };
  return {
    themes: [theme, hiddenTheme],
    tasks: [
      task("task-visible", { title: "Visible item", state: "todo", updated_at: "2026-08-21T03:00:00.000Z" }),
      task("task-done", { title: "Done item", state: "done", updated_at: "2026-08-21T02:00:00.000Z" }),
      task("task-hidden", { title: "Hidden item", ai_visibility: [], updated_at: "2026-08-21T04:00:00.000Z" }),
    ],
    notes: [{
      id: "note-visible",
      title: "Visible note",
      body_markdown: "A very long note body with C:/private/note.md and token=SECRET.",
      project_id: THEME_ID,
      updated_at: now,
    }, {
      id: "note-hidden",
      title: "Hidden note",
      body_markdown: "private note",
      project_id: THEME_ID,
      ai_visibility: [],
      updated_at: "2026-08-20T00:00:00.000Z",
    }],
    resources: [{
      id: "resource-secret",
      title: "Credentialed resource",
      project_id: THEME_ID,
      url: "https://user:pass@example.com/private?token=SECRET",
      local_path: "C:/private/resource.md",
      updated_at: now,
    }],
    repository_contexts: [{
      id: "repo-visible",
      label: "Visible repo",
      provider: "github",
      canonical_url: "https://github.com/mryk814/tasuken",
      canonical_identity: "github.com/mryk814/tasuken",
      local_path: "C:/private/tasuken",
      repository_slug: "mryk814/tasuken",
      remote_aliases: ["git@github.com:mryk814/tasuken.git"],
      active: true,
    }],
    knowledge_nodes: [
      { id: "knowledge-1", node_type: "question", title: "Question", body: "question body", theme_id: THEME_ID, updated_at: now },
      { id: "knowledge-2", node_type: "claim", title: "Claim", body: "claim body", theme_id: THEME_ID, updated_at: "2026-08-20T00:00:00.000Z" },
    ],
  };
}

function openContext(workspace) {
  return new ReadOnlyTaskenContext("wave8-in-memory.sqlite", {
    audience: "coding_agent",
    aiVisibilityDefault: ["coding_agent"],
    workspace,
  });
}

test("Wave 8 legacy get_activity: timezone/date/order, visibility-before-limit, archive, and safe event projection", () => {
  const context = openContext(activityFixture());
  try {
    const result = context.toolGetActivity({
      date: "2026-08-21",
      timezone: "Asia/Tokyo",
      sort_direction: "desc",
      limit: 1,
      include_match_metadata: true,
    });
    // Hidden/suppressed events are filtered before the result limit.
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].id, "event-unsafe");
    assert.equal(result.matched_count, 3);
    assert.equal(result.truncated, true);
    assert.equal(result.events[0].local_date, "2026-08-21");
    assert.equal(result.events[0].local_time, "00:34");
    assert.equal(result.events[0].canonical_refs[0].web_url, "https://example.com/private");
    assert.equal(JSON.stringify(result), JSON.stringify(result).replace(/user:pass|token=LEAK|Bearer LEAK|fragment|LEAK/g, ""));
    assert.equal("token" in result.events[0].metadata, false);

    const ties = context.toolGetActivity({ date: "2026-08-21", timezone: "Asia/Tokyo", sort_direction: "asc", limit: 100 });
    assert.deepEqual(ties.events.map((event) => event.id), ["event-a", "event-b", "event-unsafe"]);
    assert.deepEqual(context.toolGetActivity({ date: "2026-08-20", timezone: "UTC", limit: 100 }).events.map((event) => event.id), ["event-prior", "event-a", "event-b", "event-unsafe"]);
    assert.deepEqual(context.toolGetActivity({ from: "2026-08-20T15:30:00.000Z", to: "2026-08-20T15:30:00.000Z", limit: 100 }).events.map((event) => event.id), ["event-a", "event-b"]);
    assert.deepEqual(context.toolGetActivity({ event_kinds: Array.from({ length: 21 }, () => "task_work_recorded"), limit: 100 }).events.length, 4);

    const defaultLimit = context.toolGetActivity({}).events.length;
    assert.equal(defaultLimit, 4);
    assert.equal(context.toolGetActivity({ limit: 0 }).events.length, 4, "legacy zero uses MAX_EVENTS via Number(limit) || MAX_EVENTS");
    assert.equal(context.toolGetActivity({ limit: 501 }).events.length, 4, "legacy max+1 clamps to MAX_EVENTS");
    assert.equal(context.toolGetActivity({ limit: -1 }).events.length, 0, "legacy negative becomes a zero result limit");
    assert.equal(context.toolGetActivity({ timezone: "not/a-timezone", date: "2026-08-21", limit: 100 }).timezone, "Asia/Tokyo");

    const archived = context.toolGetActivity({ include_archived: true, limit: 100 });
    assert.ok(archived.events.some((event) => event.id === "event-archived"));
    assert.equal(archived.events.find((event) => event.id === "event-archived").metadata.entity_status, "deleted");
    assert.equal(context.toolGetActivity({ include_archived: false, limit: 100 }).events.some((event) => event.id === "event-archived"), false);
  } finally {
    context.close();
  }
});

test("Wave 8 legacy get_activity exposes direct-method event_kinds without the MCP schema max-20 guard", () => {
  const context = openContext(activityFixture());
  try {
    const twentyOne = Array.from({ length: 21 }, (_, index) => `kind-${index}`);
    const result = context.toolGetActivity({ event_kinds: twentyOne, limit: 100 });
    // The direct legacy method simply treats event_kinds as a Set. The MCP
    // registration separately rejects arrays longer than 20; this test records
    // that distinction for the Core replacement rather than endorsing it.
    assert.deepEqual(result.events, []);
    assert.equal(result.format, "json");
  } finally {
    context.close();
  }
});

test("Wave 8 legacy get_context_subgraph: bounded two-hop graph, cycles, suggested edges, hidden endpoints, and token limits", () => {
  const context = openContext(contextFixture());
  try {
    const result = context.toolGetContextSubgraph({ entity_type: "task", entity_id: "task-seed" });
    assert.deepEqual(result.seed, { type: "task", id: "task-seed" });
    assert.equal(result.limits.maxHops, 2);
    assert.equal(result.limits.maxNodes, 24);
    assert.equal(result.limits.maxEdges, 48);
    assert.equal(result.limits.tokenBudget, 2400);
    assert.ok(result.nodes.some((node) => node.id === "task-seed"));
    assert.ok(result.nodes.some((node) => node.id === "note-visible"));
    assert.ok(result.nodes.some((node) => node.id === "knowledge-visible"));
    assert.equal(result.nodes.some((node) => node.id === "task-suggested"), false);
    assert.equal(result.nodes.some((node) => node.id === "note-hidden"), false);
    assert.ok(result.excluded_nodes.some((entry) => entry.ref.id === "note-hidden"));
    assert.ok(result.diagnostics.some((entry) => entry.kind === "broken_relation"));
    assert.ok(result.paths.some((path) => path.hops === 2 && path.to.id === "knowledge-visible"));
    assert.equal(result.policy.suggested_included, false);
    assert.doesNotMatch(JSON.stringify(result), /must not be returned/);

    const suggested = context.toolGetContextSubgraph({ entity_type: "task", entity_id: "task-seed", include_suggested: true, max_hops: 1 });
    assert.equal(suggested.policy.suggested_included, true);
    assert.ok(suggested.nodes.some((node) => node.id === "task-suggested"));
    assert.ok(suggested.edges.some((edge) => edge.status === "suggested"));

    const oneNode = context.toolGetContextSubgraph({ entity_type: "task", entity_id: "task-seed", max_nodes: 1 });
    assert.deepEqual(oneNode.nodes.map((node) => node.id), ["task-seed"]);
    assert.equal(oneNode.truncated, true);
    assert.equal(context.toolGetContextSubgraph({ entity_type: "task", entity_id: "task-seed", max_edges: 0 }).edges.length, 0);
    assert.equal(context.toolGetContextSubgraph({ entity_type: "task", entity_id: "task-seed", token_budget: 0 }).limits.tokenBudget, 2400);
    assert.equal(context.toolGetContextSubgraph({ entity_type: "task", entity_id: "task-seed", token_budget: 1 }).limits.tokenBudget, 16);
    assert.deepEqual(context.toolGetContextSubgraph({ entity_type: "task", entity_id: "missing" }).exclusions, ["seed_not_found"]);
    assert.deepEqual(context.toolGetContextSubgraph({ entity_type: "", entity_id: "" }).exclusions, ["seed_not_found"]);

    const maximum = context.toolGetContextSubgraph({ entity_type: "task", entity_id: "task-seed", max_hops: 3, max_nodes: 101, max_edges: 201, token_budget: 12001 });
    assert.deepEqual(maximum.limits, { maxHops: 2, maxNodes: 100, maxEdges: 200, maxDiagnostics: 48, tokenBudget: 12000 });
  } finally {
    context.close();
  }
});

test("Wave 8 legacy export_ai_context: exact empty Markdown and bounded JSON scope semantics", () => {
  const empty = openContext({});
  try {
    assert.equal(empty.toolExportAiContext({ format: "markdown" }), [
      "# Tasken Context",
      "",
      "> 公開先: coding_agent / 除外: 0件",
      "",
      "## Theme",
      "- なし",
      "",
      "## Current Open Items",
      "- なし",
      "",
      "## Recent Notes",
      "- なし",
      "",
      "## Activity",
      "- なし",
      "",
      "## Questions",
      "- なし",
      "",
      "## Claims",
      "- なし",
      "",
      "## Evidence",
      "- なし",
      "",
      "## Decisions",
      "- なし",
      "",
      "## Risks / Contradictions",
      "- なし",
      "",
      "## Suggested Next Actions",
      "- なし",
      "",
      "## AI公開範囲で除外した情報",
      "- 除外なし",
    ].join("\n"));
  } finally {
    empty.close();
  }

  const context = openContext(exportFixture());
  try {
    const json = context.toolExportAiContext({ format: "json", scope: "open_items", max_items: 1, max_notes: 1, max_knowledge_nodes: 1, max_chars: 12, include_raw_body: false });
    assert.equal(json.scope, "open_items");
    assert.equal(json.ai_audience, "coding_agent");
    assert.deepEqual(json.items.map((item) => item.id), ["task-visible"]);
    assert.equal(json.items.some((item) => item.id === "task-done"), false);
    assert.equal(json.items.some((item) => item.id === "task-hidden"), false);
    assert.deepEqual(json.notes.map((note) => note.id), ["note-visible"]);
    assert.equal(json.notes[0].body_markdown, undefined);
    assert.equal(json.notes[0].body_excerpt, "A very long ...");
    assert.deepEqual(json.knowledge_nodes.map((node) => node.id), ["knowledge-1"]);
    assert.deepEqual(json.repository_contexts.map((entry) => entry.id), ["repo-visible"]);
    assert.equal(json.repository_contexts[0].local_path, undefined);
    assert.equal(json.theme_repository_contexts[0].theme_id, THEME_ID);
    assert.equal(json.theme_repository_contexts.length, 1);

    const generatedAt = json.generated_at;
    assert.match(generatedAt, /^20\d\d-\d\d-\d\dT/);
    const withoutTimestamp = { ...json };
    delete withoutTimestamp.generated_at;
    assert.equal(JSON.stringify(withoutTimestamp).includes("user:pass"), true, "KNOWN UNSAFE LEGACY: resource URLs are returned raw by export_ai_context");
    assert.equal(JSON.stringify(withoutTimestamp).includes("C:/private/resource.md"), true, "KNOWN UNSAFE LEGACY: resource local_path is returned raw by export_ai_context");
    assert.equal(JSON.stringify(withoutTimestamp).includes("token=SECRET"), true, "KNOWN UNSAFE LEGACY: resource query credentials are returned raw by export_ai_context");

    const defaults = context.toolExportAiContext({ format: "json" });
    assert.equal(defaults.scope, "recent");
    assert.equal(defaults.notes.length, 1);
    assert.equal(context.toolExportAiContext({ format: "json", max_items: 0 }).items.length, 2, "legacy zero uses the default item limit");
    assert.equal(context.toolExportAiContext({ format: "json", max_items: 101 }).items.length, 2, "legacy max+1 clamps to 100");
    assert.equal(context.toolExportAiContext({ format: "json", max_notes: -1 }).notes.length, 1, "legacy negative uses the default note limit");
    assert.equal(context.toolExportAiContext({ format: "json", scope: "selected_theme", theme_id: "missing" }).themes.length, 0);
  } finally {
    context.close();
  }
});
