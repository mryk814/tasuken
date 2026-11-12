import { buildAiEntityHeader } from "../../../shared/aiMetadata.mjs";

import { collectionKeyForEntityType, entityTypes } from "../../../shared/entityRegistry.mjs";
import {
  contextGraphMcpShape,
  getContextSubgraph,
  projectContextGraph,
} from "../../../shared/contextGraph.mjs";
import { publicRepositoryContext } from "../../../shared/repositoryContext.mjs";
import { noteProjectId } from "../../../shared/themeRef.mjs";
import {
  publicAiHeader,
  publicNoteSummary,
  publicThemeForContext,
  relationForNode,
  safeReceiptValue,
  TaskContextTextBudget,
} from "../../../shared/taskContext.mjs";
import {
  buildContextSelection,
  contextSelectionEntry,
  contextSelectionExclusions,
  summarizeExclusions,
} from "../../../shared/contextSelection.mjs";
import {
  getThemeContextRequestSchema,
  getThemeContextResponseSchema,
  type GetThemeContextRequest,
  type GetThemeContextResponse,
} from "../../../shared/contracts/task/public.ts";
import type { EntityType } from "../../../shared/types/workspace.ts";
import type { ThemeContextReadPort, ThemeContextRecord } from "../ports/themeContextReadPort.ts";

const ITEM_KIND_ENTITY_TYPES: Record<string, string> = {
  task: "task",
  waiting: "waiting",
  milestone: "plan_node",
  period: "plan_node",
};

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function sortUpdated(records: ThemeContextRecord[]) {
  return [...records].sort((left, right) =>
    text(right.updated_at).localeCompare(text(left.updated_at)),
  );
}

function entityKey(type: unknown, id: unknown) {
  return JSON.stringify([text(type), text(id)]);
}

function graphPayloadTokens(shape: Record<string, any>) {
  return Math.ceil(
    JSON.stringify({
      nodes: shape.nodes || [],
      edges: shape.edges || [],
      paths: shape.paths || [],
      diagnostics: shape.diagnostics || [],
    }).length / 4,
  );
}

function structuredReadError(code: string, message: string, details: Record<string, unknown> = {}) {
  return { error: { code, message, ...details }, read_only: true as const };
}

function publicThemeGraphEntity(
  type: string,
  record: ThemeContextRecord,
  budget: TaskContextTextBudget,
  relation: Record<string, any>,
  includeRawBody = false,
) {
  if (!record?.id) return null;
  if (type === "theme" || type === "project") return publicThemeForContext(record, budget);
  if (type === "repository_context") {
    const output = publicRepositoryContext(record);
    const ai = (publicAiHeader as any)(record, budget);
    return ai ? { ...output, ai } : output;
  }
  if (type === "note") {
    if (!includeRawBody) return publicNoteSummary(record, budget, relation);
    const output = {
      id: String(record.id),
      title: budget.take(record.title, 500),
      note_type: record.note_type || "note",
      project_id: noteProjectId(record),
      body_markdown: budget.take(record.body_markdown, 8_000),
      version: Number(record.version || 0),
      created_at: record.created_at || null,
      updated_at: record.updated_at || null,
      included_because: relation.includedBecause,
      relation_path: relation.path,
    };
    const ai = (publicAiHeader as any)(record, budget);
    return ai ? { ...output, ai } : output;
  }
  if (type === "knowledge_node") {
    const output = {
      id: String(record.id),
      title: budget.take(record.title, 500),
      node_type: record.node_type || null,
      theme_id: record.theme_id || null,
      body: budget.take(record.body, 8_000),
      source_type: record.source_type || null,
      source_id: record.source_id || null,
      created_at: record.created_at || null,
      updated_at: record.updated_at || null,
      included_because: relation.includedBecause,
      relation_path: relation.path,
    };
    const ai = (publicAiHeader as any)(record, budget);
    return ai ? { ...output, ai } : output;
  }
  if (["task", "waiting", "plan_node", "item"].includes(type)) {
    const output = {
      id: String(record.id),
      entity_type: type,
      title: budget.take(record.title, 500),
      kind: type === "plan_node" ? record.type || "period" : type,
      state: record.state || null,
      status: record.status || record.state || null,
      priority: record.priority || null,
      theme_id: record.project_id || record.theme_id || null,
      description: budget.take(record.description, 4_000),
      waiting_for: type === "waiting" ? budget.take(record.waiting_for, 1_000) : undefined,
      next_action: type === "waiting" ? budget.take(record.next_action, 1_000) : undefined,
      created_at: record.created_at || null,
      updated_at: record.updated_at || null,
      included_because: relation.includedBecause,
      relation_path: relation.path,
    };
    const ai = (publicAiHeader as any)(record, budget);
    return ai ? { ...output, ai } : output;
  }
  return null;
}

export class ThemeContextQueryService {
  constructor(private readonly port: ThemeContextReadPort) {}

  execute(input: GetThemeContextRequest): GetThemeContextResponse {
    const args = getThemeContextRequestSchema.parse(input);
    const limit = args.limit ?? 50;
    const textLimit = args.max_chars ?? 1_200;
    const themeId = text(args.theme_id).trim();
    const includeArchived = Boolean(args.include_archived);
    const workspace = this.port.loadThemeContextWorkspace(includeArchived);
    const records = (type: string) =>
      sortUpdated([
        ...((workspace[collectionKeyForEntityType(type as EntityType)] ||
          []) as ThemeContextRecord[]),
      ]);
    const access = { records: new Map<string, ThemeContextRecord>() };
    for (const entityType of entityTypes) {
      for (const record of records(entityType)) {
        const headerType =
          entityType === "item" ? ITEM_KIND_ENTITY_TYPES[record.kind] || "item" : entityType;
        access.records.set(entityKey(entityType, record.id), {
          ...record,
          ai: buildAiEntityHeader(headerType, record),
        });
      }
    }

    const canonicalSeed = records("project").find((theme) => String(theme.id) === themeId);
    const legacySeed = records("theme").find((theme) => String(theme.id) === themeId);
    const seedType = canonicalSeed ? "project" : "theme";
    const seedRecord = canonicalSeed || legacySeed;
    if (!seedRecord) {
      const contextSelection = (buildContextSelection as any)({
        seed: { type: seedType, id: themeId },
        limits: {},
      });
      return getThemeContextResponseSchema.parse({
        ...structuredReadError("not_found", "Themeが見つかりません。Theme IDを確認してください。", {
          theme_id: themeId,
        }),
        context_selection: contextSelection,
      });
    }

    const visibleWorkspace = { ...workspace };
    for (const entityType of entityTypes) {
      visibleWorkspace[collectionKeyForEntityType(entityType)] = records(entityType)
        .map((record) => access.records.get(entityKey(entityType, record.id)))
        .filter(Boolean);
    }
    const graph = projectContextGraph(visibleWorkspace);
    const subgraph = getContextSubgraph(
      graph,
      { type: seedType, id: themeId },
      {
        maxHops: args.max_hops ?? 2,
        maxNodes: args.max_nodes ?? Math.min(100, limit),
        maxEdges: args.max_edges ?? Math.min(200, limit * 4),
        tokenBudget: args.token_budget ?? 12_000,
        includeSuggested: false,
      },
    );
    const rawRelationGraph = contextGraphMcpShape(subgraph);
    rawRelationGraph.edges = rawRelationGraph.edges.map(
      ({ metadata: _metadata, ...edge }: Record<string, any>) => edge,
    );
    const relationGraph = safeReceiptValue(rawRelationGraph);
    const budget = new TaskContextTextBudget(textLimit);
    const selected: { type: string; output: Record<string, any> }[] = [];
    const selectionExclusions: Record<string, any>[] = [];
    for (const node of relationGraph.nodes) {
      const record = access.records.get(entityKey(node.type, node.id));
      if (!record) continue;
      if (
        ["task", "waiting", "plan_node", "item"].includes(node.type) &&
        ["done", "cancelled", "received"].includes(record.status || record.state)
      ) {
        selectionExclusions.push({
          ref: { type: node.type, id: String(node.id) },
          reason: "not_open",
          count: 1,
        });
        continue;
      }
      const relation = relationForNode(relationGraph, node.type, node.id);
      const rawOutput = publicThemeGraphEntity(
        node.type,
        record,
        budget,
        relation,
        Boolean(args.include_raw_body),
      );
      const output = rawOutput ? safeReceiptValue(rawOutput) : null;
      if (output)
        selected.push({
          type: node.type,
          output: {
            ...output,
            included_because:
              node.type === seedType && String(node.id) === themeId
                ? "seed"
                : relation.includedBecause,
            relation_path: relation.path,
          },
        });
      else
        selectionExclusions.push({
          ref: { type: node.type, id: String(node.id) },
          reason: "theme_context_scope",
          count: 1,
        });
    }
    const selectedKeys = new Set(selected.map((entry) => entityKey(entry.type, entry.output.id)));
    const retainedEdges = relationGraph.edges.filter(
      (edge: Record<string, any>) =>
        selectedKeys.has(entityKey(edge.source.type, edge.source.id)) &&
        selectedKeys.has(entityKey(edge.target.type, edge.target.id)),
    );
    const retainedEdgeIds = new Set(
      retainedEdges.map((edge: Record<string, any>) => String(edge.id)),
    );
    const contextGraph = {
      ...relationGraph,
      nodes: relationGraph.nodes.filter((node: Record<string, any>) =>
        selectedKeys.has(entityKey(node.type, node.id)),
      ),
      edges: retainedEdges,
      paths: relationGraph.paths.filter(
        (path: Record<string, any>) =>
          selectedKeys.has(entityKey(path.from.type, path.from.id)) &&
          selectedKeys.has(entityKey(path.to.type, path.to.id)) &&
          path.edge_ids.every((edgeId: unknown) => retainedEdgeIds.has(String(edgeId))),
      ),
    };
    contextGraph.estimated_tokens = graphPayloadTokens(contextGraph);
    const byType = (type: string) =>
      selected.filter((entry) => entry.type === type).map((entry) => entry.output);
    const themeEntries = selected.filter(
      (entry) => entry.type === "project" || entry.type === "theme",
    );
    const themes = themeEntries.map((entry) => entry.output);
    const repositoryContexts = byType("repository_context");
    const openItems = selected
      .filter((entry) => ["task", "waiting", "plan_node", "item"].includes(entry.type))
      .map((entry) => entry.output);
    const recentNotes = byType("note");
    const knowledgeNodes = byType("knowledge_node");
    const knowledgeNodeIds = new Set(knowledgeNodes.map((node) => String(node.id)));
    const knowledgeEdges = contextGraph.edges.filter(
      (edge: Record<string, any>) =>
        edge.source.type === "knowledge_node" &&
        edge.target.type === "knowledge_node" &&
        knowledgeNodeIds.has(String(edge.source.id)) &&
        knowledgeNodeIds.has(String(edge.target.id)),
    );
    const repositoryContextById = new Map(
      repositoryContexts.map((context) => [String(context.id), context]),
    );
    const themeRepositoryContexts = themeEntries.map(({ type, output: theme }) => {
      const contextIds = contextGraph.edges
        .filter(
          (edge: Record<string, any>) =>
            edge.predicate === "uses_repository_context" &&
            edge.source.type === type &&
            String(edge.source.id) === String(theme.id) &&
            edge.target.type === "repository_context" &&
            repositoryContextById.has(String(edge.target.id)),
        )
        .map((edge: Record<string, any>) => String(edge.target.id));
      const uniqueContextIds = [...new Set<string>(contextIds)].sort();
      return {
        theme_id: theme.id,
        context_ids: uniqueContextIds,
        missing_context_ids: [],
        missing_context_reasons: [],
        contexts: uniqueContextIds.map((id) => repositoryContextById.get(id)),
      };
    });
    const included = selected.map(({ type, output }) =>
      contextSelectionEntry(type, output, {
        reason:
          type === seedType && String(output.id) === themeId ? "seed" : output.included_because,
        relationPath: output.relation_path,
      }),
    );
    const normalizedExclusions = contextSelectionExclusions(selectionExclusions);
    const truncation: Record<string, any> = {};
    const warnings: Record<string, unknown>[] = [];
    if (contextGraph.truncated) {
      truncation.graph = { reason: "bounded_relation_query", limits: contextGraph.limits };
      warnings.push({
        code: "relation_graph_truncated",
        message: "Theme contextのrelation traversalが上限に達しました。",
      });
    }
    if (budget.truncated) {
      truncation.text = { reason: "max_text_length", limit: budget.limit, used: budget.used };
      warnings.push({
        code: "text_truncated",
        message: "Theme context本文が文字数上限に達しました。",
      });
    }
    const contextSelection = (buildContextSelection as any)({
      seed: { type: seedType, id: themeId },
      included,
      excluded: normalizedExclusions,
      relations: contextGraph.edges,
      limits: { max_text_length: textLimit, graph: contextGraph.limits },
      truncated: Boolean(contextGraph.truncated || budget.truncated),
      truncation,
      estimatedCharacters: budget.used,
      estimatedTokens: Math.ceil(budget.used / 4) + Number(contextGraph.estimated_tokens || 0),
      policy: contextGraph.policy,
    });
    const exclusionSummary = summarizeExclusions(
      normalizedExclusions.map((entry: Record<string, any>) => ({
        type: entry.ref.type,
        id: entry.ref.id,
        reason: entry.reason,
      })),
    );
    return getThemeContextResponseSchema.parse({
      themes,
      repository_contexts: repositoryContexts,
      theme_repository_contexts: themeRepositoryContexts,
      open_items: openItems,
      recent_notes: recentNotes,
      knowledge: { knowledge_nodes: knowledgeNodes, knowledge_edges: knowledgeEdges },
      health: {
        plan: { open_count: openItems.length },
        knowledge: { represented_node_count: knowledgeNodes.length },
      },
      context_graph: contextGraph,
      context_selection: contextSelection,
      limits: { max_text_length: textLimit, graph: contextGraph.limits },
      truncation,
      warnings,
      truncated: Boolean(contextGraph.truncated || budget.truncated),
      read_only: true,
      ...exclusionSummary,
    });
  }
}
