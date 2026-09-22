/**
 * Maintenanceの最小実験の契約（#454後半 / O単位）。
 *
 * 正本は `docs/issue-design-plan-2026-09-20.md` の「Maintenanceの最小実験」。
 * 扱うのは「対象」「すること」「前回実施日」「次の目安」。
 *
 * - 次の目安は**推奨間隔から提案する目安**であり、必ず守る締切ではない。
 *   目安の超過をTaskの期限違反として数えない（数えるのはTaskのdeadlineだけ）。
 * - 前回が分からない項目を「期限超過」へ分類せず、「次の目安を決める」から始める。
 * - 過去の未実施回数を積み上げない。
 */

export const MAINTENANCE_DUE_SOON_DAYS = 7;

export type MaintenanceDueState = "unscheduled" | "upcoming" | "due_soon" | "overdue";

export interface MaintenanceDue {
  state: MaintenanceDueState;
  /** 状態の短い表示。「次の目安を決める」など。 */
  label: string;
  /** 目安までの日数。未設定ならnull。 */
  daysUntil: number | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function assertDate(value: string, label: string): string {
  if (!DATE_PATTERN.test(value)) throw new Error(`${label}はYYYY-MM-DDで指定してください。`);
  return value;
}

/** 日付だけをUTC正午で扱い、夏時間や時差の影響を受けないようにする。 */
function toDate(value: string): Date {
  assertDate(value, "日付");
  return new Date(`${value}T12:00:00.000Z`);
}

export function addDays(value: string, days: number): string {
  const date = toDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 2つの日付の差（日数）。 */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}

/**
 * 実施記録のID。同じ項目・同じ日では同じIDになるので、
 * 連打と再送で記録が増えず、同じ日の2回目も1件に畳まれる。
 */
export function maintenanceEntryId(maintenanceId: string, performedOn: string): string {
  const id = maintenanceId.trim();
  if (!id || id.length > 120) {
    throw new Error("MaintenanceのIDは1〜120文字で指定してください。");
  }
  return `maintenance-entry:${id}:${assertDate(performedOn, "実施日")}`;
}

/** 推奨間隔の範囲。0や負の間隔を受け付けない。 */
export function assertIntervalDays(value: unknown): number {
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 3_650) {
    throw new Error("推奨間隔は1〜3650日で指定してください。");
  }
  return interval;
}

/** 今回の実施日から次の目安を提案する（既定間隔）。 */
export function nextDueFrom(performedOn: string, intervalDays: unknown): string {
  return addDays(performedOn, assertIntervalDays(intervalDays));
}

/**
 * 目安の状態。次の目安が無い項目は「期限超過」ではなく**未設定**として扱う。
 */
export function maintenanceDue(input: {
  nextDueOn?: string | null;
  today: string;
  soonDays?: number;
}): MaintenanceDue {
  const nextDueOn = input.nextDueOn ? String(input.nextDueOn) : "";
  if (!nextDueOn) {
    return { state: "unscheduled", label: "次の目安を決める", daysUntil: null };
  }
  const soonDays = input.soonDays ?? MAINTENANCE_DUE_SOON_DAYS;
  const daysUntil = daysBetween(input.today, nextDueOn);
  if (daysUntil < 0)
    return { state: "overdue", label: `目安を${-daysUntil}日過ぎています`, daysUntil };
  if (daysUntil <= soonDays) {
    return {
      state: "due_soon",
      label: daysUntil === 0 ? "今日が目安" : `あと${daysUntil}日`,
      daysUntil,
    };
  }
  return { state: "upcoming", label: `${nextDueOn}ごろ`, daysUntil };
}

/** Todayへ小さく出す対象か。目安が近いものと過ぎたものだけを出す。 */
export function isMaintenanceDueSoon(due: MaintenanceDue): boolean {
  return due.state === "due_soon" || due.state === "overdue";
}

/** 表示用の短い見出し。「エアコン / フィルターを掃除する」。 */
export function maintenanceLabel(input: Record<string, unknown> | undefined): string {
  const target = String(input?.target ?? "").trim();
  const action = String(input?.action ?? "").trim();
  if (target && action) return `${target} / ${action}`;
  return target || action || "未設定";
}

/** 前回実施日と次の目安から、履歴に出す短い説明を作る。 */
export function maintenanceHistoryLabel(input: {
  performedOn: string;
  nextDueOn?: string | null;
}): string {
  const next = input.nextDueOn ? `次の目安 ${input.nextDueOn}` : "次の目安 未設定";
  return `${input.performedOn} に実施 ・ ${next}`;
}
