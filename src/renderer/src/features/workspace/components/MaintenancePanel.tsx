import { useCallback, useMemo, useState } from "react";

import {
  assertIntervalDays,
  isMaintenanceDueSoon,
  maintenanceDue,
  maintenanceEntryId,
  maintenanceHistoryLabel,
  maintenanceLabel,
  nextDueFrom,
} from "../../../../../shared/contracts/maintenance/schedule.ts";
import { uuid } from "../lib/format";
import type { BaseRecord, PageProps } from "../types";
import { Button } from "./common";

/**
 * Maintenanceの最小実験（#454後半 / O単位）。
 *
 * 正本は `docs/issue-design-plan-2026-09-20.md` の「Maintenanceの最小実験」。
 * 扱うのは「対象」「すること」「前回実施日」「次の目安」だけ。
 *
 * - 次の目安は**推奨間隔からの提案**で、必ず守る締切ではない。Taskの期限違反として数えない。
 * - 前回が分からない項目は「次の目安を決める」から始める（勝手に期限超過にしない）。
 * - Todayには目安が近い項目だけを小さく出し、過去の未実施回数を積み上げない。
 * - 管理と履歴はSettingsに置く。
 */

export interface MaintenancePanelProps extends Pick<
  PageProps,
  "data" | "saveEntities" | "removeEntity" | "removeEntityQuiet" | "setToast"
> {
  /** 利用者のローカル日付（YYYY-MM-DD）。 */
  today: string;
  /** 追加・履歴・削除を出すか（Settingsの管理面だけ true）。 */
  manage?: boolean;
}

export function MaintenancePanel({
  data,
  today,
  saveEntities,
  removeEntity,
  removeEntityQuiet,
  setToast,
  manage = false,
}: MaintenancePanelProps) {
  const items = useMemo(
    () => (data.maintenances || []).filter((item) => !item.deleted_at),
    [data.maintenances],
  );
  const entries = useMemo(() => data.maintenance_entrys || [], [data.maintenance_entrys]);
  const [title, setTitle] = useState("");
  const [action, setAction] = useState("");
  const [intervalDays, setIntervalDays] = useState("30");
  const [showCreate, setShowCreate] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [performedOn, setPerformedOn] = useState<Record<string, string>>({});
  const [nextDue, setNextDue] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const entriesOf = useCallback(
    (maintenanceId: string) =>
      entries
        .filter((entry) => entry.maintenance_id === maintenanceId && !entry.deleted_at)
        .sort((a, b) => String(b.performed_on).localeCompare(String(a.performed_on))),
    [entries],
  );

  const due = (item: BaseRecord) =>
    maintenanceDue({ nextDueOn: item.next_due_on ? String(item.next_due_on) : null, today });

  const visible = items.filter((item) => (manage ? true : isMaintenanceDueSoon(due(item))));
  // 今日の面では、目安が近いものが無ければ何も出さない（未実施回数を積み上げない）。
  if (!manage && visible.length === 0) return null;

  const intervalOf = (item: BaseRecord) => {
    const value = Number(item.interval_days);
    return Number.isInteger(value) && value >= 1 ? value : 30;
  };

  const createItem = async () => {
    const target = title.trim();
    const doing = action.trim();
    if (!target || !doing) {
      setToast("対象と、することを入力してください。", "warning");
      return;
    }
    let interval: number;
    try {
      interval = assertIntervalDays(intervalDays);
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error), "warning");
      return;
    }
    setBusy(true);
    try {
      await saveEntities(
        [
          {
            action: "save",
            type: "maintenance",
            entity: {
              id: uuid(),
              title: `${target} / ${doing}`,
              target,
              action: doing,
              interval_days: interval,
              // 前回が分からない項目は「次の目安を決める」から始める。
              last_performed_on: null,
              next_due_on: null,
              started_on: today,
            },
          },
        ],
        "手入れを追加しました。",
        "main_ui",
      );
      setTitle("");
      setAction("");
      setShowCreate(false);
      setToast("追加しました。次の目安を決めてから記録できます。", "success");
    } catch (error) {
      setToast(
        `追加できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  /** 次の目安だけを決める（前回が不明な項目の入口）。 */
  const setDueOnly = async (item: BaseRecord, value: string) => {
    if (!value) {
      setToast("次の目安の日付を選んでください。", "warning");
      return;
    }
    setBusy(true);
    try {
      await saveEntities(
        [{ action: "save", type: "maintenance", entity: { ...item, next_due_on: value } }],
        "次の目安を決めました。",
        "main_ui",
      );
      setToast("次の目安を決めました。", "success");
    } catch (error) {
      setToast(
        `次の目安を保存できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * 実施を記録する。次の目安は今回の実施日から既定間隔で提案し、
   * 利用者が指定した場合はその値を保存する。戻せるよう、直前の値を記録側へ残す。
   */
  const record = async (item: BaseRecord) => {
    const performed = performedOn[String(item.id)] || today;
    const proposed = nextDueFrom(performed, intervalOf(item));
    const next = nextDue[String(item.id)] || proposed;
    const maintenanceId = String(item.id);
    setBusy(true);
    try {
      await saveEntities(
        [
          {
            action: "save",
            type: "maintenance_entry",
            entity: {
              id: maintenanceEntryId(maintenanceId, performed),
              maintenance_id: maintenanceId,
              performed_on: performed,
              next_due_on: next,
              previous_due_on: item.next_due_on ?? null,
              previous_performed_on: item.last_performed_on ?? null,
              ...(note[maintenanceId]?.trim() ? { note: note[maintenanceId].trim() } : {}),
              recorded_at: new Date().toISOString(),
            },
          },
          {
            action: "save",
            type: "maintenance",
            entity: { ...item, last_performed_on: performed, next_due_on: next },
          },
        ],
        "実施を記録しました。",
        "main_ui",
      );
      setPerformedOn((current) => ({ ...current, [maintenanceId]: "" }));
      setNextDue((current) => ({ ...current, [maintenanceId]: "" }));
      setNote((current) => ({ ...current, [maintenanceId]: "" }));
      setToast(`「${maintenanceLabel(item)}」を記録しました。次の目安は${next}です。`, "success");
    } catch (error) {
      setToast(
        `記録できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  /** 直前の記録を戻す。実施記録と次の目安の**両方**を戻す。 */
  const undoRecord = async (item: BaseRecord, entry: BaseRecord) => {
    setBusy(true);
    try {
      await removeEntityQuiet("maintenance_entry", String(entry.id));
      await saveEntities(
        [
          {
            action: "save",
            type: "maintenance",
            entity: {
              ...item,
              last_performed_on: entry.previous_performed_on ?? null,
              next_due_on: entry.previous_due_on ?? null,
            },
          },
        ],
        "記録を戻しました。",
        "main_ui",
      );
      setToast("記録と次の目安を元に戻しました。", "success");
    } catch (error) {
      setToast(
        `戻せませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel maintenance-panel" aria-labelledby="maintenance-panel-title">
      <div className="section-heading">
        <h2 id="maintenance-panel-title">手入れ</h2>
        {manage ? (
          <button
            className="text-button compact"
            type="button"
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "追加を閉じる" : "手入れを追加"}
          </button>
        ) : null}
      </div>

      {manage && showCreate ? (
        <div className="maintenance-create">
          <label>
            対象
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="エアコン"
            />
          </label>
          <label>
            すること
            <input
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="フィルターを掃除する"
            />
          </label>
          <label>
            推奨間隔（日）
            <input
              type="number"
              min={1}
              max={3650}
              value={intervalDays}
              onChange={(event) => setIntervalDays(event.target.value)}
            />
          </label>
          <Button variant="primary" compact disabled={busy} onClick={() => void createItem()}>
            追加する
          </Button>
          <p className="maintenance-note">
            次の目安は推奨間隔からの提案です。守るべき締切はTaskの期限で扱います。
          </p>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="maintenance-empty">「手入れを追加」から、対象と推奨間隔を決めて始めます。</p>
      ) : visible.length === 0 ? (
        <p className="maintenance-empty">目安が近い手入れはありません。</p>
      ) : (
        <ul className="maintenance-list">
          {visible.map((item) => {
            const maintenanceId = String(item.id);
            const dueState = due(item);
            const history = entriesOf(maintenanceId);
            const proposed = nextDueFrom(performedOn[maintenanceId] || today, intervalOf(item));
            return (
              <li className={`maintenance-row is-${dueState.state}`} key={maintenanceId}>
                <div className="maintenance-row-head">
                  <span className="maintenance-title">{maintenanceLabel(item)}</span>
                  <span className={`maintenance-due is-${dueState.state}`}>{dueState.label}</span>
                </div>
                <p className="maintenance-meta">
                  前回 {item.last_performed_on ? String(item.last_performed_on) : "不明"} ・
                  次の目安 {item.next_due_on ? String(item.next_due_on) : "未設定"} ・ 推奨間隔{" "}
                  {intervalOf(item)}日
                </p>

                {dueState.state === "unscheduled" ? (
                  <div className="maintenance-actions">
                    <label>
                      次の目安
                      <input
                        type="date"
                        value={nextDue[maintenanceId] || ""}
                        onChange={(event) =>
                          setNextDue((current) => ({
                            ...current,
                            [maintenanceId]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <Button
                      variant="primary"
                      compact
                      disabled={busy}
                      onClick={() => void setDueOnly(item, nextDue[maintenanceId] || "")}
                    >
                      次の目安を決める
                    </Button>
                  </div>
                ) : (
                  <div className="maintenance-actions">
                    <label>
                      実施日
                      <input
                        type="date"
                        value={performedOn[maintenanceId] || today}
                        onChange={(event) =>
                          setPerformedOn((current) => ({
                            ...current,
                            [maintenanceId]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      次の目安
                      <input
                        type="date"
                        value={nextDue[maintenanceId] || proposed}
                        onChange={(event) =>
                          setNextDue((current) => ({
                            ...current,
                            [maintenanceId]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="maintenance-note-field">
                      メモ
                      <input
                        value={note[maintenanceId] || ""}
                        onChange={(event) =>
                          setNote((current) => ({
                            ...current,
                            [maintenanceId]: event.target.value,
                          }))
                        }
                        placeholder="短いメモ（任意）"
                      />
                    </label>
                    <Button
                      variant="primary"
                      compact
                      disabled={busy}
                      onClick={() => void record(item)}
                    >
                      実施を記録
                    </Button>
                  </div>
                )}

                <div className="maintenance-actions">
                  <button
                    type="button"
                    className="text-button compact"
                    aria-expanded={openHistory === maintenanceId}
                    onClick={() =>
                      setOpenHistory((current) =>
                        current === maintenanceId ? null : maintenanceId,
                      )
                    }
                  >
                    履歴（{history.length}件）
                  </button>
                  {history.length > 0 ? (
                    <Button
                      variant="ghost"
                      compact
                      disabled={busy}
                      onClick={() => void undoRecord(item, history[0])}
                    >
                      直前の記録を戻す
                    </Button>
                  ) : null}
                  {manage ? (
                    <Button
                      variant="ghost"
                      compact
                      disabled={busy}
                      onClick={() =>
                        void removeEntity("maintenance", {
                          ...item,
                          title: maintenanceLabel(item),
                        })
                      }
                    >
                      削除
                    </Button>
                  ) : null}
                </div>

                {openHistory === maintenanceId ? (
                  history.length === 0 ? (
                    <p className="maintenance-empty">実施の記録はまだありません。</p>
                  ) : (
                    <ul className="maintenance-history">
                      {history.map((entry) => (
                        <li className="maintenance-history-row" key={String(entry.id)}>
                          <span className="maintenance-history-date">
                            {maintenanceHistoryLabel({
                              performedOn: String(entry.performed_on),
                              nextDueOn: entry.next_due_on ? String(entry.next_due_on) : null,
                            })}
                          </span>
                          {entry.note ? (
                            <span className="maintenance-history-note">{String(entry.note)}</span>
                          ) : null}
                          <Button
                            variant="ghost"
                            compact
                            disabled={busy}
                            onClick={() => void undoRecord(item, entry)}
                          >
                            この記録を戻す
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

      {manage && items.length > 0 ? (
        <p className="maintenance-note">
          目安を過ぎても、Taskの期限違反としては数えません。次に実施した日から新しい目安を提案します。
        </p>
      ) : null}
    </section>
  );
}
