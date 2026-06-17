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
];

const urlFields = ["url", "source_url"];
const allowedUrlProtocols = new Set(["https:", "http:", "mailto:"]);

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
  validateEntity(type, normalized);
  return normalized;
}
