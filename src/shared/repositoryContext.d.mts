export type RepositoryProvider = "github" | "gitlab" | "azure_devops" | "local" | "generic_git" | "unknown";
export type RepositoryContextMode = "inherit" | "extend" | "override";

export interface CanonicalRepositoryUrl {
  canonicalUrl: string;
  canonicalIdentity: string;
  host: string;
  provider: RepositoryProvider;
  repositorySlug: string;
  owner: string | null;
  name: string;
  transport: string;
}

export interface RepositoryContext {
  id: string;
  label: string;
  provider: RepositoryProvider;
  canonical_url: string | null;
  canonical_identity: string | null;
  web_url: string | null;
  local_path: string | null;
  repository_slug: string | null;
  owner: string | null;
  name: string | null;
  remote_aliases: string[];
  repository_root_hint: string | null;
  default_branch: string | null;
  subdirectory: string | null;
  active: boolean;
  metadata: Record<string, unknown>;
  [key: string]: unknown;
}

export const REPOSITORY_PROVIDERS: readonly RepositoryProvider[];
export const REPOSITORY_CONTEXT_MODES: readonly RepositoryContextMode[];
export function canonicalizeRepositoryUrl(value: unknown): CanonicalRepositoryUrl | null;
export const canonicalizeRemoteUrl: typeof canonicalizeRepositoryUrl;
export function normalizeLocalRepositoryPath(value: unknown): string | null;
export function normalizeRepositorySubdirectory(value: unknown): string | null;
export function normalizeRepositoryMetadata(value: unknown): Record<string, unknown>;
export function normalizeRepositoryContext(input?: Record<string, unknown>): Record<string, unknown>;
export function normalizeRepositoryLinkFields(type: string, input?: Record<string, unknown>): Record<string, unknown>;
export function resolveThemeRepositoryContexts(theme: Record<string, unknown> | null | undefined, contexts?: Record<string, unknown>[]): Record<string, unknown>;
export function resolveTaskRepositoryContexts(options?: { task?: Record<string, unknown>; theme?: Record<string, unknown> | null; contexts?: Record<string, unknown>[] }): Record<string, unknown>;
export function resolveRepositoryContext(options?: { current?: Record<string, unknown>; contexts?: Record<string, unknown>[] }): Record<string, unknown>;
export function findThemesForRepository(options?: { current?: Record<string, unknown>; contexts?: Record<string, unknown>[]; themes?: Record<string, unknown>[] }): Record<string, unknown>;
export function findTasksForRepository(options?: { current?: Record<string, unknown>; contexts?: Record<string, unknown>[]; themes?: Record<string, unknown>[]; tasks?: Record<string, unknown>[] }): Record<string, unknown>;
export function publicRepositoryContext(context: Record<string, unknown> | null | undefined): Record<string, unknown> | null;
