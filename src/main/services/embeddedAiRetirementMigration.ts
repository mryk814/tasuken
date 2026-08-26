import fs from "node:fs";
import path from "node:path";

export const EMBEDDED_AI_RETIREMENT_MIGRATION_VERSION = 1 as const;

export interface EmbeddedAiRetirementMigrationResult {
  version: typeof EMBEDDED_AI_RETIREMENT_MIGRATION_VERSION;
  credentialConfigRemoved: boolean;
}

export function applyEmbeddedAiRetirementMigration(
  userDataPath: string,
): EmbeddedAiRetirementMigrationResult {
  const configPath = path.join(userDataPath, "ai-provider.json");
  const credentialConfigRemoved = fs.existsSync(configPath);
  fs.rmSync(configPath, { force: true });
  return {
    version: EMBEDDED_AI_RETIREMENT_MIGRATION_VERSION,
    credentialConfigRemoved,
  };
}
