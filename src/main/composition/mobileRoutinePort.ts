import {
  habitEntryId,
  habitProgress,
  habitScheduleLabel,
  nextEntrySequence,
} from "../../shared/contracts/habit/progress.ts";
import type { MobileRoutineActionRequest } from "../../shared/contracts/mobile/public.ts";
import type {
  MobileGatewayCorePort,
  MobileGatewayRoutineActionResult,
  MobileGatewayRoutinesRead,
} from "../gateway/mobile/public.ts";

/**
 * 続けること（Habit）の書き込みをDesktopのmainへ任せる口（#454）。
 * Desktopの記録と同じEntity（`habit_entry` / `habit`）を保存し、
 * 保存後のDesktop画面の更新もmain側が行う。常時稼働nodeには渡さない。
 * 手入れ（Maintenance）の読み出しと記録は #755 束9b で外した（記録は読むだけで残る）。
 */
export interface RoutineWriterPort {
  saveMany(
    operations: {
      type: "habit" | "habit_entry";
      entity: Record<string, unknown>;
    }[],
  ): Record<string, unknown>[];
}

interface RoutinePersistence {
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  list(type: string, includeDeleted?: boolean): Record<string, unknown>[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Androidへ渡すHabit。Desktopの「Today」に出る範囲と同じにする。 */
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
      const habitEntries = entries
        .filter((entry) => text(entry.habit_id) === habitId && !entry.deleted_at)
        .map((entry) => ({
          id: text(entry.id),
          performed_on: text(entry.performed_on),
          sequence: Number(entry.sequence),
        }));
      const sequence = nextEntrySequence(habitEntries, date);
      const progress = habitProgress({
        schedule,
        entries: habitEntries,
        today: date,
      });
      return {
        habitId,
        title: text(habit.title) || "続けること",
        scheduleLabel: habitScheduleLabel(schedule),
        todayCount: Math.min(progress.todayCount, 50),
        nextSequence: sequence <= 50 ? sequence : null,
        weekCount: progress.weekCount,
        weekTarget: Math.min(Math.max(progress.weekTarget, 1), 7),
        todayLabel: progress.todayLabel,
        weekLabel: progress.weekLabel,
        met: progress.met,
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title, "ja"));
  return { date, habits: habits.slice(0, 50) };
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
            const habit = persistence.get("habit", action.habitId, false);
            if (!habit || habit.deleted_at || text(habit.state) === "paused")
              return { ok: false, code: "not_found" };
            const id = habitEntryId(action.habitId, action.performedOn, action.sequence);
            // 同じ日の同じ回は同じID。応答を失った再送は記録を増やさない。
            if (persistence.get("habit_entry", id, false))
              return { ok: true, commandId: input.commandId, status: "no_change" };
            writer.saveMany([
              {
                type: "habit_entry",
                entity: {
                  id,
                  habit_id: action.habitId,
                  performed_on: action.performedOn,
                  sequence: action.sequence,
                  recorded_at: input.issuedAt,
                },
              },
              { type: "habit", entity: { ...habit, last_performed_on: action.performedOn } },
            ]);
            return { ok: true, commandId: input.commandId, status: "applied" };
          },
        }
      : {}),
  };
}
