import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { ReadOnlyTaskenContext, defaultTaskenDbPath } from "./readOnlyContext.mjs";
import { queueMcpProposal } from "./proposalInbox.mjs";
import { entityTypes } from "../../shared/entityRegistry.mjs";

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

function toolResult(value) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: typeof value === "string" ? undefined : value,
  };
}

function withReadContext(handler) {
  return async (args) => {
    const context = new ReadOnlyTaskenContext(defaultTaskenDbPath());
    try {
      return toolResult(handler(context, args));
    } finally {
      context.close();
    }
  };
}

function sourceApp(args) {
  return args.source_app || "mcp-client";
}

export function createTaskenMcpServer() {
  const server = new McpServer({
    name: "tasken",
    version: "1.0.0",
  }, {
    instructions: "Tasken is a local-first work and knowledge app. Read tools may be used directly. Write tools only queue a Proposal; tell the user to review it in Tasken before it becomes official data.",
  });

  server.registerTool("tasken.search_items", {
    description: "Search Tasken tasks, waitings, and plan nodes.",
    inputSchema: {
      query: optionalText,
      theme_id: optionalText,
      limit: optionalLimit,
      include_archived: z.boolean().optional(),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolSearchItems(args)));

  server.registerTool("tasken.list_open_items", {
    description: "List open Tasken tasks, waitings, and plan nodes.",
    inputSchema: {
      theme_id: optionalText,
      limit: optionalLimit,
      include_archived: z.boolean().optional(),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolListOpenItems(args)));

  server.registerTool("tasken.list_agent_ready_tasks", {
    description: "List AI-assigned Tasks that are ready for an agent. Read-only; a Work Receipt never completes a Task.",
    inputSchema: {
      theme_id: optionalText,
      limit: optionalLimit,
      include_archived: z.boolean().optional(),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolListAgentReadyTasks(args)));

  server.registerTool("tasken.get_task_assignment", {
    description: "Read one Task assignment and its append-only Work Receipts. Read-only.",
    inputSchema: {
      task_id: z.string().trim().min(1).max(200),
      limit: optionalLimit,
      include_archived: z.boolean().optional(),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolGetTaskAssignment(args)));

  server.registerTool("tasken.get_theme_context", {
    description: "Return themes, open work, recent notes, knowledge, and health.",
    inputSchema: {
      theme_id: optionalText,
      limit: optionalLimit,
      max_chars: z.number().int().positive().max(8000).optional(),
      include_raw_body: z.boolean().optional(),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolGetThemeContext(args)));

  server.registerTool("tasken.get_recent_notes", {
    description: "Return recent notes. Full Markdown requires include_raw_body=true.",
    inputSchema: {
      theme_id: optionalText,
      limit: optionalLimit,
      max_chars: z.number().int().positive().max(8000).optional(),
      include_raw_body: z.boolean().optional(),
      include_archived: z.boolean().optional(),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolGetRecentNotes(args)));

  server.registerTool("tasken.search_knowledge", {
    description: "Search Tasken Knowledge nodes.",
    inputSchema: {
      query: optionalText,
      theme_id: optionalText,
      node_types: z.array(z.string()).max(8).optional(),
      limit: optionalLimit,
      max_chars: z.number().int().positive().max(8000).optional(),
      include_archived: z.boolean().optional(),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolSearchKnowledge(args)));

  server.registerTool("tasken.get_knowledge_context", {
    description: "Return Knowledge nodes, relations, and optionally source entities.",
    inputSchema: {
      theme_id: optionalText,
      include_relations: z.boolean().optional(),
      include_sources: z.boolean().optional(),
      include_raw_body: z.boolean().optional(),
      limit: optionalLimit,
      max_chars: z.number().int().positive().max(8000).optional(),
      include_archived: z.boolean().optional(),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolGetKnowledgeContext(args)));

  server.registerTool("tasken.get_plan_health", {
    description: "Return open, overdue, waiting, and unscheduled work health.",
    inputSchema: { theme_id: optionalText },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolGetPlanHealth(args)));

  server.registerTool("tasken.get_knowledge_health", {
    description: "Return unresolved questions and other Knowledge health issues.",
    inputSchema: { theme_id: optionalText },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolGetKnowledgeHealth(args)));

  server.registerTool("tasken.get_activity", {
    description: "Return the structured Activity event index as JSON or Markdown. This is read-only and applies AI visibility policy at projection time.",
    inputSchema: {
      date: optionalText,
      from: optionalText,
      to: optionalText,
      theme_id: optionalText,
      entity_type: optionalText,
      event_kinds: z.array(z.string()).max(20).optional(),
      timezone: optionalText,
      limit: optionalLimit,
      format: z.enum(["json", "markdown"]).optional(),
      audience: z.enum(["m365", "coding_agent", "external_ai"]).optional(),
      include_archived: z.boolean().optional(),
    },
    annotations: READ_ONLY_ANNOTATIONS,
  }, withReadContext((context, args) => context.toolGetActivity(args)));

  server.registerTool("tasken.get_context_subgraph", {
    description: "Return a bounded, read-only Context/Provenance subgraph for one typed entity. Suggested relations are excluded by default and never become facts.",
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
  }, withReadContext((context, args) => context.toolGetContextSubgraph(args)));

  server.registerTool("tasken.export_ai_context", {
    description: "Export bounded Tasken context as Markdown or JSON.",
    inputSchema: {
      scope: z.enum(["active_theme", "selected_theme", "recent", "open_items", "knowledge"]).optional(),
      theme_id: optionalText,
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
  }, withReadContext((context, args) => context.toolExportAiContext(args)));

  const workItemList = z.array(z.string().trim().min(1).max(1000)).max(100).optional();
  const taskWorkBase = {
    task_id: z.string().trim().min(1).max(200),
    source_app: z.string().trim().min(1).max(120).optional(),
  };
  const queueTaskWork = (args, action, extra = {}) => toolResult(queueMcpProposal({
    payloadType: "task_work",
    sourceApp: sourceApp(args),
    payload: { task_work: [{ action, task_id: args.task_id, ...extra }] },
    request: { tool: {
      start: "tasken.start_task_work",
      append_receipt: "tasken.append_work_receipt",
      report_done: "tasken.report_task_done",
      request_review: "tasken.request_human_review",
    }[action] || `tasken.${action}` },
  }));

  server.registerTool("tasken.start_task_work", {
    description: "Queue a proposal to start work on an assigned Task. This never writes Task state directly.",
    inputSchema: {
      ...taskWorkBase,
      executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]).optional(),
      executor_identity: z.string().trim().max(200).optional(),
    },
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => queueTaskWork(args, "start", {
    executor_kind: args.executor_kind || "ai_agent",
    executor_identity: args.executor_identity || null,
  }));

  const receiptProposalSchema = {
    ...taskWorkBase,
    executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]),
    executor_label: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(10000),
    completed_items: workItemList,
    changed_or_created_items: workItemList,
    verification: workItemList,
    remaining_work: workItemList,
    provider: z.string().trim().max(120).optional(),
    model: z.string().trim().max(200).optional(),
  };
  const receiptProposalFields = (args) => ({
    executor_kind: args.executor_kind,
    executor_label: args.executor_label,
    summary: args.summary,
    completed_items: args.completed_items || [],
    changed_or_created_items: args.changed_or_created_items || [],
    verification: args.verification || [],
    remaining_work: args.remaining_work || [],
    runtime_metadata: args.provider || args.model ? { provider: args.provider || null, model: args.model || null } : null,
  });

  server.registerTool("tasken.append_work_receipt", {
    description: "Queue an append-only Work Receipt proposal. It enters Tasken review and does not complete the Task.",
    inputSchema: receiptProposalSchema,
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => queueTaskWork(args, "append_receipt", receiptProposalFields(args)));

  server.registerTool("tasken.report_task_done", {
    description: "Queue an AI work report as a proposal. The report is not Task completion and requires human review.",
    inputSchema: receiptProposalSchema,
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => queueTaskWork(args, "report_done", receiptProposalFields(args)));

  server.registerTool("tasken.request_human_review", {
    description: "Queue a proposal asking Tasken to show a Task's Work Receipt for human review.",
    inputSchema: {
      ...taskWorkBase,
      review_note: z.string().trim().min(1).max(2000),
    },
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => queueTaskWork(args, "request_review", { review_note: args.review_note }));

  server.registerTool("tasken.propose_task", {
    description: "Queue a new Task proposal. This does not create the Task until the user accepts it in Tasken.",
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      description: z.string().max(20000).optional(),
      theme: optionalText,
      priority: z.enum(["normal", "high"]).optional(),
      planned_start: optionalText,
      planned_end: optionalText,
      reason: z.string().max(2000).optional(),
      source_app: z.string().trim().min(1).max(120).optional(),
    },
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => toolResult(queueMcpProposal({
    payloadType: "items",
    sourceApp: sourceApp(args),
    payload: {
      items: [{
        action: "create",
        kind: "task",
        status: "todo",
        title: args.title,
        description: args.description || "",
        theme: args.theme || "",
        priority: args.priority || "normal",
        planned_start: args.planned_start || null,
        planned_end: args.planned_end || null,
        reason: args.reason || "",
      }],
    },
    request: { tool: "tasken.propose_task" },
  })));

  server.registerTool("tasken.propose_note", {
    description: "Queue a new Note proposal. This does not create the Note until the user accepts it in Tasken.",
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      body: z.string().min(1).max(200000),
      theme: optionalText,
      note_type: z.enum(["memo", "report", "prompt"]).optional(),
      reason: z.string().max(2000).optional(),
      source_app: z.string().trim().min(1).max(120).optional(),
    },
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => toolResult(queueMcpProposal({
    payloadType: "notes",
    sourceApp: sourceApp(args),
    payload: {
      notes: [{
        action: "create",
        title: args.title,
        body: args.body,
        theme: args.theme || "",
        note_type: args.note_type || "memo",
        reason: args.reason || "",
      }],
    },
    request: { tool: "tasken.propose_note" },
  })));

  server.registerTool("tasken.propose_note_edit", {
    description: "Queue a full Markdown replacement for an existing Note. base_version prevents stale overwrites.",
    inputSchema: {
      note_id: z.string().trim().min(1),
      base_version: z.number().int().positive(),
      title: z.string().trim().min(1).max(200),
      body: z.string().max(200000),
      reason: z.string().trim().min(1).max(2000),
      source_app: z.string().trim().min(1).max(120).optional(),
    },
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => toolResult(queueMcpProposal({
    payloadType: "notes",
    sourceApp: sourceApp(args),
    payload: {
      notes: [{
        action: "merge",
        target_id: args.note_id,
        base_version: args.base_version,
        title: args.title,
        body: args.body,
        reason: args.reason,
      }],
    },
    request: {
      tool: "tasken.propose_note_edit",
      target: { type: "note", id: args.note_id, base_version: args.base_version },
    },
  })));

  server.registerTool("tasken.propose_knowledge", {
    description: "Queue a Knowledge proposal for review in Tasken.",
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      body: z.string().max(20000).optional(),
      node_type: z.enum(["question", "claim", "evidence", "decision", "insight"]).optional(),
      theme: optionalText,
      confidence: z.enum(["low", "medium", "high"]).optional(),
      reason: z.string().max(2000).optional(),
      source_app: z.string().trim().min(1).max(120).optional(),
    },
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => toolResult(queueMcpProposal({
    payloadType: "knowledge_nodes",
    sourceApp: sourceApp(args),
    payload: {
      knowledge_nodes: [{
        action: "create",
        title: args.title,
        body: args.body || "",
        node_type: args.node_type || "insight",
        theme: args.theme || "",
        confidence: args.confidence || "medium",
        reason: args.reason || "",
      }],
    },
    request: { tool: "tasken.propose_knowledge" },
  })));

  server.registerTool("tasken.propose_sketch", {
    description: "Queue a safe inline SVG as a Sketch proposal. Tasken only saves it after user preview and acceptance.",
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      svg: z.string().min(1).max(500000),
      theme: optionalText,
      reason: z.string().max(2000).optional(),
      source_app: z.string().trim().min(1).max(120).optional(),
    },
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => toolResult(queueMcpProposal({
    payloadType: "sketches",
    sourceApp: sourceApp(args),
    payload: {
      sketches: [{
        action: "create",
        title: args.title,
        svg: args.svg,
        theme: args.theme || "",
        reason: args.reason || "",
      }],
    },
    request: { tool: "tasken.propose_sketch" },
  })));

  server.registerTool("tasken.propose_artifact", {
    description: "Queue an inline SVG, Markdown, text, or JSON Artifact. Paths and external URLs are not accepted.",
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      file_name: z.string().trim().min(1).max(180),
      media_type: z.enum(["image/svg+xml", "text/markdown", "text/plain", "application/json"]),
      content: z.string().min(1).max(1000000),
      theme: optionalText,
      reason: z.string().max(2000).optional(),
      source_app: z.string().trim().min(1).max(120).optional(),
    },
    annotations: PROPOSAL_ANNOTATIONS,
  }, async (args) => toolResult(queueMcpProposal({
    payloadType: "artifacts",
    sourceApp: sourceApp(args),
    payload: {
      artifacts: [{
        action: "create",
        title: args.title,
        file_name: args.file_name,
        media_type: args.media_type,
        content: args.content,
        theme: args.theme || "",
        reason: args.reason || "",
      }],
    },
    request: { tool: "tasken.propose_artifact" },
  })));

  return server;
}

export async function startTaskenMcpServer() {
  const server = createTaskenMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tasken MCP Bridge is running on stdio.");
}
