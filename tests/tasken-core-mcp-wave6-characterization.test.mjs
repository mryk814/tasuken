import assert from "node:assert/strict";
import test from "node:test";

import { ReadOnlyTaskenContext } from "./fixtures/legacyReadOnlyContext.mjs";

const now = "2026-08-21T00:00:00.000Z";

function repositoryContext(id, overrides = {}) {
  return {
    id,
    label: id,
    provider: "github",
    canonical_url: "https://github.com/mryk814/tasuken",
    canonical_identity: "github.com/mryk814/tasuken",
    repository_slug: "mryk814/tasuken",
    local_path: "/private/tasuken",
    active: true,
    updated_at: now,
    ...overrides,
  };
}

function workspace() {
  return {
    themes: [
      {
        id: "theme-visible",
        name: "Visible Theme",
        description: "Theme description",
        default_ai_visibility: ["coding_agent"],
        repository_context_ids: ["repo-visible", "repo-subdir", "repo-amb-a", "repo-amb-b"],
        updated_at: "2026-08-21T06:00:00.000Z",
      },
      {
        id: "theme-hidden",
        name: "Hidden Theme",
        default_ai_visibility: ["m365"],
        repository_context_ids: ["repo-hidden"],
        updated_at: "2026-08-21T05:00:00.000Z",
      },
      {
        id: "theme-archived",
        name: "Archived Theme",
        default_ai_visibility: ["coding_agent"],
        repository_context_ids: ["repo-archived"],
        deleted_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-21T04:00:00.000Z",
      },
    ],
    tasks: [
      {
        id: "task-visible",
        title: "Visible work",
        description: "Do the visible work",
        state: "doing",
        priority: "high",
        project_id: "theme-visible",
        updated_at: "2026-08-21T03:00:00.000Z",
      },
      {
        id: "task-hidden",
        title: "Hidden work",
        state: "todo",
        project_id: "theme-hidden",
        updated_at: "2026-08-21T02:00:00.000Z",
      },
      {
        id: "task-archived",
        title: "Archived work",
        state: "todo",
        project_id: "theme-archived",
        deleted_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-21T01:00:00.000Z",
      },
    ],
    notes: [
      {
        id: "note-visible",
        title: "Visible note",
        body_markdown: "Visible note body",
        note_type: "decision",
        project_id: "theme-visible",
        version: 2,
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-21T03:00:00.000Z",
      },
      {
        id: "note-hidden",
        title: "Hidden note",
        body_markdown: "PRIVATE_NOTE_BODY",
        project_id: "theme-visible",
        ai_visibility: ["m365"],
        updated_at: "2026-08-21T02:00:00.000Z",
      },
      {
        id: "note-archived",
        title: "Archived note",
        body_markdown: "ARCHIVED_NOTE_BODY",
        project_id: "theme-visible",
        deleted_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-21T01:00:00.000Z",
      },
    ],
    knowledge_nodes: [
      {
        id: "knowledge-visible",
        title: "Visible knowledge",
        node_type: "fact",
        theme_id: "theme-visible",
        body: "Visible knowledge body",
        updated_at: "2026-08-21T03:00:00.000Z",
      },
      {
        id: "knowledge-hidden",
        title: "Hidden knowledge",
        node_type: "fact",
        theme_id: "theme-hidden",
        body: "PRIVATE_KNOWLEDGE_BODY",
        updated_at: "2026-08-21T02:00:00.000Z",
      },
    ],
    knowledge_edges: [{
      id: "knowledge-edge-visible",
      source_node_id: "knowledge-visible",
      target_node_id: "knowledge-visible",
      relation_type: "supports",
      status: "asserted",
      updated_at: now,
    }],
    repository_contexts: [
      repositoryContext("repo-visible", {
        remote_aliases: ["https://github.com/mryk814/tasuken.git"],
        web_url: "https://github.com/mryk814/tasuken?private=should-not-leak",
      }),
      repositoryContext("repo-subdir", { subdirectory: "packages/core" }),
      repositoryContext("repo-amb-a"),
      repositoryContext("repo-amb-b"),
      repositoryContext("repo-hidden", {
        canonical_url: "https://github.com/private/hidden",
        canonical_identity: "github:private/hidden",
        repository_slug: "private/hidden",
      }),
      repositoryContext("repo-archived", {
        canonical_url: "https://github.com/private/archived",
        canonical_identity: "github:private/archived",
        repository_slug: "private/archived",
        deleted_at: "2026-08-20T00:00:00.000Z",
      }),
    ],
  };
}

function context(overrides = {}) {
  return new ReadOnlyTaskenContext("wave6-characterization.sqlite", {
    workspace: { ...workspace(), ...overrides },
    aiVisibilityDefault: ["coding_agent"],
  });
}

function publicContextKeys(value) {
  return Object.keys(value).sort();
}

test("Wave 6 repository theme lookup preserves exact matching, ambiguity, subdirectory and redaction semantics", () => {
  const read = context();
  try {
    const matched = read.toolFindThemesForRepository({
      remote_url: "git@github.com:mryk814/tasuken.git",
      git_root: "/private/tasuken",
      workspace_folder: "/private/tasuken",
    });
    assert.deepEqual(Object.keys(matched).sort(), [
      "ai_audience", "candidates", "matched_context_ids", "read_only", "reason", "reason_code", "repository_contexts", "selected", "status", "themes",
    ]);
    assert.equal(matched.status, "ambiguous");
    assert.equal(matched.reason_code, "multiple_equal_repository_contexts");
    assert.equal(matched.selected, null);
    assert.deepEqual(matched.candidates.map((candidate) => candidate.context.id), ["repo-amb-a", "repo-amb-b", "repo-visible"]);
    assert.deepEqual(matched.themes.map((theme) => theme.id), ["theme-visible"]);
    assert.deepEqual(matched.repository_contexts.map((candidate) => candidate.id), ["repo-visible", "repo-amb-a", "repo-amb-b"]);
    assert.deepEqual(matched.matched_context_ids, ["repo-amb-a", "repo-amb-b", "repo-visible"]);
    for (const candidate of matched.candidates) {
      assert.deepEqual(publicContextKeys(candidate.context), [
        "active", "canonical_identity", "canonical_url", "default_branch", "id", "label", "metadata", "name", "owner", "provider", "remote_aliases", "repository_slug", "subdirectory", "web_url",
      ]);
      assert.doesNotMatch(JSON.stringify(candidate.context), /private|local_path|local\/tasuken/i);
    }

    const subdirectory = read.toolFindThemesForRepository({
      remote_url: "https://github.com/mryk814/tasuken",
      git_root: "/private/tasuken",
      workspace_folder: "/private/tasuken/packages/core/src",
    });
    assert.equal(subdirectory.status, "matched");
    assert.deepEqual(subdirectory.selected.id, "repo-subdir");
    assert.deepEqual(subdirectory.candidates.map((candidate) => candidate.context.id), ["repo-subdir"]);

    const outsideSubdirectory = read.toolFindThemesForRepository({
      remote_url: "https://github.com/mryk814/tasuken",
      git_root: "/private/tasuken",
      workspace_folder: "/private/tasuken/packages/web",
    });
    assert.equal(outsideSubdirectory.status, "ambiguous");
    assert.deepEqual(outsideSubdirectory.candidates.map((candidate) => candidate.context.id), ["repo-amb-a", "repo-amb-b", "repo-visible"]);

    const hidden = read.toolFindThemesForRepository({ remote_url: "https://github.com/private/hidden" });
    assert.equal(hidden.status, "unknown");
    assert.deepEqual(hidden.themes, []);
    assert.deepEqual(hidden.repository_contexts, []);

    const archivedWithoutFlag = read.toolFindThemesForRepository({ remote_url: "https://github.com/private/archived" });
    assert.equal(archivedWithoutFlag.status, "unknown");
    const archived = read.toolFindThemesForRepository({ remote_url: "https://github.com/private/archived", include_archived: true });
    assert.equal(archived.status, "unknown");
    assert.deepEqual(archived.themes, []);
    assert.deepEqual(archived.repository_contexts, []);
    assert.doesNotMatch(JSON.stringify(archived), /local_path|\/private\//);
  } finally {
    read.close();
  }
});

test("Wave 6 repository context lookup preserves association filtering, visibility, archived behavior and redaction", () => {
  const read = context();
  try {
    const result = read.toolGetRepositoryContext({ repository_context_id: "repo-visible" });
    assert.deepEqual(Object.keys(result).sort(), ["ai_audience", "read_only", "repository_context", "repository_context_id", "tasks", "themes"]);
    assert.equal(result.repository_context_id, "repo-visible");
    assert.deepEqual(result.repository_context, {
      id: "repo-visible",
      label: "repo-visible",
      provider: "github",
      canonical_url: "https://github.com/mryk814/tasuken",
      canonical_identity: "github.com/mryk814/tasuken",
      web_url: "https://github.com/mryk814/tasuken",
      repository_slug: "mryk814/tasuken",
      owner: "mryk814",
      name: "tasuken",
      remote_aliases: ["https://github.com/mryk814/tasuken"],
      default_branch: null,
      subdirectory: null,
      active: true,
      metadata: {},
    });
    assert.deepEqual(result.themes.map((theme) => theme.id), ["theme-visible"]);
    assert.deepEqual(result.tasks.map((task) => task.id), ["task-visible"]);
    assert.doesNotMatch(JSON.stringify(result), /private\/tasuken|local_path|PRIVATE_/);

    const missing = read.toolGetRepositoryContext({ repository_context_id: "repo-hidden" });
    assert.deepEqual(missing, {
      repository_context: null,
      repository_context_id: "repo-hidden",
      excluded_reasons: ["repository_context_not_visible"],
      read_only: true,
      ai_audience: "coding_agent",
    });

    const archivedWithoutFlag = read.toolGetRepositoryContext({ repository_context_id: "repo-archived" });
    assert.deepEqual(archivedWithoutFlag.repository_context, null);
    assert.deepEqual(archivedWithoutFlag.excluded_reasons, ["repository_context_not_visible"]);
    const archived = read.toolGetRepositoryContext({ repository_context_id: "repo-archived", include_archived: true });
    assert.equal(archived.repository_context.id, "repo-archived");
    assert.deepEqual(archived.themes.map((theme) => theme.id), ["theme-archived"]);
    assert.deepEqual(archived.tasks.map((task) => task.id), ["task-archived"]);
  } finally {
    read.close();
  }
});

test("Wave 6 theme context preserves composite sections, visibility-before-limit and bounded output", () => {
  const read = context();
  try {
    const result = read.toolGetThemeContext({ theme_id: "theme-visible" });
    assert.deepEqual(Object.keys(result).sort(), [
      "ai_audience", "context_graph", "context_selection", "excluded_count", "excluded_reasons", "health", "knowledge", "limits", "open_items", "read_only", "recent_notes", "repository_contexts", "theme_repository_contexts", "themes", "truncated", "truncation", "warnings",
    ]);
    assert.deepEqual(result.themes.map((theme) => theme.id), ["theme-visible"]);
    assert.deepEqual(result.repository_contexts.map((repository) => repository.id).sort(), ["repo-amb-a", "repo-amb-b", "repo-subdir", "repo-visible"]);
    assert.deepEqual(result.theme_repository_contexts, [{
      theme_id: "theme-visible",
      context_ids: ["repo-amb-a", "repo-amb-b", "repo-subdir", "repo-visible"],
      missing_context_ids: [],
      missing_context_reasons: [],
      contexts: result.repository_contexts,
    }]);
    assert.deepEqual(result.open_items.map((item) => item.id), ["task-visible"]);
    assert.deepEqual(result.recent_notes.map((note) => note.id), ["note-visible"]);
    assert.deepEqual(result.knowledge.knowledge_nodes.map((node) => node.id), ["knowledge-visible"]);
    assert.equal(result.knowledge.knowledge_edges.length, 1);
    assert.deepEqual(result.health, { plan: { open_count: 1 }, knowledge: { represented_node_count: 1 } });
    assert.equal(result.context_graph.nodes.some((node) => node.id === "note-hidden"), false);
    assert.equal(result.context_graph.nodes.some((node) => node.id === "note-archived"), false);
    assert.equal(result.context_graph.nodes.some((node) => node.id === "knowledge-hidden"), false);
    assert.ok(result.context_graph.excluded_nodes.some((entry) => entry.ref.id === "note-hidden"));
    assert.ok(result.context_selection.excluded.some((entry) => entry.ref.id === "note-hidden"));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NOTE_BODY|PRIVATE_KNOWLEDGE_BODY|\/private\//);

    for (const [request, expectedNodes, expectedEdges] of [
      [{ theme_id: "theme-visible", limit: 1 }, 1, 4],
      [{ theme_id: "theme-visible", limit: 50 }, 50, 200],
      [{ theme_id: "theme-visible", limit: 100 }, 100, 200],
      [{ theme_id: "theme-visible", limit: 101 }, 100, 200],
    ]) {
      const bounded = read.toolGetThemeContext(request);
      assert.equal(bounded.limits.graph.maxNodes, expectedNodes, JSON.stringify(request));
      assert.equal(bounded.limits.graph.maxEdges, expectedEdges, JSON.stringify(request));
    }

    const textBounded = read.toolGetThemeContext({ theme_id: "theme-visible", max_chars: 1, include_raw_body: true });
    assert.equal(textBounded.limits.max_text_length, 1);
    assert.equal(textBounded.truncated, true);
    assert.equal(textBounded.truncation.text.limit, 1);
    assert.match(JSON.stringify(textBounded), /text_truncated/);

    const invalid = read.toolGetThemeContext({ theme_id: "missing" });
    assert.equal(invalid.error.code, "not_found");
    assert.deepEqual(invalid.context_selection.seed, { type: "theme", id: "missing" });
    const missingId = read.toolGetThemeContext({});
    assert.equal(missingId.error.code, "invalid_request");
    assert.equal(missingId.read_only, true);
  } finally {
    read.close();
  }
});
