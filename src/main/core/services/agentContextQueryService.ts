import {
  projectActivityJson,
  projectActivityMarkdown,
  queryActivityEvents,
} from "../../../shared/activityProjection.mjs";
import { buildContextSelection, contextSelectionEntry } from "../../../shared/contextSelection.mjs";
import {
  contextGraphMcpShape,
  getContextSubgraph,
  projectContextGraph,
} from "../../../shared/contextGraph.mjs";
import { collectionKeyForEntityType, entityTypes } from "../../../shared/entityRegistry.mjs";
import { sanitizePublicValue } from "../../../shared/publicProjection.ts";
import {
  publicAiHeader,
  relationForNode,
  TaskContextTextBudget,
} from "../../../shared/taskContext.mjs";
import {
  getActivityRequestSchema,
  getActivityResponseSchema,
  getContextSubgraphRequestSchema,
  getContextSubgraphResponseSchema,
  type GetActivityRequest,
  type GetActivityResponse,
  type GetContextSubgraphRequest,
  type GetContextSubgraphResponse,
} from "../../../shared/contracts/task/public.ts";
import type { AgentContextReadPort, AgentContextRecord } from "../ports/agentContextReadPort.ts";

const DEFAULT_ACTIVITY_LIMIT = 100;

function text(value: unknown) {
  return value == null ? "" : String(value);
}
function entityKey(type: unknown, id: unknown) {
  return JSON.stringify([text(type), text(id)]);
}
function graphTokens(shape: Record<string, any>) {
  return Math.ceil(
    JSON.stringify({
      nodes: shape.nodes || [],
      edges: shape.edges || [],
      paths: shape.paths || [],
      diagnostics: shape.diagnostics || [],
    }).length / 4,
  );
}

export class AgentContextQueryService {
  constructor(private readonly port: AgentContextReadPort) {}

  getActivity(input: GetActivityRequest): GetActivityResponse {
    const request = getActivityRequestSchema.parse(input);
    const snapshot = this.port.readAgentContextSnapshot(Boolean(request.include_archived));
    const entityId = text((input as Record<string, unknown>).entity_id);
    const sourceEvents = (snapshot.workspace.change_events || []).filter(
      (event) => !entityId || text(event.entity_ref?.id || event.entity_id) === entityId,
    );
    const result = queryActivityEvents({
      currentEntityOnly: true,
      events: sourceEvents,
      workspace: snapshot.workspace,
      references: snapshot.workspace.references || [],
      date: request.date || "",
      from: request.from || "",
      to: request.to || "",
      theme_id: request.theme_id || "",
      entity_type: request.entity_type || "",
      event_kinds: request.event_kinds || [],
      profile: request.profile,
      cursor: request.cursor,
      timezone: request.timezone || "Asia/Tokyo",
      roots: snapshot.workspace.canonical_root_status || {},
      limit: request.limit ?? DEFAULT_ACTIVITY_LIMIT,
      include_match_metadata: true,
    });
    const { matched_count: matchedVisible, ...publicResult } = projectActivityJson(result);
    const format = request.format === "markdown" ? "markdown" : "json";
    return getActivityResponseSchema.parse({
      ...publicResult,
      activity: format === "markdown" ? projectActivityMarkdown(result) : publicResult,
      format,
      result_meta: {
        contract_version: 1,
        returned_count: result.events.length,
        matched_visible_count: matchedVisible ?? null,
        truncated: result.truncated,
      },
      read_only: true,
    });
  }

  getContextSubgraph(input: GetContextSubgraphRequest): GetContextSubgraphResponse {
    const request = getContextSubgraphRequestSchema.parse(input);
    const snapshot = this.port.readAgentContextSnapshot(Boolean(request.include_archived));
    const workspace = snapshot.workspace;
    const records = new Map<string, AgentContextRecord>();
    for (const type of entityTypes) {
      const values = (workspace[collectionKeyForEntityType(type)] || []) as AgentContextRecord[];
      for (const record of values) records.set(entityKey(type, record.id), record);
    }
    const graph = projectContextGraph(workspace);
    const result = getContextSubgraph(
      graph,
      { type: request.entity_type, id: request.entity_id },
      {
        maxHops: request.max_hops,
        maxNodes: request.max_nodes,
        maxEdges: request.max_edges,
        tokenBudget: request.token_budget,
        includeSuggested: Boolean(request.include_suggested),
      },
    );
    const base = contextGraphMcpShape(result) as Record<string, any>;
    const tokenBudget = Number(result.limits?.tokenBudget || 12_000);
    const remaining = Math.max(
      0,
      tokenBudget * 4 -
        JSON.stringify({
          nodes: base.nodes,
          edges: base.edges,
          paths: base.paths,
          diagnostics: base.diagnostics,
        }).length,
    );
    const budget = remaining ? new TaskContextTextBudget(remaining) : null;
    const shape: Record<string, any> = {
      ...base,
      nodes: base.nodes.map((node: Record<string, unknown>) => {
        const ai = (publicAiHeader as any)(records.get(entityKey(node.type, node.id)), budget);
        return ai ? { ...node, ai } : node;
      }),
    };
    let metadataTruncated = Boolean(!budget || budget.truncated);
    while (graphTokens(shape) > tokenBudget) {
      const node = [...shape.nodes]
        .reverse()
        .find((candidate: Record<string, unknown>) => candidate.ai);
      if (!node) break;
      delete node.ai;
      metadataTruncated = true;
    }
    if (metadataTruncated) {
      shape.truncated = true;
      shape.exclusions = [...new Set([...(shape.exclusions || []), "ai_metadata_budget"])];
    }
    shape.estimated_tokens = graphTokens(shape);
    const included = shape.nodes.map((node: Record<string, any>) => {
      const relation = relationForNode(shape, node.type, node.id);
      return contextSelectionEntry(node.type, node, {
        reason:
          node.type === request.entity_type && text(node.id) === request.entity_id
            ? "seed"
            : relation.includedBecause,
        relationPath: relation.path,
      });
    });
    const contextSelection = buildContextSelection({
      seed: shape.seed,
      included,
      relations: shape.edges,
      limits: shape.limits,
      truncated: shape.truncated,
      truncation: { reasons: shape.exclusions },
      estimatedCharacters: JSON.stringify(shape).length,
      estimatedTokens: shape.estimated_tokens,
      policy: shape.policy,
    });
    return getContextSubgraphResponseSchema.parse(
      sanitizePublicValue(
        {
          ...shape,
          context_selection: contextSelection,
          result_meta: {
            contract_version: 1,
            returned_node_count: shape.nodes.length,
            returned_edge_count: shape.edges.length,
            truncated: shape.truncated,
          },
          read_only: true,
        },
        { maxDepth: 12, maxArray: 200, maxKeys: 200, maxText: 8_000 },
      ),
    );
  }
}
