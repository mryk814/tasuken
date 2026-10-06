import {
  habitEntryId,
  habitProgress,
  habitScheduleLabel,
} from "../../shared/contracts/habit/progress.ts";
import {
  isMaintenanceDueSoon,
  maintenanceDue,
  maintenanceEntryId,
  maintenanceLabel,
  nextDueFrom,
} from "../../shared/contracts/maintenance/schedule.ts";
import type { MobileRoutineActionRequest } from "../../shared/contracts/mobile/public.ts";
import type {
  MobileGatewayCorePort,
  MobileGatewayRoutineActionResult,
  MobileGatewayRoutinesRead,
} from "../gateway/mobile/public.ts";

/**
 * 続けること（Habit）と手入れ（Maintenance）の書き込みをDesktopのmainへ任せる口（#454）。
 * Desktopの記録と同じEntity（`habit_entry` / `habit` / `maintenance_entry` / `maintenance`）を保存し、
 * 保存後のDesktop画面の更新もmain側が行う。常時稼働nodeには渡さない。
 */
export interface RoutineWriterPort {
  save(
    type: "habit" | "habit_entry" | "maintenance" | "maintenance_entry",
    entity: Record<string, unknown>,
  ): Record<string, unknown>;
}

interface RoutinePersistence {
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  list(type: string, includeDeleted?: boolean): Record<string, unknown>[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dateOrNull(value: unknown): string | null {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? raw : null;
}

function intervalOf(item: Record<string, unknown>): number | null {
  const value = Number(item.interval_days);
  return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : null;
}

/** Androidへ渡すHabitとMaintenance。Desktopの「Today」に出る範囲と同じにする。 */
export function readRoutines(
  persistence: RoutinePersistence,
  date: string,
): MobileGatewayRoutinesRead {
  const entries = persistence.list("habit_entry", false);
  const habits = persistence
    .list("habit", false)
    .filter((habit) => !habit.deleted_at && text(habit.state) !== "paused")
    .map((habit) => {
      const habitId = text(habit.id);
      // HabitPanelのhabitScheduleOfと同じ解釈。
      const kind = text(habit.schedule_kind) === "weekly" ? "weekly" : "daily";
      const target = Number(habit.weekly_target);
      const schedule = {
        kind: kind as "daily" | "weekly",
        weeklyTarget: kind === "weekly" && Number.isInteger(target) && target >= 1 ? target : null,
      };
      const progress = habitProgress({
        schedule,
        entries: entries
          .filter((entry) => text(entry.habit_id) === habitId && !entry.deleted_at)
          .map((entry) => ({
            id: text(entry.id),
            performed_on: text(entry.performed_on),
            sequence: Number(entry.sequence),
          })),
        today: date,
      });
      return {
        habitId,
        title: text(habit.title) || "続けること",
        scheduleLabel: habitScheduleLabel(schedule),
        todayCount: Math.min(progress.todayCount, 50),
        weekCount: progress.weekCount,
        weekTarget: Math.min(Math.max(progress.weekTarget, 1), 7),
        todayLabel: progress.todayLabel,
        weekLabel: progress.weekLabel,
        met: progress.met,
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title, "ja"));
  const maintenances = persistence
    .list("maintenance", false)
    .filter((item) => !item.deleted_at)
    .flatMap((item) => {
      const nextDueOn = dateOrNull(item.next_due_on);
      const due = maintenanceDue({ nextDueOn, today: date });
      if (!nextDueOn || !isMaintenanceDueSoon(due)) return [];
      return [
        {
          maintenanceId: text(item.id),
          label: maintenanceLabel(item),
          state: due.state as "due_soon" | "overdue",
          dueLabel: due.label,
          nextDueOn,
          lastPerformedOn: dateOrNull(item.last_performed_on),
          intervalDays: intervalOf(item),
        },
      ];
    })
    .sort((left, right) => left.nextDueOn.localeCompare(right.nextDueOn));
  return { date, habits: habits.slice(0, 50), maintenances: maintenances.slice(0, 50) };
}

export function createMobileRoutinePort(
  persistence: RoutinePersistence,
  writer?: RoutineWriterPort,
): Pick<MobileGatewayCorePort, "readRoutines" | "executeRoutineAction"> {
  return {
    readRoutines: (date: string) => readRoutines(persistence, date),
    ...(writer
      ? {
          executeRoutineAction(input: {
            commandId: string;
            issuedAt: string;
            action: MobileRoutineActionRequest["action"];
          }): MobileGatewayRoutineActionResult {
            const { action } = input;
            if (action.name === "RecordHabitEntry") {
              const habit = persistence.get("habit", action.habitId, false);
              if (!habit || habit.deleted_at || text(habit.state) === "paused")
                return { ok: false, code: "not_found" };
              const id = habitEntryId(action.habitId, action.performedOn, action.sequence);
              // 同じ日の同じ回は同じID。応答を失った再送は記録を増やさない。
              if (persistence.get("habit_entry", id, false))
                return {
                  ok: true,
                  commandId: input.commandId,
                  status: "no_change",
                  nextDueOn: null,
                };
              writer.save("habit_entry", {
                id,
                habit_id: action.habitId,
                performed_on: action.performedOn,
                sequence: action.sequence,
                recorded_at: input.issuedAt,
              });
              writer.save("habit", { ...habit, last_performed_on: action.performedOn });
              return { ok: true, commandId: input.commandId, status: "applied", nextDueOn: null };
            }
            const item = persistence.get("maintenance", action.maintenanceId, false);
            if (!item || item.deleted_at) return { ok: false, code: "not_found" };
            const interval = intervalOf(item);
            if (!interval) return { ok: false, code: "validation_failed" };
            const id = maintenanceEntryId(action.maintenanceId, action.performedOn);
            const existing = persistence.get("maintenance_entry", id, false);
            // 同じ日の2回目は記録を増やさない（Desktopと同じ）。
            if (existing)
              return {
                ok: true,
                commandId: input.commandId,
                status: "no_change",
                nextDueOn: dateOrNull(existing.next_due_on),
              };
            const next = nextDueFrom(action.performedOn, interval);
            writer.save("maintenance_entry", {
              id,
              maintenance_id: action.maintenanceId,
              performed_on: action.performedOn,
              next_due_on: next,
              previous_due_on: dateOrNull(item.next_due_on),
              previous_performed_on: dateOrNull(item.last_performed_on),
              recorded_at: input.issuedAt,
            });
            writer.save("maintenance", {
              ...item,
              last_performed_on: action.performedOn,
              next_due_on: next,
            });
            return { ok: true, commandId: input.commandId, status: "applied", nextDueOn: next };
          },
        }
      : {}),
  };
}
