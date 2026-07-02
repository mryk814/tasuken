import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  WorkspaceMeta,
} from "../../../../shared/types/workspace";
import type { WorkspaceDomain } from "./domain-model/types";

// shared型をこの層から再エクスポートし、各ファイルの相対パスを単純化する。
export type { Entity, EntityType, SaveOperation, SaveOptions, Workspace } from "../../../../shared/types/workspace";

// DBのdata_jsonはスキーマレスなので、利用するフィールドだけを型付けし、
// それ以外はindex signatureで許容する（カスタム項目・将来フィールドのため）。
export interface BaseRecord {
  id: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  version?: number;
  source?: string;
  [key: string]: unknown;
}

export interface Theme extends BaseRecord {
  name: string;
  code?: string;
  description?: string;
  status?: string;
  color?: string;
  group?: string;
}

export interface Item extends BaseRecord {
  title: string;
  kind?: string;
  level?: string;
  theme_id?: string | null;
  status?: string;
  priority?: string;
  parent_item_id?: string | null;
  sort_order?: number;
  planned_start?: string | null;
  planned_end?: string | null;
  due_date?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  baseline_start?: string | null;
  baseline_end?: string | null;
  schedule_confidence?: string;
  date_granularity?: string;
  date_text?: string;
  progress?: number;
  waiting_for?: string;
  next_action?: string;
  is_personal_task?: boolean;
  description?: string;
  source_record_id?: string | null;
  completed_at?: string | null;
  today_flag?: boolean;
}

export interface NoteComment {
  id: string;
  body: string;
  created_at: string;
}

export interface Note extends BaseRecord {
  title: string;
  body_markdown?: string;
  note_type?: string;
  content_format?: string;
  theme_id?: string | null;
  item_id?: string | null;
  source_url?: string;
  source_record_id?: string | null;
  properties_json?: Record<string, unknown>;
  comments?: NoteComment[];
}

export interface Link extends BaseRecord {
  title: string;
  url: string;
  link_type?: string;
  theme_id?: string | null;
  item_id?: string | null;
  note_id?: string | null;
  description?: string;
  source_record_id?: string | null;
  reference_status?: string;
  importance?: string;
  captured_at?: string | null;
  chat_group?: string | null;
  sort_order?: number | null;
}

export interface StatusUpdate extends BaseRecord {
  theme_id?: string | null;
  date?: string;
  status?: string;
  summary?: string;
  progress?: number;
  risks?: string;
  next_actions?: string;
}

export interface SourceRecord extends BaseRecord {
  source_type?: string;
  source_title?: string;
  source_url?: string;
  captured_at?: string;
  raw_text?: string;
  summary?: string;
}

export interface FieldDefinition extends BaseRecord {
  name: string;
  field_type?: string;
  applies_to?: string;
  theme_id?: string | null;
  options_json?: string[];
  sort_order?: number;
  is_required?: boolean;
}

export interface FieldValue extends BaseRecord {
  field_definition_id?: string;
  entity_type?: string;
  entity_id?: string;
  value_text?: string;
  value_number?: number | null;
  value_date?: string | null;
  value_json?: string[] | null;
}

export interface ImportBatch extends BaseRecord {
  source?: string;
  status?: string;
  count?: number;
  raw_text?: string;
  source_record_id?: string | null;
}

export interface PlanRevision extends BaseRecord {
  item_id: string;
  changed_at: string;
  reason?: string | null;
}

export type KnowledgeNodeType =
  | "source"
  | "evidence"
  | "claim"
  | "question"
  | "decision"
  | "insight";

export type KnowledgeRelationType =
  | "supports"
  | "contradicts"
  | "explains"
  | "causes"
  | "example_of"
  | "generalizes"
  | "depends_on"
  | "derived_from"
  | "answers"
  | "raises"
  | "similar_to"
  | "leads_to";

export interface KnowledgeNode extends BaseRecord {
  node_type: KnowledgeNodeType;
  title: string;
  body?: string;
  theme_id?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  /** @deprecated use source_type/source_id */
  source_note_id?: string | null;
  /** @deprecated use source_type/source_id */
  source_link_id?: string | null;
  /** @deprecated use source_type/source_id */
  source_item_id?: string | null;
  confidence?: "low" | "medium" | "high";
  status?: "active" | "resolved" | "deprecated" | "rejected";
}

// activeRecordsで論理削除を除外した「表示用の正本投影」。
export interface WorkspaceData {
  themes: Theme[];
  items: Item[];
  notes: Note[];
  links: Link[];
  resources: BaseRecord[];
  views: BaseRecord[];
  status_updates: StatusUpdate[];
  source_records: SourceRecord[];
  entity_sources: BaseRecord[];
  field_definitions: FieldDefinition[];
  field_values: FieldValue[];
  log_entries: BaseRecord[];
  import_batchs: ImportBatch[];
  knowledge_nodes: KnowledgeNode[];
  ai_proposals: BaseRecord[];
  plan_revisions: PlanRevision[];
  projects: BaseRecord[];
  capture_entrys: BaseRecord[];
  tasks: BaseRecord[];
  waitings: BaseRecord[];
  plan_nodes: BaseRecord[];
  schedules: BaseRecord[];
  references: BaseRecord[];
  task_dependencies: BaseRecord[];
  plan_dependencies: BaseRecord[];
  knowledge_edges: BaseRecord[];
  change_events: BaseRecord[];
  meta?: WorkspaceMeta;
}

// Drawerに渡すentityは新規（idなし）と既存（id付き）の両方を取り得る。
export interface DrawerEntity {
  id?: string;
  [key: string]: unknown;
}

export type DrawerEntityType =
  | "theme"
  | "note"
  | "resource"
  | "status_update"
  | "source_record"
  | "field_definition"
  | "reference"
  | "task_dependency"
  | "knowledge_node"
  | "knowledge_edge"
  | "task"
  | "waiting"
  | "plan_node"
  | "capture_entry";

export interface DrawerConfig {
  type: DrawerEntityType;
  mode?: "edit";
  entity: DrawerEntity;
}

export interface SnapshotChange {
  key: string;
  type: EntityType;
  category: string;
  action: string;
  actions?: string[];
  incoming: BaseRecord;
  local?: BaseRecord | null;
}

export interface SnapshotPreview {
  token: string;
  manifest?: Record<string, unknown>;
  changes: SnapshotChange[];
  decisions: Record<string, string>;
}

export type SaveEntity = (
  type: EntityType,
  entity: DrawerEntity,
  options?: SaveOptions,
) => Promise<Entity>;

export type SaveEntities = (
  operations: SaveOperation[],
  successMessage?: string,
) => Promise<Entity[]>;

export type RemoveEntity = (type: EntityType, entity: DrawerEntity) => Promise<void>;

export type OpenDrawer = (config: DrawerConfig) => void;

export interface PageProps {
  data: WorkspaceData;
  domain: WorkspaceDomain;
  themes: Theme[];
  items: Item[];
  notes: Note[];
  links: Link[];
  activeTheme: Theme | null;
  activeThemeId: string;
  setActiveThemeId(id: string): void;
  route: string;
  navigate(next: string): void;
  openDrawer: OpenDrawer;
  saveEntity: SaveEntity;
  saveEntities: SaveEntities;
  refreshWorkspace(): Promise<void>;
  removeEntity: RemoveEntity;
  removeEntityQuiet(type: EntityType, id: string): Promise<void>;
  setToast(message: string, tone?: "info" | "success" | "warning" | "danger"): void;
  snapshotPreview: SnapshotPreview | null;
  setSnapshotPreview(preview: SnapshotPreview | null): void;
}
