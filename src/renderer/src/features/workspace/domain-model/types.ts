export type ProjectState = "idea" | "active" | "paused" | "closed";

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  state: ProjectState;
  color?: string | null;
  created_at?: string;
  updated_at?: string;
  legacy_theme_id?: string | null;
}

export type CaptureEntryState = "untriaged" | "triaged" | "archived";

export interface CaptureEntry {
  id: string;
  text: string;
  title?: string | null;
  captured_at: string;
  state: CaptureEntryState;
  source_record_id?: string | null;
  triaged_to_type?: EntityRefType | null;
  triaged_to_id?: string | null;
  legacy_item_id?: string | null;
}

export type TaskState =
  | "todo"
  | "doing"
  | "waiting"
  | "review"
  | "done"
  | "cancelled";

export type TaskRepeatFrequency = "daily" | "weekly" | "monthly";

export interface TaskRepeatRule {
  frequency: TaskRepeatFrequency;
  interval: number;
  weekdays?: number[];
  month_day?: number | null;
  next_from: "scheduled" | "completed";
  until?: string | null;
}

export interface TaskChecklistItem {
  id: string;
  title: string;
  done: boolean;
  sort_order: number;
  completed_at?: string | null;
}

export interface Task {
  id: string;
  project_id?: string | null;
  plan_node_id?: string | null;
  parent_task_id?: string | null;
  title: string;
  description?: string | null;
  state: TaskState;
  priority: "normal" | "high";
  completed_at?: string | null;
  repeat_rule?: TaskRepeatRule | null;
  repeat_series_id?: string | null;
  repeat_parent_task_id?: string | null;
  checklist_items?: TaskChecklistItem[];
  source_record_id?: string | null;
  legacy_item_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type WaitingState = "waiting" | "received" | "cancelled";

export interface Waiting {
  id: string;
  project_id?: string | null;
  task_id?: string | null;
  title: string;
  description?: string | null;
  waiting_for: string;
  next_action?: string | null;
  state: WaitingState;
  source_record_id?: string | null;
  legacy_item_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type PlanNodeType = "phase" | "milestone" | "deliverable";
export type PlanNodeState = "planned" | "active" | "done" | "cancelled";

export interface PlanNode {
  id: string;
  project_id?: string | null;
  parent_plan_node_id?: string | null;
  title: string;
  description?: string | null;
  type: PlanNodeType;
  state: PlanNodeState;
  sort_order: number;
  source_record_id?: string | null;
  legacy_item_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ScheduleOwnerType = "task" | "waiting" | "plan_node";

export interface Schedule {
  id: string;
  owner_type: ScheduleOwnerType;
  owner_id: string;
  start_date?: string | null;
  end_date?: string | null;
  date_kind: "point" | "deadline" | "range" | "unknown";
  confidence: "rough" | "tentative" | "fixed";
  granularity: "day" | "week" | "month";
  baseline_start?: string | null;
  baseline_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  legacy_item_id?: string | null;
}

export interface Note {
  id: string;
  title: string;
  body_markdown?: string;
  project_id?: string | null;
  source_record_id?: string | null;
}

export interface Resource {
  id: string;
  title: string;
  url?: string | null;
  description?: string | null;
  project_id?: string | null;
  source_record_id?: string | null;
  link_type?: string | null;
  reference_status?: string | null;
  importance?: string | null;
  captured_at?: string | null;
  chat_group?: string | null;
}

export type KnowledgeNodeType =
  | "source"
  | "evidence"
  | "claim"
  | "question"
  | "decision"
  | "insight";

export interface KnowledgeNode {
  id: string;
  title: string;
  body?: string;
  node_type: KnowledgeNodeType;
  project_id?: string | null;
  source_type?: EntityRefType | null;
  source_id?: string | null;
}

export type EntityRefType =
  | "project"
  | "capture_entry"
  | "task"
  | "waiting"
  | "plan_node"
  | "note"
  | "resource"
  | "knowledge_node";

export interface Reference {
  id: string;
  source_type: EntityRefType;
  source_id: string;
  target_type: EntityRefType;
  target_id: string;
  relation_type: "related_to" | "derived_from" | "mentions" | "blocks" | "supports";
  note?: string | null;
}

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  dependency_type?: string | null;
}

export interface PlanDependency {
  id: string;
  plan_node_id: string;
  depends_on_plan_node_id: string;
  dependency_type?: string | null;
}

export interface KnowledgeEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  description?: string | null;
}

export interface ChangeEvent {
  id: string;
  entity_type: EntityRefType;
  entity_id: string;
  changed_at: string;
  change_type: "created" | "updated" | "completed" | "rescheduled" | "triaged" | "deleted";
  reason?: string | null;
  before_json?: unknown;
  after_json?: unknown;
  source: "manual" | "import" | "ai" | "migration";
  legacy_item_id?: string | null;
}

export interface WorkspaceDomain {
  projects: Project[];
  capture_entries: CaptureEntry[];
  tasks: Task[];
  waitings: Waiting[];
  plan_nodes: PlanNode[];
  schedules: Schedule[];
  notes: Note[];
  resources: Resource[];
  knowledge_nodes: KnowledgeNode[];
  references: Reference[];
  task_dependencies: TaskDependency[];
  plan_dependencies: PlanDependency[];
  knowledge_edges: KnowledgeEdge[];
  ai_proposals: Record<string, unknown>[];
  change_events: ChangeEvent[];
}

/** @deprecated Use WorkspaceDomain instead */
export type WorkspaceV2 = WorkspaceDomain;

export type DomainEntity =
  | Project
  | CaptureEntry
  | Task
  | Waiting
  | PlanNode
  | Schedule
  | Note
  | Resource
  | KnowledgeNode
  | Reference
  | TaskDependency
  | PlanDependency
  | KnowledgeEdge
  | ChangeEvent;

/** @deprecated Use DomainEntity instead */
export type V2Entity = DomainEntity;
