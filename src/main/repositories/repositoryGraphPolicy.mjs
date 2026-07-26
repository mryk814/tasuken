import {
  assertItemParentAcyclic,
  hasPath,
  isKnowledgeDirectionalRelationType,
} from "./domain.mjs";

export function validateRepositoryGraph(repository, type, entity) {
  if (type === "item") {
    assertItemParentAcyclic(repository.list("item"), entity);
    return;
  }

  if (type === "task" && entity.parent_task_id) {
    validateParentChain(repository.list("task"), entity, "parent_task_id", "Taskの親子関係が循環しています。別の親Taskを選んでください。");
    return;
  }

  if (type === "plan_node" && entity.parent_plan_node_id) {
    validateParentChain(repository.list("plan_node"), entity, "parent_plan_node_id", "PlanNodeの親子関係が循環しています。別の親PlanNodeを選んでください。");
    return;
  }

  if (type === "task_dependency") {
    validateDependency(
      repository.list("task_dependency"),
      entity,
      "task_id",
      "depends_on_task_id",
      "TaskDependencyが循環します。依存関係の向きを見直してください。",
    );
    return;
  }

  if (type === "plan_dependency") {
    validateDependency(
      repository.list("plan_dependency"),
      entity,
      "plan_node_id",
      "depends_on_plan_node_id",
      "PlanDependencyが循環します。依存関係の向きを見直してください。",
    );
    return;
  }

  if (type === "knowledge_edge") validateKnowledgeEdge(repository, entity);
}

function validateParentChain(entities, entity, parentField, errorMessage) {
  const byId = new Map(entities.filter((entry) => !entry.deleted_at).map((entry) => [String(entry.id), entry]));
  byId.set(String(entity.id), entity);
  const seen = new Set([String(entity.id)]);
  let currentId = String(entity[parentField] || "");
  while (currentId) {
    if (seen.has(currentId)) throw new Error(errorMessage);
    seen.add(currentId);
    currentId = String(byId.get(currentId)?.[parentField] || "");
  }
}

function validateDependency(entities, entity, ownerField, dependencyField, errorMessage) {
  if (!entity[ownerField] || !entity[dependencyField]) return;
  const edges = entities
    .filter((entry) => !entry.deleted_at && String(entry.id) !== String(entity.id))
    .map((entry) => [String(entry[ownerField]), String(entry[dependencyField])]);
  edges.push([String(entity[ownerField]), String(entity[dependencyField])]);
  if (hasPath(edges, String(entity[dependencyField]), String(entity[ownerField]))) {
    throw new Error(errorMessage);
  }
}

function validateKnowledgeEdge(repository, entity) {
  if (!entity.source_node_id || !entity.target_node_id) return;
  if (!isKnowledgeDirectionalRelationType(entity.relation_type)) return;
  const edges = repository.list("knowledge_edge")
    .filter((edge) => !edge.deleted_at && String(edge.id) !== String(entity.id) && isKnowledgeDirectionalRelationType(edge.relation_type))
    .map((edge) => [String(edge.source_node_id), String(edge.target_node_id)]);
  edges.push([String(entity.source_node_id), String(entity.target_node_id)]);
  if (hasPath(edges, String(entity.target_node_id), String(entity.source_node_id))) {
    throw new Error("KnowledgeEdgeが循環します。relationの向きを見直してください。");
  }
}
