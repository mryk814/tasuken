export type RegistryEntityType =
  | "theme" | "item" | "note" | "link" | "view" | "status_update"
  | "source_record" | "entity_source" | "field_definition" | "field_value"
  | "log_entry" | "import_batch" | "knowledge_node" | "ai_proposal" | "resource"
  | "project" | "repository_context" | "capture_entry" | "task" | "waiting" | "plan_node" | "schedule"
  | "reference" | "task_dependency" | "plan_dependency" | "knowledge_edge"
  | "change_event" | "work_receipt" | "artifact" | "sketch";

export const entityTypes: readonly RegistryEntityType[];
export const referenceTargetEntityTypes: readonly Exclude<RegistryEntityType, "theme" | "item" | "link" | "view" | "status_update" | "source_record" | "entity_source" | "field_definition" | "field_value" | "log_entry" | "import_batch" | "ai_proposal" | "repository_context" | "schedule" | "reference" | "task_dependency" | "plan_dependency" | "knowledge_edge" | "change_event" | "work_receipt">[];
export const referenceRelationTypes: readonly ["related_to", "derived_from", "mentions", "blocks", "supports"];
export interface EntityDefinition {
  readonly type: RegistryEntityType;
  readonly collectionKey: string;
  readonly domainCollectionKey: string | null;
  readonly themePolicy: "none" | "optional" | "required";
  readonly themeField: string | null;
  readonly parseCreate(payload: unknown): Record<string, unknown>;
  readonly parseUpdate(payload: unknown): Record<string, unknown>;
}
export const entityDefinitions: readonly EntityDefinition[];
export function entityDefinition(type: RegistryEntityType): EntityDefinition;
export function collectionKeyForEntityType(type: RegistryEntityType): string;
export function domainCollectionKeyForEntityType(type: string): string | null;
export function themeFieldForEntityType(type: RegistryEntityType): string | null;
export function legacyThemeFieldsForEntityType(type: RegistryEntityType): readonly string[];
export function requiredFieldsForEntityType(type: RegistryEntityType): readonly string[];
export function assertEntityType(type: string): RegistryEntityType;
export function assertEntityPayload(type: RegistryEntityType, payload: unknown): Record<string, unknown>;
export function assertEntityEnvelope(envelope: unknown): Record<string, unknown>;
