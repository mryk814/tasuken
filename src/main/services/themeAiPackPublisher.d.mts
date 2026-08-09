import type { ThemeAiPackPlan, ThemeAiPackManifest } from "../../shared/themeAiPack.mjs";

export const THEME_AI_PACK_DIRECTORY: "AI Pack";
export const THEME_AI_PACK_MANIFEST: ".tasken-ai-pack.json";
export const THEME_AI_PACK_OPERATION_SCHEMA: "tasken-ai-pack-operation/v1";

export type ThemeAiPackLocation =
  | { status: "needs_root" | "root_unavailable"; dirty: true; retryPending: true }
  | { status: "identity_conflict"; dirty: true; retryPending: false; reason: string }
  | {
      status: "ok";
      dirty: true;
      retryPending: false;
      source: string;
      themeFolder: string;
      packDirectory: string;
      createManifest: boolean;
      themeManifest: { schema: string; themeId: string; displayName: string };
    };

export interface ThemeAiPackPublishResult {
  state: "current" | "skipped" | "current_with_warning" | "failed_retryable" | "root_unavailable" | "recovery_required";
  dirty: boolean;
  retryPending: boolean;
  written: boolean;
  operationId?: string;
  manifest?: ThemeAiPackManifest & Record<string, unknown>;
  warning?: string;
  error?: string;
  rollbackError?: string;
}

export function discoverThemeAiPackLocation(input?: Record<string, unknown>): ThemeAiPackLocation;
export function ensureThemeAiPackLocation(location: ThemeAiPackLocation, options?: Record<string, unknown>): ThemeAiPackLocation;
export function inspectThemeAiPack(input: { plan: ThemeAiPackPlan; packDirectory: string; fileSystem?: unknown }): { state: "missing" | "dirty" | "current"; dirty: boolean; manifest?: ThemeAiPackManifest };
export function publishThemeAiPack(input: { plan: ThemeAiPackPlan; packDirectory: string; recoveryDirectory?: string; operationId?: string; fileSystem?: unknown }): ThemeAiPackPublishResult;
export function recoverThemeAiPackOperations(input: { recoveryDirectory: string; fileSystem?: unknown }): Array<{ operationId: string; state: string; error?: string }>;
