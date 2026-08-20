import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { build } from "esbuild";

import { ReadOnlyTaskenContext } from "../src/main/mcp/readOnlyContext.mjs";

const bundled = await build({
  stdin: {
    contents: `
      export {
        ListAgentReadyTasksService,
      } from "./src/main/core/public.ts";
      export { createTaskenCore, WorkspaceAgentReadyTaskReadAdapter } from "./src/main/infrastructure/sqlite/public.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});

const {
  createTaskenCore,
  WorkspaceAgentReadyTaskReadAdapter,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const now = "2026-08-20T00:00:00.000Z";

function task(id, overrides = {}) {
  return {
    id,
    title: id,
    project_id: "theme-visible",
    intended_executor: "ai_agent",
    state: "todo",
    updated_at: now,
    ...overrides,
  };
}

function fixture() {
  return {
    themes: [
      { id: "theme-visible", name: "Visible", default_ai_visibility: ["coding_agent"], updated_at: now },
      { id: "theme-hidden", name: "Hidden", default_ai_visibility: ["m365"], updated_at: now },
    ],
    tasks: [
      task("ready-new", {
        updated_at: "2026-08-20T03:00:00.000Z",
        legacy_extension: { retained: true },
      }),
      task("ready-explicit", { work_state: "ready_for_agent", updated_at: "2026-08-20T02:00:00.000Z" }),
      task("ready-workspace", { project_id: null, updated_at: "2026-08-20T01:00:00.000Z" }),
      task("working", { work_state: "in_progress" }),
      task("human", { intended_executor: "self" }),
      task("done", { state: "done" }),
      task("cancelled", { state: "cancelled" }),
      task("hidden-entity", { ai_visibility: ["m365"] }),
      task("hidden-theme", { project_id: "theme-hidden" }),
      task("archived", { deleted_at: "2026-08-20T04:00:00.000Z", updated_at: "2026-08-20T04:00:00.000Z" }),
    ],
  };
}

class FixtureWorkspaceRepository {
  constructor(workspace) {
    this.workspace = workspace;
    this.calls = [];
  }

  list(type, includeDeleted = false) {
    this.calls.push({ operation: "list", type, includeDeleted });
    const records = type === "task" ? this.workspace.tasks : this.workspace.themes;
    return records.filter((record) => includeDeleted || !record.deleted_at);
  }

  readPreference(key) {
    this.calls.push({ operation: "getPreference", key });
    return ["coding_agent"];
  }
}

function legacy(workspace) {
  return new ReadOnlyTaskenContext("phase-1-fixture.sqlite", {
    workspace,
    aiVisibilityDefault: ["coding_agent"],
  });
}

test("Phase 1 Core is deep-equal to the legacy agent-ready query for compatible requests", () => {
  const workspace = fixture();
  const repository = new FixtureWorkspaceRepository(workspace);
  const core = createTaskenCore(repository);
  const context = legacy(workspace);
  try {
    for (const request of [
      {},
      { theme_id: "theme-visible", limit: 1 },
      { theme_id: "theme-visible", include_archived: true, limit: 100 },
    ]) {
      assert.deepEqual(core.listAgentReadyTasks.execute(request), context.toolListAgentReadyTasks(request));
    }
    assert.deepEqual(core.listAgentReadyTasks.execute().tasks[0].legacy_extension, { retained: true });
  } finally {
    context.close();
  }
});

test("Phase 1 adapter uses only the injected Workspace repository instance", () => {
  const repository = new FixtureWorkspaceRepository(fixture());
  const adapter = new WorkspaceAgentReadyTaskReadAdapter(repository);

  adapter.listTasks(false);
  adapter.listThemes();
  assert.deepEqual(adapter.workspaceAiVisibilityDefault(), ["coding_agent"]);
  assert.deepEqual(repository.calls, [
    { operation: "list", type: "task", includeDeleted: false },
    { operation: "list", type: "theme", includeDeleted: true },
    { operation: "getPreference", key: "aiVisibilityDefault" },
  ]);
});
