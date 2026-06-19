import type { BaseRecord, Dependency, Item, Link as LegacyLink, Note as LegacyNote, Theme, WorkspaceData } from "../../workspace/types";
import type {
  CaptureEntry,
  ChangeEvent,
  EntityRefType,
  KnowledgeEdge,
  KnowledgeNode,
  Note,
  PlanDependency,
  PlanNode,
  PlanNodeState,
  PlanNodeType,
  Project,
  ProjectState,
  Reference,
  Resource,
  Schedule,
  ScheduleOwnerType,
  Task,
  TaskDependency,
  TaskState,
  Waiting,
  WaitingState,
  WorkspaceV2,
} from "./types";

type LegacyItemKind = "capture" | "task" | "waiting" | "plan_node";

interface LegacyItemRef {
  type: Exclude<EntityRefType, "project" | "note" | "resource" | "knowledge_node">;
  id: string;
}

export interface LegacyContext {
  itemRefsByLegacyId: Map<string, LegacyItemRef>;
}

export interface V2ConversionResult {
  item: Item;
  kind: LegacyItemKind;
  entity: CaptureEntry | Task | Waiting | PlanNode;
  schedule: Schedule | null;
  changeEvent: ChangeEvent;
  warnings: string[];
}

export interface MigrationReport {
  legacyItems: number;
  created: {
    Project: number;
    CaptureEntry: number;
    Task: number;
    Waiting: number;
    PlanNode: number;
    Schedule: number;
    Reference: number;
    TaskDependency: number;
    PlanDependency: number;
    KnowledgeEdge: number;
    ChangeEvent: number;
  };
  warnings: string[];
  warningCounts: {
    unknownKindToTask: number;
    mixedDependencyToReference: number;
    dueDateOnlyToScheduleEnd: number;
    missingParent: number;
    missingDependencyEndpoint: number;
  };
}

export interface WorkspaceV2Migration {
  workspace: WorkspaceV2;
  report: MigrationReport;
}

const KNOWN_ITEM_KINDS = new Set([
  "task",
  "milestone",
  "period",
  "event",
  "waiting",
  "deliverable",
  "reminder",
  "idea",
]);

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value != null);
}

function legacyId(prefix: string, id: string): string {
  return `${prefix}-${id}`;
}

function legacyTimestamp(item: Item): string {
  return String(item.created_at || item.updated_at || new Date(0).toISOString());
}

function nullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function priorityFromLegacy(value: unknown): "normal" | "high" {
  return value === "high" ? "high" : "normal";
}

function taskStateFromLegacy(item: Item): TaskState {
  switch (item.status) {
    case "doing":
      return "doing";
    case "waiting":
      return "waiting";
    case "review":
      return "review";
    case "done":
    case "completed":
      return "done";
    case "cancelled":
    case "archived":
      return "cancelled";
    default:
      return "todo";
  }
}

function waitingStateFromLegacy(item: Item): WaitingState {
  if (item.status === "done" || item.status === "completed") return "received";
  if (item.status === "cancelled" || item.status === "archived") return "cancelled";
  return "waiting";
}

function planStateFromLegacy(item: Item): PlanNodeState {
  if (item.status === "done" || item.status === "completed") return "done";
  if (item.status === "cancelled" || item.status === "archived") return "cancelled";
  if (item.status === "doing") return "active";
  return "planned";
}

function planTypeFromLegacy(item: Item): PlanNodeType {
  if (item.kind === "milestone") return "milestone";
  if (item.kind === "deliverable") return "deliverable";
  return "phase";
}

function projectStateFromLegacy(theme: Theme): ProjectState {
  if (theme.status === "paused") return "paused";
  if (theme.status === "completed" || theme.status === "closed") return "closed";
  if (theme.status === "idea") return "idea";
  return "active";
}

function classifyLegacyItem(item: Item): LegacyItemKind {
  if (item.status === "inbox") return "capture";
  if (item.kind === "idea" && item.status !== "done" && item.status !== "archived") return "capture";
  if (item.kind === "waiting" || item.status === "waiting") return "waiting";
  if (item.kind === "milestone" || item.kind === "period" || item.level === "plan") return "plan_node";
  return "task";
}

function entityRefType(kind: LegacyItemKind): LegacyItemRef["type"] {
  if (kind === "capture") return "capture_entry";
  if (kind === "waiting") return "waiting";
  if (kind === "plan_node") return "plan_node";
  return "task";
}

function projectIdFromLegacy(item: Item): string | null {
  return nullableText(item.theme_id);
}

function scheduleFromLegacyItem(
  item: Item,
  ownerType: ScheduleOwnerType,
  ownerId: string,
): { schedule: Schedule | null; dueDateOnly: boolean } {
  const start = nullableText(item.planned_start);
  const end = nullableText(item.planned_end) || nullableText(item.due_date);
  if (!start && !end) return { schedule: null, dueDateOnly: false };

  const dueDateOnly = !start && !item.planned_end && Boolean(item.due_date);
  const dateKind = start && end && start !== end
    ? "range"
    : item.kind === "milestone"
      ? "point"
      : start && !end
        ? "point"
        : "deadline";

  return {
    schedule: {
      id: legacyId("schedule", item.id),
      owner_type: ownerType,
      owner_id: ownerId,
      start_date: start,
      end_date: end,
      date_kind: dateKind,
      confidence: item.schedule_confidence === "rough" || item.schedule_confidence === "tentative"
        ? item.schedule_confidence
        : "fixed",
      granularity: item.date_granularity === "week" || item.date_granularity === "month"
        ? item.date_granularity
        : "day",
      baseline_start: nullableText(item.baseline_start),
      baseline_end: nullableText(item.baseline_end),
      actual_start: nullableText(item.actual_start),
      actual_end: nullableText(item.actual_end),
      legacy_item_id: item.id,
    },
    dueDateOnly,
  };
}

function changeEventForLegacyItem(entityType: EntityRefType, entityId: string, item: Item): ChangeEvent {
  return {
    id: legacyId("change-event", item.id),
    entity_type: entityType,
    entity_id: entityId,
    changed_at: legacyTimestamp(item),
    change_type: "created",
    after_json: { legacy_item_id: item.id },
    source: "migration",
    legacy_item_id: item.id,
  };
}

function migrateProject(theme: Theme): Project {
  return {
    id: theme.id,
    name: theme.name,
    description: nullableText(theme.description),
    state: projectStateFromLegacy(theme),
    color: nullableText(theme.color),
    created_at: theme.created_at,
    updated_at: theme.updated_at,
    legacy_theme_id: theme.id,
  };
}

function migrateNote(note: LegacyNote): LegacyNote & { project_id?: string | null } {
  return {
    ...note,
    project_id: nullableText(note.theme_id),
  };
}

function migrateResource(link: LegacyLink): Resource {
  return {
    id: link.id,
    title: link.title,
    url: nullableText(link.url),
    description: nullableText(link.description),
    project_id: nullableText(link.theme_id),
    source_record_id: nullableText(link.source_record_id),
  };
}

function migrateKnowledgeNode(
  node: WorkspaceData["knowledge_nodes"][number],
  itemRefsByLegacyId: Map<string, LegacyItemRef>,
): KnowledgeNode {
  const source = node.source_note_id
    ? { source_type: "note" as const, source_id: node.source_note_id }
    : node.source_link_id
      ? { source_type: "resource" as const, source_id: node.source_link_id }
      : node.source_item_id
        ? {
          source_type: itemRefsByLegacyId.get(node.source_item_id)?.type || "task" as const,
          source_id: itemRefsByLegacyId.get(node.source_item_id)?.id || legacyId("task", node.source_item_id),
        }
        : { source_type: null, source_id: null };

  return {
    id: node.id,
    title: node.title,
    body: nullableText(node.body) || undefined,
    node_type: node.node_type,
    project_id: nullableText(node.theme_id),
    ...source,
  };
}

export function legacyItemToV2(item: Item, _context: LegacyContext): V2ConversionResult {
  const warnings: string[] = [];
  const kind = classifyLegacyItem(item);
  const refType = entityRefType(kind);
  const id = legacyId(refType, item.id);
  const source_record_id = nullableText(item.source_record_id);
  const description = nullableText(item.description);
  let entity: CaptureEntry | Task | Waiting | PlanNode;

  if (item.kind && !KNOWN_ITEM_KINDS.has(item.kind)) {
    warnings.push(`Item ${item.id} had unknown kind "${item.kind}" and was converted to Task.`);
  }

  if (kind === "capture") {
    entity = {
      id,
      text: description || item.title,
      title: nullableText(item.title),
      captured_at: legacyTimestamp(item),
      state: item.status === "archived" ? "archived" : "untriaged",
      source_record_id,
      legacy_item_id: item.id,
    };
  } else if (kind === "waiting") {
    entity = {
      id,
      project_id: projectIdFromLegacy(item),
      title: item.title,
      description,
      waiting_for: nullableText(item.waiting_for) || "未設定",
      next_action: nullableText(item.next_action),
      state: waitingStateFromLegacy(item),
      source_record_id,
      legacy_item_id: item.id,
      created_at: item.created_at,
      updated_at: item.updated_at,
    };
  } else if (kind === "plan_node") {
    entity = {
      id,
      project_id: projectIdFromLegacy(item),
      title: item.title,
      description,
      type: planTypeFromLegacy(item),
      state: planStateFromLegacy(item),
      sort_order: Number(item.sort_order) || 0,
      source_record_id,
      legacy_item_id: item.id,
      created_at: item.created_at,
      updated_at: item.updated_at,
    };
  } else {
    entity = {
      id,
      project_id: projectIdFromLegacy(item),
      title: item.title,
      description,
      state: taskStateFromLegacy(item),
      priority: priorityFromLegacy(item.priority),
      completed_at: nullableText(item.completed_at),
      source_record_id,
      legacy_item_id: item.id,
      created_at: item.created_at,
      updated_at: item.updated_at,
    };
  }

  const scheduleOwner = kind === "waiting" ? "waiting" : kind === "plan_node" ? "plan_node" : kind === "task" ? "task" : null;
  const scheduleResult = scheduleOwner ? scheduleFromLegacyItem(item, scheduleOwner, id) : { schedule: null, dueDateOnly: false };
  if (scheduleResult.dueDateOnly) {
    warnings.push(`Item ${item.id} had due_date only; mapped to Schedule.end_date.`);
  }

  return {
    item,
    kind,
    entity,
    schedule: scheduleResult.schedule,
    changeEvent: changeEventForLegacyItem(refType, id, item),
    warnings,
  };
}

function emptyWorkspaceV2(): WorkspaceV2 {
  return {
    projects: [],
    capture_entries: [],
    tasks: [],
    waitings: [],
    plan_nodes: [],
    schedules: [],
    notes: [],
    resources: [],
    knowledge_nodes: [],
    references: [],
    task_dependencies: [],
    plan_dependencies: [],
    knowledge_edges: [],
    change_events: [],
  };
}

function emptyMigrationReport(legacyItems: number): MigrationReport {
  return {
    legacyItems,
    created: {
      Project: 0,
      CaptureEntry: 0,
      Task: 0,
      Waiting: 0,
      PlanNode: 0,
      Schedule: 0,
      Reference: 0,
      TaskDependency: 0,
      PlanDependency: 0,
      KnowledgeEdge: 0,
      ChangeEvent: 0,
    },
    warnings: [],
    warningCounts: {
      unknownKindToTask: 0,
      mixedDependencyToReference: 0,
      dueDateOnlyToScheduleEnd: 0,
      missingParent: 0,
      missingDependencyEndpoint: 0,
    },
  };
}

function pushParentReference(workspace: WorkspaceV2, child: LegacyItemRef, parent: LegacyItemRef, childLegacyId: string, parentLegacyId: string): void {
  workspace.references.push({
    id: legacyId("parent-reference", `${parentLegacyId}-${childLegacyId}`),
    source_type: child.type,
    source_id: child.id,
    target_type: parent.type,
    target_id: parent.id,
    relation_type: "related_to",
    note: "Migrated from legacy parent_item_id.",
  });
}

function applyParentLinks(workspace: WorkspaceV2, items: Item[], itemRefsByLegacyId: Map<string, LegacyItemRef>, report: MigrationReport): void {
  const planNodesById = new Map(workspace.plan_nodes.map((node) => [node.id, node]));
  const tasksById = new Map(workspace.tasks.map((task) => [task.id, task]));
  const waitingsById = new Map(workspace.waitings.map((waiting) => [waiting.id, waiting]));

  for (const item of items) {
    const parentLegacyId = nullableText(item.parent_item_id);
    if (!parentLegacyId) continue;

    const childRef = itemRefsByLegacyId.get(item.id);
    const parentRef = itemRefsByLegacyId.get(parentLegacyId);
    if (!childRef || !parentRef) {
      report.warningCounts.missingParent += 1;
      report.warnings.push(`Item ${item.id} referenced missing parent_item_id ${parentLegacyId}.`);
      continue;
    }

    if (childRef.type === "plan_node" && parentRef.type === "plan_node") {
      const child = planNodesById.get(childRef.id);
      if (child) child.parent_plan_node_id = parentRef.id;
      continue;
    }

    if (childRef.type === "task" && parentRef.type === "plan_node") {
      const child = tasksById.get(childRef.id);
      if (child) child.plan_node_id = parentRef.id;
      continue;
    }

    if (childRef.type === "task" && parentRef.type === "task") {
      const child = tasksById.get(childRef.id);
      if (child) child.parent_task_id = parentRef.id;
      continue;
    }

    if (childRef.type === "waiting" && parentRef.type === "task") {
      const child = waitingsById.get(childRef.id);
      if (child) child.task_id = parentRef.id;
      continue;
    }

    pushParentReference(workspace, childRef, parentRef, item.id, parentLegacyId);
  }
}

function applyDependencyLinks(workspace: WorkspaceV2, dependencies: Dependency[], itemRefsByLegacyId: Map<string, LegacyItemRef>, report: MigrationReport): void {
  for (const dependency of dependencies) {
    const sourceLegacyId = nullableText(dependency.source_item_id);
    const targetLegacyId = nullableText(dependency.target_item_id);
    if (!sourceLegacyId || !targetLegacyId) continue;

    const source = itemRefsByLegacyId.get(sourceLegacyId);
    const target = itemRefsByLegacyId.get(targetLegacyId);
    if (!source || !target) {
      report.warningCounts.missingDependencyEndpoint += 1;
      report.warnings.push(`Dependency ${dependency.id} referenced missing item endpoint.`);
      continue;
    }

    if (source.type === "task" && target.type === "task") {
      workspace.task_dependencies.push({
        id: legacyId("task-dependency", dependency.id),
        task_id: target.id,
        depends_on_task_id: source.id,
        dependency_type: nullableText(dependency.dependency_type),
        legacy_dependency_id: dependency.id,
      });
      continue;
    }

    if (source.type === "plan_node" && target.type === "plan_node") {
      workspace.plan_dependencies.push({
        id: legacyId("plan-dependency", dependency.id),
        plan_node_id: target.id,
        depends_on_plan_node_id: source.id,
        dependency_type: nullableText(dependency.dependency_type),
        legacy_dependency_id: dependency.id,
      });
      continue;
    }

    workspace.references.push({
      id: legacyId("dependency-reference", dependency.id),
      source_type: source.type,
      source_id: source.id,
      target_type: target.type,
      target_id: target.id,
      relation_type: "blocks",
      note: nullableText(dependency.dependency_type),
      legacy_dependency_id: dependency.id,
    });
    report.warningCounts.mixedDependencyToReference += 1;
    report.warnings.push(`Dependency ${dependency.id} was mixed type and converted to Reference(blocks).`);
  }
}

function applyKnowledgeEdges(workspace: WorkspaceV2, data: WorkspaceData): void {
  workspace.knowledge_edges = (data.knowledge_relations || []).map((relation) => ({
    id: relation.id,
    source_node_id: String(relation.source_node_id || ""),
    target_node_id: String(relation.target_node_id || ""),
    relation_type: String(relation.relation_type || "related_to"),
    description: nullableText(relation.description),
    legacy_relation_id: relation.id,
  })).filter((edge) => edge.source_node_id && edge.target_node_id);
}

function updateCreatedCounts(workspace: WorkspaceV2, report: MigrationReport): void {
  report.created.Project = workspace.projects.length;
  report.created.CaptureEntry = workspace.capture_entries.length;
  report.created.Task = workspace.tasks.length;
  report.created.Waiting = workspace.waitings.length;
  report.created.PlanNode = workspace.plan_nodes.length;
  report.created.Schedule = workspace.schedules.length;
  report.created.Reference = workspace.references.length;
  report.created.TaskDependency = workspace.task_dependencies.length;
  report.created.PlanDependency = workspace.plan_dependencies.length;
  report.created.KnowledgeEdge = workspace.knowledge_edges.length;
  report.created.ChangeEvent = workspace.change_events.length;
}

export function legacyWorkspaceToV2Migration(data: WorkspaceData): WorkspaceV2Migration {
  const workspace = emptyWorkspaceV2();
  const items = data.items || [];
  const report = emptyMigrationReport(items.length);
  const itemRefsByLegacyId = new Map<string, LegacyItemRef>();
  const context: LegacyContext = { itemRefsByLegacyId };

  workspace.projects = (data.themes || []).map(migrateProject);
  workspace.notes = (data.notes || []).map(migrateNote);
  workspace.resources = (data.links || []).map(migrateResource);

  for (const item of items) {
    const result = legacyItemToV2(item, context);
    itemRefsByLegacyId.set(item.id, { type: entityRefType(result.kind), id: result.entity.id });

    if (result.kind === "capture") workspace.capture_entries.push(result.entity as CaptureEntry);
    else if (result.kind === "waiting") workspace.waitings.push(result.entity as Waiting);
    else if (result.kind === "plan_node") workspace.plan_nodes.push(result.entity as PlanNode);
    else workspace.tasks.push(result.entity as Task);

    if (result.schedule) workspace.schedules.push(result.schedule);
    workspace.change_events.push(result.changeEvent);
    report.warnings.push(...result.warnings);
    if (result.warnings.some((warning) => warning.includes("unknown kind"))) report.warningCounts.unknownKindToTask += 1;
    if (result.warnings.some((warning) => warning.includes("due_date only"))) report.warningCounts.dueDateOnlyToScheduleEnd += 1;
  }

  workspace.knowledge_nodes = (data.knowledge_nodes || []).map((node) => migrateKnowledgeNode(node, itemRefsByLegacyId));
  applyParentLinks(workspace, items, itemRefsByLegacyId, report);
  applyDependencyLinks(workspace, data.dependencys || [], itemRefsByLegacyId, report);
  applyKnowledgeEdges(workspace, data);
  updateCreatedCounts(workspace, report);

  return { workspace, report };
}

export function legacyWorkspaceToV2(data: WorkspaceData): WorkspaceV2 {
  return legacyWorkspaceToV2Migration(data).workspace;
}

export function buildMigrationReport(data: WorkspaceData): MigrationReport {
  return legacyWorkspaceToV2Migration(data).report;
}

function mergeV2<T extends { id: string }>(
  persisted: T[],
  legacyDerived: T[],
  legacyIdField: keyof T & string,
): T[] {
  if (!persisted.length) return legacyDerived;

  const excludeIds = new Set(persisted.map((e) => e.id));
  const excludeLegacyIds = new Set<string>();
  for (const entity of persisted) {
    const val = entity[legacyIdField];
    if (typeof val === "string") excludeLegacyIds.add(val);
  }

  const supplemental = legacyDerived.filter((entity) => {
    if (excludeIds.has(entity.id)) return false;
    const val = entity[legacyIdField];
    return !(typeof val === "string" && excludeLegacyIds.has(val));
  });

  return [...persisted, ...supplemental];
}

function castRecords<T>(records: BaseRecord[] | undefined): T[] {
  return (records || []) as unknown as T[];
}

export function workspaceToV2(data: WorkspaceData): WorkspaceV2 {
  const legacy = legacyWorkspaceToV2(data);

  const pProjects = castRecords<Project>(data.projects);
  const pCaptures = castRecords<CaptureEntry>(data.capture_entrys);
  const pTasks = castRecords<Task>(data.tasks);
  const pWaitings = castRecords<Waiting>(data.waitings);
  const pPlanNodes = castRecords<PlanNode>(data.plan_nodes);
  const pSchedules = castRecords<Schedule>(data.schedules);
  const pReferences = castRecords<Reference>(data.references);
  const pTaskDeps = castRecords<TaskDependency>(data.task_dependencys);
  const pPlanDeps = castRecords<PlanDependency>(data.plan_dependencys);
  const pKnowledgeEdges = castRecords<KnowledgeEdge>(data.knowledge_edges);
  const pChangeEvents = castRecords<ChangeEvent>(data.change_events);

  const hasPersistedV2 =
    pProjects.length || pCaptures.length || pTasks.length ||
    pWaitings.length || pPlanNodes.length || pSchedules.length ||
    pReferences.length || pTaskDeps.length || pPlanDeps.length ||
    pKnowledgeEdges.length || pChangeEvents.length;

  if (!hasPersistedV2) return legacy;

  return {
    projects: mergeV2(pProjects, legacy.projects, "legacy_theme_id"),
    capture_entries: mergeV2(pCaptures, legacy.capture_entries, "legacy_item_id"),
    tasks: mergeV2(pTasks, legacy.tasks, "legacy_item_id"),
    waitings: mergeV2(pWaitings, legacy.waitings, "legacy_item_id"),
    plan_nodes: mergeV2(pPlanNodes, legacy.plan_nodes, "legacy_item_id"),
    schedules: mergeV2(pSchedules, legacy.schedules, "legacy_item_id"),
    notes: legacy.notes as Note[],
    resources: legacy.resources,
    knowledge_nodes: legacy.knowledge_nodes,
    references: mergeV2(pReferences, legacy.references, "legacy_dependency_id"),
    task_dependencies: mergeV2(pTaskDeps, legacy.task_dependencies, "legacy_dependency_id"),
    plan_dependencies: mergeV2(pPlanDeps, legacy.plan_dependencies, "legacy_dependency_id"),
    knowledge_edges: mergeV2(pKnowledgeEdges, legacy.knowledge_edges, "legacy_relation_id"),
    change_events: mergeV2(pChangeEvents, legacy.change_events, "legacy_item_id"),
  };
}

export function formatMigrationReport(report: MigrationReport): string {
  const warningLines = report.warnings.length
    ? report.warnings.map((warning) => `- ${warning}`)
    : ["- なし"];

  return [
    "Migration report",
    "----------------",
    `Legacy items: ${report.legacyItems}`,
    "",
    "Created:",
    `- Project: ${report.created.Project}`,
    `- CaptureEntry: ${report.created.CaptureEntry}`,
    `- Task: ${report.created.Task}`,
    `- Waiting: ${report.created.Waiting}`,
    `- PlanNode: ${report.created.PlanNode}`,
    `- Schedule: ${report.created.Schedule}`,
    `- Reference: ${report.created.Reference}`,
    `- TaskDependency: ${report.created.TaskDependency}`,
    `- PlanDependency: ${report.created.PlanDependency}`,
    `- KnowledgeEdge: ${report.created.KnowledgeEdge}`,
    `- ChangeEvent: ${report.created.ChangeEvent}`,
    "",
    "Warnings:",
    ...warningLines,
  ].join("\n");
}

function scheduleByOwner(v2: WorkspaceV2): Map<string, Schedule> {
  return new Map(v2.schedules.map((schedule) => [`${schedule.owner_type}:${schedule.owner_id}`, schedule]));
}

export function v2ToLegacyWorkspace(v2: WorkspaceV2, base?: WorkspaceData): WorkspaceData {
  const schedules = scheduleByOwner(v2);
  const itemFromTask = (task: Task): Item => {
    const schedule = schedules.get(`task:${task.id}`);
    return {
      id: task.legacy_item_id || task.id,
      title: task.title,
      kind: "task",
      level: "task",
      theme_id: task.project_id,
      parent_item_id: task.parent_task_id,
      status: task.state,
      priority: task.priority,
      planned_start: schedule?.start_date,
      planned_end: schedule?.end_date,
      baseline_start: schedule?.baseline_start,
      baseline_end: schedule?.baseline_end,
      actual_start: schedule?.actual_start,
      actual_end: schedule?.actual_end,
      schedule_confidence: schedule?.confidence,
      date_granularity: schedule?.granularity,
      completed_at: task.completed_at,
      source_record_id: task.source_record_id,
      description: task.description || undefined,
    };
  };
  const itemFromWaiting = (waiting: Waiting): Item => {
    const schedule = schedules.get(`waiting:${waiting.id}`);
    return {
      id: waiting.legacy_item_id || waiting.id,
      title: waiting.title,
      kind: "waiting",
      level: "task",
      theme_id: waiting.project_id,
      parent_item_id: waiting.task_id,
      status: waiting.state === "received" ? "done" : waiting.state,
      planned_start: schedule?.start_date,
      planned_end: schedule?.end_date,
      waiting_for: waiting.waiting_for,
      next_action: waiting.next_action || undefined,
      source_record_id: waiting.source_record_id,
      description: waiting.description || undefined,
    };
  };
  const itemFromPlanNode = (planNode: PlanNode): Item => {
    const schedule = schedules.get(`plan_node:${planNode.id}`);
    return {
      id: planNode.legacy_item_id || planNode.id,
      title: planNode.title,
      kind: planNode.type === "milestone" ? "milestone" : planNode.type === "deliverable" ? "deliverable" : "period",
      level: "plan",
      theme_id: planNode.project_id,
      parent_item_id: planNode.parent_plan_node_id,
      status: planNode.state === "planned" ? "todo" : planNode.state,
      sort_order: planNode.sort_order,
      planned_start: schedule?.start_date,
      planned_end: schedule?.end_date,
      baseline_start: schedule?.baseline_start,
      baseline_end: schedule?.baseline_end,
      actual_start: schedule?.actual_start,
      actual_end: schedule?.actual_end,
      schedule_confidence: schedule?.confidence,
      date_granularity: schedule?.granularity,
      source_record_id: planNode.source_record_id,
      description: planNode.description || undefined,
    };
  };
  const itemFromCapture = (entry: CaptureEntry): Item => ({
    id: entry.legacy_item_id || entry.id,
    title: entry.title || entry.text,
    kind: "idea",
    level: "task",
    status: entry.state === "archived" ? "archived" : "inbox",
    source_record_id: entry.source_record_id,
    description: entry.text,
  });

  return {
    ...base,
    themes: v2.projects.map((project) => ({
      id: project.legacy_theme_id || project.id,
      name: project.name,
      description: project.description || undefined,
      status: project.state === "closed" ? "completed" : project.state,
      color: project.color || undefined,
    })),
    items: [
      ...v2.capture_entries.map(itemFromCapture),
      ...v2.tasks.map(itemFromTask),
      ...v2.waitings.map(itemFromWaiting),
      ...v2.plan_nodes.map(itemFromPlanNode),
    ],
    notes: v2.notes as WorkspaceData["notes"],
    links: v2.resources.map((resource) => ({
      id: resource.id,
      title: resource.title,
      url: resource.url || "",
      description: resource.description || undefined,
      theme_id: resource.project_id,
      source_record_id: resource.source_record_id,
    })),
    dependencys: compact([
      ...v2.task_dependencies.map((dependency): Dependency => ({
        id: dependency.legacy_dependency_id || dependency.id,
        source_item_id: dependency.depends_on_task_id,
        target_item_id: dependency.task_id,
        dependency_type: dependency.dependency_type || undefined,
      })),
      ...v2.plan_dependencies.map((dependency): Dependency => ({
        id: dependency.legacy_dependency_id || dependency.id,
        source_item_id: dependency.depends_on_plan_node_id,
        target_item_id: dependency.plan_node_id,
        dependency_type: dependency.dependency_type || undefined,
      })),
    ]),
    views: base?.views || [],
    status_updates: base?.status_updates || [],
    source_records: base?.source_records || [],
    entity_sources: base?.entity_sources || [],
    relations: base?.relations || [],
    field_definitions: base?.field_definitions || [],
    field_values: base?.field_values || [],
    log_entries: base?.log_entries || [],
    import_batchs: base?.import_batchs || [],
    knowledge_nodes: base?.knowledge_nodes || [],
    knowledge_relations: base?.knowledge_relations || [],
    ai_proposals: base?.ai_proposals || [],
    plan_revisions: base?.plan_revisions || [],
    meta: base?.meta,
  };
}
