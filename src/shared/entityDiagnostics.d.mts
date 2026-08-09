export type EntityDiagnostic = Record<string, unknown>;
export function diagnoseWorkspaceRawRecord(workspace: Record<string, unknown>, options?: { knownThemeIds?: string[] }): { issues: EntityDiagnostic[]; hasErrors: boolean };
export function diagnoseCollectionKey(collectionKey: string): { type: string | null; collectionKey: string };
