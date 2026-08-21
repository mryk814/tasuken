import {
  listOpenItemsRequestSchema,
  listOpenItemsResponseSchema,
  searchItemsRequestSchema,
  searchItemsResponseSchema,
  type ListOpenItemsRequest,
  type ListOpenItemsResponse,
  type SearchItemsRequest,
  type SearchItemsResponse,
} from "../../../shared/contracts/task/public.ts";
import type { ItemQueryReadPort, ItemQueryRecord, ItemQuerySnapshot } from "../ports/itemQueryReadPort.ts";
import { ItemQueryAiProjectionPolicy } from "../policies/itemQueryAiProjectionPolicy.ts";
import type { AiAudience } from "../../../shared/aiMetadata.mjs";

const DEFAULT_LIMIT = 20;
const OPEN_ITEM_STATUSES = new Set(["todo", "doing", "waiting", "review", "inbox"]);
const AI_METADATA_KEYS = [
  "ai_summary",
  "ai_summary_authority",
  "ai_freshness",
  "ai_authority",
  "ai_visibility",
  "ai_last_verified_at",
  "ai_superseded_by",
  "ai_source_refs",
];

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function pickAiMetadata(entity: ItemQueryRecord) {
  return Object.fromEntries(AI_METADATA_KEYS
    .filter((key) => entity[key] !== undefined)
    .map((key) => [key, entity[key]]));
}

function locator(entityType: "item" | "task" | "waiting" | "plan_node", entityId: string) {
  if (entityType === "task") {
    return {
      entity_type: entityType,
      entity_id: entityId,
      tool: "tasken.get_task_context",
      arguments: { task_id: entityId },
    };
  }
  return { entity_type: entityType, entity_id: entityId };
}

function projectItems(snapshot: ItemQuerySnapshot): ItemQueryRecord[] {
  const scheduleMap = new Map(snapshot.schedules.map((schedule) => [
    `${schedule.owner_type}:${schedule.owner_id}`,
    schedule,
  ]));
  const migratedLegacyIds = new Set<string>();
  const projected: ItemQueryRecord[] = [];

  for (const task of snapshot.tasks) {
    if (task.legacy_item_id) migratedLegacyIds.add(String(task.legacy_item_id));
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
      locator: locator("task", task.id),
      ...pickAiMetadata(task),
    });
  }
  for (const waiting of snapshot.waitings) {
    if (waiting.legacy_item_id) migratedLegacyIds.add(String(waiting.legacy_item_id));
    const schedule = scheduleMap.get(`waiting:${waiting.id}`);
    projected.push({
      id: text(waiting.legacy_item_id || waiting.id),
      title: waiting.title,
      kind: "waiting",
      status: waiting.state === "received" ? "done" : waiting.state === "cancelled" ? "cancelled" : "waiting",
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
      locator: locator("waiting", waiting.id),
      ...pickAiMetadata(waiting),
    });
  }
  for (const node of snapshot.planNodes) {
    if (node.legacy_item_id) migratedLegacyIds.add(String(node.legacy_item_id));
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
      locator: locator("plan_node", node.id),
      ...pickAiMetadata(node),
    });
  }

  const legacy: ItemQueryRecord[] = snapshot.items
    .filter((item) => !migratedLegacyIds.has(item.id))
    .map((item) => ({ ...item, locator: locator("item", item.id) }));
  return [...legacy, ...projected]
    .sort((left, right) => text(right.updated_at).localeCompare(text(left.updated_at)));
}

function itemDate(item: ItemQueryRecord) {
  return text(item.planned_end || item.planned_start || item.due_date);
}

function queryMatches(item: ItemQueryRecord, query: string | undefined) {
  const normalized = text(query).toLowerCase();
  if (!normalized) return true;
  return ["title", "description", "next_action", "waiting_for"]
    .some((field) => text(item[field]).toLowerCase().includes(normalized));
}

const SEARCH_NEXT_TOOLS = [
  { tool: "tasken.get_task_context", description: "Taskのlocatorからbounded contextを取得する。" },
  { tool: "tasken.list_open_items", description: "検索語を外してopen workを期限順に確認する。" },
];

const OPEN_NEXT_TOOLS = [
  { tool: "tasken.get_task_context", description: "Taskのlocatorからbounded contextを取得する。" },
  { tool: "tasken.search_items", description: "title・description・次の行動で候補を絞り込む。" },
];

export class ItemQueryService {
  constructor(
    private readonly readPort: ItemQueryReadPort,
    private readonly projection = new ItemQueryAiProjectionPolicy(),
  ) {}

  searchItems(input: SearchItemsRequest, audience: AiAudience = "coding_agent"): SearchItemsResponse {
    const request = searchItemsRequestSchema.parse(input);
    const snapshot = this.readPort.readItemQuerySnapshot(Boolean(request.include_archived));
    const candidates = projectItems(snapshot)
      .filter((item) => queryMatches(item, request.query))
      .filter((item) => !request.theme_id || item.theme_id === request.theme_id);
    const filtered = this.projection.project(candidates, snapshot, audience);
    const limit = request.limit ?? DEFAULT_LIMIT;
    const items = filtered.records.slice(0, limit);
    return searchItemsResponseSchema.parse({
      items,
      limit,
      ai_audience: audience,
      read_only: true,
      excluded_count: filtered.excluded_count,
      excluded_reasons: filtered.excluded_reasons,
      next_tools: SEARCH_NEXT_TOOLS,
      result_meta: {
        contract_version: 1,
        returned_count: items.length,
        matched_visible_count: filtered.records.length,
        truncated: filtered.records.length > items.length,
      },
    });
  }

  listOpenItems(input: ListOpenItemsRequest, audience: AiAudience = "coding_agent"): ListOpenItemsResponse {
    const request = listOpenItemsRequestSchema.parse(input);
    const snapshot = this.readPort.readItemQuerySnapshot(Boolean(request.include_archived));
    const candidates = projectItems(snapshot)
      .filter((item) => OPEN_ITEM_STATUSES.has(text(item.status || "todo")) && !item.deleted_at)
      .filter((item) => !request.theme_id || item.theme_id === request.theme_id)
      .sort((left, right) => (itemDate(left) || "9999-12-31").localeCompare(itemDate(right) || "9999-12-31"));
    const filtered = this.projection.project(candidates, snapshot, audience);
    const limit = request.limit ?? DEFAULT_LIMIT;
    const items = filtered.records.slice(0, limit);
    return listOpenItemsResponseSchema.parse({
      items,
      limit,
      ai_audience: audience,
      read_only: true,
      excluded_count: filtered.excluded_count,
      excluded_reasons: filtered.excluded_reasons,
      next_tools: OPEN_NEXT_TOOLS,
      result_meta: {
        contract_version: 1,
        returned_count: items.length,
        matched_visible_count: filtered.records.length,
        truncated: filtered.records.length > items.length,
      },
    });
  }
}
