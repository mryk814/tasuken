import { createHash, randomUUID } from "node:crypto";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { entityTypes } from "../../shared/entityRegistry.mjs";
import { parseCanonicalTaskId, parseTaskLocator } from "../../shared/contracts/mobile/public.mjs";
import { TaskenCoreClient, TaskenCoreClientError } from "./taskenCoreClient.mjs";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const PROPOSAL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const optionalText = z.string().trim().optional();
const optionalLimit = z.number().int().positive().max(100).optional();
const optionalWave7ThemeId = z.string().trim().min(1).max(200).optional();
const optionalWave7Query = z.string().trim().min(1).max(1000).optional();
const optionalWave7NodeTypes = z.array(z.string().trim().min(1).max(100)).max(8).optional();
const NOTE_MARKDOWN_BODY_DESCRIPTION =
  "Markdown body. Keep the title in the separate title field; do not repeat it as an H1. Short notes need no heading; longer notes may use ##/###. Let the UI number headings instead of typing numbers. Supported rendering includes inline $...$, display $$...$$ on its own line, ```mermaid fenced code, and > [!INSIGHT] (MEMO). These are authoring recommendations, not validation: do not wrap the whole body in a code fence or imply that Markdown creates Task, Reference, or other relations.";

function toolResult(value) {
  return {
    content: [
      { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
    structuredContent: typeof value === "string" ? undefined : value,
  };
}

function createContextView(view, tokenBudget, payload, sourceTheme = null) {
  const generatedAt = new Date().toISOString();
  const sourceVersions = sourceTheme
    ? [
        {
          kind: "theme",
          id: sourceTheme.id,
          version: sourceTheme.version ?? null,
          updated_at: sourceTheme.updated_at ?? null,
        },
      ]
    : [];
  const hashInput = JSON.stringify({
    view,
    token_budget: tokenBudget,
    source_versions: sourceVersions,
    payload,
  });

  return {
    schema: "tasken-context-view/v1",
    view_id: randomUUID(),
    view,
    generated_at: generatedAt,
    content_hash: createHash("sha256").update(hashInput).digest("hex"),
    budget: { token_budget: tokenBudget },
    source_versions: sourceVersions,
    ...payload,
    read_only: true,
  };
}

function withCoreClient(handler) {
  return async (args) => {
    try {
      return toolResult(await handler(args));
    } catch (error) {
      if (!(error instanceof TaskenCoreClientError)) throw error;
      const value = { error: error.toPublicError() };
      return {
        ...toolResult(value),
        isError: true,
      };
    }
  };
}

function sourceApp(args) {
  return args.source_app || "mcp-client";
}

export function mcpReadOnlyMode(env = process.env) {
  return ["1", "true", "yes", "on"].includes(
    String(env.TASKEN_MCP_READ_ONLY || "")
      .trim()
      .toLowerCase(),
  );
}

export function createTaskenMcpServer(options = {}) {
  const readOnly = options.readOnly ?? mcpReadOnlyMode(options.env || process.env);
  const coreClient =
    options.coreClient || new TaskenCoreClient({ env: options.env || process.env });
  const server = new McpServer(
    {
      name: "tasken",
      version: "1.0.0",
    },
    {
      instructions: readOnly
        ? "Tasken is running in read-only mode. Use bounded context and detail tools; no write or Proposal tools are exposed."
        : "Tasken is a local-first work and knowledge app. Read tools may be used directly. Write tools only queue a Proposal. A successful write returns a Proposal ID, not a Note ID; tell the user to review and accept it in Tasken before it becomes official data. A Note proposal may carry a Theme, not a Task or Reference relation.",
    },
  );

  server.registerResource(
    "theme-intent",
    new ResourceTemplate("tasken://themes/{themeId}/intent", { list: undefined }),
    {
      title: "Tasken Theme Intent",
      description:
        "Human-written Theme Charter and current Theme State. This resource is read-only and excludes private records.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const rawThemeId = variables.themeId;
      const themeId = String(Array.isArray(rawThemeId) ? rawThemeId[0] : rawThemeId || "");
      const context = await coreClient.getThemeContext({
        theme_id: themeId,
        limit: 1,
        max_chars: 4_000,
        max_hops: 1,
        max_nodes: 10,
        max_edges: 10,
        token_budget: 2_000,
      });
      const theme =
        context.themes?.find((candidate) => candidate.id === themeId) ||
        context.themes?.[0] ||
        null;
      const content = theme
        ? {
            schema: "tasken-theme-intent-resource/v1",
            theme: {
              id: theme.id,
              name: theme.name,
              charter: theme.charter,
              current_state: theme.current_state,
              updated_at: theme.updated_at,
            },
            context_selection: context.context_selection || null,
            read_only: true,
          }
        : { schema: "tasken-theme-intent-resource/v1", error: "theme_not_found", read_only: true };
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(content, null, 2) },
        ],
      };
    },
  );

  server.registerPrompt(
    "debrief",
    {
      title: "Tasken Debrief",
      description:
        "Review observed work, then return judgment and next-return writing to the user.",
      argsSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      },
    },
    ({ date }) => ({
      description: "Prepare a Tasken Debrief without writing the user's reflection.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Use tasken.get_debrief_context${date ? ` for ${date}` : " for the relevant date"}.`,
              "Separate observed, agent-reported, and inferred evidence.",
              "Present a concise evidence review and ask at most one adaptive question.",
              "Do not write My decision or Next return. Those fields must remain the user's own words.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "learning-column",
    {
      title: "Tasken Learning Column",
      description:
        "Find one technically interesting story grounded in the user's actual recent work.",
      argsSchema: {
        theme_id: z.string().trim().min(1).max(200),
      },
    },
    ({ theme_id: themeId }) => ({
      description: "Pitch or write a personal technical column from Tasken evidence.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Use tasken.get_learning_context with theme_id=${themeId}.`,
              "First discover zero to three pitches, then select at most one.",
              "Prefer an actual incident, a surprising technical question, a wider connection, and a return to the user's own work.",
              "Avoid generic tutorials and previously covered material. If no pitch is genuinely interesting, recommend no column today.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerTool(
    "tasken.search_items",
    {
      description: "Search Tasken tasks, waitings, and plan nodes.",
      inputSchema: {
        query: optionalText,
        theme_id: optionalText,
        limit: optionalLimit,
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.searchItems(args)),
  );

  server.registerTool(
    "tasken.list_open_items",
    {
      description: "List open Tasken tasks, waitings, and plan nodes.",
      inputSchema: {
        theme_id: optionalText,
        limit: optionalLimit,
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.listOpenItems(args)),
  );

  server.registerTool(
    "tasken.list_agent_ready_tasks",
    {
      description:
        "List AI-assigned Tasks that are ready for an agent. Read-only; a Work Receipt never completes a Task.",
      inputSchema: {
        theme_id: optionalText,
        limit: optionalLimit,
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.listAgentReadyTasks(args)),
  );

  server.registerTool(
    "tasken.get_task_assignment",
    {
      description: "Read one Task assignment and its append-only Work Receipts. Read-only.",
      inputSchema: {
        task_id: z.string().trim().min(1).max(200),
        limit: optionalLimit,
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getTaskAssignment(args)),
  );

  const boundedTextLength = z.number().int().positive().max(100000).optional();
  const taskContextWorkspaceSchema = z
    .object({
      repository_id: optionalText,
      provider: optionalText,
      cwd: optionalText,
      git_root: optionalText,
      remote_url: optionalText,
      remote_urls: z.array(z.string().trim().max(2000)).max(20).optional(),
      remotes: z.array(z.string().trim().max(2000)).max(20).optional(),
      repository_slug: optionalText,
      branch: optionalText,
      workspace_folder: optionalText,
    })
    .strict()
    .optional();
  server.registerTool(
    "tasken.get_task_context",
    {
      description:
        "Return bounded, AI-visible Task context by raw task_id or canonical task_locator: assignment, Theme, RepositoryContext match, explicit/provenance-related summaries, Activity, and Work Receipts. Summary items contain stable locators instead of full bodies.",
      inputSchema: {
        task_id: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((value) => parseCanonicalTaskId(value) !== null)
          .optional(),
        task_locator: z.string().trim().min(1).max(2000).optional(),
        include: z
          .array(
            z.enum([
              "theme",
              "repository",
              "notes",
              "conversations",
              "artifacts",
              "resources",
              "activity",
              "work_receipts",
            ]),
          )
          .max(8)
          .optional(),
        max_items_per_type: z.number().int().positive().max(25).optional(),
        max_text_length: boundedTextLength,
        detail: z.literal("summary").optional(),
        workspace: taskContextWorkspaceSchema,
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => {
      const { task_id: taskId, task_locator: taskLocator, ...options } = args;
      if (Boolean(taskId) === Boolean(taskLocator)) {
        return {
          error: {
            code: "invalid_task_reference",
            message: "task_idまたはtask_locatorのどちらか一方を指定してください。",
          },
          read_only: true,
        };
      }
      const resolvedTaskId = taskLocator ? parseTaskLocator(taskLocator) : taskId;
      if (!resolvedTaskId) {
        return {
          error: {
            code: "invalid_task_locator",
            message: "canonical task_locatorを確認してください。",
          },
          read_only: true,
        };
      }
      return coreClient.getTaskContext({ ...options, task_id: resolvedTaskId });
    }),
  );

  server.registerTool(
    "tasken.get_note",
    {
      description:
        "Read one AI-visible Note body by stable ID with a text limit. Use its next_tools guidance to reopen Task context or queue a reviewed Note edit proposal.",
      inputSchema: {
        note_id: z.string().trim().min(1).max(200),
        max_text_length: boundedTextLength,
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getNote(args)),
  );

  server.registerTool(
    "tasken.get_conversation",
    {
      description:
        "Read one AI-visible Chat Ref conversation by stable ID with a text limit. URL credentials, query, and fragment are removed; next_tools identifies safe follow-up reads and proposals.",
      inputSchema: {
        conversation_id: z.string().trim().min(1).max(200),
        max_text_length: boundedTextLength,
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getConversation(args)),
  );

  server.registerTool(
    "tasken.get_artifact_metadata",
    {
      description:
        "Read safe Artifact metadata by stable ID. External file content and private filesystem paths are never returned; origin Note guidance is included when available.",
      inputSchema: {
        artifact_id: z.string().trim().min(1).max(200),
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getArtifactMetadata(args)),
  );

  server.registerTool(
    "tasken.get_activity_entries",
    {
      description:
        "Read bounded AI-visible Activity entries for one Task by stable ID. Follow next_tools to refresh assignment/context or queue reviewed work reports.",
      inputSchema: {
        task_id: z.string().trim().min(1).max(200),
        limit: optionalLimit,
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getActivityEntries(args)),
  );

  const repositoryLookupSchema = {
    repository_context_id: optionalText,
    repository_id: optionalText,
    provider: optionalText,
    remote_url: optionalText,
    remote_urls: z.array(z.string().trim().max(2000)).max(20).optional(),
    repository_slug: optionalText,
    git_root: optionalText,
    cwd: optionalText,
    workspace_folder: optionalText,
    include_archived: z.boolean().optional(),
  };
  const contextLookupSchema = {
    ...repositoryLookupSchema,
    theme_id: z.string().trim().min(1).max(200).optional(),
  };
  const resolveContextTheme = async (args) => {
    if (args.theme_id) return { themeId: args.theme_id, repositoryMatch: null, error: null };
    const { theme_id: _themeId, ...workspace } = args;
    const match = await coreClient.findThemesForRepository(workspace);
    if (match.themes?.length === 1) {
      return { themeId: match.themes[0].id, repositoryMatch: match, error: null };
    }
    return {
      themeId: null,
      repositoryMatch: match,
      error: {
        code: match.themes?.length ? "ambiguous_theme" : "theme_not_found",
        message: match.themes?.length
          ? "Repositoryに複数のThemeがあります。theme_idを指定してください。"
          : "Repositoryに関連するAI-visible Themeが見つかりません。",
        candidates: (match.themes || []).map((theme) => ({ id: theme.id, name: theme.name })),
      },
    };
  };
  const sessionContextForWorkspace = async (workspace, sourceSession) => {
    const clientKinds = ["codex", "claude_code", "cursor", "github_copilot", "other"];
    const contexts = await Promise.all(
      clientKinds.map((clientKind) =>
        coreClient.getAgentSessionContext({
          ...workspace,
          client_kind: clientKind,
          source_session: sourceSession,
          limit: 20,
        }),
      ),
    );
    return {
      repository_context:
        contexts.find((context) => context.repository_context)?.repository_context || null,
      sessions: [
        ...new Map(
          contexts
            .flatMap((context) => context.sessions || [])
            .map((session) => [session.id, session]),
        ).values(),
      ]
        .sort((left, right) => String(right.started_at).localeCompare(String(left.started_at)))
        .slice(0, 20),
    };
  };
  server.registerTool(
    "tasken.resolve_repository_context",
    {
      description:
        "Resolve a current workspace to a RepositoryContext without choosing an ambiguous candidate.",
      inputSchema: repositoryLookupSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.resolveRepositoryContext(args)),
  );

  server.registerTool(
    "tasken.find_themes_for_repository",
    {
      description: "Find AI-visible Themes associated with a current repository workspace.",
      inputSchema: repositoryLookupSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.findThemesForRepository(args)),
  );

  server.registerTool(
    "tasken.find_tasks_for_repository",
    {
      description:
        "Find AI-visible Tasks associated with a current repository workspace, respecting Task subdirectories.",
      inputSchema: repositoryLookupSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.findTasksForRepository(args)),
  );

  server.registerTool(
    "tasken.get_repository_context",
    {
      description:
        "Read one RepositoryContext and its AI-visible Theme/Task associations. Private local paths are redacted.",
      inputSchema: {
        repository_context_id: z.string().trim().min(1).max(200),
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getRepositoryContext(args)),
  );

  server.registerTool(
    "tasken.get_agent_session_context",
    {
      description:
        "Resolve the current repository and return this client kind's related sessions plus its previous structured handoff. Private paths and raw transcripts are never returned.",
      inputSchema: {
        ...repositoryLookupSchema,
        client_kind: z.enum(["codex", "claude_code", "cursor", "github_copilot", "other"]),
        source_session: z.string().trim().min(1).max(500),
        agent_label: z.string().trim().min(1).max(200).optional(),
        limit: z.number().int().positive().max(50).optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getAgentSessionContext(args)),
  );

  server.registerTool(
    "tasken.get_debrief_context",
    {
      description:
        "Return bounded, repository-related Agent Session evidence and prior human-written Tasken Debriefs. Use it to prepare a Debrief, but never write My decision or Next return for the user.",
      inputSchema: {
        ...repositoryLookupSchema,
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        include_recent_debriefs: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient(async (args) => {
      const { date, include_recent_debriefs: includeRecentDebriefs = true, ...workspace } = args;
      const sourceSession = `tasken-debrief:${date || randomUUID()}`;
      const clientKinds = ["codex", "claude_code", "cursor", "github_copilot", "other"];
      const contexts = await Promise.all(
        clientKinds.map((clientKind) =>
          coreClient.getAgentSessionContext({
            ...workspace,
            client_kind: clientKind,
            source_session: sourceSession,
            limit: 50,
          }),
        ),
      );
      const sessions = [
        ...new Map(
          contexts
            .flatMap((context) => context.sessions || [])
            .filter((session) => !date || String(session.started_at || "").slice(0, 10) === date)
            .map((session) => [session.id, session]),
        ).values(),
      ]
        .sort((left, right) => String(left.started_at).localeCompare(String(right.started_at)))
        .slice(0, 50);
      const noteContext = includeRecentDebriefs
        ? await coreClient.getRecentNotes({ limit: 50, max_chars: 8_000, include_raw_body: true })
        : null;
      const debriefs = (noteContext?.notes || [])
        .filter((note) => String(note.title || "").startsWith("Tasken Debrief"))
        .slice(0, 14);
      const repository =
        contexts.find((context) => context.repository_context)?.repository_context || null;
      const themes = [
        ...new Map(
          contexts.flatMap((context) => context.themes || []).map((theme) => [theme.id, theme]),
        ).values(),
      ];
      return {
        date: date || null,
        repository_context: repository,
        theme_intent: themes.map((theme) => ({
          id: theme.id,
          name: theme.name,
          charter: theme.charter,
          current_state: theme.current_state,
        })),
        sessions,
        prior_debriefs: debriefs,
        evidence_strength: "agent_reported",
        read_only: true,
        human_fields: {
          required: ["My decision", "Next return"],
          instruction:
            "These fields must be written by the user. The AI may ask at most one adaptive question.",
        },
        limitations: [
          "Only canonical sessions related to the resolved repository are returned.",
          "Raw transcripts, hidden reasoning, tool-call streams, and private paths are excluded.",
        ],
      };
    }),
  );

  server.registerTool(
    "tasken.get_work_context",
    {
      description:
        "Return a bounded implementation context: Theme intent, optional current Task, related open work, repository, and recent Agent Sessions. This is a read-only projection, not a workspace dump.",
      inputSchema: {
        ...contextLookupSchema,
        task_id: z.string().trim().min(1).max(200).optional(),
        include_sessions: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient(async (args) => {
      const { task_id: taskId, include_sessions: includeSessions = true, ...lookup } = args;
      const resolved = await resolveContextTheme(lookup);
      if (resolved.error) return { view: "work", error: resolved.error, read_only: true };
      const themeContext = await coreClient.getThemeContext({
        theme_id: resolved.themeId,
        limit: 20,
        max_chars: 4_000,
        max_hops: 1,
        max_nodes: 40,
        max_edges: 60,
        token_budget: 4_000,
      });
      const taskContext = taskId
        ? await coreClient.getTaskContext({
            task_id: taskId,
            max_items_per_type: 8,
            max_text_length: 20_000,
          })
        : null;
      const { theme_id: _themeId, ...workspace } = lookup;
      const sessions =
        includeSessions && Object.values(workspace).some(Boolean)
          ? await sessionContextForWorkspace(workspace, `tasken-work-context:${randomUUID()}`)
          : { repository_context: null, sessions: [] };
      const theme =
        themeContext.themes?.find((candidate) => candidate.id === resolved.themeId) ||
        themeContext.themes?.[0] ||
        null;
      return createContextView(
        "work",
        4_000,
        {
          purpose: "Start or continue implementation without losing the Theme's intent.",
          canonical_intent: theme
            ? {
                theme_id: theme.id,
                name: theme.name,
                charter: theme.charter,
                current_state: theme.current_state,
              }
            : null,
          current_task: taskContext?.task || null,
          task_context: taskContext,
          related_work: (themeContext.open_items || []).slice(0, 20),
          repository_context: sessions.repository_context,
          recent_sessions: sessions.sessions,
          context_selection: themeContext.context_selection || null,
          limitations: [
            "Raw transcripts, hidden reasoning, tool-call streams, credentials, and private paths are excluded.",
            "Only AI-visible records within the bounded relation query are included.",
          ],
        },
        theme,
      );
    }),
  );

  server.registerTool(
    "tasken.get_planning_context",
    {
      description:
        "Return a bounded planning view of one Theme: Charter, current State, open work, recent human records, knowledge, and health.",
      inputSchema: contextLookupSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient(async (args) => {
      const resolved = await resolveContextTheme(args);
      if (resolved.error) return { view: "planning", error: resolved.error, read_only: true };
      const context = await coreClient.getThemeContext({
        theme_id: resolved.themeId,
        limit: 40,
        max_chars: 6_000,
        max_hops: 2,
        max_nodes: 80,
        max_edges: 120,
        token_budget: 8_000,
      });
      const theme =
        context.themes?.find((candidate) => candidate.id === resolved.themeId) ||
        context.themes?.[0] ||
        null;
      return createContextView(
        "planning",
        8_000,
        {
          purpose: "Choose direction and next work while preserving unresolved questions.",
          canonical_intent: theme
            ? {
                theme_id: theme.id,
                name: theme.name,
                charter: theme.charter,
                current_state: theme.current_state,
              }
            : null,
          open_work: context.open_items || [],
          recent_human_records: context.recent_notes || [],
          knowledge: context.knowledge || { knowledge_nodes: [], knowledge_edges: [] },
          health: context.health || null,
          context_selection: context.context_selection || null,
        },
        theme,
      );
    }),
  );

  server.registerTool(
    "tasken.get_learning_context",
    {
      description:
        "Return a bounded editorial context for a personal technical column: Theme learning interests, current questions, recent activity, sessions, and prior possible article material. Good days may yield no pitch.",
      inputSchema: contextLookupSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient(async (args) => {
      const resolved = await resolveContextTheme(args);
      if (resolved.error) return { view: "learning", error: resolved.error, read_only: true };
      const context = await coreClient.getThemeContext({
        theme_id: resolved.themeId,
        limit: 30,
        max_chars: 5_000,
        max_hops: 2,
        max_nodes: 70,
        max_edges: 100,
        token_budget: 7_000,
      });
      const activity = await coreClient.getActivity({ theme_id: resolved.themeId, limit: 50 });
      const recentNotes = await coreClient.getRecentNotes({
        theme_id: resolved.themeId,
        limit: 30,
        max_chars: 5_000,
      });
      const { theme_id: _themeId, ...workspace } = args;
      const sessions = Object.values(workspace).some(Boolean)
        ? await sessionContextForWorkspace(workspace, `tasken-learning-context:${randomUUID()}`)
        : { repository_context: null, sessions: [] };
      const theme =
        context.themes?.find((candidate) => candidate.id === resolved.themeId) ||
        context.themes?.[0] ||
        null;
      const activityPayload =
        activity.activity && typeof activity.activity === "object" ? activity.activity : activity;
      const recentActivity = Array.isArray(activityPayload.entries)
        ? activityPayload.entries.slice(0, 50)
        : [];
      return createContextView(
        "learning",
        7_000,
        {
          purpose: "Find one technically interesting story grounded in the user's actual work.",
          canonical_intent: theme
            ? {
                theme_id: theme.id,
                name: theme.name,
                charter: theme.charter,
                current_state: theme.current_state,
              }
            : null,
          recent_activity: recentActivity,
          recent_sessions: sessions.sessions,
          prior_material: (recentNotes.notes || []).slice(0, 30),
          context_selection: context.context_selection || null,
          editorial_contract: {
            pitch_count: "zero_to_three",
            select_at_most: 1,
            may_skip: true,
            criteria: [
              "personal_relevance",
              "surprise",
              "generalizability",
              "learning_gap",
              "technical_depth",
              "story_quality",
              "freshness",
            ],
            shape: [
              "actual_event",
              "interesting_question",
              "technical_principle",
              "wider_connection",
              "return_to_own_work",
            ],
          },
          limitations: [
            "This view supplies editorial evidence; it does not mark anything as learned.",
            "No article should be generated when the evidence does not support an interesting pitch.",
          ],
        },
        theme,
      );
    }),
  );

  server.registerTool(
    "tasken.get_theme_context",
    {
      description: "Return themes, open work, recent notes, knowledge, and health.",
      inputSchema: {
        theme_id: z.string().trim().min(1).max(200),
        limit: optionalLimit,
        max_chars: z.number().int().positive().max(8000).optional(),
        include_raw_body: z.boolean().optional(),
        max_hops: z.number().int().positive().max(2).optional(),
        max_nodes: z.number().int().positive().max(100).optional(),
        max_edges: z.number().int().nonnegative().max(200).optional(),
        token_budget: z.number().int().positive().max(12000).optional(),
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getThemeContext(args)),
  );

  server.registerTool(
    "tasken.get_recent_notes",
    {
      description: "Return recent notes. Full Markdown requires include_raw_body=true.",
      inputSchema: {
        theme_id: optionalWave7ThemeId,
        limit: optionalLimit,
        max_chars: z.number().int().positive().max(8000).optional(),
        include_raw_body: z.boolean().optional(),
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getRecentNotes(args)),
  );

  server.registerTool(
    "tasken.search_knowledge",
    {
      description: "Search Tasken Knowledge nodes.",
      inputSchema: {
        query: optionalWave7Query,
        theme_id: optionalWave7ThemeId,
        node_types: optionalWave7NodeTypes,
        limit: optionalLimit,
        max_chars: z.number().int().positive().max(8000).optional(),
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.searchKnowledge(args)),
  );

  server.registerTool(
    "tasken.get_knowledge_context",
    {
      description: "Return Knowledge nodes, relations, and optionally source entities.",
      inputSchema: {
        theme_id: optionalWave7ThemeId,
        include_relations: z.boolean().optional(),
        include_sources: z.boolean().optional(),
        include_raw_body: z.boolean().optional(),
        limit: optionalLimit,
        max_chars: z.number().int().positive().max(8000).optional(),
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getKnowledgeContext(args)),
  );

  server.registerTool(
    "tasken.get_plan_health",
    {
      description: "Return open, overdue, waiting, and unscheduled work health.",
      inputSchema: { theme_id: optionalWave7ThemeId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getPlanHealth(args)),
  );

  server.registerTool(
    "tasken.get_knowledge_health",
    {
      description: "Return unresolved questions and other Knowledge health issues.",
      inputSchema: { theme_id: optionalWave7ThemeId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getKnowledgeHealth(args)),
  );

  server.registerTool(
    "tasken.get_activity",
    {
      description:
        "Return the structured Activity event index as JSON or Markdown. This is read-only and applies AI visibility policy at projection time.",
      inputSchema: {
        date: z.string().trim().max(40).optional(),
        from: z.string().trim().max(80).optional(),
        to: z.string().trim().max(80).optional(),
        theme_id: z.string().trim().max(200).optional(),
        entity_type: z.string().trim().max(100).optional(),
        event_kinds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
        timezone: z.string().trim().max(100).optional(),
        limit: optionalLimit,
        format: z.enum(["json", "markdown"]).optional(),
        audience: z.enum(["m365", "coding_agent", "external_ai"]).optional(),
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getActivity(args)),
  );

  server.registerTool(
    "tasken.get_context_subgraph",
    {
      description:
        "Return a bounded, read-only Context/Provenance subgraph for one typed entity. Suggested relations are excluded by default and never become facts.",
      inputSchema: {
        entity_type: z.enum(entityTypes),
        entity_id: z.string().trim().min(1).max(200),
        max_hops: z.number().int().positive().max(2).optional(),
        max_nodes: z.number().int().positive().max(100).optional(),
        max_edges: z.number().int().positive().max(200).optional(),
        token_budget: z.number().int().positive().max(12000).optional(),
        include_suggested: z.boolean().optional(),
        include_archived: z.boolean().optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.getContextSubgraph(args)),
  );

  server.registerTool(
    "tasken.export_ai_context",
    {
      description: "Export bounded Tasken context as Markdown or JSON.",
      inputSchema: {
        scope: z
          .enum(["active_theme", "selected_theme", "recent", "open_items", "knowledge"])
          .optional(),
        theme_id: z.string().trim().max(200).optional(),
        max_items: optionalLimit,
        max_notes: optionalLimit,
        max_knowledge_nodes: optionalLimit,
        max_chars: z.number().int().positive().max(8000).optional(),
        format: z.enum(["markdown", "json"]).optional(),
        include_raw_body: z.boolean().optional(),
        // 既定はcoding_agent。M365向けPackを作るときだけ明示的に切り替える（#294）。
        audience: z.enum(["m365", "coding_agent", "external_ai"]).optional(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withCoreClient((args) => coreClient.exportAiContext(args)),
  );

  if (readOnly) return server;

  const workItemList = z.array(z.string().trim().min(1).max(1000)).max(100).optional();
  const externalReferenceInput = z
    .object({
      kind: z.enum([
        "issue",
        "pull_request",
        "merge_request",
        "commit",
        "branch",
        "file",
        "pipeline",
        "other",
      ]),
      provider: z.string().trim().max(120).optional(),
      display_label: z.string().trim().min(1).max(200),
      url: z
        .string()
        .trim()
        .url()
        .refine((value) => {
          try {
            const parsed = new URL(value);
            return parsed.protocol === "https:" && !parsed.username && !parsed.password;
          } catch {
            return false;
          }
        }, "HTTPS URL without credentialsが必要です。"),
      external_id: z.string().trim().max(200).optional(),
    })
    .strict();
  const externalReferenceList = z.array(externalReferenceInput).max(100).optional();
  const optionalTimestamp = z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), "ISO 8601 timestampが必要です。")
    .optional();
  const taskWorkRepositoryContextSchema = z
    .object({
      repository_context_id: z.string().trim().min(1).max(200).optional(),
      provider: z
        .enum(["github", "gitlab", "azure_devops", "local", "generic_git", "unknown"])
        .optional(),
      repository_slug: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/)
        .optional(),
      branch: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .refine((value) => !/[\x00-\x1f\x7f]/.test(value), "branchに制御文字は使えません。")
        .optional(),
    })
    .strict()
    .optional();
  const taskWorkBase = {
    task_id: z.string().trim().min(1).max(200),
    expected_version: z.number().int().nonnegative(),
    idempotency_key: z.string().trim().min(1).max(200),
    caller: z.string().trim().min(1).max(200),
    source_session: z.string().trim().min(1).max(200).optional(),
    repository_context: taskWorkRepositoryContextSchema,
    source_app: z.string().trim().min(1).max(120).optional(),
  };
  const queueTaskWork = (args, action) =>
    coreClient.proposeTaskWork({
      ...args,
      action,
      actor: { kind: "ai_agent" },
      source: "mcp",
      source_app: sourceApp(args),
    });
  const requiredTimestamp = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => !Number.isNaN(Date.parse(value)), "ISO 8601 timestamp が必要です。");
  const agentSessionIdentity = {
    idempotency_key: z.string().trim().min(1).max(200),
    caller: z.string().trim().min(1).max(200),
    source_session: z.string().trim().min(1).max(500),
    source_app: z.string().trim().min(1).max(120).optional(),
  };
  const agentSessionList = z.array(z.string().trim().min(1).max(1000)).max(100).optional();
  const queueAgentSession = (args, action) =>
    coreClient.proposeAgentSession({
      ...args,
      action,
      actor: { kind: "ai_agent" },
      source: "mcp",
      source_app: sourceApp(args),
    });
  const contentProposalIdentity = {
    idempotency_key: z.string().trim().min(1).max(200).optional(),
    caller: z.string().trim().min(1).max(200).optional(),
    source_session: z.string().trim().min(1).max(200).optional(),
    source_app: z.string().trim().min(1).max(120).optional(),
  };
  const queueRepositoryTask = (args, kind) =>
    coreClient.proposeRepositoryTask({
      ...args,
      kind,
      actor: { kind: "ai_agent" },
      source: "mcp",
      source_app: sourceApp(args),
      idempotency_key: args.idempotency_key || randomUUID(),
      caller: args.caller || "MCP client",
    });
  const contentProposalBase = {
    ...contentProposalIdentity,
    repository_context: taskWorkRepositoryContextSchema,
  };
  const queueContent = (args, kind) =>
    coreClient.proposeContent({
      ...args,
      idempotency_key: args.idempotency_key ?? randomUUID(),
      caller: args.caller ?? sourceApp(args),
      kind,
      actor: { kind: "ai_agent" },
      source: "mcp",
      source_app: sourceApp(args),
    });

  server.registerTool(
    "tasken.start_agent_session",
    {
      description:
        "Queue an Agent Session start proposal for AI Inbox review. It never creates official data directly.",
      inputSchema: {
        ...agentSessionIdentity,
        started_at: requiredTimestamp,
        client_kind: z.enum(["codex", "claude_code", "cursor", "github_copilot", "other"]),
        client_label: z.string().trim().max(200).optional(),
        agent_label: z.string().trim().max(200).optional(),
        provider_label: z.string().trim().max(200).optional(),
        model_label: z.string().trim().max(200).optional(),
        intent: z
          .object({
            summary: z.string().trim().min(1).max(4000),
            requested_outcome: z.string().trim().max(4000).optional(),
            boundary: z.string().trim().max(4000).optional(),
          })
          .strict(),
        theme_ids: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
        task_ids: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        repository_context_ids: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
        working_copy_ids: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueAgentSession(args, "start")),
  );

  server.registerTool(
    "tasken.finish_agent_session",
    {
      description:
        "Queue an Agent Session outcome proposal for AI Inbox review. Intent and client identity stay immutable.",
      inputSchema: {
        ...agentSessionIdentity,
        agent_session_id: z.string().uuid(),
        expected_version: z.number().int().positive(),
        ended_at: requiredTimestamp,
        status: z.enum(["completed", "blocked", "abandoned"]),
        outcome: z
          .object({
            summary: z.string().trim().min(1).max(8000),
            decisions: agentSessionList,
            changed_items: agentSessionList,
            verification: agentSessionList,
            remaining_work: agentSessionList,
            next_suggested_action: z.string().trim().max(4000).optional(),
          })
          .strict(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueAgentSession(args, "finish")),
  );

  server.registerTool(
    "tasken.submit_agent_session_record",
    {
      description:
        "Queue one complete Agent Session record for AI Inbox review. This is for lifecycle collectors that observed both Intent and terminal Outcome; it never stores raw transcripts or writes official data directly.",
      inputSchema: {
        ...agentSessionIdentity,
        started_at: requiredTimestamp,
        ended_at: requiredTimestamp,
        status: z.enum(["completed", "blocked", "abandoned"]),
        client_kind: z.enum(["codex", "claude_code", "cursor", "github_copilot", "other"]),
        client_label: z.string().trim().max(200).optional(),
        agent_label: z.string().trim().max(200).optional(),
        provider_label: z.string().trim().max(200).optional(),
        model_label: z.string().trim().max(200).optional(),
        intent: z
          .object({
            summary: z.string().trim().min(1).max(4000),
            requested_outcome: z.string().trim().max(4000).optional(),
            boundary: z.string().trim().max(4000).optional(),
          })
          .strict(),
        outcome: z
          .object({
            summary: z.string().trim().min(1).max(8000),
            decisions: agentSessionList,
            changed_items: agentSessionList,
            verification: agentSessionList,
            remaining_work: agentSessionList,
            next_suggested_action: z.string().trim().max(4000).optional(),
          })
          .strict(),
        theme_ids: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
        task_ids: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        repository_context_ids: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
        working_copy_ids: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueAgentSession(args, "capture")),
  );

  server.registerTool(
    "tasken.start_task_work",
    {
      description:
        "Queue a proposal to start work on an assigned Task. This never writes Task state directly.",
      inputSchema: {
        ...taskWorkBase,
        executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]).optional(),
        executor_identity: z.string().trim().max(200).optional(),
        started_at: optionalTimestamp,
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueTaskWork(args, "start")),
  );

  const receiptProposalSchema = {
    ...taskWorkBase,
    executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]),
    executor_label: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(10000),
    completed_items: workItemList,
    changed_or_created_items: workItemList,
    verification: workItemList,
    remaining_work: workItemList,
    external_references: externalReferenceList,
    reported_at: optionalTimestamp,
    provider: z.string().trim().max(120).optional(),
    model: z.string().trim().max(200).optional(),
  };
  server.registerTool(
    "tasken.append_work_receipt",
    {
      description:
        "Queue an append-only Work Receipt proposal. It enters Tasken review and does not complete the Task.",
      inputSchema: receiptProposalSchema,
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueTaskWork(args, "append_receipt")),
  );

  server.registerTool(
    "tasken.report_task_done",
    {
      description:
        "Queue an AI work report as a proposal. The report is not Task completion and requires human review.",
      inputSchema: receiptProposalSchema,
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueTaskWork(args, "report_done")),
  );

  server.registerTool(
    "tasken.report_task_blocked",
    {
      description:
        "Queue an append-only blocker report. The Task changes only after human review; the original Task body is never overwritten.",
      inputSchema: {
        ...taskWorkBase,
        executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]).optional(),
        executor_label: z.string().trim().min(1).max(200),
        blocker: z.string().trim().min(1).max(10000),
        attempted_work: workItemList,
        needed_input: workItemList,
        retained_artifacts: workItemList,
        external_references: externalReferenceList,
        reported_at: optionalTimestamp,
        provider: z.string().trim().max(120).optional(),
        model: z.string().trim().max(200).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueTaskWork(args, "report_blocked")),
  );

  server.registerTool(
    "tasken.propose_repository_context",
    {
      description:
        "Queue a RepositoryContext proposal for user review. This never writes a context directly and never stores credentials.",
      inputSchema: {
        ...contentProposalIdentity,
        label: z.string().trim().min(1).max(200),
        provider: z
          .enum(["github", "gitlab", "azure_devops", "local", "generic_git", "unknown"])
          .optional(),
        remote_url: optionalText,
        local_path: optionalText,
        web_url: optionalText,
        repository_slug: optionalText,
        subdirectory: optionalText,
        default_branch: optionalText,
        reason: z.string().max(2000).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueRepositoryTask(args, "repository_context")),
  );

  server.registerTool(
    "tasken.propose_task",
    {
      description:
        "Queue a new Task proposal. This does not create the Task until the user accepts it in Tasken.",
      inputSchema: {
        ...contentProposalIdentity,
        title: z.string().trim().min(1).max(200),
        description: z.string().max(20000).optional(),
        theme: optionalText,
        priority: z.enum(["normal", "high"]).optional(),
        planned_start: optionalText,
        planned_end: optionalText,
        reason: z.string().max(2000).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueRepositoryTask(args, "task")),
  );

  server.registerTool(
    "tasken.propose_note",
    {
      description:
        "Queue a new Note proposal. Note display type is `memo`; Report is `report`; Prompt is `prompt`. This does not create the Note until the user accepts it in Tasken. A successful result returns a Proposal ID, not a Note ID. When provided, theme is the only association; this does not create a Task or Reference relation.",
      inputSchema: {
        ...contentProposalBase,
        title: z.string().trim().min(1).max(200),
        body: z.string().min(1).max(200000).describe(NOTE_MARKDOWN_BODY_DESCRIPTION),
        theme: optionalText,
        note_type: z.enum(["memo", "report", "prompt"]).optional(),
        reason: z.string().max(2000).optional(),
        source_app: z.string().trim().min(1).max(120).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueContent(args, "note_create")),
  );

  server.registerTool(
    "tasken.propose_note_edit",
    {
      description:
        "Queue a full Markdown replacement for an existing Note. base_version prevents stale overwrites.",
      inputSchema: {
        ...contentProposalBase,
        note_id: z.string().trim().min(1),
        base_version: z.number().int().positive(),
        title: z.string().trim().min(1).max(200),
        body: z.string().max(200000).describe(NOTE_MARKDOWN_BODY_DESCRIPTION),
        reason: z.string().trim().min(1).max(2000),
        source_app: z.string().trim().min(1).max(120).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueContent(args, "note_edit")),
  );

  server.registerTool(
    "tasken.propose_knowledge",
    {
      description: "Queue a Knowledge proposal for review in Tasken.",
      inputSchema: {
        ...contentProposalBase,
        title: z.string().trim().min(1).max(200),
        body: z.string().max(20000).optional(),
        node_type: z.enum(["question", "claim", "evidence", "decision", "insight"]).optional(),
        theme: optionalText,
        confidence: z.enum(["low", "medium", "high"]).optional(),
        reason: z.string().max(2000).optional(),
        source_app: z.string().trim().min(1).max(120).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueContent(args, "knowledge_create")),
  );

  server.registerTool(
    "tasken.propose_sketch",
    {
      description:
        "Queue a safe inline SVG as a Sketch proposal. Tasken only saves it after user preview and acceptance.",
      inputSchema: {
        ...contentProposalBase,
        title: z.string().trim().min(1).max(200),
        svg: z.string().min(1).max(500000),
        theme: optionalText,
        reason: z.string().max(2000).optional(),
        source_app: z.string().trim().min(1).max(120).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueContent(args, "sketch_create")),
  );

  server.registerTool(
    "tasken.propose_artifact",
    {
      description:
        "Queue an inline SVG, Markdown, text, or JSON Artifact. Paths and external URLs are not accepted.",
      inputSchema: {
        ...contentProposalBase,
        title: z.string().trim().min(1).max(200),
        file_name: z.string().trim().min(1).max(180),
        media_type: z.enum(["image/svg+xml", "text/markdown", "text/plain", "application/json"]),
        content: z.string().min(1).max(1000000),
        theme: optionalText,
        reason: z.string().max(2000).optional(),
        source_app: z.string().trim().min(1).max(120).optional(),
      },
      annotations: PROPOSAL_ANNOTATIONS,
    },
    withCoreClient((args) => queueContent(args, "artifact_create")),
  );

  return server;
}

export async function startTaskenMcpServer() {
  const server = createTaskenMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tasken MCP Bridge is running on stdio.");
}
