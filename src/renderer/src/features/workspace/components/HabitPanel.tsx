import { useCallback, useMemo, useState } from "react";

import {
  habitEntryId,
  habitProgress,
  habitScheduleLabel,
  habitStateAfter,
  nextEntrySequence,
  weekRangeOf,
  type HabitScheduleKind,
} from "../../../../../shared/contracts/habit/progress.ts";
import type { BaseRecord, PageProps } from "../types";
import { uuid } from "../lib/format";
import { Button } from "./common";

/**
 * Habitの最小実験（#454後半 / O単位）。
 *
 * 正本は `docs/issue-design-plan-2026-09-20.md` の「Habitの最小実験」と `docs/habit-experiment.md`。
 * - 手動記録だけを扱い、**日付ごとのTaskを自動生成しない**。
 * - 主表示は「今日1回」「今週2/3回」。連続日数・達成率・失敗を強調する赤い表示は置かない。
 * - 実施記録のIDは組み立てで決まるので、連打と再送では増えず、同じ日の2回目は別の記録になる。
 * - Todayでは**Habitがある場合だけ**現れる（未使用の人へ空の設定案内を常設しない）。
 */

export interface HabitPanelProps extends Pick<
  PageProps,
  "data" | "saveEntities" | "removeEntity" | "setToast"
> {
  /** 利用者のローカル日付（YYYY-MM-DD）。週は月曜開始。 */
  today: string;
  /** 「続けることを追加」を常設するか（Settingsの管理面だけ true）。 */
  manage?: boolean;
}

function habitScheduleOf(habit: BaseRecord): {
  kind: HabitScheduleKind;
  weeklyTarget: number | null;
} {
  const kind = habit.schedule_kind === "weekly" ? "weekly" : "daily";
  const target = Number(habit.weekly_target);
  return {
    kind,
    weeklyTarget: kind === "weekly" && Number.isInteger(target) && target >= 1 ? target : null,
  };
}

function entriesOf(entries: readonly BaseRecord[], habitId: string): BaseRecord[] {
  return entries.filter((entry) => entry.habit_id === habitId && !entry.deleted_at);
}

function sortedEntries(entries: readonly BaseRecord[]): BaseRecord[] {
  return [...entries].sort(
    (a, b) =>
      String(b.performed_on).localeCompare(String(a.performed_on)) ||
      Number(b.sequence || 0) - Number(a.sequence || 0),
  );
}

export function HabitPanel({
  data,
  today,
  saveEntities,
  removeEntity,
  setToast,
  manage = false,
}: HabitPanelProps) {
  const habits = useMemo(
    () => (data.habits || []).filter((habit) => !habit.deleted_at),
    [data.habits],
  );
  const entries = useMemo(() => data.habit_entrys || [], [data.habit_entrys]);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<HabitScheduleKind>("daily");
  const [weeklyTarget, setWeeklyTarget] = useState("3");
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [pendingDates, setPendingDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const active = habits.filter((habit) => habit.state !== "paused");
  const paused = habits.filter((habit) => habit.state === "paused");
  const ordered = [...active, ...paused];
  // Todayでは、まだ使っていない人へ空の案内を出さない。
  if (!manage && ordered.length === 0) return null;

  const record = async (habit: BaseRecord, performedOn: string) => {
    const habitEntries = entriesOf(entries, String(habit.id));
    const sequence = nextEntrySequence(habitEntries as never, performedOn);
    const entry: BaseRecord = {
      id: habitEntryId(String(habit.id), performedOn, sequence),
      habit_id: String(habit.id),
      performed_on: performedOn,
      sequence,
      recorded_at: new Date().toISOString(),
    };
    setBusy(true);
    try {
      await saveEntities(
        [
          { action: "save", type: "habit_entry", entity: entry },
          {
            action: "save",
            type: "habit",
            entity: { ...habit, last_performed_on: performedOn },
          },
        ],
        "1回記録しました。",
        "main_ui",
      );
      setToast(
        performedOn === today
          ? `${String(habit.title || "Habit")}を1回記録しました。`
          : `${performedOn}の記録を追加しました。`,
        "success",
      );
    } catch (error) {
      setToast(
        `記録できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  const createHabit = async () => {
    const value = title.trim();
    if (!value) {
      setToast("続けることの名前を入力してください。", "warning");
      return;
    }
    const target = Number(weeklyTarget);
    if (kind === "weekly" && (!Number.isInteger(target) || target < 1 || target > 7)) {
      setToast("週の目標は1〜7で入力してください。", "warning");
      return;
    }
    setBusy(true);
    try {
      await saveEntities(
        [
          {
            action: "save",
            type: "habit",
            entity: {
              id: uuid(),
              title: value,
              schedule_kind: kind,
              ...(kind === "weekly" ? { weekly_target: target } : {}),
              state: "active",
              started_on: today,
            },
          },
        ],
        "続けることを追加しました。",
        "main_ui",
      );
      setTitle("");
      setShowCreate(false);
      setToast("追加しました。Todayで1回記録できます。", "success");
    } catch (error) {
      setToast(
        `追加できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  /** 実施日の修正は記録を作り直さず、同じIDのまま日付と修正時刻だけを更新する。 */
  const correctPerformedOn = async (entry: BaseRecord, performedOn: string) => {
    setBusy(true);
    try {
      await saveEntities(
        [
          {
            action: "save",
            type: "habit_entry",
            entity: { ...entry, performed_on: performedOn, corrected_at: new Date().toISOString() },
          },
        ],
        "実施日を修正しました。",
        "main_ui",
      );
      setToast("実施日を修正しました。", "success");
    } catch (error) {
      setToast(
        `実施日を修正できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  const changeState = async (habit: BaseRecord, action: "pause" | "resume") => {
    const next = habitStateAfter({
      state: String(habit.state || "active"),
      action,
      at: new Date().toISOString(),
    });
    setBusy(true);
    try {
      await saveEntities(
        [{ action: "save", type: "habit", entity: { ...habit, ...next } }],
        action === "pause" ? "一時停止しました。" : "再開しました。",
        "main_ui",
      );
      setToast(action === "pause" ? "一時停止しました。" : "再開しました。", "success");
    } catch (error) {
      setToast(
        `${action === "pause" ? "一時停止" : "再開"}できませんでした。${
          error instanceof Error ? error.message : String(error)
        }`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel habit-panel" aria-labelledby="habit-panel-title">
      <div className="section-heading">
        <h2 id="habit-panel-title">続けること</h2>
        {manage ? (
          <button
            className="text-button compact"
            type="button"
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "追加を閉じる" : "続けることを追加"}
          </button>
        ) : null}
      </div>

      {manage && showCreate ? (
        <div className="habit-create">
          <label>
            名前
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="読書、運動など"
            />
          </label>
          <label>
            目標
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value === "weekly" ? "weekly" : "daily")}
            >
              <option value="daily">毎日1回</option>
              <option value="weekly">週N回</option>
            </select>
          </label>
          {kind === "weekly" ? (
            <label>
              週の回数
              <input
                type="number"
                min={1}
                max={7}
                value={weeklyTarget}
                onChange={(event) => setWeeklyTarget(event.target.value)}
              />
            </label>
          ) : null}
          <Button variant="primary" compact disabled={busy} onClick={() => void createHabit()}>
            追加する
          </Button>
          <p className="habit-note">週の区切りは月曜開始です。Taskは作りません。</p>
        </div>
      ) : null}

      {ordered.length === 0 ? (
        <p className="habit-empty">「続けることを追加」から、毎日1回か週N回の記録を試せます。</p>
      ) : (
        <ul className="habit-list">
          {ordered.map((habit) => {
            const schedule = habitScheduleOf(habit);
            const habitEntries = entriesOf(entries, String(habit.id));
            const progress = habitProgress({ schedule, entries: habitEntries as never, today });
            const listed = sortedEntries(habitEntries);
            const last = listed[0] || null;
            const pausedNow = habit.state === "paused";
            const week = weekRangeOf(today);
            return (
              <li className="habit-row" key={String(habit.id)}>
                <div className="habit-row-head">
                  <span className="habit-title">{String(habit.title || "無題")}</span>
                  <span className="habit-schedule">{habitScheduleLabel(schedule)}</span>
                  {pausedNow ? <span className="habit-state">一時停止中</span> : null}
                </div>
                <p className="habit-progress">
                  {progress.todayLabel} ・ {progress.weekLabel}
                  <span className="habit-week-range">
                    （{week.start}〜{week.end}）
                  </span>
                </p>
                {last ? (
                  <p className="habit-last">
                    {String(last.performed_on)} に記録
                    {last.corrected_at ? "（実施日を修正済み）" : ""}
                  </p>
                ) : (
                  <p className="habit-last">まだ記録はありません。</p>
                )}
                <div className="habit-actions">
                  {pausedNow ? (
                    <Button
                      variant="secondary"
                      compact
                      disabled={busy}
                      onClick={() => void changeState(habit, "resume")}
                    >
                      再開
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="primary"
                        compact
                        disabled={busy}
                        onClick={() => void record(habit, today)}
                      >
                        {progress.todayCount === 0 ? "1回記録" : "もう1回記録"}
                      </Button>
                      {last && String(last.performed_on) === today ? (
                        <Button
                          variant="ghost"
                          compact
                          disabled={busy}
                          onClick={() =>
                            void removeEntity("habit_entry", {
                              ...last,
                              // 削除のトーストで「無題」と出さない（Entity名を持たない記録のため）。
                              title: `${String(habit.title || "Habit")}の記録`,
                            })
                          }
                        >
                          直前の記録を取り消す
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        compact
                        disabled={busy}
                        onClick={() => void changeState(habit, "pause")}
                      >
                        一時停止
                      </Button>
                    </>
                  )}
                  <button
                    type="button"
                    className="text-button compact"
                    aria-expanded={openHistory === String(habit.id)}
                    onClick={() =>
                      setOpenHistory((current) =>
                        current === String(habit.id) ? null : String(habit.id),
                      )
                    }
                  >
                    履歴（{listed.length}件）
                  </button>
                  {manage ? (
                    <Button
                      variant="ghost"
                      compact
                      disabled={busy}
                      onClick={() => void removeEntity("habit", { id: String(habit.id) })}
                    >
                      削除
                    </Button>
                  ) : null}
                </div>
                {openHistory === String(habit.id) ? (
                  listed.length === 0 ? (
                    <p className="habit-empty">過去の記録はありません。</p>
                  ) : (
                    <ul className="habit-history">
                      {listed.map((entry) => (
                        <li className="habit-history-row" key={String(entry.id)}>
                          <span className="habit-history-date">{String(entry.performed_on)}</span>
                          <span className="habit-history-sequence">
                            {Number(entry.sequence || 1)}回目
                          </span>
                          <input
                            type="date"
                            aria-label="実施日"
                            value={pendingDates[String(entry.id)] ?? String(entry.performed_on)}
                            onChange={(event) =>
                              setPendingDates((current) => ({
                                ...current,
                                [String(entry.id)]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            variant="ghost"
                            compact
                            disabled={busy}
                            onClick={() =>
                              void correctPerformedOn(
                                entry,
                                pendingDates[String(entry.id)] ?? String(entry.performed_on),
                              )
                            }
                          >
                            実施日を修正
                          </Button>
                          <Button
                            variant="ghost"
                            compact
                            disabled={busy}
                            onClick={() =>
                              void removeEntity("habit_entry", {
                                ...entry,
                                title: `${String(habit.title || "Habit")}の記録`,
                              })
                            }
                          >
                            取消
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
