export interface RootRelativePathRef {
  storage_root_id: string;
  relative_path: string;
}

export const SYNC_STORAGE_ROOT_ID: string;

export function safeRootRelativePath(value: unknown): string;
export function isRootRelativePathRef(value: unknown): boolean;
export function normalizeRootRelativePathRef(value: unknown): RootRelativePathRef | null;
export function rootRelativePathRef(
  absolutePath: unknown,
  root: unknown,
  storageRootId?: string,
): RootRelativePathRef | null;
export function resolveRootRelativePath(
  value: unknown,
  roots?: Record<string, string> | Map<string, string>,
): string;
export function rootRelativePathText(value: unknown): string;
