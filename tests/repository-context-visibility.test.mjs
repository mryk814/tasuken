import assert from "node:assert/strict";
import test from "node:test";

test("MCP repository resolver exposes only contexts reachable from AI-visible Themes/Tasks", async (t) => {
  let ReadOnlyTaskenContext;
  try {
    ({ ReadOnlyTaskenContext } = await import("./fixtures/legacyReadOnlyContext.mjs"));
  } catch (error) {
    t.skip(`better-sqlite3依存がないためMCP visibility境界を実行できません: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const context = new ReadOnlyTaskenContext("in-memory.sqlite", {
    audience: "coding_agent",
    workspace: {
      themes: [
        {
          id: "theme-private",
          name: "Private Theme",
          default_ai_visibility: [],
          repository_context_ids: ["context-private"],
        },
        {
          id: "theme-public",
          name: "Public Theme",
          default_ai_visibility: ["coding_agent"],
          repository_context_ids: ["context-public", "context-inactive"],
        },
      ],
      tasks: [],
      repository_contexts: [
        {
          id: "context-private",
          label: "Private Repository",
          provider: "local",
          local_path: "C:\\Users\\private\\repo",
          canonical_identity: "local:c:\\users\\private\\repo",
        },
        {
          id: "context-public",
          label: "Public GitLab Project",
          provider: "gitlab",
          canonical_url: "https://gitlab.example/Team/PublicRepo",
          canonical_identity: "gitlab.example/Team/PublicRepo",
          remote_aliases: [],
        },
        {
          id: "context-inactive",
          label: "Archived Public GitLab Project",
          provider: "gitlab",
          canonical_url: "https://gitlab.example/Team/ArchivedRepo",
          canonical_identity: "gitlab.example/Team/ArchivedRepo",
          remote_aliases: [],
          active: false,
        },
      ],
    },
  });
  try {
    const hidden = context.toolResolveRepositoryContext({ git_root: "C:\\Users\\private\\repo" });
    assert.equal(hidden.selected, null);
    assert.equal(hidden.status, "unknown");
    assert.equal(context.toolGetRepositoryContext({ id: "context-private" }).repository_context, null);
    assert.deepEqual(context.toolGetRepositoryContext({ id: "context-private" }).excluded_reasons, ["repository_context_not_visible"]);
    assert.equal(context.toolGetRepositoryContext({ id: "context-inactive" }).repository_context, null);
    assert.deepEqual(context.toolGetRepositoryContext({ id: "context-inactive" }).excluded_reasons, ["repository_context_not_visible"]);
    assert.equal(context.toolGetRepositoryContext({ id: "context-inactive", include_archived: true }).repository_context.id, "context-inactive");

    const visible = context.toolResolveRepositoryContext({ remote_url: "https://gitlab.example/Team/PublicRepo" });
    assert.equal(visible.selected.id, "context-public");
    const themes = context.toolFindThemesForRepository({ remote_url: "https://gitlab.example/Team/PublicRepo" });
    assert.deepEqual(themes.themes.map((theme) => theme.id), ["theme-public"]);
    assert.deepEqual(themes.repository_contexts.map((entry) => entry.id), ["context-public"]);
    assert.equal(JSON.stringify(themes).includes("C:\\Users\\private"), false);

    const privateThemes = context.toolFindThemesForRepository({ git_root: "C:\\Users\\private\\repo" });
    assert.deepEqual(privateThemes.themes, []);
    assert.deepEqual(privateThemes.repository_contexts, []);
    const exported = context.toolExportAiContext({ format: "json" });
    assert.deepEqual(exported.repository_contexts.map((entry) => entry.id), ["context-public"]);
  } finally {
    context.close();
  }
});
