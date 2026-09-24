import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";
import { TASK_CONTRACT_SCHEMA_VERSION } from "../src/shared/contracts/task/public.ts";

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

const removedContextTools = [
  "tasken.get_work_context",
  "tasken.get_planning_context",
  "tasken.get_learning_context",
  "tasken.get_debrief_context",
];

test("removed composite views are no longer listed; Theme/Activity stay bounded and read-only", async () => {
  await withMcp(fakeCoreClient(), async (client) => {
    const listed = await client.listTools();
    const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));
    for (const name of removedContextTools) {
      assert.equal(tools.has(name), false, `${name} must stay removed`);
    }
    for (const name of ["tasken.get_theme_context", "tasken.get_activity"]) {
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
      schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
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

test("Daily report prompt is listed and keeps user-owned boundaries", async () => {
  await withMcp(fakeCoreClient(), async (client) => {
    const listed = await client.listPrompts();
    const prompts = new Map(listed.prompts.map((prompt) => [prompt.name, prompt]));
    assert.ok(prompts.has("daily-report"));
    assert.equal(prompts.has("debrief"), false);
    assert.equal(prompts.has("learning-column"), false);
    assert.equal(prompts.get("daily-report").title, "Tasken日報");
    assert.equal(prompts.get("daily-report").arguments, undefined);

    const debrief = await client.getPrompt({ name: "daily-report" });
    const debriefText = debrief.messages[0].content.text;
    assert.match(debriefText, /tasken\.get_activity with date=\d{4}-\d{2}-\d{2}/);
    assert.match(debriefText, /one or two adaptive questions/);
    assert.match(debriefText, /daily report draft/);
    assert.match(debriefText, /report_date/);
    const tools = await client.listTools();
    const noteSchema = tools.tools.find((tool) => tool.name === "tasken.propose_note").inputSchema;
    assert.ok(Object.hasOwn(noteSchema.properties, "theme"));
  });
});

test("daily-report prompt uses the runtime local date at the UTC/JST day boundary", async (t) => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "UTC";
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-31T16:00:00.000Z") });
  try {
    await withMcp(fakeCoreClient(), async (client) => {
      const prompt = await client.getPrompt({ name: "daily-report" });
      assert.match(prompt.messages[0].content.text, /with date=2026-08-31/);
      const activity = await client.callTool({
        name: "tasken.get_activity",
        arguments: { date: "2026-08-26" },
      });
      // The Core owns date selection; the MCP adapter must preserve its entries.
      assert.equal(activity.structuredContent.entries.length, 4);
    });
  } finally {
    t.mock.timers.reset();
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});
