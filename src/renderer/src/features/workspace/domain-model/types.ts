export type ProjectState = "idea" | "active" | "paused" | "closed";

export interface Project {
  id: string;
  name: string;
  code?: string | null;
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
  kind?: "inbox" | "micro_memo" | string | null;
  content_type?: "text" | "url" | "file" | "image" | "markdown" | "ink" | null;
  url?: string | null;
  project_id?: string | null;
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

export type TaskShelf = "maybe_today" | "this_evening" | "this_week" | "someday" | "backlog";

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
  section_id?: string | null;
  title: string;
  description?: string | null;
  state: TaskState;
  priority: "normal" | "high";
  planning_shelf?: TaskShelf | null;
  planned_start_time?: string | null;
  planned_duration_minutes?: number | null;
  reminder_at?: string | null;
  completed_at?: string | null;
  /** 完了時のひとこと。説明とは別に、完了の記録として保持する（#308）。 */
  completion_note?: string | null;
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
  check_reminder_at?: string | null;
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

/**
 * 日付範囲の意味（#309）。開始日と終了日が異なる範囲にだけ設定する。
 * 未設定（null）は「意味を決めていない既存の範囲」で、#95の表示規則をそのまま使う。
 */
export type ScheduleRangeSemantics = "once_within_window" | "ongoing";

export interface Schedule {
  id: string;
  owner_type: ScheduleOwnerType;
  owner_id: string;
  start_date?: string | null;
  end_date?: string | null;
  date_kind: "point" | "deadline" | "range" | "unknown";
  range_semantics?: ScheduleRangeSemantics | null;
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
  note_type?: string | null;
  content_format?: string | null;
  project_id?: string | null;
  source_record_id?: string | null;
  properties_json?: Record<string, unknown>;
}

export interface Resource {
  id: string;
  title: string;
  url?: string | null;
  description?: string | null;
  /** リンクを見ながらのメモ（Markdown）。description は短い補足用として残す。 */
  body_markdown?: string | null;
  project_id?: string | null;
  source_record_id?: string | null;
  link_type?: string | null;
  reference_status?: string | null;
  importance?: string | null;
  resource_scope?: "note" | "chat_ref" | null;
  captured_at?: string | null;
  chat_group?: string | null;
  parent_resource_id?: string | null;
  sort_order?: number | null;
  /**
   * チャットリンクのArchive時刻。null/未設定は通常一覧。
   * 削除・グループ解除とは別。Theme / chat_group / reference_status は保持する。
   */
  archived_at?: string | null;
  source_format?: string | null;
  fidelity?: string | null;
  parser_version?: string | null;
  message_count?: number | null;
}

export interface Sketch {
  id: string;
  title: string;
  project_id?: string | null;
  origin_capture_id?: string | null;
  document: import("../lib/sketch").SketchDocument;
  created_at?: string;
  updated_at?: string;
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
  | "knowledge_node"
  | "sketch"
  | "artifact";

export interface Reference {
  id: string;
  source_type: EntityRefType;
  source_id: string;
  target_type: EntityRefType;
  target_id: string;
  relation_type: "related_to" | "derived_from" | "mentions" | "blocks" | "supports";
  note?: string | null;
  source_heading?: string | null;
  source_excerpt?: string | null;
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
  sketches: Sketch[];
  knowledge_nodes: KnowledgeNode[];
  references: Reference[];
  task_dependencies: TaskDependency[];
  plan_dependencies: PlanDependency[];
  knowledge_edges: KnowledgeEdge[];
  ai_proposals: Record<string, unknown>[];
  change_events: ChangeEvent[];
}

export type DomainEntity =
  | Project
  | CaptureEntry
  | Task
  | Waiting
  | PlanNode
  | Schedule
  | Note
  | Resource
  | Sketch
  | KnowledgeNode
  | Reference
  | TaskDependency
  | PlanDependency
  | KnowledgeEdge
  | ChangeEvent;
