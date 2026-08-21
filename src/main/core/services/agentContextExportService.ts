import { projectEntityForAi, summarizeAiExclusions, type AiAudience } from "../../../shared/aiMetadata.mjs";
import { publicRepositoryContext, resolveThemeRepositoryContexts } from "../../../shared/repositoryContext.mjs";
import { pickPublicFields, sanitizePublicIdentifier, sanitizePublicText, sanitizePublicUrl, sanitizePublicValue } from "../../../shared/publicProjection.ts";
import { publicAiHeader, publicThemeForContext, TaskContextTextBudget } from "../../../shared/taskContext.mjs";
import {
  exportAiContextRequestSchema, exportAiContextResponseSchema,
  type ExportAiContextRequest, type ExportAiContextResponse,
} from "../../../shared/contracts/task/public.ts";
import type { AgentContextReadPort, AgentContextRecord } from "../ports/agentContextReadPort.ts";

interface ItemQueries {
  searchItems(request: Record<string, unknown>): any;
  listOpenItems(request: Record<string, unknown>): any;
}
interface KnowledgeQueries {
  getRecentNotes(request: Record<string, unknown>): any;
  getKnowledgeContext(request: Record<string, unknown>): any;
  getPlanHealth(request: Record<string, unknown>): any;
  getKnowledgeHealth(request: Record<string, unknown>): any;
}
interface ActivityQueries { getActivity(request: Record<string, unknown>): any }

const DEFAULT_MAX_ITEMS = 40;
const DEFAULT_MAX_NOTES = 20;
const DEFAULT_MAX_KNOWLEDGE = 50;
const DEFAULT_MAX_CHARS = 1_200;
const RESOURCE_FIELDS = ["description", "resource_scope", "project_id", "theme_id", "version", "created_at", "updated_at", "deleted_at", "source", "tags", "metadata"] as const;

function text(value: unknown) { return value == null ? "" : String(value); }
function sortUpdated(records: AgentContextRecord[]) {
  return [...records].sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)) || text(a.id).localeCompare(text(b.id)));
}
function visibleForAudience(record: any, audience: AiAudience) {
  return !record?.ai?.ai_visibility || record.ai.ai_visibility.includes(audience);
}
function publicResource(record: AgentContextRecord) {
  return {
    id: sanitizePublicIdentifier(record.id) || "",
    title: sanitizePublicText(record.title, 500),
    ...pickPublicFields(record, RESOURCE_FIELDS),
    // Deliberate correction: only the allowlisted, credential-free URL leaves Core.
    source_url: sanitizePublicUrl(record.url || record.source_url),
    ai: sanitizePublicValue(publicAiHeader(record)),
  };
}
function aiMark(record: any) {
  const header = record?.ai;
  if (!header) return "";
  const marks = [];
  if (header.freshness === "stale") marks.push("要再確認");
  if (header.freshness === "superseded") marks.push("置き換え済み");
  if (header.freshness === "unknown") marks.push("鮮度不明");
  if (header.authority === "ai_generated") marks.push("AI生成");
  if (header.authority === "inferred") marks.push("推定");
  if (header.authority === "imported") marks.push("取り込み");
  if (header.authority === "user_confirmed") marks.push("確認済み");
  return marks.length ? ` [${marks.join(" / ")}]` : "";
}
function itemDate(item: any) { return item.planned_end || item.planned_start || item.due_date || ""; }
function nodeLines(nodes: any[], kind: string) {
  const scoped = nodes.filter((node) => node.node_type === kind);
  return scoped.length ? scoped.map((node) => `- ${node.title}${node.body ? `: ${node.body}` : ""}${aiMark(node)}`) : ["- なし"];
}
function renderMarkdown(pack: any) {
  return [
    "# Tasken Context", "", `> 公開先: ${pack.ai_audience} / 除外: ${pack.excluded_count || 0}件`, "",
    "## Theme", ...(pack.themes.length ? pack.themes.map((theme: any) => `- ${theme.name}: ${theme.description || ""}${aiMark(theme)}`) : ["- なし"]), "",
    "## Current Open Items", ...(pack.items.length ? pack.items.map((item: any) => `- ${itemDate(item) || "予定なし"} / ${item.status || "todo"}: ${item.title}${aiMark(item)}`) : ["- なし"]), "",
    "## Recent Notes", ...(pack.notes.length ? pack.notes.map((note: any) => `- ${note.title}: ${note.body_excerpt || note.body_markdown || ""}${aiMark(note)}`) : ["- なし"]), "",
    "## Activity", ...(pack.activity.length ? pack.activity.map((event: any) => `- ${event.local_date} ${event.local_time} / ${event.event_kind}: ${event.entity_title} (${event.entity_ref.type}:${event.entity_ref.id})`) : ["- なし"]), "",
    "## Questions", ...nodeLines(pack.knowledge_nodes, "question"), "",
    "## Claims", ...nodeLines(pack.knowledge_nodes, "claim"), "",
    "## Evidence", ...nodeLines(pack.knowledge_nodes, "evidence"), "",
    "## Decisions", ...nodeLines(pack.knowledge_nodes, "decision"), "",
    "## Risks / Contradictions",
    ...(pack.health?.knowledge?.contradicted_claims?.length ? pack.health.knowledge.contradicted_claims.map((node: any) => `- ${node.title}`) : ["- なし"]), "",
    "## Suggested Next Actions",
    ...(pack.health?.knowledge?.unresolved_questions?.length ? pack.health.knowledge.unresolved_questions.map((node: any) => `- Questionを処理: ${node.title}`) : ["- なし"]), "",
    "## AI公開範囲で除外した情報",
    ...(pack.excluded_count ? pack.excluded_reasons.map((entry: any) => `- ${entry.type}: ${entry.reason}（${entry.count}件）`) : ["- 除外なし"]),
  ].join("\n");
}

export class AgentContextExportService {
  constructor(
    private readonly port: AgentContextReadPort,
    private readonly items: ItemQueries,
    private readonly knowledge: KnowledgeQueries,
    private readonly activity: ActivityQueries,
    private readonly now = () => new Date(),
  ) {}

  execute(input: ExportAiContextRequest): ExportAiContextResponse {
    const request = exportAiContextRequestSchema.parse(input);
    const scope = request.scope || "recent";
    const audience = request.audience || "coding_agent";
    const maxItems = request.max_items ?? DEFAULT_MAX_ITEMS;
    const maxNotes = request.max_notes ?? DEFAULT_MAX_NOTES;
    const maxKnowledge = request.max_knowledge_nodes ?? DEFAULT_MAX_KNOWLEDGE;
    const maxChars = request.max_chars ?? DEFAULT_MAX_CHARS;
    const snapshot = this.port.readAgentContextSnapshot(false);
    const themeId = request.theme_id || "";
    const exclusions: any[] = [];
    const themes = sortUpdated((snapshot.workspace.themes || []).filter((theme) => !themeId || text(theme.id) === themeId))
      .flatMap((theme) => {
        const visibility = projectEntityForAi("theme", theme, { audience, theme, workspaceDefault: snapshot.workspaceAiVisibilityDefault });
        if (!visibility.included) { if (visibility.exclusion) exclusions.push(visibility.exclusion); return []; }
        const projected = publicThemeForContext({ ...theme, ai: visibility.header }, new TaskContextTextBudget(maxChars));
        return projected ? [sanitizePublicValue(projected)] : [];
      });
    const visibleThemeIds = new Set(themes.map((theme: any) => text(theme.id)));
    const contextRecords = (snapshot.workspace.repository_contexts || []) as AgentContextRecord[];
    const repositoryContexts = new Map<string, unknown>();
    const themeRepositoryContexts = (snapshot.workspace.themes || [])
      .filter((theme) => visibleThemeIds.has(text(theme.id)))
      .map((theme) => {
        const resolution = resolveThemeRepositoryContexts(theme, contextRecords) as any;
        resolution.contexts.forEach((context: any) => repositoryContexts.set(text(context.id), sanitizePublicValue(publicRepositoryContext(context))));
        return sanitizePublicValue({ theme_id: theme.id, context_ids: resolution.contextIds, missing_context_ids: resolution.missingContextIds, missing_context_reasons: resolution.missingContextReasons });
      });
    const itemResult = scope === "open_items"
      ? this.items.listOpenItems({ theme_id: themeId || undefined, limit: maxItems })
      : this.items.searchItems({ theme_id: themeId || undefined, limit: maxItems });
    const noteResult = this.knowledge.getRecentNotes({ theme_id: themeId || undefined, limit: maxNotes, max_chars: maxChars, include_raw_body: Boolean(request.include_raw_body) });
    const knowledgeResult = this.knowledge.getKnowledgeContext({ theme_id: themeId || undefined, limit: maxKnowledge, max_chars: maxChars, include_relations: true, include_sources: false });
    const activityResult = this.activity.getActivity({ theme_id: themeId || undefined, limit: maxItems, format: "json", audience });
    const resourceCandidates = [
      ...((snapshot.workspace.resources || []) as AgentContextRecord[]),
      ...((snapshot.workspace.links || []) as AgentContextRecord[]),
    ].filter((resource) => !themeId || text(resource.project_id || resource.theme_id) === themeId);
    const resourceIds = new Set<string>();
    const resources = [];
    for (const resource of sortUpdated(resourceCandidates)) {
      if (resources.length >= maxItems || resourceIds.has(text(resource.id))) continue;
      const effectiveThemeId = text(resource.project_id || resource.theme_id);
      const visibility = projectEntityForAi("resource", resource, { audience, theme: snapshot.visibilityThemes.find((theme) => text(theme.id) === effectiveThemeId) || null, workspaceDefault: snapshot.workspaceAiVisibilityDefault });
      if (!visibility.included) { if (visibility.exclusion) exclusions.push(visibility.exclusion); continue; }
      resourceIds.add(text(resource.id));
      resources.push(publicResource({ ...resource, ai: visibility.header }));
    }
    const items = (sanitizePublicValue((itemResult.items || []).filter((entry: any) => visibleForAudience(entry, audience)), { maxDepth: 12, maxArray: 100, maxKeys: 100 }) || []) as any[];
    const notes = (sanitizePublicValue((noteResult.notes || []).filter((entry: any) => visibleForAudience(entry, audience)), { maxDepth: 12, maxArray: 100, maxKeys: 100 }) || []) as any[];
    const knowledgeNodes = (sanitizePublicValue((knowledgeResult.knowledge_nodes || []).filter((entry: any) => visibleForAudience(entry, audience)), { maxDepth: 12, maxArray: 100, maxKeys: 100 }) || []) as any[];
    const publicKnowledgeIds = new Set(knowledgeNodes.map((node: any) => text(node.id)));
    const knowledgeEdges = (sanitizePublicValue((knowledgeResult.knowledge_edges || []).filter((edge: any) => publicKnowledgeIds.has(text(edge.source_node_id)) && publicKnowledgeIds.has(text(edge.target_node_id))), { maxDepth: 12, maxArray: 200, maxKeys: 100 }) || []) as any[];
    const planHealth = this.knowledge.getPlanHealth({ theme_id: themeId || undefined });
    const knowledgeHealth = this.knowledge.getKnowledgeHealth({ theme_id: themeId || undefined });
    const resultMeta = {
      contract_version: 1 as const,
      returned_theme_count: themes.length, returned_item_count: items.length,
      returned_note_count: notes.length, returned_resource_count: resources.length,
      returned_knowledge_node_count: knowledgeNodes.length, returned_activity_count: activityResult.events.length,
      truncated: Boolean(itemResult.truncated || noteResult.truncated || knowledgeResult.truncated || activityResult.truncated || resourceCandidates.length > resources.length),
    };
    const summarized = summarizeAiExclusions([
      ...exclusions,
      ...(itemResult.excluded_reasons || []).flatMap((entry: any) => Array.from({ length: entry.count || 0 }, () => ({ type: entry.type, reason: entry.reason }))),
      ...(noteResult.excluded_reasons || []).flatMap((entry: any) => Array.from({ length: entry.count || 0 }, () => ({ type: entry.type, reason: entry.reason }))),
    ]);
    const pack = {
      generated_at: this.now().toISOString(), scope, ai_audience: audience,
      themes, repository_contexts: [...repositoryContexts.values()], theme_repository_contexts: themeRepositoryContexts,
      items, notes, resources, knowledge_nodes: knowledgeNodes, knowledge_edges: knowledgeEdges,
      activity: activityResult.events,
      activity_meta: { schema_version: activityResult.schema_version, timezone: activityResult.timezone, excluded_count: activityResult.excluded_count, excluded_reasons: activityResult.excluded_reasons },
      health: sanitizePublicValue({ plan: planHealth, knowledge: knowledgeHealth }, { maxDepth: 12, maxArray: 200, maxKeys: 200 }),
      ...summarized, result_meta: resultMeta, read_only: true as const,
    };
    if (request.format === "json") return exportAiContextResponseSchema.parse(pack);
    return exportAiContextResponseSchema.parse(renderMarkdown(pack));
  }
}
