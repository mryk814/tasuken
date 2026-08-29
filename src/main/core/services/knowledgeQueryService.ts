import {
  projectEntityForAi,
  summarizeAiExclusions,
  type AiAudience,
} from "../../../shared/aiMetadata.mjs";
import {
  buildKnowledgeHealth,
  groupKnowledgeHealthIssues,
} from "../../../shared/knowledgeHealth.mjs";
import {
  pickPublicFields,
  sanitizePublicIdentifier,
  sanitizePublicText,
  sanitizePublicUrl,
  sanitizePublicValue,
} from "../../../shared/publicProjection.ts";
import { noteProjectId } from "../../../shared/themeRef.mjs";
import { publicAiHeader } from "../../../shared/taskContext.mjs";
import {
  getKnowledgeContextRequestSchema,
  getKnowledgeContextResponseSchema,
  getKnowledgeHealthRequestSchema,
  getKnowledgeHealthResponseSchema,
  getPlanHealthRequestSchema,
  getPlanHealthResponseSchema,
  getRecentNotesRequestSchema,
  getRecentNotesResponseSchema,
  searchKnowledgeRequestSchema,
  searchKnowledgeResponseSchema,
  type GetKnowledgeContextRequest,
  type GetKnowledgeContextResponse,
  type GetKnowledgeHealthRequest,
  type GetKnowledgeHealthResponse,
  type GetPlanHealthRequest,
  type GetPlanHealthResponse,
  type GetRecentNotesRequest,
  type GetRecentNotesResponse,
  type SearchKnowledgeRequest,
  type SearchKnowledgeResponse,
} from "../../../shared/contracts/task/public.ts";
import type { KnowledgeReadPort, KnowledgeReadRecord } from "../ports/knowledgeReadPort.ts";

const AUDIENCE = "coding_agent" as const;
const DEFAULT_LIMIT = 20;
const DEFAULT_CONTEXT_LIMIT = 50;
const DEFAULT_TEXT_LIMIT = 1_200;
const MAX_EDGE_RESULTS = 200;
const MAX_HEALTH_RESULTS = 100;

const KNOWLEDGE_NEXT_TOOLS = [
  {
    tool: "tasken.get_theme_context",
    description: "Theme単位の作業・Note・Knowledgeをまとめて読む。",
  },
  {
    tool: "tasken.get_context_subgraph",
    description: "対象Entityのbounded relation graphを読む。",
  },
  {
    tool: "tasken.propose_knowledge",
    description: "追記が必要なら利用者レビュー用Knowledge案をqueueする。",
  },
];
const NOTE_NEXT_TOOLS = [
  { tool: "tasken.get_note", description: "stable Note IDで本文を再取得する。" },
  { tool: "tasken.get_theme_context", description: "関連Themeのbounded contextを読む。" },
  { tool: "tasken.propose_note", description: "追記が必要なら利用者レビュー用Note案をqueueする。" },
];
const HEALTH_NEXT_TOOLS = [
  { tool: "tasken.list_open_items", description: "公開対象のopen workを確認する。" },
  { tool: "tasken.get_theme_context", description: "対象Themeのbounded contextを読む。" },
  {
    tool: "tasken.propose_task_update",
    description: "修正が必要なら利用者レビュー用Task更新案をqueueする。",
  },
];

const ITEM_KIND_ENTITY_TYPES: Record<string, string> = {
  task: "task",
  waiting: "waiting",
  milestone: "plan_node",
  period: "plan_node",
};
const AI_METADATA_KEYS = [
  "ai_summary",
  "ai_summary_authority",
  "ai_freshness",
  "ai_authority",
  "ai_visibility",
  "ai_last_verified_at",
  "ai_superseded_by",
  "ai_source_refs",
] as const;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function truncate(value: unknown, limit: number) {
  const raw = text(value);
  return raw.length <= limit ? raw : `${raw.slice(0, limit)}...`;
}

const NOTE_FIELDS = [
  "note_type",
  "version",
  "created_at",
  "updated_at",
  "deleted_at",
  "source",
  "tags",
  "metadata",
] as const;
const KNOWLEDGE_NODE_FIELDS = [
  "theme_id",
  "status",
  "confidence",
  "source_type",
  "source_id",
  "source_note_id",
  "source_link_id",
  "source_item_id",
  "version",
  "created_at",
  "updated_at",
  "deleted_at",
  "source",
  "tags",
  "metadata",
] as const;
const KNOWLEDGE_EDGE_FIELDS = [
  "label",
  "description",
  "confidence",
  "version",
  "created_at",
  "updated_at",
  "deleted_at",
  "source",
  "metadata",
] as const;
const RESOURCE_FIELDS = [
  "description",
  "resource_scope",
  "project_id",
  "theme_id",
  "version",
  "created_at",
  "updated_at",
  "deleted_at",
  "source",
  "tags",
  "metadata",
] as const;
const ITEM_FIELDS = [
  "priority",
  "theme_id",
  "description",
  "waiting_for",
  "next_action",
  "planned_start",
  "planned_end",
  "due_date",
  "source_record_id",
  "created_at",
  "updated_at",
  "deleted_at",
  "source",
  "metadata",
] as const;

function publicAi(record: KnowledgeReadRecord) {
  return sanitizePublicValue(publicAiHeader(record)) as Record<string, unknown>;
}

function publicNote(note: KnowledgeReadRecord, includeRawBody: boolean, textLimit: number) {
  const body = sanitizePublicText(note.body_markdown, 8_000);
  return {
    id: sanitizePublicIdentifier(note.id) || "",
    title: sanitizePublicText(note.title, 500),
    project_id: noteProjectId(note),
    ...pickPublicFields(note, NOTE_FIELDS),
    ...(includeRawBody
      ? { body_markdown: truncate(body, textLimit) }
      : { body_excerpt: truncate(body, Math.min(textLimit, 360)) }),
    ai: publicAi(note),
  };
}

function publicKnowledgeNode(node: KnowledgeReadRecord, textLimit = 8_000) {
  return {
    id: sanitizePublicIdentifier(node.id) || "",
    node_type: sanitizePublicIdentifier(node.node_type, 100) || "unknown",
    title: sanitizePublicText(node.title, 500),
    body: truncate(sanitizePublicText(node.body, 8_000), textLimit),
    ...pickPublicFields(node, KNOWLEDGE_NODE_FIELDS),
    ai: publicAi(node),
  };
}

function publicKnowledgeEdge(edge: KnowledgeReadRecord) {
  return {
    id: sanitizePublicIdentifier(edge.id) || "",
    source_node_id: sanitizePublicIdentifier(edge.source_node_id) || "",
    target_node_id: sanitizePublicIdentifier(edge.target_node_id) || "",
    relation_type: sanitizePublicIdentifier(edge.relation_type, 100) || "unknown",
    ...pickPublicFields(edge, KNOWLEDGE_EDGE_FIELDS),
  };
}

function publicResource(resource: KnowledgeReadRecord) {
  return {
    id: sanitizePublicIdentifier(resource.id) || "",
    title: sanitizePublicText(resource.title, 500),
    ...pickPublicFields(resource, RESOURCE_FIELDS),
    source_url: sanitizePublicUrl(resource.url || resource.source_url),
    ai: publicAi(resource),
  };
}

function publicItem(item: KnowledgeReadRecord) {
  return {
    id: sanitizePublicIdentifier(item.id) || "",
    title: sanitizePublicText(item.title, 500),
    kind: sanitizePublicIdentifier(item.kind, 100) || "item",
    status: sanitizePublicIdentifier(item.status, 100) || "todo",
    ...pickPublicFields(item, ITEM_FIELDS),
    ai: publicAi(item),
  };
}

function publicHealthItem(item: Record<string, unknown>) {
  return {
    id: sanitizePublicIdentifier(item.id) || "",
    title: sanitizePublicText(item.title, 500),
    ...pickPublicFields(item, ["kind", "waiting_for", "date", "theme_id"]),
  };
}

function publicHealthIssue(issue: Record<string, any>) {
  return {
    id: sanitizePublicIdentifier(issue.id) || "",
    kind: sanitizePublicIdentifier(issue.kind, 100) || "unknown",
    node: publicKnowledgeNode(issue.node),
    message: sanitizePublicText(issue.message, 1_000),
    action: sanitizePublicText(issue.action, 1_000),
  };
}

function pickAiMetadata(record: KnowledgeReadRecord) {
  const picked: Record<string, unknown> = {};
  for (const key of AI_METADATA_KEYS) {
    if (record[key] !== undefined) picked[key] = record[key];
  }
  return picked;
}

type StableDomainRecord = Record<string, any> & { id?: unknown; updated_at?: unknown };

function sortUpdated<T extends StableDomainRecord>(records: T[]) {
  return [...records].sort((a, b) => {
    const updated = text(b.updated_at ?? b.node?.updated_at).localeCompare(
      text(a.updated_at ?? a.node?.updated_at),
    );
    return updated || text(a.id).localeCompare(text(b.id));
  });
}

export class KnowledgeQueryService {
  constructor(private readonly port: KnowledgeReadPort) {}

  private themesById() {
    return new Map(this.port.list("theme", true).map((theme) => [text(theme.id), theme]));
  }

  private filterForAi(
    type: string,
    records: KnowledgeReadRecord[],
    audience: AiAudience = AUDIENCE,
  ) {
    const themes = this.themesById();
    const included: KnowledgeReadRecord[] = [];
    const exclusions: Array<{ id: string; type: string; reason: string }> = [];
    for (const record of records) {
      const entityType =
        type === "item" ? ITEM_KIND_ENTITY_TYPES[text(record.kind)] || "item" : type;
      const themeId =
        type === "note" ? text(noteProjectId(record)) : text(record.theme_id || record.project_id);
      const theme = type === "theme" ? record : themes.get(themeId) || null;
      const result = projectEntityForAi(entityType, record, {
        audience,
        theme,
        workspaceDefault: this.port.workspaceAiVisibilityDefault(),
      });
      if (!result.included) {
        if (result.exclusion) exclusions.push(result.exclusion);
        continue;
      }
      included.push({ ...record, ai: result.header });
    }
    return { records: included, exclusions };
  }

  private mergedItems() {
    const schedules = this.port.list("schedule", false);
    const scheduleMap = new Map(
      schedules.map((entry) => [`${entry.owner_type}:${entry.owner_id}`, entry]),
    );
    const projected: KnowledgeReadRecord[] = [];
    const v2Ids = new Set<string>();
    for (const task of this.port.list("task", false)) {
      if (task.legacy_item_id) v2Ids.add(text(task.legacy_item_id));
      const schedule = scheduleMap.get(`task:${task.id}`);
      projected.push({
        id: text(task.legacy_item_id || task.id),
        title: task.title,
        kind: "task",
        status: task.state || "todo",
        priority: task.priority || "normal",
        theme_id: task.project_id || null,
        description: task.description || "",
        planned_start: schedule?.start_date || null,
        planned_end: schedule?.end_date || null,
        due_date: null,
        source_record_id: task.source_record_id,
        created_at: task.created_at,
        updated_at: task.updated_at,
        deleted_at: task.deleted_at,
        source: task.source,
        metadata: task.metadata,
        ...pickAiMetadata(task),
      });
    }
    for (const waiting of this.port.list("waiting", false)) {
      if (waiting.legacy_item_id) v2Ids.add(text(waiting.legacy_item_id));
      const schedule = scheduleMap.get(`waiting:${waiting.id}`);
      projected.push({
        id: text(waiting.legacy_item_id || waiting.id),
        title: waiting.title,
        kind: "waiting",
        status:
          waiting.state === "received"
            ? "done"
            : waiting.state === "cancelled"
              ? "cancelled"
              : "waiting",
        priority: "normal",
        theme_id: waiting.project_id || null,
        description: waiting.description || "",
        waiting_for: waiting.waiting_for || "",
        next_action: waiting.next_action || "",
        planned_start: schedule?.start_date || null,
        planned_end: schedule?.end_date || null,
        due_date: null,
        source_record_id: waiting.source_record_id,
        created_at: waiting.created_at,
        updated_at: waiting.updated_at,
        deleted_at: waiting.deleted_at,
        source: waiting.source,
        metadata: waiting.metadata,
        ...pickAiMetadata(waiting),
      });
    }
    for (const node of this.port.list("plan_node", false)) {
      if (node.legacy_item_id) v2Ids.add(text(node.legacy_item_id));
      const schedule = scheduleMap.get(`plan_node:${node.id}`);
      projected.push({
        id: text(node.legacy_item_id || node.id),
        title: node.title,
        kind: node.type === "milestone" ? "milestone" : "period",
        status: node.state === "done" ? "done" : node.state === "cancelled" ? "cancelled" : "todo",
        priority: "normal",
        theme_id: node.project_id || null,
        description: node.description || "",
        planned_start: schedule?.start_date || null,
        planned_end: schedule?.end_date || null,
        due_date: null,
        source_record_id: node.source_record_id,
        created_at: node.created_at,
        updated_at: node.updated_at,
        deleted_at: node.deleted_at,
        source: node.source,
        metadata: node.metadata,
        ...pickAiMetadata(node),
      });
    }
    return sortUpdated([
      ...this.port.list("item", false).filter((item) => !v2Ids.has(text(item.id))),
      ...projected,
    ]);
  }

  getRecentNotes(
    input: GetRecentNotesRequest,
    audience: AiAudience = AUDIENCE,
  ): GetRecentNotesResponse {
    const request = getRecentNotesRequestSchema.parse(input);
    const limit = request.limit ?? DEFAULT_LIMIT;
    const textLimit = request.max_chars ?? DEFAULT_TEXT_LIMIT;
    const scoped = this.port
      .list("note", Boolean(request.include_archived))
      .filter((note) => !request.theme_id || noteProjectId(note) === request.theme_id);
    const filtered = this.filterForAi("note", scoped, audience);
    const matchedVisible = filtered.records.length;
    const notes = sortUpdated(filtered.records)
      .slice(0, limit)
      .map((note) => publicNote(note, Boolean(request.include_raw_body), textLimit));
    const truncated = matchedVisible > notes.length;
    return getRecentNotesResponseSchema.parse({
      notes,
      limit,
      include_raw_body: Boolean(request.include_raw_body),
      truncated,
      result_meta: {
        contract_version: 1,
        returned_count: notes.length,
        matched_visible_count: matchedVisible,
        truncated,
      },
      ...summarizeAiExclusions(filtered.exclusions),
      ai_audience: audience,
      read_only: true,
      next_tools: NOTE_NEXT_TOOLS,
    });
  }

  searchKnowledge(
    input: SearchKnowledgeRequest,
    audience: AiAudience = AUDIENCE,
  ): SearchKnowledgeResponse {
    const request = searchKnowledgeRequestSchema.parse(input);
    const limit = request.limit ?? DEFAULT_LIMIT;
    const textLimit = request.max_chars ?? DEFAULT_TEXT_LIMIT;
    const scoped = this.port
      .list("knowledge_node", Boolean(request.include_archived))
      .filter((node) => !request.theme_id || node.theme_id === request.theme_id);
    // Visibility is resolved before query matching and result limits so hidden
    // Knowledge cannot become a search oracle or consume the public result cap.
    const filtered = this.filterForAi("knowledge_node", scoped, audience);
    const query = text(request.query).toLowerCase();
    const nodeTypes = request.node_types ? new Set(request.node_types) : null;
    const matched = sortUpdated(
      filtered.records
        .filter(
          (node) =>
            !query ||
            [node.title, node.body, node.node_type].some((value) =>
              text(value).toLowerCase().includes(query),
            ),
        )
        .filter((node) => !nodeTypes || nodeTypes.has(text(node.node_type))),
    );
    const nodes = matched.slice(0, limit).map((node) => publicKnowledgeNode(node, textLimit));
    const truncated = matched.length > nodes.length;
    return searchKnowledgeResponseSchema.parse({
      knowledge_nodes: nodes,
      limit,
      truncated,
      result_meta: {
        contract_version: 1,
        returned_count: nodes.length,
        matched_visible_count: matched.length,
        truncated,
      },
      ...summarizeAiExclusions(filtered.exclusions),
      ai_audience: audience,
      read_only: true,
      next_tools: KNOWLEDGE_NEXT_TOOLS,
    });
  }

  getKnowledgeContext(
    input: GetKnowledgeContextRequest,
    audience: AiAudience = AUDIENCE,
  ): GetKnowledgeContextResponse {
    const request = getKnowledgeContextRequestSchema.parse(input);
    const limit = request.limit ?? DEFAULT_CONTEXT_LIMIT;
    const textLimit = request.max_chars ?? DEFAULT_TEXT_LIMIT;
    const allNodes = this.port.list("knowledge_node", Boolean(request.include_archived));
    const scoped = allNodes.filter(
      (node) => !request.theme_id || node.theme_id === request.theme_id,
    );
    const filteredNodes = this.filterForAi("knowledge_node", scoped, audience);
    const selectedRecords = sortUpdated(filteredNodes.records).slice(0, limit);
    const nodes = selectedRecords.map((node) => publicKnowledgeNode(node, textLimit));
    const selectedNodeIds = new Set(selectedRecords.map((node) => text(node.id)));
    const publicNodeIds = new Set(
      this.filterForAi("knowledge_node", allNodes, audience).records.map((node) => text(node.id)),
    );
    const matchedRelations =
      (request.include_relations ?? true)
        ? sortUpdated(
            this.port
              .list("knowledge_edge", Boolean(request.include_archived))
              .filter((relation) => {
                const sourceId = text(relation.source_node_id);
                const targetId = text(relation.target_node_id);
                // Deliberate security correction over legacy: never disclose a raw edge
                // when either endpoint is hidden from the Coding Agent audience.
                return (
                  publicNodeIds.has(sourceId) &&
                  publicNodeIds.has(targetId) &&
                  (selectedNodeIds.has(sourceId) || selectedNodeIds.has(targetId))
                );
              }),
          )
        : [];
    const relations = matchedRelations.slice(0, MAX_EDGE_RESULTS).map(publicKnowledgeEdge);

    const sourceExclusions: Array<{ id: string; type: string; reason: string }> = [];
    const sources = request.include_sources
      ? (() => {
          const activeNodes = selectedRecords;
          const filteredNotes = this.filterForAi(
            "note",
            this.port
              .list("note", false)
              .filter((note) =>
                activeNodes.some(
                  (node) =>
                    node.source_note_id === note.id ||
                    (node.source_type === "note" && node.source_id === note.id),
                ),
              ),
            audience,
          );
          sourceExclusions.push(...filteredNotes.exclusions);
          const matchedNotes = sortUpdated(filteredNotes.records)
            .slice(0, MAX_HEALTH_RESULTS)
            .map((note) => publicNote(note, Boolean(request.include_raw_body), textLimit));

          const links = this.port.list("link", false);
          const resources = this.port.list("resource", false);
          const matchedLinks = links.filter((link) =>
            activeNodes.some((node) => node.source_link_id === link.id),
          );
          const matchedResources = resources.filter((resource) =>
            activeNodes.some(
              (node) => node.source_type === "resource" && node.source_id === resource.id,
            ),
          );
          const resourceIds = new Set(matchedResources.map((resource) => text(resource.id)));
          const filteredResources = this.filterForAi(
            "resource",
            [
              ...matchedResources,
              ...matchedLinks.filter((link) => !resourceIds.has(text(link.id))),
            ],
            audience,
          );
          sourceExclusions.push(...filteredResources.exclusions);

          const filteredItems = this.filterForAi(
            "item",
            this.mergedItems().filter((item) =>
              activeNodes.some(
                (node) =>
                  node.source_item_id === item.id ||
                  (["task", "waiting", "plan_node"].includes(text(node.source_type)) &&
                    node.source_id === item.id),
              ),
            ),
            audience,
          );
          sourceExclusions.push(...filteredItems.exclusions);
          return {
            notes: matchedNotes,
            resources: sortUpdated(filteredResources.records)
              .slice(0, MAX_HEALTH_RESULTS)
              .map(publicResource),
            items: sortUpdated(filteredItems.records).slice(0, MAX_HEALTH_RESULTS).map(publicItem),
            matched_count:
              filteredNotes.records.length +
              filteredResources.records.length +
              filteredItems.records.length,
          };
        })()
      : undefined;

    const returnedSourceCount = sources
      ? sources.notes.length + sources.resources.length + sources.items.length
      : 0;
    const sourceTruncated = Boolean(sources && sources.matched_count > returnedSourceCount);
    const truncated =
      filteredNodes.records.length > nodes.length ||
      matchedRelations.length > relations.length ||
      sourceTruncated;

    return getKnowledgeContextResponseSchema.parse({
      knowledge_nodes: nodes,
      knowledge_edges: relations,
      ...(sources
        ? { sources: { notes: sources.notes, resources: sources.resources, items: sources.items } }
        : {}),
      limit,
      truncated,
      result_meta: {
        contract_version: 1,
        returned_node_count: nodes.length,
        matched_visible_node_count: filteredNodes.records.length,
        returned_edge_count: relations.length,
        matched_public_edge_count: matchedRelations.length,
        returned_source_count: returnedSourceCount,
        matched_public_source_count: sources?.matched_count || 0,
        truncated,
      },
      ...summarizeAiExclusions([...filteredNodes.exclusions, ...sourceExclusions]),
      ai_audience: audience,
      read_only: true,
      next_tools: KNOWLEDGE_NEXT_TOOLS,
    });
  }

  getPlanHealth(
    input: GetPlanHealthRequest,
    audience: AiAudience = AUDIENCE,
  ): GetPlanHealthResponse {
    const request = getPlanHealthRequestSchema.parse(input);
    const themeId = request.theme_id || "";
    const today = new Date().toISOString().slice(0, 10);
    const tasks = sortUpdated(
      this.filterForAi(
        "task",
        this.port.list("task", false).filter((task) => !themeId || task.project_id === themeId),
        audience,
      ).records,
    );
    const waitings = sortUpdated(
      this.filterForAi(
        "waiting",
        this.port
          .list("waiting", false)
          .filter((waiting) => !themeId || waiting.project_id === themeId),
        audience,
      ).records,
    );
    const planNodes = sortUpdated(
      this.filterForAi(
        "plan_node",
        this.port
          .list("plan_node", false)
          .filter((node) => !themeId || node.project_id === themeId),
        audience,
      ).records,
    );
    const scheduleMap = new Map(
      sortUpdated(this.port.list("schedule", false)).map((schedule) => [
        `${schedule.owner_type}:${schedule.owner_id}`,
        schedule,
      ]),
    );
    const endDate = (ownerType: string, ownerId: string) => {
      const schedule = scheduleMap.get(`${ownerType}:${ownerId}`);
      return text(schedule?.end_date || schedule?.start_date);
    };
    const openTasks = tasks.filter((task) => task.state !== "done" && task.state !== "cancelled");
    const openWaitings = waitings.filter((waiting) => waiting.state === "waiting");
    const openPlanNodes = planNodes.filter(
      (node) => node.state !== "done" && node.state !== "cancelled",
    );
    const overdueItems = [
      ...openTasks
        .filter((task) => endDate("task", task.id) && endDate("task", task.id) < today)
        .map((task) => ({
          id: task.id,
          title: task.title,
          kind: "task",
          date: endDate("task", task.id),
          theme_id: task.project_id,
          updated_at: task.updated_at,
        })),
      ...openWaitings
        .filter(
          (waiting) => endDate("waiting", waiting.id) && endDate("waiting", waiting.id) < today,
        )
        .map((waiting) => ({
          id: waiting.id,
          title: waiting.title,
          kind: "waiting",
          date: endDate("waiting", waiting.id),
          theme_id: waiting.project_id,
          updated_at: waiting.updated_at,
        })),
      ...openPlanNodes
        .filter((node) => endDate("plan_node", node.id) && endDate("plan_node", node.id) < today)
        .map((node) => ({
          id: node.id,
          title: node.title,
          kind: node.type,
          date: endDate("plan_node", node.id),
          theme_id: node.project_id,
          updated_at: node.updated_at,
        })),
    ];
    const unscheduledItems = [
      ...openTasks
        .filter((task) => !scheduleMap.has(`task:${task.id}`))
        .map((task) => ({
          id: task.id,
          title: task.title,
          kind: "task",
          theme_id: task.project_id,
          updated_at: task.updated_at,
        })),
      ...openPlanNodes
        .filter((node) => !scheduleMap.has(`plan_node:${node.id}`))
        .map((node) => ({
          id: node.id,
          title: node.title,
          kind: node.type,
          theme_id: node.project_id,
          updated_at: node.updated_at,
        })),
    ];
    const waitingItems = openWaitings.map((waiting) => ({
      id: waiting.id,
      title: waiting.title,
      waiting_for: waiting.waiting_for,
      date: endDate("waiting", waiting.id),
      theme_id: waiting.project_id,
      updated_at: waiting.updated_at,
    }));
    const matchedItemCount = overdueItems.length + waitingItems.length + unscheduledItems.length;
    const publicOverdue = sortUpdated(overdueItems)
      .slice(0, MAX_HEALTH_RESULTS)
      .map(publicHealthItem);
    const publicWaiting = sortUpdated(waitingItems)
      .slice(0, MAX_HEALTH_RESULTS)
      .map(publicHealthItem);
    const publicUnscheduled = sortUpdated(unscheduledItems)
      .slice(0, MAX_HEALTH_RESULTS)
      .map(publicHealthItem);
    const returnedItemCount =
      publicOverdue.length + publicWaiting.length + publicUnscheduled.length;
    const truncated = matchedItemCount > returnedItemCount;
    return getPlanHealthResponseSchema.parse({
      open_tasks: openTasks.length,
      open_waitings: openWaitings.length,
      open_plan_nodes: openPlanNodes.length,
      open_count: openTasks.length + openWaitings.length + openPlanNodes.length,
      overdue_items: publicOverdue,
      waiting_items: publicWaiting,
      unscheduled_items: publicUnscheduled,
      truncated,
      result_meta: {
        contract_version: 1,
        returned_item_count: returnedItemCount,
        matched_visible_item_count: matchedItemCount,
        truncated,
      },
      ai_audience: audience,
      read_only: true,
      next_tools: HEALTH_NEXT_TOOLS,
    });
  }

  getKnowledgeHealth(
    input: GetKnowledgeHealthRequest,
    audience: AiAudience = AUDIENCE,
  ): GetKnowledgeHealthResponse {
    const request = getKnowledgeHealthRequestSchema.parse(input);
    const themeId = request.theme_id || "";
    const allPublicNodes = sortUpdated(
      this.filterForAi("knowledge_node", this.port.list("knowledge_node", false), audience).records,
    );
    const nodes = allPublicNodes.filter((node) => !themeId || node.theme_id === themeId);
    const publicNodeIds = new Set(allPublicNodes.map((node) => text(node.id)));
    const relations = sortUpdated(
      this.port
        .list("knowledge_edge", false)
        .filter(
          (relation) =>
            publicNodeIds.has(text(relation.source_node_id)) &&
            publicNodeIds.has(text(relation.target_node_id)),
        ),
    );
    const entities = sortUpdated([
      ...this.filterForAi("task", this.port.list("task", false), audience).records,
      ...this.filterForAi("waiting", this.port.list("waiting", false), audience).records,
      ...this.filterForAi("plan_node", this.port.list("plan_node", false), audience).records,
      ...this.filterForAi("item", this.port.list("item", false), audience).records,
    ]);
    const grouped = groupKnowledgeHealthIssues(buildKnowledgeHealth(nodes, relations, entities));
    const matchedIssueCount = grouped.issues.length;
    const issues = sortUpdated(grouped.issues).slice(0, MAX_HEALTH_RESULTS).map(publicHealthIssue);
    const publicGroup = (records: KnowledgeReadRecord[]) =>
      sortUpdated(records)
        .slice(0, MAX_HEALTH_RESULTS)
        .map((record) => publicKnowledgeNode(record));
    const groups = {
      unresolved_questions: publicGroup(grouped.unresolved_questions),
      claims_without_evidence: publicGroup(grouped.claims_without_evidence),
      contradicted_claims: publicGroup(grouped.contradicted_claims),
      evidence_without_source: publicGroup(grouped.evidence_without_source),
      isolated_nodes: publicGroup(grouped.isolated_nodes),
      stale_decisions: publicGroup(grouped.stale_decisions),
    };
    const truncated =
      matchedIssueCount > issues.length ||
      Object.entries(groups).some(
        ([key, records]) => records.length < grouped[key as keyof typeof groups].length,
      );
    return getKnowledgeHealthResponseSchema.parse({
      issues,
      ...groups,
      truncated,
      result_meta: {
        contract_version: 1,
        returned_issue_count: issues.length,
        matched_issue_count: matchedIssueCount,
        truncated,
      },
      ai_audience: audience,
      read_only: true,
      next_tools: HEALTH_NEXT_TOOLS,
    });
  }
}
