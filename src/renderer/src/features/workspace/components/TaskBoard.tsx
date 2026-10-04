import { useRef, useState } from "react";
import type { Task, Schedule } from "../domain-model/types";
import type { SaveOperation } from "../../../../../shared/types/workspace";
import { TASK_STATE_LABELS } from "../domain-model/labels";
import { buildSaveTaskOperations } from "../domain-model/persistence";
import { buildCompleteTaskOperations } from "../domain-model/taskRecurrence";
import { taskNextTurn, taskWorkModel } from "./TaskBoardModel";
import { AiCreationMark } from "./AiCreationMark";
import "./TaskBoard.css";

export function TaskBoard({
  rows,
  proposals,
  receipts,
  saveEntities,
  setToast,
  onOpen,
}: {
  rows: { task: Task; schedule?: Schedule }[];
  proposals: readonly unknown[];
  receipts: readonly unknown[];
  saveEntities(operations: SaveOperation[], message?: string): Promise<unknown>;
  setToast(message: string, tone?: "info" | "success" | "warning" | "danger"): void;
  onOpen(task: Task, schedule?: Schedule): void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function changeState(task: Task, schedule: Schedule | undefined, state: Task["state"]) {
    if (lock.current || state === task.state) return;
    lock.current = true;
    setBusy(true);
    try {
      const operations =
        state === "done"
          ? buildCompleteTaskOperations(task, schedule)
          : buildSaveTaskOperations({ ...task, state, completed_at: null });
      await saveEntities(operations, `「${task.title}」を${TASK_STATE_LABELS[state]}にしました。`);
    } catch (error) {
      setToast(
        `状態を保存できませんでした。再試行してください。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="task-board" aria-label="Task状態別ボード" aria-busy={busy}>
      {Object.entries(TASK_STATE_LABELS).map(([state, label]) => {
        const column = rows.filter(({ task }) => task.state === state);
        return (
          <section className={`task-board-column state-${state}`} key={state} aria-label={label}>
            <h2>
              {label} <span>{column.length}</span>
            </h2>
            {column.length === 0 && <p className="field-help">この状態のTaskはありません</p>}
            {column.map(({ task, schedule }) => {
              const model = taskWorkModel(task, proposals, receipts);
              const canComplete =
                task.intended_executor !== "ai_agent" || task.work_state === "accepted";
              return (
                <article className="task-board-card" key={task.id}>
                  <div className="ai-origin-heading">
                    <button
                      type="button"
                      className="task-board-title"
                      onClick={() => onOpen(task, schedule)}
                    >
                      {task.title}
                    </button>
                    <AiCreationMark entity={task} />
                  </div>
                  <p>{taskNextTurn(task, model)}</p>
                  {schedule?.end_date && (
                    <time dateTime={schedule.end_date}>予定終了 {schedule.end_date}</time>
                  )}
                  <label>
                    Task状態
                    <select
                      aria-label={`${task.title}のTask状態`}
                      value={task.state}
                      disabled={busy}
                      onChange={(event) =>
                        void changeState(task, schedule, event.target.value as Task["state"])
                      }
                    >
                      {Object.entries(TASK_STATE_LABELS).map(([value, name]) => (
                        <option
                          key={value}
                          value={value}
                          disabled={value === "done" && !canComplete}
                        >
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!canComplete && <small>Task完了は報告採用後に選べます</small>}
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
