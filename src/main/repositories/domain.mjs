export const workspaceEntityTypes = [
  "theme",
  "item",
  "note",
  "link",
  "dependency",
  "view",
  "status_update",
  "source_record",
  "entity_source",
  "relation",
  "field_definition",
  "field_value",
  "log_entry",
  "import_batch",
  "knowledge_node",
  "knowledge_relation",
  "ai_proposal",
  "project",
  "capture_entry",
  "task",
  "waiting",
  "plan_node",
  "schedule",
  "reference",
  "task_dependency",
  "plan_dependency",
  "knowledge_edge",
  "change_event",
];

const requiredTextFields = {
  theme: ["name"],
  item: ["title"],
  note: ["title", "body_markdown"],
  link: ["title", "url"],
  status_update: ["theme_id", "summary"],
  source_record: ["source_title"],
  field_definition: ["name", "field_type", "applies_to"],
  dependency: ["source_item_id", "target_item_id"],
  relation: ["source_entity_type", "source_entity_id", "target_entity_type", "target_entity_id", "relation_type"],
  field_value: ["field_definition_id", "entity_type", "entity_id"],
  knowledge_node: ["node_type", "title"],
  knowledge_relation: ["source_node_id", "target_node_id", "relation_type"],
  ai_proposal: ["source", "payload_type", "status"],
  project: ["name", "state"],
  capture_entry: ["text", "captured_at", "state"],
  task: ["title", "state"],
  waiting: ["title", "waiting_for", "state"],
  plan_node: ["title", "type", "state"],
  schedule: ["owner_type", "owner_id", "date_kind", "confidence", "granularity"],
  reference: ["source_type", "source_id", "target_type", "target_id", "relation_type"],
  task_dependency: ["task_id", "depends_on_task_id"],
  plan_dependency: ["plan_node_id", "depends_on_plan_node_id"],
  knowledge_edge: ["source_node_id", "target_node_id", "relation_type"],
  change_event: ["entity_type", "entity_id", "changed_at", "change_type", "source"],
};

const isoDateFields = [
  "baseline_start",
  "baseline_end",
  "planned_start",
  "planned_end",
  "actual_start",
  "actual_end",
  "due_date",
  "date",
  "value_date",
  "start_date",
  "end_date",
];

const urlFields = ["url", "source_url"];
const allowedUrlProtocols = new Set(["https:", "http:", "mailto:"]);
const knowledgeNodeTypes = new Set(["source", "evidence", "claim", "question", "decision", "insight"]);
const knowledgeRelationTypes = new Set([
  "supports",
  "contradicts",
  "explains",
  "causes",
  "example_of",
  "generalizes",
  "depends_on",
  "derived_from",
  "answers",
  "raises",
  "similar_to",
  "leads_to",
]);
const knowledgeDirectionalRelationTypes = new Set(["depends_on", "causes", "leads_to"]);
const confidenceValues = new Set(["low", "medium", "high"]);
const knowledgeStatusValues = new Set(["active", "resolved", "deprecated", "rejected"]);
const proposalSources = new Set(["mcp", "ai_import", "manual"]);
const proposalPayloadTypes = new Set(["items", "notes", "links", "knowledge_nodes", "status_update"]);
const proposalStatuses = new Set(["pending", "accepted", "rejected", "partially_accepted"]);
const projectStates = new Set(["idea", "active", "paused", "closed"]);
const captureEntryStates = new Set(["untriaged", "triaged", "archived"]);
const taskStates = new Set(["todo", "doing", "waiting", "review", "done", "cancelled"]);
const waitingStates = new Set(["waiting", "received", "cancelled"]);
const planNodeTypes = new Set(["phase", "milestone", "deliverable"]);
const planNodeStates = new Set(["planned", "active", "done", "cancelled"]);
const scheduleOwnerTypes = new Set(["task", "waiting", "plan_node"]);
const scheduleDateKinds = new Set(["point", "deadline", "range", "unknown"]);
const scheduleConfidenceValues = new Set(["rough", "tentative", "fixed"]);
const scheduleGranularityValues = new Set(["day", "week", "month"]);
const entityRefTypes = new Set(["project", "capture_entry", "task", "waiting", "plan_node", "note", "resource", "knowledge_node"]);
const referenceRelationTypes = new Set(["related_to", "derived_from", "mentions", "blocks", "supports"]);
const changeTypes = new Set(["created", "updated", "completed", "rescheduled", "triaged", "deleted"]);
const changeSources = new Set(["manual", "import", "ai", "migration"]);

function localDateIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function isAllowedExternalUrl(value) {
  try {
    return allowedUrlProtocols.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function hasPath(edges, fromId, toId) {
  const graph = new Map();
  for (const [sourceId, targetId] of edges) {
    if (!sourceId || !targetId) continue;
    const targets = graph.get(sourceId) || [];
    targets.push(targetId);
    graph.set(sourceId, targets);
  }
  const stack = [fromId];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (current === toId) return true;
    seen.add(current);
    stack.push(...(graph.get(current) || []));
  }
  return false;
}

export function assertItemParentAcyclic(items, entity, message = "親Itemに自分自身または子孫を指定すると循環します。別の親Itemを選んでください。") {
  if (!entity.parent_item_id) return;
  const entityId = String(entity.id);
  const byId = new Map(items.filter((item) => !item.deleted_at).map((item) => [String(item.id), item]));
  byId.set(entityId, entity);

  const seen = new Set([entityId]);
  let currentId = String(entity.parent_item_id);
  while (currentId) {
    if (seen.has(currentId)) throw new Error(message);
    seen.add(currentId);
    currentId = String(byId.get(currentId)?.parent_item_id || "");
  }
}

export function assertDependencyAcyclic(dependencies, entity, message = "Dependencyが循環します。先行Itemと後続Itemの向きを見直してください。") {
  if (!entity.source_item_id || !entity.target_item_id) return;
  const sourceId = String(entity.source_item_id);
  const targetId = String(entity.target_item_id);
  const edges = dependencies
    .filter((dependency) => !dependency.deleted_at && String(dependency.id) !== String(entity.id))
    .map((dependency) => [String(dependency.source_item_id), String(dependency.target_item_id)]);
  edges.push([sourceId, targetId]);

  if (hasPath(edges, targetId, sourceId)) throw new Error(message);
}

export function assertKnowledgeRelationAcyclic(relations, entity, message = "Knowledge Relationが循環します。関係の向きを見直してください。") {
  if (!knowledgeDirectionalRelationTypes.has(entity.relation_type)) return;
  if (!entity.source_node_id || !entity.target_node_id) return;
  const sourceId = String(entity.source_node_id);
  const targetId = String(entity.target_node_id);
  const edges = relations
    .filter((relation) =>
      !relation.deleted_at
      && String(relation.id) !== String(entity.id)
      && knowledgeDirectionalRelationTypes.has(relation.relation_type))
    .map((relation) => [String(relation.source_node_id), String(relation.target_node_id)]);
  edges.push([sourceId, targetId]);

  if (hasPath(edges, targetId, sourceId)) throw new Error(message);
}

export function assertEntityType(type) {
  if (!workspaceEntityTypes.includes(type)) {
    throw new Error(`未対応のデータ種別です: ${type}`);
  }
}

export function validateEntity(type, input) {
  assertEntityType(type);
  if (!isPlainObject(input)) throw new Error(`${type}の保存内容が不正です。`);

  for (const field of requiredTextFields[type] || []) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new Error(`${type}.${field}を入力してください。`);
    }
  }

  for (const field of isoDateFields) {
    if (input[field] != null && input[field] !== "" && !isIsoDate(input[field])) {
      throw new Error(`${type}.${field}はYYYY-MM-DD形式で指定してください。`);
    }
  }

  for (const field of urlFields) {
    if (input[field] != null && input[field] !== "" && !isAllowedExternalUrl(input[field])) {
      throw new Error(`${type}.${field}はhttps、http、mailtoのURLを指定してください。fileや未知の形式は開けません。`);
    }
  }

  if (type === "item") {
    const progress = Number(input.progress ?? 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      throw new Error("item.progressは0から100で指定してください。");
    }
    if (input.planned_start && input.planned_end && input.planned_end < input.planned_start) {
      throw new Error("item.planned_endはplanned_start以降にしてください。");
    }
    if (input.id && input.parent_item_id && String(input.id) === String(input.parent_item_id)) {
      throw new Error("Item自身を親Itemにはできません。");
    }
  }

  if (type === "dependency" && input.source_item_id === input.target_item_id) {
    throw new Error("Dependencyの先行Itemと後続Itemは別にしてください。");
  }

  if (type === "relation"
    && input.source_entity_type === input.target_entity_type
    && input.source_entity_id === input.target_entity_id) {
    throw new Error("Entity自身へのRelationは作成できません。");
  }

  if (type === "knowledge_node") {
    if (!knowledgeNodeTypes.has(input.node_type)) throw new Error("knowledge_node.node_typeが不正です。");
    if (input.confidence != null && input.confidence !== "" && !confidenceValues.has(input.confidence)) {
      throw new Error("knowledge_node.confidenceが不正です。");
    }
    if (input.status != null && input.status !== "" && !knowledgeStatusValues.has(input.status)) {
      throw new Error("knowledge_node.statusが不正です。");
    }
    if (String(input.title || "").length > 200) throw new Error("knowledge_node.titleは200文字以内で入力してください。");
    if (String(input.body || "").length > 20000) throw new Error("knowledge_node.bodyは20000文字以内で入力してください。");
  }

  if (type === "knowledge_relation") {
    if (!knowledgeRelationTypes.has(input.relation_type)) throw new Error("knowledge_relation.relation_typeが不正です。");
    if (input.source_node_id === input.target_node_id) throw new Error("Knowledge Relationで自分自身は参照できません。");
    if (input.confidence != null && input.confidence !== "" && !confidenceValues.has(input.confidence)) {
      throw new Error("knowledge_relation.confidenceが不正です。");
    }
  }

  if (type === "ai_proposal") {
    if (!proposalSources.has(input.source)) throw new Error("ai_proposal.sourceが不正です。");
    if (!proposalPayloadTypes.has(input.payload_type)) throw new Error("ai_proposal.payload_typeが不正です。");
    if (!proposalStatuses.has(input.status)) throw new Error("ai_proposal.statusが不正です。");
    if (input.payload == null) throw new Error("ai_proposal.payloadを入力してください。");
  }

  if (type === "project" && !projectStates.has(input.state)) throw new Error("project.stateが不正です。");
  if (type === "capture_entry") {
    if (!captureEntryStates.has(input.state)) throw new Error("capture_entry.stateが不正です。");
    if (input.triaged_to_type != null && input.triaged_to_type !== "" && !entityRefTypes.has(input.triaged_to_type)) {
      throw new Error("capture_entry.triaged_to_typeが不正です。");
    }
  }
  if (type === "task") {
    if (!taskStates.has(input.state)) throw new Error("task.stateが不正です。");
    if (input.priority != null && input.priority !== "" && !["normal", "high"].includes(input.priority)) {
      throw new Error("task.priorityが不正です。");
    }
  }
  if (type === "waiting" && !waitingStates.has(input.state)) throw new Error("waiting.stateが不正です。");
  if (type === "plan_node") {
    if (!planNodeTypes.has(input.type)) throw new Error("plan_node.typeが不正です。");
    if (!planNodeStates.has(input.state)) throw new Error("plan_node.stateが不正です。");
  }
  if (type === "schedule") {
    if (!scheduleOwnerTypes.has(input.owner_type)) throw new Error("schedule.owner_typeが不正です。");
    if (!scheduleDateKinds.has(input.date_kind)) throw new Error("schedule.date_kindが不正です。");
    if (!scheduleConfidenceValues.has(input.confidence)) throw new Error("schedule.confidenceが不正です。");
    if (!scheduleGranularityValues.has(input.granularity)) throw new Error("schedule.granularityが不正です。");
    if (input.start_date && input.end_date && input.end_date < input.start_date) {
      throw new Error("schedule.end_dateはstart_date以降にしてください。");
    }
  }
  if (type === "reference") {
    if (!entityRefTypes.has(input.source_type) || !entityRefTypes.has(input.target_type)) throw new Error("referenceの参照先種別が不正です。");
    if (!referenceRelationTypes.has(input.relation_type)) throw new Error("reference.relation_typeが不正です。");
    if (input.source_type === input.target_type && input.source_id === input.target_id) throw new Error("Referenceで自分自身は参照できません。");
  }
  if (type === "task_dependency" && input.task_id === input.depends_on_task_id) {
    throw new Error("TaskDependencyで自分自身は参照できません。");
  }
  if (type === "plan_dependency" && input.plan_node_id === input.depends_on_plan_node_id) {
    throw new Error("PlanDependencyで自分自身は参照できません。");
  }
  if (type === "knowledge_edge" && input.source_node_id === input.target_node_id) {
    throw new Error("KnowledgeEdgeで自分自身は参照できません。");
  }
  if (type === "change_event") {
    if (!entityRefTypes.has(input.entity_type)) throw new Error("change_event.entity_typeが不正です。");
    if (!changeTypes.has(input.change_type)) throw new Error("change_event.change_typeが不正です。");
    if (!changeSources.has(input.source)) throw new Error("change_event.sourceが不正です。");
  }

  return input;
}

export function normalizeEntity(type, input) {
  const normalized = { ...input };
  for (const field of requiredTextFields[type] || []) {
    if (typeof normalized[field] === "string") normalized[field] = normalized[field].trim();
  }
  if (type === "item") {
    normalized.schedule_status = normalized.planned_start || normalized.planned_end ? "scheduled" : "unscheduled";
    normalized.progress = Math.max(0, Math.min(100, Number(normalized.progress ?? 0)));
    if (normalized.status === "done") {
      normalized.progress = 100;
      normalized.completed_at ||= new Date().toISOString();
      normalized.actual_end ||= localDateIso();
    } else if (normalized.completed_at) {
      normalized.completed_at = null;
    }
  }
  if (type === "knowledge_node") {
    normalized.status ||= "active";
    normalized.confidence ||= "medium";
  }
  if (type === "knowledge_relation") normalized.confidence ||= "medium";
  if (type === "ai_proposal") normalized.status ||= "pending";
  validateEntity(type, normalized);
  return normalized;
}
