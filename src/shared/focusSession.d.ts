export const FOCUS_SESSION_ROLE: "focus_session";
export function focusSessionProperties(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown>;
export function isFocusSession(record: Record<string, unknown> | null | undefined): boolean;
export function isActiveFocusSession(record: Record<string, unknown> | null | undefined): boolean;
export function isPausedFocusSession(record: Record<string, unknown> | null | undefined): boolean;
export function focusSessionElapsedMs(
  record: Record<string, unknown> | null | undefined,
  now: number,
): number;
export function pauseFocusSessionProperties(
  properties: Record<string, unknown>,
  at: string,
): Record<string, unknown>;
export function resumeFocusSessionProperties(
  properties: Record<string, unknown>,
  at: string,
): Record<string, unknown>;
export function focusSessionTaskId(record: Record<string, unknown> | null | undefined): string;
export function findActiveFocusSession<T extends Record<string, unknown>>(records: T[]): T | null;
export function focusSessionDraftKey(sessionId: string): string;
export function focusDocumentDraftKey(noteId: string): string;
