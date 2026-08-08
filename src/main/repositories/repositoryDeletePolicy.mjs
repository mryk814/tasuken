import { entityTypes, themeFieldForEntityType } from "../../shared/entityRegistry.mjs";

const themeReferenceTargets = entityTypes
  .filter((entityType) => entityType !== "theme" && entityType !== "project" && entityType !== "status_update")
  .map((entityType) => [entityType, themeFieldForEntityType(entityType)])
  .filter((entry) => entry[1]);

export function applyRepositoryDeletePolicy(repository, type, id) {
  if (type === "theme") {
    repository.cascadeWhere("artifact", (entry) => entry.source_type === "theme" && entry.source_id === id, type, id);
    repository.nullifyReferences(type, themeReferenceTargets, id);
    repository.cascadeWhere("status_update", (entry) => entry.theme_id === id, type, id);
  }

  if (type === "item") {
    repository.nullifyReferences(type, [
      ["item", "parent_item_id"],
      ["note", "item_id"],
      ["link", "item_id"],
      ["knowledge_node", "source_item_id"],
      ["log_entry", "item_id"],
    ], id);
  }

  if (type === "note") {
    repository.nullifyReferences(type, [
      ["link", "note_id"],
      ["knowledge_node", "source_note_id"],
      ["log_entry", "related_note_id"],
      ["artifact", "origin_note_id"],
    ], id);
    repository.cascadeWhere("artifact", (entry) => (entry.source_type === "note" || entry.source_type === "report") && entry.source_id === id, type, id);
  }

  if (type === "link") repository.nullifyReferences(type, [["knowledge_node", "source_link_id"]], id);
  if (type === "task") {
    repository.cascadeWhere("artifact", (entry) => entry.source_type === "task" && entry.source_id === id, type, id);
    repository.cascadeWhere("work_receipt", (entry) => entry.task_id === id, type, id);
  }
  if (type === "resource") repository.cascadeWhere("artifact", (entry) => entry.source_type === "chat_ref" && entry.source_id === id, type, id);
  if (type === "capture_entry") repository.cascadeWhere("artifact", (entry) => entry.source_type === "capture_entry" && entry.source_id === id, type, id);
  if (type === "ai_proposal") repository.cascadeWhere("artifact", (entry) => entry.source_type === "ai_proposal" && entry.source_id === id, type, id);
  if (type === "sketch") {
    repository.cascadeWhere(
      "reference",
      (entry) => (entry.source_type === "sketch" && entry.source_id === id)
        || (entry.target_type === "sketch" && entry.target_id === id),
      type,
      id,
    );
  }

  if (type === "source_record") {
    repository.nullifyReferences(type, [
      ["item", "source_record_id"],
      ["note", "source_record_id"],
      ["link", "source_record_id"],
      ["log_entry", "source_record_id"],
    ], id);
  }

  if (type === "field_definition") {
    repository.cascadeWhere("field_value", (entry) => entry.field_definition_id === id, type, id);
  }

  if (type === "knowledge_node") {
    repository.cascadeWhere(
      "knowledge_edge",
      (entry) => entry.source_node_id === id || entry.target_node_id === id,
      type,
      id,
    );
  }

  if (["theme", "item", "note", "link", "source_record", "knowledge_node"].includes(type)) {
    repository.cascadeWhere(
      "entity_source",
      (entry) => (entry.entity_type === type && entry.entity_id === id)
        || (type === "source_record" && entry.source_record_id === id),
      type,
      id,
    );
    repository.cascadeWhere(
      "field_value",
      (entry) => entry.entity_type === type && entry.entity_id === id,
      type,
      id,
    );
  }
}
