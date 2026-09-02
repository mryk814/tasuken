import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";

const charter = {
  schema: "tasken-theme-charter/v1",
  purpose: "Keep human ownership while using AI.",
  desired_outcome: "Make the next useful decision visible.",
  principles: ["Use AI", "Keep decisions visible"],
  learning_interests: ["Context engineering"],
};
const currentState = {
  schema: "tasken-theme-state/v1",
  current_direction: "Build the context contract.",
  active_questions: ["Which evidence belongs in each view?"],
  blockers: ["The boundary is not yet tested."],
  next_frontier: "Write the first technical column.",
};
const theme = {
  id: "theme-context",
  name: "Tasken context",
  updated_at: "2026-08-26T09:00:00.000Z",
  charter,
  current_state: currentState,
};
const repository = {
  id: "repository-context",
  label: "Tasuken",
  repository_slug: "mryk814/tasuken",
};

function boundedItems(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    title: `${prefix} ${index}`,
  }));
}

function fakeCoreClient({ ambiguous = false, sessionsPerClient = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async findThemesForRepository(args) {
      calls.push(["findThemesForRepository", args]);
      return ambiguous
        ? { themes: [theme, { id: "theme-other", name: "Another theme" }] }
        : { themes: [theme] };
    },
    async getThemeContext(args) {
      calls.push(["getThemeContext", args]);
      return {
        themes: [theme],
        open_items: boundedItems("open", 6),
        recent_notes: boundedItems("note", 4),
        knowledge: { knowledge_nodes: boundedItems("knowledge", 3), knowledge_edges: [] },
        health: { open_count: 6 },
        context_selection: { limit: args.limit, max_chars: args.max_chars },
      };
    },
    async getTaskContext(args) {
      calls.push(["getTaskContext", args]);
      return {
        task: {
          id: args.task_id,
          title: "Continue the contract",
          memo: "Keep this one-line context.",
        },
        evidence: boundedItems("evidence", 3),
      };
    },
    async getActivity(args) {
      calls.push(["getActivity", args]);
      return { entries: boundedItems("activity", 4) };
    },
    async getActivityEntries(args) {
      calls.push(["getActivityEntries", args]);
      return {
        date: args.date,
        events: [{ id: "activity-day-1", local_date: args.date, summary: "Observed day activity" }],
        limit: args.limit,
        truncated: false,
        result_meta: {
          contract_version: 1,
          returned_count: 1,
          matched_visible_count: 1,
          truncated: false,
        },
        read_only: true,
        ai_audience: "coding_agent",
        next_tools: [],
      };
    },
    async getRecentNotes(args) {
      calls.push(["getRecentNotes", args]);
      return {
        notes: [{ id: "debrief-1", title: "Tasken Debrief 2026-08-26", body: "Human reflection" }],
      };
    },
    async getAgentSessionContext(args) {
      calls.push(["getAgentSessionContext", args]);
      return {
        repository_context: repository,
        themes: [theme],
        sessions: Array.from({ length: sessionsPerClient }, (_, index) => ({
          id: `session-${args.client_kind || "daily"}-${index}`,
          started_at:
            index === 0
              ? "2026-08-25T15:30:00.000Z"
              : `2026-08-26T${String(10 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
          summary: "Observed evidence",
        })),
      };
    },
    async executeTaskCommand(args) {
      calls.push(["executeTaskCommand", args]);
      return {
        ok: true,
        value: {
          command_id: args.command_id,
          name: args.name,
          status: "applied",
          task: {
            id: args.payload.task_id,
            version: args.payload.expected_version + 1,
            work_state: "in_progress",
          },
        },
      };
    },
  };
}

async function withMcp(coreClient, callback) {
  const server = createTaskenMcpServer({ coreClient, readOnly: false });
  const client = new Client({ name: "tasken-context-contract", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await callback(client);
  } finally {
    await client.close();
    await server.close();
  }
}

const contextTools = [
  "tasken.get_work_context",
  "tasken.get_planning_context",
  "tasken.get_learning_context",
  "tasken.get_debrief_context",
];

test("context views are listed as bounded read-only MCP tools", async () => {
  await withMcp(fakeCoreClient(), async (client) => {
    const listed = await client.listTools();
    const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));
    for (const name of contextTools) {
      const tool = tools.get(name);
      assert.ok(tool, `${name} is listed`);
      assert.equal(tool.annotations?.readOnlyHint, true, `${name} is read-only`);
      assert.equal(tool.annotations?.destructiveHint, false, `${name} is non-destructive`);
      assert.equal(tool.annotations?.idempotentHint, true, `${name} is idempotent`);
    }
  });
});

test("start_task_work directly claims an AI Ready Task without creating a Proposal", async () => {
  const core = fakeCoreClient();
  await withMcp(core, async (client) => {
    const listed = await client.listTools();
    const tool = listed.tools.find((entry) => entry.name === "tasken.start_task_work");
    assert.ok(tool);
    assert.equal(tool.annotations?.readOnlyHint, false);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.idempotentHint, true);

    const result = await client.callTool({
      name: "tasken.start_task_work",
      arguments: {
        task_id: "task-ready",
        expected_version: 4,
        idempotency_key: "start-task-ready",
        caller: "Codex",
        source_session: "codex-session-1",
        started_at: "2026-08-26T10:00:00.000Z",
      },
    });
    assert.equal(result.structuredContent.ok, true);
  });

  const call = core.calls.find(([name]) => name === "executeTaskCommand");
  assert.deepEqual(call, [
    "executeTaskCommand",
    {
      schemaVersion: 1,
      command_id: "start-task-ready",
      name: "StartTaskWork",
      actor: { kind: "ai_agent", id: "Codex" },
      source: "mcp",
      entrypoint: "mcp",
      issued_at: "2026-08-26T10:00:00.000Z",
      payload: {
        task_id: "task-ready",
        expected_version: 4,
        executor_identity: "Codex",
        started_at: "2026-08-26T10:00:00.000Z",
        source_session: "codex-session-1",
      },
    },
  ]);
});

test("Theme intent ResourceTemplate is listed and reads a bounded human intent projection", async () => {
  const core = fakeCoreClient();
  await withMcp(core, async (client) => {
    const listed = await client.listResourceTemplates();
    const template = listed.resourceTemplates.find(
      (entry) => entry.uriTemplate === "tasken://themes/{themeId}/intent",
    );
    assert.ok(template);
    assert.equal(template.name, "theme-intent");
    assert.equal(template.mimeType, "application/json");

    const result = await client.readResource({ uri: "tasken://themes/theme-context/intent" });
    assert.equal(result.contents.length, 1);
    assert.equal(result.contents[0].uri, "tasken://themes/theme-context/intent");
    assert.equal(result.contents[0].mimeType, "application/json");
    const projection = JSON.parse(result.contents[0].text);
    assert.deepEqual(projection.theme, {
      id: theme.id,
      name: theme.name,
      charter,
      current_state: currentState,
      updated_at: theme.updated_at,
    });
    assert.equal(projection.read_only, true);
    const themeCall = core.calls.find(([name]) => name === "getThemeContext");
    assert.deepEqual(themeCall[1], {
      theme_id: theme.id,
      limit: 1,
      max_chars: 4_000,
      max_hops: 1,
      max_nodes: 10,
      max_edges: 10,
      token_budget: 2_000,
    });
  });
});

test("Daily report and learning-column prompts are listed and keep user-owned boundaries", async () => {
  await withMcp(fakeCoreClient(), async (client) => {
    const listed = await client.listPrompts();
    const prompts = new Map(listed.prompts.map((prompt) => [prompt.name, prompt]));
    assert.ok(prompts.has("daily-report"));
    assert.equal(prompts.has("debrief"), false);
    assert.ok(prompts.has("learning-column"));
    assert.equal(prompts.get("daily-report").title, "Tasken日報");
    assert.equal(prompts.get("daily-report").arguments, undefined);
    assert.equal(prompts.get("learning-column").arguments[0].name, "theme_id");

    const debrief = await client.getPrompt({ name: "daily-report" });
    const debriefText = debrief.messages[0].content.text;
    assert.match(debriefText, /tasken\.get_debrief_context with date=\d{4}-\d{2}-\d{2}/);
    assert.match(debriefText, /one or two adaptive questions/);
    assert.match(debriefText, /daily report draft/);
    assert.match(debriefText, /report_date/);
    assert.match(debriefText, /include_recent_debriefs=false, and no repository filter/);
    const context = await client.callTool({
      name: "tasken.get_debrief_context",
      arguments: { date: "2026-08-31", include_recent_debriefs: false },
    });
    const guidance = context.structuredContent.writing_guidance;
    assert.ok(debriefText.includes(guidance));
    assert.match(guidance, /Group related work by Theme or Task/);
    assert.match(guidance, /Separate observed facts, agent-reported results, and inference/);
    assert.match(guidance, /never fill human answers/);
    assert.match(guidance, /Prior reports and human answers.*must not be overwritten/);
    const tools = await client.listTools();
    const noteSchema = tools.tools.find((tool) => tool.name === "tasken.propose_note").inputSchema;
    const themeArgument = guidance.match(/Omit (\w+) unless the user specified a Theme/)[1];
    assert.ok(Object.hasOwn(noteSchema.properties, themeArgument));
    assert.equal(themeArgument, "theme");
    const learning = await client.getPrompt({
      name: "learning-column",
      arguments: { theme_id: theme.id },
    });
    const learningText = learning.messages[0].content.text;
    assert.match(learningText, /theme_id=theme-context/);
    assert.match(learningText, /select at most one/);
    assert.match(learningText, /no pitch is genuinely interesting/);
  });
});

test("work context returns a bounded projection with Theme intent and optional Task", async () => {
  const core = fakeCoreClient();
  await withMcp(core, async (client) => {
    const result = await client.callTool({
      name: "tasken.get_work_context",
      arguments: { theme_id: theme.id, task_id: "task-context", include_sessions: false },
    });
    assert.equal(result.isError, undefined);
    const projection = result.structuredContent;
    assert.deepEqual(projection.canonical_intent, {
      theme_id: theme.id,
      name: theme.name,
      charter,
      current_state: currentState,
    });
    assert.equal(projection.current_task.id, "task-context");
    assert.equal(projection.related_work.length, 6);
    assert.deepEqual(projection.recent_sessions, []);
    assert.equal(projection.schema, "tasken-context-view/v1");
    assert.match(projection.view_id, /^[0-9a-f-]{36}$/);
    assert.match(projection.generated_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(projection.content_hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(projection.budget, { token_budget: 4_000 });
    assert.deepEqual(projection.source_versions, [
      {
        kind: "theme",
        id: theme.id,
        version: null,
        updated_at: theme.updated_at,
      },
    ]);
    assert.equal(projection.read_only, true);
    assert.equal("My decision" in projection, false);
    const themeCall = core.calls.find(([name]) => name === "getThemeContext");
    assert.deepEqual(themeCall[1], {
      theme_id: theme.id,
      limit: 20,
      max_chars: 4_000,
      max_hops: 1,
      max_nodes: 40,
      max_edges: 60,
      token_budget: 4_000,
    });
    const taskCall = core.calls.find(([name]) => name === "getTaskContext");
    assert.deepEqual(taskCall[1], {
      task_id: "task-context",
      max_items_per_type: 8,
      max_text_length: 20_000,
    });
  });
});

test("daily-report prompt uses the runtime local date at the UTC/JST day boundary", async (t) => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "UTC";
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-31T16:00:00.000Z") });
  try {
    await withMcp(fakeCoreClient(), async (client) => {
      const prompt = await client.getPrompt({ name: "daily-report" });
      assert.match(prompt.messages[0].content.text, /with date=2026-08-31,/);
      const context = await client.callTool({
        name: "tasken.get_debrief_context",
        arguments: { date: "2026-08-26", include_recent_debriefs: false },
      });
      // The Core owns date selection; the MCP adapter must preserve its selected sessions.
      assert.equal(context.structuredContent.sessions.length, 1);
      assert.equal(context.structuredContent.sessions[0].id, "session-daily-0");
    });
  } finally {
    t.mock.timers.reset();
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("planning and learning contexts preserve charter/state and bound their evidence", async () => {
  const core = fakeCoreClient();
  await withMcp(core, async (client) => {
    const planning = await client.callTool({
      name: "tasken.get_planning_context",
      arguments: { theme_id: theme.id },
    });
    assert.equal(planning.isError, undefined);
    assert.deepEqual(planning.structuredContent.canonical_intent.charter, charter);
    assert.deepEqual(planning.structuredContent.canonical_intent.current_state, currentState);
    assert.equal(planning.structuredContent.open_work.length, 6);
    assert.equal(planning.structuredContent.read_only, true);

    const learning = await client.callTool({
      name: "tasken.get_learning_context",
      arguments: { theme_id: theme.id },
    });
    assert.equal(learning.isError, undefined);
    assert.deepEqual(learning.structuredContent.canonical_intent.charter, charter);
    assert.deepEqual(learning.structuredContent.canonical_intent.current_state, currentState);
    assert.equal(learning.structuredContent.recent_activity.length, 4);
    assert.equal(learning.structuredContent.prior_material.length, 1);
    assert.equal(learning.structuredContent.editorial_contract.select_at_most, 1);
    assert.equal(learning.structuredContent.editorial_contract.may_skip, true);
    assert.equal(learning.structuredContent.read_only, true);

    const activityCall = core.calls.find(([name]) => name === "getActivity");
    assert.deepEqual(activityCall[1], { theme_id: theme.id, limit: 50 });
    const notesCall = core.calls.find(([name]) => name === "getRecentNotes");
    assert.deepEqual(notesCall[1], { theme_id: theme.id, limit: 30, max_chars: 5_000 });
  });
});

test("repository-to-theme ambiguity is explicit and does not guess for context views", async () => {
  for (const name of [
    "tasken.get_work_context",
    "tasken.get_planning_context",
    "tasken.get_learning_context",
  ]) {
    const core = fakeCoreClient({ ambiguous: true });
    await withMcp(core, async (client) => {
      const result = await client.callTool({
        name,
        arguments: { repository_slug: "mryk814/tasuken" },
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent.error, {
        code: "ambiguous_theme",
        message: "Repositoryに複数のThemeがあります。theme_idを指定してください。",
        candidates: [
          { id: theme.id, name: theme.name },
          { id: "theme-other", name: "Another theme" },
        ],
      });
      assert.equal(
        result.structuredContent.view,
        name.slice("tasken.get_".length, -"_context".length),
      );
      assert.equal(result.structuredContent.read_only, true);
      assert.equal(core.calls.filter(([method]) => method === "getThemeContext").length, 0);
    });
  }
});

test("debrief context includes bounded daily Activity and leaves report adoption to the user", async () => {
  const core = fakeCoreClient();
  await withMcp(core, async (client) => {
    const result = await client.callTool({
      name: "tasken.get_debrief_context",
      arguments: {
        repository_slug: "mryk814/tasuken",
        date: "2026-08-26",
        include_recent_debriefs: false,
      },
    });
    assert.equal(result.isError, undefined);
    const projection = result.structuredContent;
    assert.equal(projection.date, "2026-08-26");
    assert.deepEqual(projection.repository_context, repository);
    assert.deepEqual(projection.theme_intent, [
      { id: theme.id, name: theme.name, charter, current_state: currentState },
    ]);
    assert.equal(projection.sessions.length, 5);
    assert.deepEqual(projection.prior_debriefs, []);
    assert.equal(projection.evidence_strength, "agent_reported");
    assert.equal(projection.read_only, true);
    assert.equal(
      projection.sessions.some((session) => session.id === "session-codex-0"),
      true,
    );
    assert.deepEqual(projection.daily_activity.events, [
      { id: "activity-day-1", local_date: "2026-08-26", summary: "Observed day activity" },
    ]);
    assert.deepEqual(
      core.calls.filter(([method]) => method === "getActivityEntries").map(([, args]) => args),
      [{ date: "2026-08-26", limit: 100 }],
    );
    assert.deepEqual(
      core.calls
        .filter(([method]) => method === "getAgentSessionContext")
        .map(([, args]) => ({
          client_kind: args.client_kind,
          date: args.date,
          limit: args.limit,
        })),
      [
        { client_kind: "codex", date: "2026-08-26", limit: 50 },
        { client_kind: "claude_code", date: "2026-08-26", limit: 50 },
        { client_kind: "cursor", date: "2026-08-26", limit: 50 },
        { client_kind: "github_copilot", date: "2026-08-26", limit: 50 },
        { client_kind: "other", date: "2026-08-26", limit: 50 },
      ],
    );
    assert.equal("human_fields" in projection, false);
    assert.equal(
      core.calls.some(([method]) => method === "getRecentNotes"),
      false,
    );
  });
});

test("debrief context keeps the multi-client session projection bounded", async () => {
  const core = fakeCoreClient({ sessionsPerClient: 20 });
  await withMcp(core, async (client) => {
    const result = await client.callTool({
      name: "tasken.get_debrief_context",
      arguments: {
        repository_slug: "mryk814/tasuken",
        date: "2026-08-26",
        include_recent_debriefs: false,
      },
    });
    assert.equal(result.isError, undefined);
    assert.ok(result.structuredContent.sessions.length <= 50);
  });
});
