export const entityTypes = [
  "theme",
  "item",
  "note",
  "link",
  "view",
  "status_update",
  "source_record",
  "entity_source",
  "field_definition",
  "field_value",
  "log_entry",
  "import_batch",
  "knowledge_node",
  "ai_proposal",
  "resource",
  "project",
  "capture_entry",
  "task",
  "waiting",
  "plan_node",
  "schedule",
  "reference",
  "task_dependency",
  "plan_dependency",
  "knowledge_edge",
  "change_event",
  "artifact",
] as const;

export type EntityType = (typeof entityTypes)[number];

export interface Entity {
  id: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  version?: number;
  source?: string;
  [key: string]: unknown;
}

export interface WorkspaceMeta {
  schemaVersion?: number;
  workspaceId?: string;
  deviceId?: string;
  themeMode?: "light" | "dark";
  [key: string]: unknown;
}

export interface Workspace {
  meta?: WorkspaceMeta;
  themes?: Entity[];
  items?: Entity[];
  notes?: Entity[];
  links?: Entity[];
  resources?: Entity[];
  views?: Entity[];
  status_updates?: Entity[];
  source_records?: Entity[];
  entity_sources?: Entity[];
  field_definitions?: Entity[];
  field_values?: Entity[];
  log_entries?: Entity[];
  import_batchs?: Entity[];
  knowledge_nodes?: Entity[];
  ai_proposals?: Entity[];
  projects?: Entity[];
  capture_entrys?: Entity[];
  tasks?: Entity[];
  waitings?: Entity[];
  plan_nodes?: Entity[];
  schedules?: Entity[];
  references?: Entity[];
  task_dependencies?: Entity[];
  plan_dependencies?: Entity[];
  knowledge_edges?: Entity[];
  change_events?: Entity[];
  artifacts?: Entity[];
  plan_revisions?: Entity[];
  [key: string]: Entity[] | WorkspaceMeta | undefined;
}

export interface SaveOptions {
  reason?: string;
  source?: string;
  quiet?: boolean;
}

export interface SaveOperation {
  action: "save";
  type: EntityType;
  entity: Entity;
  options?: SaveOptions;
}

export interface SnapshotDecision {
  type: EntityType;
  id: string;
  action: "create" | "update" | "duplicate" | "ignore";
}

export interface SnapshotInspectResult {
  canceled: boolean;
  token?: string;
  manifest?: Record<string, unknown>;
  changes?: unknown[];
}
