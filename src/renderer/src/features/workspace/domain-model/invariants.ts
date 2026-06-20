import type { WorkspaceDomain } from "./types";

export interface InvariantViolation {
  rule: string;
  entity_type: string;
  entity_id: string;
  message: string;
}

function hasCycle(adjacency: Map<string, string[]>): { hasCycle: boolean; path: string[] } {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, path: string[]): string[] | null {
    if (stack.has(node)) return [...path, node];
    if (visited.has(node)) return null;
    visited.add(node);
    stack.add(node);
    for (const neighbor of adjacency.get(node) || []) {
      const result = dfs(neighbor, [...path, node]);
      if (result) return result;
    }
    stack.delete(node);
    return null;
  }

  for (const node of adjacency.keys()) {
    const result = dfs(node, []);
    if (result) return { hasCycle: true, path: result };
  }
  return { hasCycle: false, path: [] };
}

export function validateInvariants(domain: WorkspaceDomain): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // Schedule の owner が存在する
  const ownerSets: Record<string, Set<string>> = {
    task: new Set(domain.tasks.map((t) => t.id)),
    waiting: new Set(domain.waitings.map((w) => w.id)),
    plan_node: new Set(domain.plan_nodes.map((p) => p.id)),
  };
  for (const schedule of domain.schedules) {
    const owners = ownerSets[schedule.owner_type];
    if (!owners || !owners.has(schedule.owner_id)) {
      violations.push({
        rule: "schedule_owner_exists",
        entity_type: "schedule",
        entity_id: schedule.id,
        message: `Schedule ${schedule.id} references ${schedule.owner_type}:${schedule.owner_id} which does not exist.`,
      });
    }
  }

  // TaskDependency に循環がない
  const taskAdj = new Map<string, string[]>();
  for (const dep of domain.task_dependencies) {
    const list = taskAdj.get(dep.depends_on_task_id) || [];
    list.push(dep.task_id);
    taskAdj.set(dep.depends_on_task_id, list);
  }
  const taskCycle = hasCycle(taskAdj);
  if (taskCycle.hasCycle) {
    violations.push({
      rule: "task_dependency_acyclic",
      entity_type: "task_dependency",
      entity_id: taskCycle.path.join(" → "),
      message: `TaskDependency cycle detected: ${taskCycle.path.join(" → ")}.`,
    });
  }

  // PlanDependency に循環がない
  const planAdj = new Map<string, string[]>();
  for (const dep of domain.plan_dependencies) {
    const list = planAdj.get(dep.depends_on_plan_node_id) || [];
    list.push(dep.plan_node_id);
    planAdj.set(dep.depends_on_plan_node_id, list);
  }
  const planCycle = hasCycle(planAdj);
  if (planCycle.hasCycle) {
    violations.push({
      rule: "plan_dependency_acyclic",
      entity_type: "plan_dependency",
      entity_id: planCycle.path.join(" → "),
      message: `PlanDependency cycle detected: ${planCycle.path.join(" → ")}.`,
    });
  }

  // CaptureEntry.triaged_to_* の参照先が存在する
  const allEntityIds: Record<string, Set<string>> = {
    project: new Set(domain.projects.map((p) => p.id)),
    capture_entry: new Set(domain.capture_entries.map((c) => c.id)),
    task: ownerSets.task,
    waiting: ownerSets.waiting,
    plan_node: ownerSets.plan_node,
    note: new Set(domain.notes.map((n) => n.id)),
    resource: new Set(domain.resources.map((r) => r.id)),
    knowledge_node: new Set(domain.knowledge_nodes.map((k) => k.id)),
  };
  for (const entry of domain.capture_entries) {
    if (entry.state === "triaged" && entry.triaged_to_type && entry.triaged_to_id) {
      const targetSet = allEntityIds[entry.triaged_to_type];
      if (!targetSet || !targetSet.has(entry.triaged_to_id)) {
        violations.push({
          rule: "triage_target_exists",
          entity_type: "capture_entry",
          entity_id: entry.id,
          message: `CaptureEntry ${entry.id} triaged to ${entry.triaged_to_type}:${entry.triaged_to_id} which does not exist.`,
        });
      }
    }
  }

  // project_id が存在する
  const projectIds = allEntityIds.project;
  for (const task of domain.tasks) {
    if (task.project_id && !projectIds.has(task.project_id)) {
      violations.push({ rule: "project_ref_exists", entity_type: "task", entity_id: task.id, message: `Task ${task.id} references project ${task.project_id} which does not exist.` });
    }
  }
  for (const waiting of domain.waitings) {
    if (waiting.project_id && !projectIds.has(waiting.project_id)) {
      violations.push({ rule: "project_ref_exists", entity_type: "waiting", entity_id: waiting.id, message: `Waiting ${waiting.id} references project ${waiting.project_id} which does not exist.` });
    }
  }
  for (const node of domain.plan_nodes) {
    if (node.project_id && !projectIds.has(node.project_id)) {
      violations.push({ rule: "project_ref_exists", entity_type: "plan_node", entity_id: node.id, message: `PlanNode ${node.id} references project ${node.project_id} which does not exist.` });
    }
  }

  // parent_task_id が存在し循環しない
  const taskIds = ownerSets.task;
  const planNodeIds = ownerSets.plan_node;
  for (const task of domain.tasks) {
    if (task.parent_task_id) {
      if (!taskIds.has(task.parent_task_id)) {
        violations.push({ rule: "parent_task_exists", entity_type: "task", entity_id: task.id, message: `Task ${task.id} references parent_task ${task.parent_task_id} which does not exist.` });
      }
    }
    if (task.plan_node_id && !planNodeIds.has(task.plan_node_id)) {
      violations.push({ rule: "plan_node_ref_exists", entity_type: "task", entity_id: task.id, message: `Task ${task.id} references plan_node ${task.plan_node_id} which does not exist.` });
    }
  }

  // parent_plan_node_id が存在する
  for (const node of domain.plan_nodes) {
    if (node.parent_plan_node_id && !planNodeIds.has(node.parent_plan_node_id)) {
      violations.push({ rule: "parent_plan_node_exists", entity_type: "plan_node", entity_id: node.id, message: `PlanNode ${node.id} references parent_plan_node ${node.parent_plan_node_id} which does not exist.` });
    }
  }

  // Task.task_id in Waiting が存在する
  for (const waiting of domain.waitings) {
    if (waiting.task_id && !taskIds.has(waiting.task_id)) {
      violations.push({ rule: "waiting_task_ref_exists", entity_type: "waiting", entity_id: waiting.id, message: `Waiting ${waiting.id} references task ${waiting.task_id} which does not exist.` });
    }
  }

  // Reference の source/target が存在する
  for (const ref of domain.references) {
    const sourceSet = allEntityIds[ref.source_type];
    if (sourceSet && !sourceSet.has(ref.source_id)) {
      violations.push({ rule: "reference_source_exists", entity_type: "reference", entity_id: ref.id, message: `Reference ${ref.id} source ${ref.source_type}:${ref.source_id} does not exist.` });
    }
    const targetSet = allEntityIds[ref.target_type];
    if (targetSet && !targetSet.has(ref.target_id)) {
      violations.push({ rule: "reference_target_exists", entity_type: "reference", entity_id: ref.id, message: `Reference ${ref.id} target ${ref.target_type}:${ref.target_id} does not exist.` });
    }
  }

  // TaskDependency の task_id/depends_on_task_id が存在する
  for (const dep of domain.task_dependencies) {
    if (!taskIds.has(dep.task_id)) {
      violations.push({ rule: "task_dep_ref_exists", entity_type: "task_dependency", entity_id: dep.id, message: `TaskDependency ${dep.id} references task ${dep.task_id} which does not exist.` });
    }
    if (!taskIds.has(dep.depends_on_task_id)) {
      violations.push({ rule: "task_dep_ref_exists", entity_type: "task_dependency", entity_id: dep.id, message: `TaskDependency ${dep.id} references task ${dep.depends_on_task_id} which does not exist.` });
    }
  }

  // PlanDependency の plan_node_id/depends_on_plan_node_id が存在する
  for (const dep of domain.plan_dependencies) {
    if (!planNodeIds.has(dep.plan_node_id)) {
      violations.push({ rule: "plan_dep_ref_exists", entity_type: "plan_dependency", entity_id: dep.id, message: `PlanDependency ${dep.id} references plan_node ${dep.plan_node_id} which does not exist.` });
    }
    if (!planNodeIds.has(dep.depends_on_plan_node_id)) {
      violations.push({ rule: "plan_dep_ref_exists", entity_type: "plan_dependency", entity_id: dep.id, message: `PlanDependency ${dep.id} references plan_node ${dep.depends_on_plan_node_id} which does not exist.` });
    }
  }

  // parent_task_id 循環チェック
  const taskParentAdj = new Map<string, string[]>();
  for (const task of domain.tasks) {
    if (task.parent_task_id) {
      const list = taskParentAdj.get(task.parent_task_id) || [];
      list.push(task.id);
      taskParentAdj.set(task.parent_task_id, list);
    }
  }
  const taskParentCycle = hasCycle(taskParentAdj);
  if (taskParentCycle.hasCycle) {
    violations.push({ rule: "task_parent_acyclic", entity_type: "task", entity_id: taskParentCycle.path.join(" → "), message: `Task parent cycle detected: ${taskParentCycle.path.join(" → ")}.` });
  }

  // parent_plan_node_id 循環チェック
  const planParentAdj = new Map<string, string[]>();
  for (const node of domain.plan_nodes) {
    if (node.parent_plan_node_id) {
      const list = planParentAdj.get(node.parent_plan_node_id) || [];
      list.push(node.id);
      planParentAdj.set(node.parent_plan_node_id, list);
    }
  }
  const planParentCycle = hasCycle(planParentAdj);
  if (planParentCycle.hasCycle) {
    violations.push({ rule: "plan_node_parent_acyclic", entity_type: "plan_node", entity_id: planParentCycle.path.join(" → "), message: `PlanNode parent cycle detected: ${planParentCycle.path.join(" → ")}.` });
  }

  // legacy_item_id 由来の重複がない
  function checkLegacyDuplicates<T extends { id: string; legacy_item_id?: string | null }>(
    entities: T[],
    typeName: string,
  ): void {
    const seen = new Map<string, string>();
    for (const entity of entities) {
      if (!entity.legacy_item_id) continue;
      const existing = seen.get(entity.legacy_item_id);
      if (existing) {
        violations.push({
          rule: "no_legacy_duplicates",
          entity_type: typeName,
          entity_id: entity.id,
          message: `${typeName} ${entity.id} and ${existing} share legacy_item_id ${entity.legacy_item_id}.`,
        });
      } else {
        seen.set(entity.legacy_item_id, entity.id);
      }
    }
  }
  checkLegacyDuplicates(domain.tasks, "task");
  checkLegacyDuplicates(domain.waitings, "waiting");
  checkLegacyDuplicates(domain.plan_nodes, "plan_node");
  checkLegacyDuplicates(domain.capture_entries, "capture_entry");

  // Task.state=waiting と Waiting の関係が破綻していない
  const waitingTaskIds = new Set(
    domain.waitings
      .filter((w) => w.state === "waiting" && w.task_id)
      .map((w) => w.task_id!),
  );
  for (const task of domain.tasks) {
    if (task.state === "waiting") {
      const hasActiveWaiting = domain.waitings.some(
        (w) => w.task_id === task.id && w.state === "waiting",
      );
      if (!hasActiveWaiting) {
        violations.push({
          rule: "waiting_task_has_waiting",
          entity_type: "task",
          entity_id: task.id,
          message: `Task ${task.id} has state=waiting but no active Waiting record references it.`,
        });
      }
    }
  }

  return violations;
}

export function formatViolations(violations: InvariantViolation[]): string {
  if (!violations.length) return "All invariants hold.";
  return violations
    .map((v) => `[${v.rule}] ${v.entity_type}:${v.entity_id} — ${v.message}`)
    .join("\n");
}
