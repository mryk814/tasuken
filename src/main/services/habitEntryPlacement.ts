import { habitEntryId, nextFreeEntrySequence } from "../../shared/contracts/habit/progress.ts";

/**
 * 続けることの記録を新しく作る時の置き場所（回）を、Main で決める所。
 * Desktop の画面の記録（IPC の保存）と、スマホの「1回足す」（mobileRoutinePort）が同じ決め方を通る。
 * 画面には消した記録（墓標）が届かないので、墓標の ID を避けるのは墓標を読める Main だけができる。
 * 汎用の保存（saveWithinTransaction）には入れない: 元に戻す（restore）や同期の取り込みは、同じ ID のまま扱う。
 */

interface HabitEntryReader {
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  list(type: string, includeDeleted?: boolean): Record<string, unknown>[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** その Habit・その日に新しく足す回。消した記録と、実施日を直した記録の ID も避ける。50 を越えたら 51。 */
export function freeHabitEntrySequence(
  persistence: HabitEntryReader,
  habitId: string,
  performedOn: string,
): number {
  const entries = persistence
    .list("habit_entry", true)
    .filter((entry) => text(entry.habit_id) === habitId)
    .map((entry) => ({
      id: text(entry.id),
      performed_on: text(entry.performed_on),
      sequence: Number(entry.sequence),
    }));
  return nextFreeEntrySequence(entries, habitId, performedOn);
}

/**
 * 画面が作ろうとする記録の ID が、消した記録（墓標）と同じなら、次の空いた回へずらした形を返す。
 * 墓標を同じ ID で上書きすると、消した記録の元へ戻せなくなるため。
 * 生きている記録と同じ ID（実施日の修正など、既にある記録の書き換え）と、新しい ID はそのまま返す。
 */
export function placeNewHabitEntry(
  persistence: HabitEntryReader,
  entity: Record<string, unknown>,
): Record<string, unknown> {
  const id = text(entity.id);
  const stored = id ? persistence.get("habit_entry", id, true) : null;
  if (!stored?.deleted_at) return entity;
  const habitId = text(entity.habit_id);
  const performedOn = text(entity.performed_on);
  const sequence = freeHabitEntrySequence(persistence, habitId, performedOn);
  if (sequence > 50) throw new Error("この日はこれ以上記録できません。");
  return { ...entity, id: habitEntryId(habitId, performedOn, sequence), sequence };
}
