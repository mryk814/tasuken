import { useEffect, useRef, useState } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconGripVertical,
  IconPlus,
} from "@tabler/icons-react";
import type { Task, Schedule } from "../domain-model/types";
import type { SaveEntities } from "../types";
import { TASK_STATE_LABELS } from "../domain-model/labels";
import { buildSaveTaskOperations } from "../domain-model/persistence";
import { buildCompleteTaskOperations } from "../domain-model/taskRecurrence";
import {
  moveBoardTask,
  sortBoardRows,
  taskNextTurn,
  taskWorkModel,
  type BoardRow,
} from "./TaskBoardModel";
import { AiCreationMark } from "./AiCreationMark";
import { AgentLaunchButton } from "./AgentLaunchButton";
import "./TaskBoard.css";

const STATES: Task["state"][] = ["todo", "doing", "review", "waiting", "done", "cancelled"];

export function TaskBoard({
  rows,
  allRows,
  themes,
  defaultThemeId,
  showTerminal,
  proposals,
  receipts,
  saveEntities,
  setToast,
  onOpen,
}: {
  rows: BoardRow[];
  allRows: BoardRow[];
  themes: { id: string; name: string }[];
  defaultThemeId: string;
  showTerminal: boolean;
  proposals: readonly unknown[];
  receipts: readonly unknown[];
  saveEntities: SaveEntities;
  setToast(message: string, tone?: "info" | "success" | "warning" | "danger"): void;
  onOpen(task: Task, schedule?: Schedule): void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef<{ taskId: string; action: string } | null>(null);
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [adding, setAdding] = useState<Task["state"] | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (busy || !moveFocus.current) return;
    const { taskId, action } = moveFocus.current;
    moveFocus.current = null;
    const card = boardRef.current?.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(taskId)}"]`,
    );
    const control =
      card?.querySelector<HTMLElement>(`[data-board-action="${action}"]:not(:disabled)`) ||
      card?.querySelector<HTMLElement>(".task-board-title") ||
      boardRef.current;
    control?.focus({ preventScroll: true });
  }, [busy, rows]);

  async function move(taskId: string, state: Task["state"], beforeId?: string) {
    if (lock.current) return;
    const action = (document.activeElement as HTMLElement | null)?.dataset.boardAction;
    if (action) moveFocus.current = { taskId, action };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const updates = moveBoardTask(allRows, taskId, state, beforeId);
      if (!updates.length) return;
      const source = allRows.find(({ task }) => task.id === taskId)!;
      const operations = updates.flatMap((task) =>
        task.id === taskId && state === "done" && source.task.state !== "done"
          ? buildCompleteTaskOperations({ ...task, state: source.task.state }, source.schedule)
          : buildSaveTaskOperations(task, { reason: "board_task_moved" }),
      );
      await saveEntities(
        operations,
        source.task.state === state
          ? "順序を保存しました。"
          : `「${source.task.title}」を${TASK_STATE_LABELS[state]}にしました。`,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`移動を保存できませんでした。${message}`);
      setToast("移動できませんでした。ボードの案内を確認してください。", "danger");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function addTask(state: Task["state"]) {
    if (lock.current || !title.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await saveEntities(
        buildSaveTaskOperations({
          id: crypto.randomUUID(),
          title: title.trim(),
          state,
          priority: "normal",
          project_id: defaultThemeId,
        }),
        "タスクを追加しました。",
      );
      setTitle("");
      setAdding(null);
    } catch (cause) {
      setError(`追加できませんでした。${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function drop(state: Task["state"], beforeId?: string) {
    if (dragId) void move(dragId, state, beforeId);
    setDragId(null);
    setDropTarget("");
  }

  return (
    <>
      <div className="task-board-help">
        <span>上から取り組む順序 · ハンドルをドラッグして移動</span>
        <span role="status">
          {busy
            ? "保存中…"
            : `進行中 ${rows.filter(({ task }) => task.state === "doing").length}件`}
        </span>
      </div>
      {error && (
        <p className="task-board-error" role="alert">
          {error}
        </p>
      )}
      <div
        ref={boardRef}
        tabIndex={-1}
        className="task-board"
        aria-label="Task状態別ボード"
        aria-busy={busy}
      >
        {STATES.filter((state) => !showTerminal || state === "done" || state === "cancelled").map(
          (state) => {
            const label = TASK_STATE_LABELS[state];
            const column = sortBoardRows(rows.filter(({ task }) => task.state === state));
            const terminal = state === "done" || state === "cancelled";
            const collapsed = terminal && !showTerminal && !expanded.includes(state);
            return (
              <section
                className={`task-board-column state-${state}${collapsed ? " is-collapsed" : ""}${dropTarget === state ? " is-drop-target" : ""}`}
                key={state}
                aria-label={label}
                onDragOver={(event) => {
                  if (dragId && !busy) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTarget(state);
                  }
                }}
                onDrop={(event) => {
                  if (dragId) {
                    event.preventDefault();
                    drop(state);
                  }
                }}
              >
                <h2>
                  {terminal ? (
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={() =>
                        setExpanded((current) =>
                          current.includes(state)
                            ? current.filter((value) => value !== state)
                            : [...current, state],
                        )
                      }
                      disabled={showTerminal}
                    >
                      {collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                      {label}
                    </button>
                  ) : (
                    <span>{label}</span>
                  )}
                  <span className="task-board-count">{column.length}</span>
                  {!terminal && (
                    <button
                      type="button"
                      className="task-board-icon"
                      aria-label={`${label}にタスクを追加`}
                      title="タスクを追加"
                      disabled={busy}
                      onClick={() => {
                        setAdding(state);
                        setError("");
                      }}
                    >
                      <IconPlus size={16} />
                    </button>
                  )}
                </h2>
                {!collapsed && (
                  <div className="task-board-cards">
                    {column.length === 0 && adding !== state && (
                      <p className="task-board-empty">
                        {dragId ? "ここへ移動" : "タスクはありません"}
                      </p>
                    )}
                    {column.map(({ task, schedule }, index) => {
                      const model = taskWorkModel(task, proposals, receipts);
                      const canComplete =
                        task.intended_executor !== "ai_agent" ||
                        task.work_state === "accepted" ||
                        task.state === "done";
                      const checklist = task.checklist_items || [];
                      return (
                        <article
                          className={`task-board-card${dragId === task.id ? " is-dragging" : ""}${dropTarget === task.id ? " is-drop-before" : ""}`}
                          key={task.id}
                          data-task-id={task.id}
                          onDragOver={(event) => {
                            if (dragId && !busy) {
                              event.preventDefault();
                              event.stopPropagation();
                              setDropTarget(task.id);
                            }
                          }}
                          onDrop={(event) => {
                            if (dragId) {
                              event.preventDefault();
                              event.stopPropagation();
                              drop(state, task.id);
                            }
                          }}
                        >
                          <div className="task-board-card-heading">
                            <button
                              type="button"
                              className="task-board-icon task-board-grip"
                              draggable={!busy}
                              disabled={busy}
                              aria-label={`${task.title}をドラッグして移動`}
                              title="ドラッグして移動（上下ボタンでも並べ替えできます）"
                              onDragStart={(event) => {
                                setDragId(task.id);
                                event.dataTransfer.setData("text/plain", task.id);
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                setDragId(null);
                                setDropTarget("");
                              }}
                            >
                              <IconGripVertical size={16} />
                            </button>
                            <button
                              type="button"
                              className="task-board-title"
                              onClick={() => onOpen(task, schedule)}
                            >
                              {task.title}
                            </button>
                            <AiCreationMark entity={task} />
                          </div>
                          <span className="task-board-theme">
                            {themes.find((theme) => theme.id === task.project_id)?.name ||
                              "個人業務"}
                          </span>
                          <p className="task-board-turn">
                            {task.executor_identity && <strong>{task.executor_identity} · </strong>}
                            {taskNextTurn(task, model)}
                          </p>
                          <div className="task-board-meta">
                            {schedule?.end_date && (
                              <time dateTime={schedule.end_date}>予定終了 {schedule.end_date}</time>
                            )}
                            {checklist.length > 0 && (
                              <span
                                aria-label={`チェック項目 ${checklist.filter((item) => item.done).length}/${checklist.length}完了`}
                              >
                                ✓ {checklist.filter((item) => item.done).length}/{checklist.length}
                              </span>
                            )}
                          </div>
                          <div className="task-board-card-actions">
                            <select
                              data-board-action="state"
                              aria-label={`${task.title}のTask状態`}
                              value={task.state}
                              disabled={busy}
                              onChange={(event) =>
                                void move(task.id, event.target.value as Task["state"])
                              }
                            >
                              {STATES.map((value) => (
                                <option
                                  key={value}
                                  value={value}
                                  disabled={value === "done" && !canComplete}
                                >
                                  {TASK_STATE_LABELS[value]}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="task-board-icon"
                              aria-label={`${task.title}を上へ`}
                              data-board-action="up"
                              title="上へ"
                              disabled={busy || index === 0}
                              onClick={() => void move(task.id, state, column[index - 1].task.id)}
                            >
                              <IconArrowUp size={15} />
                            </button>
                            <button
                              type="button"
                              className="task-board-icon"
                              aria-label={`${task.title}を下へ`}
                              data-board-action="down"
                              title="下へ"
                              disabled={busy || index === column.length - 1}
                              onClick={() => void move(task.id, state, column[index + 2]?.task.id)}
                            >
                              <IconArrowDown size={15} />
                            </button>
                          </div>
                          {!canComplete && <small>報告を採用してから完了できます</small>}
                          {!terminal && (
                            <AgentLaunchButton
                              task={task}
                              saveEntities={saveEntities}
                              setToast={setToast}
                            />
                          )}
                        </article>
                      );
                    })}
                    {adding === state && (
                      <form
                        className="task-board-add"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void addTask(state);
                        }}
                      >
                        <input
                          autoFocus
                          aria-label={`${label}の新しいタスク名`}
                          placeholder="タスク名"
                          value={title}
                          disabled={busy}
                          onChange={(event) => setTitle(event.target.value)}
                        />
                        <div>
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={busy || !title.trim()}
                          >
                            追加
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              setAdding(null);
                              setTitle("");
                            }}
                          >
                            キャンセル
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </section>
            );
          },
        )}
      </div>
    </>
  );
}
