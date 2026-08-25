import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { normalizeThemeCharter, normalizeThemeState, THEME_CHARTER_SCHEMA, THEME_STATE_SCHEMA } =
  await importBundled("src/shared/themeRef.mjs");
const { buildDomainDrawerFormPlan } = await importBundled(
  "src/renderer/src/features/workspace/lib/drawerFormPlans.ts",
);

function plan(type, entries, base = {}) {
  const values = new FormData();
  for (const [key, value] of entries) values.append(key, value);
  return buildDomainDrawerFormPlan({
    type,
    values,
    base,
    data: { views: [], artifacts: [] },
    domain: {
      projects: [],
      capture_entries: [],
      tasks: [],
      waitings: [],
      plan_nodes: [],
      schedules: [],
      resources: [],
      notes: [],
      task_dependencies: [],
      plan_dependencies: [],
      knowledge_nodes: [],
      knowledge_edges: [],
      change_events: [],
    },
    hasField: (name) => entries.some(([key]) => key === name),
  });
}

test("theme intent normalization returns null for empty or invalid values", () => {
  assert.equal(normalizeThemeCharter(null), null);
  assert.equal(normalizeThemeCharter("not an object"), null);
  assert.equal(normalizeThemeCharter({ principles: ["", "  "] }), null);

  assert.equal(normalizeThemeState(undefined), null);
  assert.equal(normalizeThemeState({ updated_at: "2026-08-25T00:00:00.000Z" }), null);
  assert.equal(normalizeThemeState({ current_direction: "   " }), null);
});

test("theme intent normalization trims, deduplicates, and bounds content", () => {
  const principles = [
    "  Keep the context useful  ",
    "Keep the context useful",
    ...Array.from({ length: 20 }, (_, index) => `principle-${index}`),
  ];
  const charter = normalizeThemeCharter({
    purpose: `  ${"x".repeat(8_100)}  `,
    principles,
  });
  assert.equal(charter.schema, THEME_CHARTER_SCHEMA);
  assert.equal(charter.purpose.length, 8_000);
  assert.equal(charter.principles.length, 20);
  assert.deepEqual(charter.principles.slice(0, 2), ["Keep the context useful", "principle-0"]);

  const state = normalizeThemeState({
    current_direction: "  Keep one active direction  ",
    active_questions: "What matters?\n What matters? \nWhat is next?",
  });
  assert.equal(state.schema, THEME_STATE_SCHEMA);
  assert.deepEqual(state.active_questions, ["What matters?", "What is next?"]);
});

const stableThemeState = {
  schema: THEME_STATE_SCHEMA,
  current_direction: "Ship the context contract",
  active_questions: ["Which view should agents read first?"],
  current_bets: ["A focused context pack beats a full database dump"],
  blockers: [],
  unresolved_decisions: ["Whether to expose history in the first pack"],
  next_frontier: "Connect the learning view",
  updated_at: "2026-08-25T12:34:56.000Z",
};

const stableThemeFormEntries = [
  ["name", "Tasken"],
  ["charter_purpose", "Keep human ownership while using AI"],
  ["state_current_direction", stableThemeState.current_direction],
  ["state_active_questions", stableThemeState.active_questions.join("\n")],
  ["state_current_bets", stableThemeState.current_bets.join("\n")],
  ["state_unresolved_decisions", stableThemeState.unresolved_decisions.join("\n")],
  ["state_next_frontier", stableThemeState.next_frontier],
];

test("theme state updated_at is stable when state content is unchanged", () => {
  const result = plan("theme", stableThemeFormEntries, {
    id: "theme-1",
    theme_state: stableThemeState,
  });
  assert.equal(result.kind, "operations");
  const theme = result.operations.find((operation) => operation.type === "theme").entity;
  assert.equal(theme.theme_state.updated_at, stableThemeState.updated_at);
});

test("theme state updated_at changes when state content changes", () => {
  const result = plan(
    "theme",
    stableThemeFormEntries.map(([key, value]) =>
      key === "state_next_frontier" ? [key, "Publish the context pack"] : [key, value],
    ),
    { id: "theme-1", theme_state: stableThemeState },
  );
  assert.equal(result.kind, "operations");
  const theme = result.operations.find((operation) => operation.type === "theme").entity;
  assert.notEqual(theme.theme_state.updated_at, stableThemeState.updated_at);
  assert.match(theme.theme_state.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(theme.theme_state.next_frontier, "Publish the context pack");
});

test("theme form persists charter and state while task description stays lightweight", () => {
  const themeResult = plan(
    "theme",
    [
      ["name", "Tasken"],
      ["description", "A short project memo"],
      ["charter_purpose", "Keep human ownership while using AI"],
      ["charter_desired_outcome", "Know what to do next"],
      ["charter_principles", "Use AI\nKeep decisions visible\nUse AI"],
      ["state_current_direction", "Build the context contract"],
      ["state_active_questions", "What should the agent read first?"],
      ["state_next_frontier", "Generate a useful technical note"],
    ],
    { id: "theme-1" },
  );
  assert.equal(themeResult.kind, "operations");
  const theme = themeResult.operations.find((operation) => operation.type === "theme").entity;
  assert.equal(theme.description, "A short project memo");
  assert.equal(theme.theme_charter.purpose, "Keep human ownership while using AI");
  assert.deepEqual(theme.theme_charter.principles, ["Use AI", "Keep decisions visible"]);
  assert.equal(theme.theme_state.current_direction, "Build the context contract");
  assert.equal(theme.theme_state.next_frontier, "Generate a useful technical note");

  const taskResult = plan(
    "task",
    [
      ["title", "Implement context pack"],
      ["description", "One short implementation note"],
      ["theme_id", "theme-1"],
      ["state", "todo"],
    ],
    { id: "task-1" },
  );
  assert.equal(taskResult.kind, "operations");
  const task = taskResult.operations.find((operation) => operation.type === "task").entity;
  assert.equal(task.description, "One short implementation note");
  assert.equal("theme_charter" in task, false);
  assert.equal("theme_state" in task, false);
});
