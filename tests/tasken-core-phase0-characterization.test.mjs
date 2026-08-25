import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ReadOnlyTaskenContext } from "./fixtures/legacyReadOnlyContext.mjs";

const now = "2026-08-20T00:00:00.000Z";

test("Phase 0: MCP inventory documents every registered read and Proposal tool", () => {
  const serverSource = readFileSync(new URL("../src/main/mcp/server.mjs", import.meta.url), "utf8");
  const migrationDocument = readFileSync(new URL("../docs/tasken-core-migration.md", import.meta.url), "utf8");
  const readOnlyBoundary = serverSource.indexOf("if (readOnly) return server;");
  const registrations = [...serverSource.matchAll(/server\.registerTool\("([^"]+)"/g)]
    .map((match) => ({ name: match[1], offset: match.index }));
  const readTools = registrations.filter((entry) => entry.offset < readOnlyBoundary);
  const proposalTools = registrations.filter((entry) => entry.offset > readOnlyBoundary);

  assert.equal(readTools.length, 23);
  assert.equal(proposalTools.length, 13);
  assert.equal(new Set(registrations.map((entry) => entry.name)).size, registrations.length);
  for (const { name } of registrations) {
    assert.equal(migrationDocument.includes(`\`${name.replace(/^tasken\./, "")}\``), true, `${name} is missing from the inventory`);
  }
});

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

function context() {
  return new ReadOnlyTaskenContext("phase-0-characterization.sqlite", {
    workspace: {
      themes: [
        {
          id: "theme-visible",
          name: "Visible",
          default_ai_visibility: ["coding_agent"],
          updated_at: now,
        },
        {
          id: "theme-hidden",
          name: "Hidden",
          default_ai_visibility: ["m365"],
          updated_at: now,
        },
      ],
      tasks: [
        task("ready-new", { updated_at: "2026-08-20T03:00:00.000Z" }),
        task("ready-explicit", { work_state: "ready_for_agent", updated_at: "2026-08-20T02:00:00.000Z" }),
        task("ready-other-theme", { project_id: null, updated_at: "2026-08-20T01:00:00.000Z" }),
        task("working", { work_state: "in_progress" }),
        task("human", { intended_executor: "self" }),
        task("done", { state: "done" }),
        task("cancelled", { state: "cancelled" }),
        task("hidden-entity", { ai_visibility: ["m365"] }),
        task("hidden-theme", { project_id: "theme-hidden" }),
        task("archived", { deleted_at: "2026-08-20T04:00:00.000Z", updated_at: "2026-08-20T04:00:00.000Z" }),
      ],
    },
  });
}

test("Phase 0: agent-ready Task selection, ordering, AI visibility, and metadata stay compatible", () => {
  const readContext = context();
  try {
    const result = readContext.toolListAgentReadyTasks();

    assert.deepEqual(result.tasks.map((entry) => entry.id), [
      "ready-new",
      "ready-explicit",
      "ready-other-theme",
    ]);
    assert.equal(result.limit, 20);
    assert.equal(result.ai_audience, "coding_agent");
    assert.equal(result.read_only, true);
    assert.equal(result.excluded_count, 2);
    assert.deepEqual(result.excluded_reasons.map((entry) => ({ type: entry.type, count: entry.count })), [
      { type: "task", count: 1 },
      { type: "task", count: 1 },
    ]);
    assert.ok(result.tasks.every((entry) => entry.ai?.ai_visibility.includes("coding_agent")));
  } finally {
    readContext.close();
  }
});

test("Phase 0: agent-ready Theme filter, limit, and archived opt-in stay compatible", () => {
  const readContext = context();
  try {
    const limited = readContext.toolListAgentReadyTasks({ theme_id: "theme-visible", limit: 1 });
    assert.deepEqual(limited.tasks.map((entry) => entry.id), ["ready-new"]);
    assert.equal(limited.limit, 1);

    const archived = readContext.toolListAgentReadyTasks({
      theme_id: "theme-visible",
      include_archived: true,
      limit: 100,
    });
    assert.deepEqual(archived.tasks.map((entry) => entry.id), [
      "archived",
      "ready-new",
      "ready-explicit",
    ]);
    assert.equal(archived.limit, 100);
  } finally {
    readContext.close();
  }
});
