import assert from "node:assert/strict";
import test from "node:test";

import { ReadOnlyTaskenContext } from "./fixtures/legacyReadOnlyContext.mjs";

function record(id, fields = {}) {
  return {
    id,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...fields,
  };
}

function fixture() {
  const publicTheme = record("theme-public", {
    name: "Public Theme",
    default_ai_visibility: ["coding_agent"],
    updated_at: "2026-08-20T00:00:00.000Z",
  });
  const privateTheme = record("theme-private", {
    name: "Private Theme",
    default_ai_visibility: [],
    updated_at: "2026-08-19T00:00:00.000Z",
  });
  const noteBody = "0123456789abcdefghijklmnopqrstuvwxyz";
  const notes = [
    record("note-visible-new", {
      title: "Visible newest note",
      project_id: publicTheme.id,
      body_markdown: noteBody,
      updated_at: "2026-08-20T00:00:00.000Z",
    }),
    record("note-private", {
      title: "Private secret note",
      project_id: privateTheme.id,
      body_markdown: "PRIVATE_NOTE_BODY",
      updated_at: "2026-08-30T00:00:00.000Z",
    }),
    record("note-visible-tie-a", {
      title: "Visible tie A",
      project_id: publicTheme.id,
      body_markdown: "tie-a",
      updated_at: "2026-08-10T00:00:00.000Z",
    }),
    record("note-visible-tie-b", {
      title: "Visible tie B",
      project_id: publicTheme.id,
      body_markdown: "tie-b",
      updated_at: "2026-08-10T00:00:00.000Z",
    }),
    record("note-entity-hidden", {
      title: "Entity hidden note",
      project_id: publicTheme.id,
      ai_visibility: [],
      body_markdown: "ENTITY_HIDDEN_BODY",
      updated_at: "2026-08-09T00:00:00.000Z",
    }),
    record("note-archived", {
      title: "Archived note",
      project_id: publicTheme.id,
      body_markdown: "ARCHIVED_BODY",
      deleted_at: "2026-08-08T00:00:00.000Z",
      updated_at: "2026-08-08T00:00:00.000Z",
    }),
  ];

  const knowledge_nodes = [
    record("knowledge-visible-new", {
      node_type: "claim",
      title: "Visible query claim",
      body: "VISIBLE_KNOWLEDGE_BODY_0123456789",
      theme_id: publicTheme.id,
      source_note_id: "note-visible-new",
      source_link_id: "link-visible",
      source_item_id: "task-visible",
      updated_at: "2026-08-20T00:00:00.000Z",
    }),
    record("knowledge-private", {
      node_type: "claim",
      title: "Private query secret",
      body: "PRIVATE_KNOWLEDGE_BODY",
      theme_id: privateTheme.id,
      source_note_id: "note-private",
      updated_at: "2026-08-30T00:00:00.000Z",
    }),
    record("knowledge-visible-tie-a", {
      node_type: "evidence",
      title: "Visible tie A",
      body: "tie-a",
      theme_id: publicTheme.id,
      updated_at: "2026-08-10T00:00:00.000Z",
    }),
    record("knowledge-visible-tie-b", {
      node_type: "question",
      title: "Visible tie B",
      body: "tie-b",
      theme_id: publicTheme.id,
      updated_at: "2026-08-10T00:00:00.000Z",
    }),
    record("knowledge-entity-hidden", {
      node_type: "claim",
      title: "Entity hidden query",
      body: "ENTITY_HIDDEN_KNOWLEDGE_BODY",
      theme_id: publicTheme.id,
      ai_visibility: [],
      updated_at: "2026-08-09T00:00:00.000Z",
    }),
    record("knowledge-archived", {
      node_type: "claim",
      title: "Archived query",
      body: "ARCHIVED_KNOWLEDGE_BODY",
      theme_id: publicTheme.id,
      deleted_at: "2026-08-08T00:00:00.000Z",
      updated_at: "2026-08-08T00:00:00.000Z",
    }),
  ];

  const tasks = [
    record("task-visible", {
      title: "Visible source task",
      state: "doing",
      project_id: publicTheme.id,
      description: "Visible task source",
      updated_at: "2026-08-20T00:00:00.000Z",
    }),
    record("task-private", {
      title: "Private source task",
      state: "doing",
      project_id: privateTheme.id,
      description: "PRIVATE_TASK_BODY",
      updated_at: "2026-08-19T00:00:00.000Z",
    }),
    record("task-done-public", {
      title: "Done public task",
      state: "done",
      project_id: publicTheme.id,
      updated_at: "2026-08-18T00:00:00.000Z",
    }),
    record("task-deleted-public", {
      title: "Deleted public task",
      state: "doing",
      project_id: publicTheme.id,
      deleted_at: "2026-08-17T00:00:00.000Z",
      updated_at: "2026-08-17T00:00:00.000Z",
    }),
    record("task-unscheduled-public", {
      title: "Unscheduled public task",
      state: "doing",
      project_id: publicTheme.id,
      updated_at: "2026-08-16T00:00:00.000Z",
    }),
  ];

  const waitings = [
    record("waiting-visible", {
      title: "Visible waiting",
      waiting_for: "Vendor",
      state: "waiting",
      project_id: publicTheme.id,
      updated_at: "2026-08-16T00:00:00.000Z",
    }),
    record("waiting-private", {
      title: "Private waiting",
      waiting_for: "PRIVATE_VENDOR",
      state: "waiting",
      project_id: privateTheme.id,
      updated_at: "2026-08-15T00:00:00.000Z",
    }),
  ];
  const plan_nodes = [
    record("plan-visible", {
      title: "Visible milestone",
      type: "milestone",
      state: "todo",
      project_id: publicTheme.id,
      updated_at: "2026-08-14T00:00:00.000Z",
    }),
    record("plan-private", {
      title: "Private milestone",
      type: "milestone",
      state: "todo",
      project_id: privateTheme.id,
      updated_at: "2026-08-13T00:00:00.000Z",
    }),
    record("plan-cancelled", {
      title: "Cancelled milestone",
      type: "milestone",
      state: "cancelled",
      project_id: publicTheme.id,
      updated_at: "2026-08-12T00:00:00.000Z",
    }),
  ];
  const schedules = [
    record("schedule-task-visible", { owner_type: "task", owner_id: "task-visible", end_date: "2020-08-20" }),
    record("schedule-waiting-visible", { owner_type: "waiting", owner_id: "waiting-visible", end_date: "2020-08-19" }),
    record("schedule-plan-visible", { owner_type: "plan_node", owner_id: "plan-visible", end_date: "2020-08-18" }),
  ];
  const links = [record("link-visible", { title: "Visible source link", url: "https://example.test/public", theme_id: publicTheme.id })];
  const resources = [record("resource-visible", { title: "Visible source resource", project_id: publicTheme.id })];
  const knowledge_edges = [
    record("edge-visible", { source_node_id: "knowledge-visible-new", target_node_id: "knowledge-visible-tie-a", relation_type: "supports" }),
    // This is intentionally a legacy behavior probe: raw relation endpoints are not
    // passed through filterForAi by getKnowledgeContext.
    record("edge-hidden-endpoint", { source_node_id: "knowledge-visible-new", target_node_id: "knowledge-private", relation_type: "mentions" }),
    record("edge-deleted-endpoint", { source_node_id: "knowledge-visible-new", target_node_id: "knowledge-archived", relation_type: "related_to" }),
    record("edge-deleted", { source_node_id: "knowledge-visible-new", target_node_id: "knowledge-visible-tie-b", relation_type: "contradicts", deleted_at: "2026-08-07T00:00:00.000Z" }),
  ];

  return {
    themes: [publicTheme, privateTheme],
    notes,
    knowledge_nodes,
    knowledge_edges,
    tasks,
    waitings,
    plan_nodes,
    schedules,
    links,
    resources,
    // All other collections are optional to the workspace-backed legacy context.
  };
}

function openContext() {
  return new ReadOnlyTaskenContext("wave7-characterization.sqlite", {
    workspace: fixture(),
    audience: "coding_agent",
    aiVisibilityDefault: ["coding_agent"],
  });
}

test("Wave 7 recent notes preserves visibility-before-limit, inherited Theme policy, ordering, and body projection", () => {
  const context = openContext();
  try {
    const defaultResult = context.toolGetRecentNotes({});
    assert.equal(defaultResult.limit, 20);
    assert.equal(defaultResult.include_raw_body, false);
    assert.deepEqual(defaultResult.notes.map((note) => note.id), [
      "note-visible-new",
      "note-visible-tie-a",
      "note-visible-tie-b",
    ]);
    assert.equal(defaultResult.excluded_count, 2);
    assert.equal(defaultResult.excluded_reasons[0].type, "note");
    assert.deepEqual(defaultResult.excluded_reasons.map((entry) => entry.count), [1, 1]);
    assert.equal("body_markdown" in defaultResult.notes[0], false);
    assert.equal(defaultResult.notes[0].body_excerpt, `${"0123456789abcdefghijklmnopqrstuvwxyz".slice(0, 36)}`);

    const raw = context.toolGetRecentNotes({ include_raw_body: true, max_chars: 10, limit: 101 });
    assert.equal(raw.limit, 100);
    assert.equal(raw.notes[0].body_markdown, "0123456789...");
    assert.equal("body_excerpt" in raw.notes[0], false);
    assert.equal(raw.notes.some((note) => note.id === "note-archived"), false);

    context.workspace.notes.push(record("note-long-body", { title: "Long body note", project_id: "theme-public", body_markdown: "x".repeat(9001), updated_at: "2026-08-07T00:00:00.000Z" }));
    const cappedText = context.toolGetRecentNotes({ include_raw_body: true, max_chars: 9000, limit: 100 });
    assert.equal(cappedText.notes.find((note) => note.id === "note-long-body").body_markdown.length, 8003);

    const archived = context.toolGetRecentNotes({ include_archived: true, limit: 100 });
    assert.equal(archived.notes.some((note) => note.id === "note-archived"), true);
    assert.equal(archived.notes.some((note) => note.id === "note-private"), false);
    assert.equal(archived.excluded_count, 2);
    assert.equal(context.toolGetRecentNotes({ max_chars: 9000, include_raw_body: true }).notes[0].body_markdown.length, 36);
  } finally {
    context.close();
  }
});

test("Wave 7 search knowledge preserves query/type/theme filters, tie order, and hidden-result accounting", () => {
  const context = openContext();
  try {
    const query = context.toolSearchKnowledge({ query: "query", limit: 1 });
    assert.deepEqual(query.knowledge_nodes.map((node) => node.id), ["knowledge-visible-new"]);
    assert.equal(query.limit, 1);
    assert.equal(query.excluded_count, 2);
    assert.equal(query.excluded_reasons[0].type, "knowledge_node");
    assert.equal(query.knowledge_nodes[0].body, "VISIBLE_KNOWLEDGE_BODY_0123456789");

    const typed = context.toolSearchKnowledge({ node_types: ["question", "evidence"], limit: 101 });
    assert.equal(typed.limit, 100);
    assert.deepEqual(typed.knowledge_nodes.map((node) => node.id), ["knowledge-visible-tie-a", "knowledge-visible-tie-b"]);

    const hiddenByTheme = context.toolSearchKnowledge({ theme_id: "theme-private", limit: 100 });
    assert.deepEqual(hiddenByTheme.knowledge_nodes, []);
    assert.equal(hiddenByTheme.excluded_count, 1);

    const archived = context.toolSearchKnowledge({ query: "archived", include_archived: true, limit: 100 });
    assert.deepEqual(archived.knowledge_nodes.map((node) => node.id), ["knowledge-archived"]);
    assert.equal(archived.knowledge_nodes[0].body, "ARCHIVED_KNOWLEDGE_BODY");
    const bounded = context.toolSearchKnowledge({ query: "visible", max_chars: 5 });
    assert.equal(bounded.knowledge_nodes[0].body, "VISIB...");
  } finally {
    context.close();
  }
});

test("Wave 7 knowledge context preserves source opt-in, default relation inclusion, limits, and raw relation endpoint behavior", () => {
  const context = openContext();
  try {
    const defaults = context.toolGetKnowledgeContext({ theme_id: "theme-public" });
    assert.equal(defaults.limit, 50);
    assert.equal(defaults.sources, undefined);
    assert.equal(defaults.knowledge_edges.length, 3);
    assert.deepEqual(defaults.knowledge_nodes.map((node) => node.id), [
      "knowledge-visible-new",
      "knowledge-visible-tie-a",
      "knowledge-visible-tie-b",
    ]);
    assert.equal(defaults.knowledge_edges.some((edge) => edge.id === "edge-hidden-endpoint"), true);
    assert.equal(defaults.knowledge_edges.some((edge) => edge.target_node_id === "knowledge-private"), true);
    assert.equal(defaults.knowledge_edges.some((edge) => edge.id === "edge-deleted-endpoint"), true);
    assert.equal(defaults.knowledge_edges.some((edge) => edge.id === "edge-deleted"), false);

    const maxed = context.toolGetKnowledgeContext({ theme_id: "theme-public", limit: 101 });
    assert.equal(maxed.limit, 100);

    const bounded = context.toolGetKnowledgeContext({ theme_id: "theme-public", limit: 1, max_chars: 5, include_relations: false });
    assert.equal(bounded.limit, 1);
    assert.deepEqual(bounded.knowledge_nodes.map((node) => node.id), ["knowledge-visible-new"]);
    assert.deepEqual(bounded.knowledge_edges, []);
    assert.equal(bounded.knowledge_nodes[0].body, "VISIB...");

    const sources = context.toolGetKnowledgeContext({ theme_id: "theme-public", include_sources: true, include_raw_body: false, include_relations: false });
    assert.equal(sources.sources.notes.length, 1);
    assert.equal(sources.sources.notes[0].id, "note-visible-new");
    assert.equal("body_markdown" in sources.sources.notes[0], false);
    assert.equal(sources.sources.notes[0].body_excerpt, "0123456789abcdefghijklmnopqrstuvwxyz");
    assert.deepEqual(sources.sources.resources.map((resource) => resource.id), ["link-visible"]);
    assert.deepEqual(sources.sources.items.map((item) => item.id), ["task-visible"]);
    assert.doesNotMatch(JSON.stringify(sources.sources), /PRIVATE_|knowledge-private|note-private|task-private/);

    const raw = context.toolGetKnowledgeContext({ theme_id: "theme-public", include_sources: true, include_raw_body: true, include_relations: false, max_chars: 10 });
    assert.equal(raw.sources.notes[0].body_markdown, "0123456789...");
    assert.equal("body_excerpt" in raw.sources.notes[0], false);
    assert.equal(raw.knowledge_nodes[0].body, "VISIBLE_KN...");
    assert.equal(context.toolGetKnowledgeContext({ theme_id: "theme-private" }).knowledge_nodes.length, 0);
  } finally {
    context.close();
  }
});

test("Wave 7 plan health aggregates only visible, non-deleted records and preserves legacy shape", () => {
  const context = openContext();
  try {
    const health = context.toolGetPlanHealth({});
    assert.deepEqual(Object.keys(health), [
      "open_tasks",
      "open_waitings",
      "open_plan_nodes",
      "open_count",
      "overdue_items",
      "waiting_items",
      "unscheduled_items",
    ]);
    assert.equal(health.open_tasks, 2);
    assert.equal(health.open_waitings, 1);
    assert.equal(health.open_plan_nodes, 1);
    assert.equal(health.open_count, 4);
    assert.deepEqual(health.overdue_items.map((item) => item.id), ["task-visible", "waiting-visible", "plan-visible"]);
    assert.deepEqual(health.waiting_items.map((item) => item.id), ["waiting-visible"]);
    assert.deepEqual(health.unscheduled_items.map((item) => item.id), ["task-unscheduled-public"]);
    assert.equal(health.unscheduled_items.some((item) => item.id === "task-unscheduled-public"), true);
    assert.equal(health.unscheduled_items.some((item) => item.id === "plan-visible"), false);
    assert.equal(JSON.stringify(health).includes("PRIVATE"), false);

    const themeHealth = context.toolGetPlanHealth({ theme_id: "theme-private" });
    assert.deepEqual(themeHealth, {
      open_tasks: 0,
      open_waitings: 0,
      open_plan_nodes: 0,
      open_count: 0,
      overdue_items: [],
      waiting_items: [],
      unscheduled_items: [],
    });
  } finally {
    context.close();
  }
});

test("Wave 7 knowledge health excludes private/deleted nodes from public aggregation and retains exact issue groups", () => {
  const context = openContext();
  try {
    const health = context.toolGetKnowledgeHealth({});
    assert.deepEqual(Object.keys(health), [
      "issues",
      "unresolved_questions",
      "claims_without_evidence",
      "contradicted_claims",
      "evidence_without_source",
      "isolated_nodes",
      "stale_decisions",
    ]);
    const serialized = JSON.stringify(health);
    assert.doesNotMatch(serialized, /knowledge-private|PRIVATE_|knowledge-archived|ARCHIVED_/);
    assert.equal(health.issues.some((issue) => issue.node?.id === "knowledge-private"), false);
    assert.equal(health.issues.some((issue) => issue.node?.id === "knowledge-archived"), false);
    assert.deepEqual(context.toolGetKnowledgeHealth({ theme_id: "theme-private" }), {
      issues: [],
      unresolved_questions: [],
      claims_without_evidence: [],
      contradicted_claims: [],
      evidence_without_source: [],
      isolated_nodes: [],
      stale_decisions: [],
    });
  } finally {
    context.close();
  }
});

