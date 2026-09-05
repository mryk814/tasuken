export interface ActivityAutoExportState {
  now: Date;
  time: unknown;
  directory: unknown;
  lastExportDate: unknown;
  /** Pass an empty string to enable next-day finalization before its first success. */
  lastFinalizedDate?: unknown;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDateAndTime(now: Date): { date: string; time: string } {
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

function parseDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null;
  return { year, month, day };
}

function addDateDays(value: string, days: number): string {
  const parsed = parseDate(value);
  if (!parsed) return "";
  const date = new Date(parsed.year, parsed.month - 1, parsed.day + days);
  return localDateAndTime(date).date;
}

export function activityDatesToAutoExport(state: ActivityAutoExportState): string[] {
  const time = typeof state.time === "string" ? state.time : "";
  const directory = typeof state.directory === "string" ? state.directory.trim() : "";
  const lastExportDate = typeof state.lastExportDate === "string" ? state.lastExportDate : "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !directory) return [];
  const current = localDateAndTime(state.now);
  if (state.lastFinalizedDate !== undefined) {
    const yesterday = addDateDays(current.date, -1);
    const finalized = parseDate(state.lastFinalizedDate) ? String(state.lastFinalizedDate) : "";
    const previousExport = parseDate(lastExportDate) ? lastExportDate : "";
    // Existing installations revisit their last provisional report on upgrade.
    let date = finalized
      ? addDateDays(finalized, 1)
      : previousExport && previousExport <= yesterday
        ? previousExport
        : yesterday;
    const targets: string[] = [];
    while (date && date <= yesterday) {
      targets.push(date);
      date = addDateDays(date, 1);
    }
    if (current.time >= time && (!previousExport || previousExport < current.date)) {
      targets.push(current.date);
    }
    return targets;
  }
  const latestEligibleDate = current.time >= time ? current.date : addDateDays(current.date, -1);
  if (!latestEligibleDate) return [];

  const validLastDate = parseDate(lastExportDate) ? lastExportDate : "";
  if (validLastDate && validLastDate >= latestEligibleDate) return [];
  let date = validLastDate ? addDateDays(validLastDate, 1) : latestEligibleDate;
  const targets: string[] = [];
  while (date && date <= latestEligibleDate) {
    targets.push(date);
    date = addDateDays(date, 1);
  }
  return targets;
}

export async function runActivityAutoExport({
  dates,
  exportDate,
  markExported,
  finalization,
}: {
  dates: string[];
  exportDate: (date: string) => Promise<void>;
  markExported: (date: string) => Promise<void>;
  finalization?: {
    today: string;
    markFinalized: (date: string) => Promise<void>;
  };
}): Promise<string[]> {
  const completed: string[] = [];
  for (const date of dates) {
    await exportDate(date);
    if (finalization && date < finalization.today) {
      await finalization.markFinalized(date);
    } else {
      await markExported(date);
    }
    completed.push(date);
  }
  return completed;
}
