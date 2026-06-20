/** @deprecated Import from workspace/domain-model/compat/legacyAdapter instead */
export type {
  LegacyContext,
  LegacyConversionResult as V2ConversionResult,
  LegacyConversionResult,
  MigrationReport,
  DomainMigration as WorkspaceV2Migration,
  DomainMigration,
  MigrationOperations,
} from "../../workspace/domain-model/compat/legacyAdapter";
export {
  legacyItemToDomain as legacyItemToV2,
  legacyItemToDomain,
  legacyWorkspaceToDomainMigration as legacyWorkspaceToV2Migration,
  legacyWorkspaceToDomainMigration,
  legacyWorkspaceToDomain as legacyWorkspaceToV2,
  legacyWorkspaceToDomain,
  buildWorkspaceDomain as workspaceToV2,
  buildWorkspaceDomain,
  buildMigrationReport,
  formatMigrationReport,
  buildLegacyMigrationOperations,
  projectLegacyWorkspace as v2ToLegacyWorkspace,
  projectLegacyWorkspace,
} from "../../workspace/domain-model/compat/legacyAdapter";
