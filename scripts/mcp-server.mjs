#!/usr/bin/env node
import { ReadOnlyTaskenContext, defaultTaskenDbPath } from "../src/main/mcp/readOnlyContext.mjs";

const TOOLS = [
  {
    name: "tasken.search_items",
    description: "Search Tasken items by title, description, next action, or waiting-for text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        theme_id: { type: "string" },
        limit: { type: "number" },
        include_archived: { type: "boolean" },
      },
    },
  },
  {
    name: "tasken.list_open_items",
    description: "List open Tasken items, optionally scoped to a theme.",
    inputSchema: {
      type: "object",
      properties: {
        theme_id: { type: "string" },
        limit: { type: "number" },
        include_archived: { type: "boolean" },
      },
    },
  },
  {
    name: "tasken.get_theme_context",
    description: "Return themes, open items, recent notes, knowledge, and health for a theme.",
    inputSchema: {
      type: "object",
      properties: {
        theme_id: { type: "string" },
        limit: { type: "number" },
        max_chars: { type: "number" },
        include_raw_body: { type: "boolean" },
      },
    },
  },
  {
    name: "tasken.get_recent_notes",
    description: "Return recent notes. Raw note bodies are omitted unless include_raw_body is true.",
    inputSchema: {
      type: "object",
      properties: {
        theme_id: { type: "string" },
        limit: { type: "number" },
        max_chars: { type: "number" },
        include_raw_body: { type: "boolean" },
        include_archived: { type: "boolean" },
      },
    },
  },
  {
    name: "tasken.search_knowledge",
    description: "Search KnowledgeNodes by title, body, and node type.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        theme_id: { type: "string" },
        node_types: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
        max_chars: { type: "number" },
        include_archived: { type: "boolean" },
      },
    },
  },
  {
    name: "tasken.get_knowledge_context",
    description: "Return KnowledgeNodes and optionally relations and source entities.",
    inputSchema: {
      type: "object",
      properties: {
        theme_id: { type: "string" },
        include_relations: { type: "boolean" },
        include_sources: { type: "boolean" },
        include_raw_body: { type: "boolean" },
        limit: { type: "number" },
        max_chars: { type: "number" },
        include_archived: { type: "boolean" },
      },
    },
  },
  {
    name: "tasken.get_plan_health",
    description: "Return open, overdue, waiting, and unscheduled item health.",
    inputSchema: {
      type: "object",
      properties: { theme_id: { type: "string" } },
    },
  },
  {
    name: "tasken.get_knowledge_health",
    description: "Return unresolved questions, claims without evidence, contradictions, unsourced evidence, and isolated nodes.",
    inputSchema: {
      type: "object",
      properties: { theme_id: { type: "string" } },
    },
  },
  {
    name: "tasken.export_ai_context",
    description: "Export Tasken context as markdown or JSON for external AI use.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["active_theme", "selected_theme", "recent", "open_items", "knowledge"] },
        theme_id: { type: "string" },
        max_items: { type: "number" },
        max_notes: { type: "number" },
        max_knowledge_nodes: { type: "number" },
        max_chars: { type: "number" },
        format: { type: "string", enum: ["markdown", "json"] },
        include_raw_body: { type: "boolean" },
      },
    },
  },
];

const TOOL_HANDLERS = {
  "tasken.search_items": "toolSearchItems",
  "tasken.list_open_items": "toolListOpenItems",
  "tasken.get_theme_context": "toolGetThemeContext",
  "tasken.get_recent_notes": "toolGetRecentNotes",
  "tasken.search_knowledge": "toolSearchKnowledge",
  "tasken.get_knowledge_context": "toolGetKnowledgeContext",
  "tasken.get_plan_health": "toolGetPlanHealth",
  "tasken.get_knowledge_health": "toolGetKnowledgeHealth",
  "tasken.export_ai_context": "toolExportAiContext",
};

function frame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function result(id, value) {
  process.stdout.write(frame({ jsonrpc: "2.0", id, result: value }));
}

function error(id, code, message) {
  process.stdout.write(frame({ jsonrpc: "2.0", id, error: { code, message } }));
}

function toolContent(value) {
  return {
    content: [{
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }],
  };
}

function handleRequest(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (message.id == null) return;
  try {
    if (message.method === "initialize") {
      result(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "tasken-readonly", version: "0.1.0" },
      });
      return;
    }
    if (message.method === "tools/list") {
      result(message.id, { tools: TOOLS });
      return;
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const handlerName = TOOL_HANDLERS[name];
      if (!handlerName) throw new Error(`Unknown tool: ${name}`);
      const context = new ReadOnlyTaskenContext(defaultTaskenDbPath());
      try {
        result(message.id, toolContent(context[handlerName](message.params?.arguments || {})));
      } finally {
        context.close();
      }
      return;
    }
    error(message.id, -32601, `Unknown method: ${message.method}`);
  } catch (err) {
    error(message.id, -32000, err instanceof Error ? err.message : String(err));
  }
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) break;
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    handleRequest(JSON.parse(body));
  }
});

process.stdin.resume();
