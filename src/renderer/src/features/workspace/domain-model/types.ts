import type { AiMetadataFields } from "../../../../../shared/aiMetadata.mjs";
import type { RepositoryContext } from "../../../../../shared/repositoryContext.mjs";
import type { ExternalReference } from "../../../../../shared/externalReference.mjs";
import type {
  RelationAssertion,
  RelationEvidenceRef,
  RelationLayer,
  RelationOrigin,
  RelationPredicate,
  RelationRef,
  RelationStatus,
} from "../../../../../shared/relationAssertion.mjs";

/**
 * AI可読の共通metadata（#294）。本文schemaは種別ごとに別のまま、
 * 概要・鮮度・根拠・公開範囲・出典だけを同じ意味で持つ。
 */
export type AiMetadata = Partial<AiMetadataFields>;

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
  repository_context_ids?: string[];
  primary_repository_context_id?: string | null;
  repository_context_detachments?: Array<Record<string, unknown>>;
}

export interface WorkingCopy {
  [key: string]: unknown;
  id: string;
  repository_context_id: string;
  device_id: string;
  storage_root_id: string;
  worktree_identity?: string | null;
  branch_hint?: string | null;
  active: boolean;
  last_seen_at?: string | null;
}

export interface AgentSessionIntent {
  summary: string;
  requested_outcome?: string | null;
  boundary?: string | null;
}

export interface AgentSessionOutcome {
  summary: string;
  decisions: string[];
  changed_items: string[];
  verification: string[];
  remaining_work: string[];
  next_suggested_action?: string | null;
}

export interface AgentSessionCheckpoint {
  observed_at: string;
  text: string;
}

export interface AgentSession {
  [key: string]: unknown;
  id: string;
  started_at: string;
  ended_at?: string | null;
  status: "active" | "completed" | "blocked" | "abandoned";
  client_kind: "codex" | "claude_code" | "cursor" | "github_copilot" | "other";
  client_label?: string | null;
  agent_label?: string | null;
  provider_label?: string | null;
  model_label?: string | null;
  source_session_id?: string | null;
  request_events?: AgentSessionCheckpoint[];
  response_checkpoints?: AgentSessionCheckpoint[];
  intent: AgentSessionIntent;
  outcome?: AgentSessionOutcome | null;
}

export type CaptureEntryState = "untriaged" | "triaged" | "archived";

export interface CaptureEntry extends AiMetadata {
  id: string;
  text: string;
  title?: string | null;
  kind?: "inbox" | "micro_memo" | string | null;
  content_type?: "text" | "url" | "file" | "image" | "markdown" | "ink" | "audio" | "video" | null;
  capture_method?:
    "audio_import" | "microphone" | "external_dictation" | "transcript_import" | null;
  media_status?: "preparing" | "ready" | "failed" | null;
  transcription_status?: "not_requested" | "queued" | "processing" | "completed" | "failed" | null;
  url?: string | null;
  properties_json?: Record<string, unknown>;
  project_id?: string | null;
  captured_at: string;
  state: CaptureEntryState;
  source_record_id?: string | null;
  triaged_to_type?: EntityRefType | null;
  triaged_to_id?: string | null;
  legacy_item_id?: string | null;
}

export type TaskState = "todo" | "doing" | "waiting" | "review" | "done" | "cancelled";

export type TaskRepeatFrequency = "daily" | "weekly" | "monthly";

export type TaskShelf = "maybe_today" | "this_evening" | "this_week" | "someday" | "backlog";

export type TaskRequester = "self" | "human" | "ai_agent" | "external" | "unknown";
export type TaskIntendedExecutor = "self" | "human" | "ai_agent" | "unassigned";
export type TaskExecutorKind = "self" | "human" | "ai_agent" | "external" | "unknown";
export type TaskWorkState =
  | "not_delegated"
  | "ready_for_agent"
  | "in_progress"
  | "reported_done"
  | "needs_human_review"
  | "accepted"
  | "blocked"
  | "failed";

export interface WorkReceipt {
  [key: string]: unknown;
  id: string;
  task_id: string;
  executor_kind: TaskExecutorKind;
  executor_label: string;
  started_at?: string | null;
  reported_at: string;
  summary: string;
  completed_items: string[];
  changed_or_created_items: string[];
  verification?: string[];
  remaining_work?: string[];
  external_references?: ExternalReference[];
  repository_context?: Record<string, unknown> | null;
  source_session?: string | null;
  provenance?: Record<string, unknown>;
  runtime_metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

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

export interface Task extends AiMetadata {
  id: string;
  project_id?: string | null;
  plan_node_id?: string | null;
  parent_task_id?: string | null;
  section_id?: string | null;
  title: string;
  description?: string | null;
  state: TaskState;
  requester?: TaskRequester;
  intended_executor?: TaskIntendedExecutor;
  executor_identity?: string | null;
  work_state?: TaskWorkState;
  work_started_at?: string | null;
  work_reported_at?: string | null;
  work_review_note?: string | null;
  priority: "normal" | "high";
  /** ユーザーが今日やると選んだ日。Scheduleの期限とは別に保持する。 */
  today_date?: string | null;
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
  repository_context_mode?: "inherit" | "extend" | "override";
  repository_context_ids?: string[];
  primary_repository_context_id?: string | null;
  repository_subdirectory?: string | null;
  repository_branch_hint?: string | null;
  repository_context_detachments?: Array<Record<string, unknown>>;
}

export type WaitingState = "waiting" | "received" | "cancelled";

export interface Waiting extends AiMetadata {
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

export interface PlanNode extends AiMetadata {
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

export interface Note extends AiMetadata {
  id: string;
  title: string;
  body_markdown?: string;
  note_type?: string | null;
  content_format?: string | null;
  project_id?: string | null;
  source_record_id?: string | null;
  properties_json?: Record<string, unknown>;
}

export interface Resource extends AiMetadata {
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

export interface Sketch extends AiMetadata {
  id: string;
  title: string;
  project_id?: string | null;
  origin_capture_id?: string | null;
  document: import("../lib/sketch").SketchDocument;
  created_at?: string;
  updated_at?: string;
}

export type KnowledgeNodeType =
  "source" | "evidence" | "claim" | "question" | "decision" | "insight";

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
  | "repository_context"
  | "working_copy"
  | "agent_session"
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
  assertion_id?: string;
  subject?: RelationRef;
  predicate?: RelationPredicate;
  object?: RelationRef;
  layer?: RelationLayer;
  status?: RelationStatus;
  origin?: RelationOrigin;
  evidence_refs?: RelationEvidenceRef[];
  legacy_evidence_refs?: string[];
  confidence?: number | null;
  metadata?: Record<string, unknown>;
  recorded_at?: string | null;
  superseded_by_assertion_id?: string | null;
  legacy_read?: boolean;
  source_type: EntityRefType;
  source_id: string;
  target_type: EntityRefType;
  target_id: string;
  relation_type: RelationPredicate;
  note?: string | null;
  source_heading?: string | null;
  source_excerpt?: string | null;
}

export type CanonicalReference = Reference & RelationAssertion;

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
  occurred_at?: string;
  event_kind?: string;
  entity_ref?: { type: EntityRefType; id: string; revision?: number };
  theme_ref?: { kind: "theme" | "none"; id: string | null };
  actor?: { kind: string; id?: string };
  origin?: { kind: string; command_id?: string; command_name?: string; session_id?: string };
  summary?: string;
  changed_fields?: string[];
  canonical_refs?: Array<Record<string, unknown>>;
  source_refs?: Array<Record<string, unknown>>;
  relation_refs?: Array<Record<string, unknown>>;
  work_receipt_ref?: { type: string; id: string; revision?: number } | null;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceDomain {
  projects: Project[];
  repository_contexts: RepositoryContext[];
  working_copies: WorkingCopy[];
  agent_sessions: AgentSession[];
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
  work_receipts: WorkReceipt[];
}

export type DomainEntity =
  | Project
  | RepositoryContext
  | WorkingCopy
  | AgentSession
  | CaptureEntry
  | Task
  | WorkReceipt
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
