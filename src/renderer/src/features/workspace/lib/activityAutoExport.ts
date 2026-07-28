export interface ActivityAutoExportState {
  now: Date;
  time: unknown;
  directory: unknown;
  lastExportDate: unknown;
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

export function shouldAutoExportActivityLog(state: ActivityAutoExportState): boolean {
  const time = typeof state.time === "string" ? state.time : "";
  const directory = typeof state.directory === "string" ? state.directory.trim() : "";
  const lastExportDate = typeof state.lastExportDate === "string" ? state.lastExportDate : "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !directory) return false;
  const current = localDateAndTime(state.now);
  return current.time >= time && lastExportDate !== current.date;
}
