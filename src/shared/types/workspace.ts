import { entityTypes as registryEntityTypes } from "../entityRegistry.mjs";

export const entityTypes = registryEntityTypes;

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
  /** AI公開範囲のworkspace既定（#294）。Entity・Themeが未設定のときに使う。 */
  aiVisibilityDefault?: ("m365" | "coding_agent" | "external_ai")[];
  [key: string]: unknown;
}

export interface CanonicalRootStatus {
  status: "ok" | "broken";
}

export type CanonicalRootStatusMap = Record<string, CanonicalRootStatus>;

export interface Workspace {
  meta?: WorkspaceMeta;
  /** Public resolver state only; absolute storage paths never cross this boundary. */
  canonical_root_status?: CanonicalRootStatusMap;
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
  repository_contexts?: Entity[];
  working_copies?: Entity[];
  agent_sessions?: Entity[];
  capture_entrys?: Entity[];
  tasks?: Entity[];
  work_receipts?: Entity[];
  waitings?: Entity[];
  plan_nodes?: Entity[];
  schedules?: Entity[];
  references?: Entity[];
  task_dependencies?: Entity[];
  plan_dependencies?: Entity[];
  knowledge_edges?: Entity[];
  change_events?: Entity[];
  artifacts?: Entity[];
  sketches?: Entity[];
  plan_revisions?: Entity[];
  [key: string]: Entity[] | WorkspaceMeta | undefined;
}

export interface SaveOptions {
  reason?: string;
  source?: string;
  quiet?: boolean;
  /** Noteの正本Markdownを外部変更ごと明示的に上書きする再試行。 */
  canonicalMarkdown?: "normal" | "overwrite";
}

/** #333/#336: 文書保存は対象ownerと取得時revisionを必ず伴う。 */
export type DocumentOwner =
  | { recordType: "note"; entityId: string }
  | { recordType: "resource"; entityId: string };

export interface DocumentSaveSnapshot {
  owner: Extract<DocumentOwner, { recordType: "note" }>;
  body: string;
  expectedRevision: number;
}

export type ReferenceTargetEntityType =
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

/** document:saveに同伴できる副作用は、保存対象Noteを起点にした派生Referenceだけ。 */
export interface DocumentSaveReferenceCompanion {
  action: "save";
  type: "reference";
  entity: Entity & {
    source_type: "note";
    source_id: string;
    target_type: ReferenceTargetEntityType;
    target_id: string;
    relation_type: "derived_from";
    note?: string | null;
    created_at?: string;
  };
  options?: Pick<SaveOptions, "reason" | "source">;
}

export interface DocumentSaveRequest {
  entity: Entity;
  snapshot: DocumentSaveSnapshot;
  options?: SaveOptions;
  companions?: DocumentSaveReferenceCompanion[];
}

/** canonical Note AI採用時だけdocument:saveに同伴できるApplication Command正本。 */
export interface CanonicalNoteAiCompanion {
  schema: "tasken-note-ai-companion/v1";
  noteId: string;
  commandId: string;
  proposal: Entity;
  event: Entity;
}

export interface SaveOperation {
  action: "save";
  type: EntityType;
  entity: Entity;
  options?: SaveOptions;
}

export type RawRecord = Record<string, unknown>;

export interface EntityEnvelope<T extends RawRecord = Entity> {
  type: EntityType;
  entity: T;
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
