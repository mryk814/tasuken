export type RegistryEntityType =
  | "theme" | "item" | "note" | "link" | "view" | "status_update"
  | "source_record" | "entity_source" | "field_definition" | "field_value"
  | "log_entry" | "import_batch" | "knowledge_node" | "ai_proposal" | "resource"
  | "project" | "capture_entry" | "task" | "waiting" | "plan_node" | "schedule"
  | "reference" | "task_dependency" | "plan_dependency" | "knowledge_edge"
  | "change_event" | "artifact" | "sketch";

export const entityTypes: readonly RegistryEntityType[];
export const entityDefinitions: readonly Record<string, unknown>[];
export function collectionKeyForEntityType(type: RegistryEntityType): string;
export function themeFieldForEntityType(type: RegistryEntityType): string | null;
export function legacyThemeFieldsForEntityType(type: RegistryEntityType): readonly string[];
export function requiredFieldsForEntityType(type: RegistryEntityType): readonly string[];
export function assertEntityType(type: string): RegistryEntityType;
export function assertEntityPayload(type: RegistryEntityType, payload: unknown): Record<string, unknown>;
export function assertEntityEnvelope(envelope: unknown): Record<string, unknown>;
