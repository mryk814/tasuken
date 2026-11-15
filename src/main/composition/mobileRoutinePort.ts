import {
  habitEntryId,
  habitProgress,
  habitScheduleLabel,
  laterPerformedOn,
  nextEntrySequence,
} from "../../shared/contracts/habit/progress.ts";
import { freeHabitEntrySequence } from "../services/habitEntryPlacement.ts";
import type { MobileRoutineActionRequest } from "../../shared/contracts/mobile/public.ts";
import type {
  MobileGatewayCorePort,
  MobileGatewayRoutineActionResult,
  MobileGatewayRoutinesRead,
} from "../gateway/mobile/public.ts";

/**
 * 続けること（Habit）の書き込みをDesktopのmainへ任せる口（#454）。
 * Desktopの記録と同じEntity（`habit_entry` / `habit`）を保存し、保存後の画面の更新は書き手（writer）が行う。
 * Desktopも常時稼働node（NASのheadless）も、同じこの口を通る（tests/core-capability-parity.test.mjs）。
 * スマホの記録は今のAPKが「1回足す」（commandIdで送り直しを見分ける）、古いAPKが「N回目にする」。
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
  /**
   * 保存後のそのHabitの数を、記録の日 [date] の数として読む（読み出し readRoutines と同じ導出）。
   * スマホは端末の写しをこの値で上書きするので、読み直しや送り直しと重なっても二重に数えない。
   */
  const countsAfter = (habitId: string, date: string) => {
    const read = readRoutines(persistence, date).habits.find((habit) => habit.habitId === habitId);
    return read
      ? {
          habitId,
          date,
          todayCount: read.todayCount,
          weekCount: read.weekCount,
          nextSequence: read.nextSequence,
        }
      : undefined;
  };
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
            let sequence = action.sequence;
            if (action.mode === "append") {
              // 「1回足す」（今のAPK）。同じ commandId で作った記録があれば、それが答え（送り直し）。
              // 消した記録も探す: 消した後に届いた送り直しで、記録を生き返らせない。
              const entries = persistence
                .list("habit_entry", true)
                .filter((entry) => text(entry.habit_id) === action.habitId);
              const sent = entries.find((entry) => entry.source_command_id === input.commandId);
              if (sent) {
                return text(sent.performed_on) === action.performedOn
                  ? {
                      ok: true,
                      commandId: input.commandId,
                      status: "no_change",
                      habit: countsAfter(action.habitId, action.performedOn),
                    }
                  : { ok: false, code: "idempotency_conflict" };
              }
              // その日の次の空いた回に入れる。PCが同じ日に記録していても、端末の1回を潰さない。
              // 消した記録と、実施日を直した記録のIDも避ける（Desktopの画面の記録と同じ所で決める）。
              sequence = freeHabitEntrySequence(persistence, action.habitId, action.performedOn);
              if (sequence > 50) return { ok: false, code: "validation_failed" };
            }
            const id = habitEntryId(action.habitId, action.performedOn, sequence);
            // 古いAPK（N回目にする）は、同じ日の同じ回は同じID。応答を失った再送は記録を増やさない。
            if (action.mode !== "append" && persistence.get("habit_entry", id, false))
              return { ok: true, commandId: input.commandId, status: "no_change" };
            writer.saveMany([
              {
                type: "habit_entry",
                entity: {
                  id,
                  habit_id: action.habitId,
                  performed_on: action.performedOn,
                  sequence,
                  recorded_at: input.issuedAt,
                  ...(action.mode === "append" ? { source_command_id: input.commandId } : {}),
                },
              },
              {
                type: "habit",
                entity: {
                  ...habit,
                  last_performed_on: laterPerformedOn(habit.last_performed_on, action.performedOn),
                },
              },
            ]);
            return {
              ok: true,
              commandId: input.commandId,
              status: "applied",
              // 古いAPK（mode なし）は受領の知らない欄を読めないので、1回足すの時だけ数を返す。
              ...(action.mode === "append"
                ? { habit: countsAfter(action.habitId, action.performedOn) }
                : {}),
            };
          },
        }
      : {}),
  };
}
