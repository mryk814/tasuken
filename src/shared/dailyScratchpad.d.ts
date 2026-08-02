export const DAILY_SCRATCHPAD_ROLE: "daily_scratchpad";

export interface DailyScratchpadRecord {
  id: string;
  title?: unknown;
  body_markdown?: unknown;
  updated_at?: unknown;
  properties_json?: unknown;
  [key: string]: unknown;
}

export function dailyScratchpadProperties(record: DailyScratchpadRecord | null | undefined): Record<string, unknown>;
export function dailyScratchpadDate(record: DailyScratchpadRecord | null | undefined): string;
export function isDailyScratchpad(record: DailyScratchpadRecord | null | undefined): boolean;
export function dailyScratchpadTitle(date: string): string;
export function dailyScratchpadDraftKey(date: string): string;
export function filterDailyScratchpads<T extends DailyScratchpadRecord>(records: T[], query?: string): T[];
