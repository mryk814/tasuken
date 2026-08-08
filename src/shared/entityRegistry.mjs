/**
 * Workspace entity contract.
 *
 * This is the only runtime source for entity names, storage collections and
 * the fields that carry Theme identity.  SQLite/import rows may remain raw
 * records, but every application boundary resolves through this registry.
 */
const definitions = [
  { type: "theme", collectionKey: "themes", label: "Theme", iconKey: "palette", projection: "legacy", themePolicy: "none", themeField: null, requiredFields: ["name"] },
  { type: "item", collectionKey: "items", label: "Item", iconKey: "check", projection: "legacy", themePolicy: "optional", themeField: "theme_id", requiredFields: ["title"] },
  { type: "note", collectionKey: "notes", domainCollectionKey: "notes", label: "Note", iconKey: "note", projection: "canonical", themePolicy: "optional", themeField: "project_id", legacyThemeFields: ["theme_id"], requiredFields: ["title"] },
  { type: "link", collectionKey: "links", label: "Link", iconKey: "link", projection: "legacy", themePolicy: "optional", themeField: "theme_id", requiredFields: ["title", "url"] },
  { type: "view", collectionKey: "views", label: "View", iconKey: "layout", projection: "legacy", themePolicy: "optional", themeField: "theme_id", requiredFields: [] },
  { type: "status_update", collectionKey: "status_updates", label: "Status update", iconKey: "message", projection: "legacy", themePolicy: "required", themeField: "theme_id", requiredFields: ["theme_id", "summary"] },
  { type: "source_record", collectionKey: "source_records", label: "Source record", iconKey: "database", projection: "legacy", themePolicy: "none", themeField: null, requiredFields: ["source_title"] },
  { type: "entity_source", collectionKey: "entity_sources", label: "Entity source", iconKey: "link", projection: "legacy", themePolicy: "none", themeField: null, requiredFields: [] },
  { type: "field_definition", collectionKey: "field_definitions", label: "Field definition", iconKey: "forms", projection: "legacy", themePolicy: "optional", themeField: "theme_id", requiredFields: ["name", "field_type", "applies_to"] },
  { type: "field_value", collectionKey: "field_values", label: "Field value", iconKey: "forms", projection: "legacy", themePolicy: "none", themeField: null, requiredFields: ["field_definition_id", "entity_type", "entity_id"] },
  { type: "log_entry", collectionKey: "log_entries", label: "Log entry", iconKey: "history", projection: "legacy", themePolicy: "optional", themeField: "theme_id", requiredFields: [] },
  { type: "import_batch", collectionKey: "import_batchs", label: "Import batch", iconKey: "upload", projection: "legacy", themePolicy: "none", themeField: null, requiredFields: [] },
  { type: "knowledge_node", collectionKey: "knowledge_nodes", domainCollectionKey: "knowledge_nodes", label: "Knowledge node", iconKey: "bulb", projection: "legacy", themePolicy: "optional", themeField: "theme_id", requiredFields: ["node_type", "title"] },
  { type: "ai_proposal", collectionKey: "ai_proposals", label: "AI proposal", iconKey: "sparkles", projection: "legacy", themePolicy: "none", themeField: null, requiredFields: ["source", "payload_type", "status"] },
  { type: "resource", collectionKey: "resources", domainCollectionKey: "resources", label: "Resource", iconKey: "folder", projection: "canonical", themePolicy: "optional", themeField: "project_id", legacyThemeFields: ["theme_id"], requiredFields: ["title"] },
  { type: "project", collectionKey: "projects", domainCollectionKey: "projects", label: "Theme", iconKey: "palette", projection: "canonical", themePolicy: "none", themeField: null, requiredFields: ["name", "state"] },
  { type: "repository_context", collectionKey: "repository_contexts", domainCollectionKey: "repository_contexts", label: "Repository context", iconKey: "git", projection: "canonical", themePolicy: "none", themeField: null, requiredFields: ["label"] },
  { type: "capture_entry", collectionKey: "capture_entrys", domainCollectionKey: "capture_entries", label: "Capture", iconKey: "inbox", projection: "canonical", themePolicy: "optional", themeField: "project_id", legacyThemeFields: ["theme_id"], requiredFields: ["text", "captured_at", "state"] },
  { type: "task", collectionKey: "tasks", domainCollectionKey: "tasks", label: "Task", iconKey: "check", projection: "canonical", themePolicy: "optional", themeField: "project_id", legacyThemeFields: ["theme_id"], requiredFields: ["title", "state"] },
  { type: "work_receipt", collectionKey: "work_receipts", domainCollectionKey: "work_receipts", label: "Work receipt", iconKey: "history", projection: "canonical", themePolicy: "none", themeField: null, requiredFields: ["task_id", "executor_kind", "executor_label", "reported_at", "summary"] },
  { type: "waiting", collectionKey: "waitings", domainCollectionKey: "waitings", label: "Waiting", iconKey: "clock", projection: "canonical", themePolicy: "optional", themeField: "project_id", legacyThemeFields: ["theme_id"], requiredFields: ["title", "waiting_for", "state"] },
  { type: "plan_node", collectionKey: "plan_nodes", domainCollectionKey: "plan_nodes", label: "Plan node", iconKey: "route", projection: "canonical", themePolicy: "optional", themeField: "project_id", legacyThemeFields: ["theme_id"], requiredFields: ["title", "type", "state"] },
  { type: "schedule", collectionKey: "schedules", domainCollectionKey: "schedules", label: "Schedule", iconKey: "calendar", projection: "canonical", themePolicy: "none", themeField: null, requiredFields: ["owner_type", "owner_id", "date_kind", "confidence", "granularity"] },
  { type: "reference", collectionKey: "references", domainCollectionKey: "references", label: "Reference", iconKey: "arrows", projection: "canonical", themePolicy: "none", themeField: null, requiredFields: ["source_type", "source_id", "target_type", "target_id", "relation_type"] },
  { type: "task_dependency", collectionKey: "task_dependencies", domainCollectionKey: "task_dependencies", label: "Task dependency", iconKey: "arrows", projection: "canonical", themePolicy: "none", themeField: null, requiredFields: ["task_id", "depends_on_task_id"] },
  { type: "plan_dependency", collectionKey: "plan_dependencies", domainCollectionKey: "plan_dependencies", label: "Plan dependency", iconKey: "arrows", projection: "canonical", themePolicy: "none", themeField: null, requiredFields: ["plan_node_id", "depends_on_plan_node_id"] },
  { type: "knowledge_edge", collectionKey: "knowledge_edges", domainCollectionKey: "knowledge_edges", label: "Knowledge edge", iconKey: "arrows", projection: "canonical", themePolicy: "none", themeField: null, requiredFields: ["source_node_id", "target_node_id", "relation_type"] },
  { type: "change_event", collectionKey: "change_events", domainCollectionKey: "change_events", label: "Change event", iconKey: "history", projection: "canonical", themePolicy: "none", themeField: null, requiredFields: ["entity_type", "entity_id", "changed_at", "change_type", "source"] },
  { type: "artifact", collectionKey: "artifacts", label: "Artifact", iconKey: "file", projection: "legacy", themePolicy: "optional", themeField: "theme_id", requiredFields: ["title", "filename", "source_type", "source_id"] },
  { type: "sketch", collectionKey: "sketches", domainCollectionKey: "sketches", label: "Sketch", iconKey: "pencil", projection: "canonical", themePolicy: "optional", themeField: "project_id", legacyThemeFields: ["theme_id"], requiredFields: ["title"] },
];

function parseCreatePayload(type, payload) {
  return assertEntityPayload(type, payload);
}

function parseUpdatePayload(type, payload) {
  return assertEntityPayload(type, payload);
}

export const entityDefinitions = Object.freeze(definitions.map((definition) => Object.freeze({
  ...definition,
  requiredFields: Object.freeze([...definition.requiredFields]),
  legacyThemeFields: Object.freeze([...(definition.legacyThemeFields || [])]),
  domainCollectionKey: definition.domainCollectionKey || null,
  payloadKind: "record",
  parseCreate: (payload) => parseCreatePayload(definition.type, payload),
  parseUpdate: (payload) => parseUpdatePayload(definition.type, payload),
  referencePolicy: Object.freeze({
    themeField: definition.themeField,
    legacyThemeFields: Object.freeze([...(definition.legacyThemeFields || [])]),
  }),
  activityPolicy: Object.freeze({ tracked: true, projection: definition.projection }),
})));

const definitionsByType = new Map(entityDefinitions.map((definition) => [definition.type, definition]));
const definitionsByCollection = new Map(entityDefinitions.map((definition) => [definition.collectionKey, definition]));

export const entityTypes = Object.freeze(entityDefinitions.map((definition) => definition.type));

/** Referenceのsource/targetは、Repositoryの内部enumではなくRegistryのdomain境界を正本にする。 */
export const referenceTargetEntityTypes = Object.freeze([
  "project", "capture_entry", "task", "waiting", "plan_node", "note", "resource", "knowledge_node", "sketch", "artifact",
]);
export const referenceRelationTypes = Object.freeze(["related_to", "derived_from", "mentions", "blocks", "supports"]);

export function entityDefinition(type) {
  const definition = definitionsByType.get(type);
  if (!definition) throw new Error(`未知のEntity typeです: ${String(type)}`);
  return definition;
}

export function entityDefinitionForCollection(collectionKey) {
  return definitionsByCollection.get(collectionKey) || null;
}

export function collectionKeyForEntityType(type) {
  return entityDefinition(type).collectionKey;
}

export function domainCollectionKeyForEntityType(type) {
  return definitionsByType.get(type)?.domainCollectionKey || null;
}

export function requiredFieldsForEntityType(type) {
  return entityDefinition(type).requiredFields;
}

export function themeFieldForEntityType(type) {
  return entityDefinition(type).themeField;
}

export function legacyThemeFieldsForEntityType(type) {
  return entityDefinition(type).legacyThemeFields;
}

export function assertEntityType(type) {
  return entityDefinition(type).type;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reject a typed envelope or payload whose declared type does not match its route. */
export function assertEntityPayload(type, payload) {
  assertEntityType(type);
  if (!isRecord(payload)) throw new Error(`${type}のpayloadはRecordである必要があります。`);
  // `entity_type` is a domain reference on several records (field_value,
  // change_event, entity_source).  Only the envelope/payload discriminator is
  // checked here, so reference fields are not confused with their owner type.
  const declaredType = payload.entityType ?? payload.__entity_type;
  if (declaredType != null && declaredType !== type) {
    throw new Error(`Entity typeとpayloadのtypeが一致しません: ${type} / ${String(declaredType)}`);
  }
  return payload;
}

export function assertEntityEnvelope(envelope) {
  if (!isRecord(envelope) || typeof envelope.type !== "string") {
    throw new Error("Entity envelopeのtypeが不正です。");
  }
  assertEntityPayload(envelope.type, envelope.entity ?? envelope.payload);
  return envelope;
}

export const rawRecordBoundary = Object.freeze({
  kind: "raw-record-boundary",
  description: "DB/importのRecordはこの境界で検証し、domainへ直接持ち込まない",
});
