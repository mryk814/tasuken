import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
  IconCalendar,
  IconChecklist,
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconCircleCheck,
  IconCircleHalf2,
  IconClockPause,
  IconEye,
  IconFlag,
  IconGripVertical,
  IconPlus,
  IconRobot,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import type { Task, Schedule } from "../domain-model/types";
import type { BaseRecord, SaveEntities, Theme } from "../types";
import { TASK_STATE_LABELS } from "../domain-model/labels";
import { buildSaveTaskOperations } from "../domain-model/persistence";
import { buildCompleteTaskOperations } from "../domain-model/taskRecurrence";
import { todayIso } from "../../../utils/dataFormat.js";
import { themePickerOptions } from "../../../../../shared/themeRef.mjs";
import {
  BOARD_STATES,
  boardDropBeforeId,
  boardKeyboardState,
  moveBoardTask,
  sortBoardRows,
  taskNextTurn,
  taskWorkModel,
  type BoardRow,
} from "./TaskBoardModel";
import { AiCreationMark } from "./AiCreationMark";
import { AgentLaunchButton } from "./AgentLaunchButton";
import "./TaskBoard.css";

const STATE_ICONS = {
  todo: IconCircle,
  doing: IconCircleHalf2,
  review: IconEye,
  waiting: IconClockPause,
  done: IconCircleCheck,
  cancelled: IconX,
};
type DropPosition = { state: Task["state"]; beforeId?: string };

export function TaskBoard({
  rows,
  allRows,
  themes,
  repositoryContexts,
  defaultThemeId,
  proposals,
  receipts,
  saveEntities,
  setToast,
  onOpen,
}: {
  rows: BoardRow[];
  allRows: BoardRow[];
  themes: Theme[];
  repositoryContexts: BaseRecord[];
  defaultThemeId: string;
  proposals: readonly unknown[];
  receipts: readonly unknown[];
  saveEntities: SaveEntities;
  setToast(message: string, tone?: "info" | "success" | "warning" | "danger"): void;
  onOpen(task: Task, schedule?: Schedule): void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const focusTask = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropPosition | null>(null);
  const [collapsedStates, setCollapsedStates] = useState<string[]>(["cancelled"]);
  const [adding, setAdding] = useState<Task["state"] | null>(null);
  const [title, setTitle] = useState("");
  const keyboardHelp = useId();
  const today = todayIso();
  const themeOptions = themePickerOptions(themes);

  useEffect(() => {
    if (busy || !focusTask.current) return;
    const card = boardRef.current?.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(focusTask.current)}"]`,
    );
    focusTask.current = null;
    (card || boardRef.current)?.focus({ preventScroll: true });
  }, [busy, rows]);

  async function move(taskId: string, state: Task["state"], beforeId?: string) {
    if (lock.current) return;
    focusTask.current = taskId;
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
      const message =
        source.task.state === state
          ? "順序を保存しました。"
          : `「${source.task.title}」を${TASK_STATE_LABELS[state]}にしました。`;
      await saveEntities(operations, message, "main_ui", { copyAiRequest: false });
      setCollapsedStates((current) => current.filter((value) => value !== state));
      setAnnouncement(message);
    } catch (cause) {
      setError(`移動できませんでした。${cause instanceof Error ? cause.message : String(cause)}`);
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

  function drop(target: DropPosition) {
    if (dragId) void move(dragId, target.state, target.beforeId);
    setDragId(null);
    setDropTarget(null);
  }
  function dropPosition(state: Task["state"], column: BoardRow[], pointerY: number): DropPosition {
    if (collapsedStates.includes(state)) return { state };
    for (const { task } of column) {
      const card = boardRef.current?.querySelector<HTMLElement>(
        `[data-task-id="${CSS.escape(task.id)}"]`,
      );
      if (!card) continue;
      const bounds = card.getBoundingClientRect();
      if (pointerY < bounds.bottom) {
        return {
          state,
          beforeId: boardDropBeforeId(column, task.id, pointerY >= bounds.y + bounds.height / 2),
        };
      }
    }
    return { state };
  }
  function insertion(state: Task["state"], beforeId?: string) {
    return dragId &&
      dropTarget?.state === state &&
      dropTarget.beforeId === beforeId &&
      beforeId !== dragId ? (
      <div className="task-board-insertion" aria-hidden="true">
        <span>ここに移動</span>
      </div>
    ) : null;
  }

  return (
    <>
      <div className="task-board-help">
        <span>カードをドラッグして移動</span>
        <span role="status">
          {busy
            ? "保存中…"
            : `${rows.length}件 · 進行中 ${rows.filter(({ task }) => task.state === "doing").length}件`}
        </span>
      </div>
      <p id={keyboardHelp} className="task-board-sr-only">
        Altと左右キーで列を移動、Altと上下キーで並べ替え。Enterで詳細を開きます。
      </p>
      <span className="task-board-sr-only" aria-live="polite">
        {announcement}
      </span>
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
        {BOARD_STATES.map((state) => {
          const label = TASK_STATE_LABELS[state];
          const StateIcon = STATE_ICONS[state];
          const column = sortBoardRows(rows.filter(({ task }) => task.state === state));
          const terminal = state === "done" || state === "cancelled";
          const collapsed = collapsedStates.includes(state);
          return (
            <section
              key={state}
              aria-label={label}
              className={`task-board-column state-${state}${collapsed ? " is-collapsed" : ""}${dragId && dropTarget?.state === state ? " is-drop-target" : ""}`}
              onDragOver={(event) => {
                if (dragId && !busy) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(dropPosition(state, column, event.clientY));
                }
              }}
              onDrop={(event) => {
                if (dragId) {
                  event.preventDefault();
                  drop(dropPosition(state, column, event.clientY));
                }
              }}
            >
              <h2>
                <StateIcon className="task-board-state-icon" size={18} aria-hidden="true" />
                {terminal ? (
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() =>
                      setCollapsedStates((current) =>
                        current.includes(state)
                          ? current.filter((value) => value !== state)
                          : [...current, state],
                      )
                    }
                  >
                    {label}
                    {collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
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
                  {column.length === 0 && adding !== state && !dragId && (
                    <p className="task-board-empty">タスクはありません</p>
                  )}
                  {column.map(({ task, schedule }, index) => {
                    const model = taskWorkModel(task, proposals, receipts);
                    const theme = themeOptions.find((item) => item.value === task.project_id);
                    const checklist = task.checklist_items || [];
                    const checked = checklist.filter((item) => item.done).length;
                    const ai = task.intended_executor === "ai_agent";
                    const nextTurn = taskNextTurn(task, model);
                    const workLabel =
                      model.state === "start_waiting"
                        ? "開始待ち"
                        : model.state === "working"
                          ? "作業中"
                          : model.state === "review_waiting"
                            ? "報告あり"
                            : nextTurn.replace(/^次: /, "").replace(/^AI · /, "");
                    const due = schedule?.end_date;
                    return (
                      <Fragment key={task.id}>
                        {insertion(state, task.id)}
                        <article
                          data-task-id={task.id}
                          tabIndex={0}
                          aria-label={task.title}
                          aria-describedby={keyboardHelp}
                          className={`task-board-card${dragId === task.id ? " is-dragging" : ""}`}
                          draggable={!busy}
                          onDragStart={(event) => {
                            const target = event.target as HTMLElement;
                            if (target.closest("button") && !target.closest(".task-board-title")) {
                              event.preventDefault();
                              return;
                            }
                            setDragId(task.id);
                            event.dataTransfer.setData("text/plain", task.id);
                            event.dataTransfer.effectAllowed = "move";
                            const bounds = event.currentTarget.getBoundingClientRect();
                            event.dataTransfer.setDragImage(
                              event.currentTarget,
                              Math.max(0, event.clientX - bounds.x),
                              Math.max(0, event.clientY - bounds.y),
                            );
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setDropTarget(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget || busy) return;
                            if (event.key === "Enter") {
                              event.preventDefault();
                              onOpen(task, schedule);
                              return;
                            }
                            if (
                              !event.altKey ||
                              !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                                event.key,
                              )
                            )
                              return;
                            event.preventDefault();
                            if (event.key === "ArrowUp" && index > 0)
                              void move(task.id, state, column[index - 1].task.id);
                            if (event.key === "ArrowDown" && index < column.length - 1)
                              void move(task.id, state, column[index + 2]?.task.id);
                            if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                              const nextState = boardKeyboardState(
                                task,
                                event.key === "ArrowLeft" ? -1 : 1,
                              );
                              if (nextState) void move(task.id, nextState);
                            }
                          }}
                        >
                          <div className="task-board-card-top">
                            <span className="task-board-theme">
                              <i
                                style={{
                                  background: theme?.colorToken
                                    ? `var(--color-${theme.colorToken})`
                                    : "var(--color-text-tertiary)",
                                }}
                              />
                              {theme?.label || "個人業務"}
                            </span>
                            {task.priority === "high" && (
                              <IconFlag
                                className="task-board-priority"
                                size={15}
                                aria-label="高優先度"
                              />
                            )}
                            <AiCreationMark entity={task} />
                            <IconGripVertical
                              className="task-board-grip"
                              size={16}
                              aria-hidden="true"
                            />
                          </div>
                          <button
                            type="button"
                            className="task-board-title"
                            onClick={() => onOpen(task, schedule)}
                          >
                            {task.title}
                          </button>
                          {(due || checklist.length > 0) && (
                            <div className="task-board-meta">
                              {due && (
                                <time
                                  className={!terminal && due < today ? "is-overdue" : ""}
                                  dateTime={due}
                                  title={`予定終了 ${due}`}
                                >
                                  <IconCalendar size={14} aria-hidden="true" />
                                  {due.slice(5).replace("-", "/")}
                                </time>
                              )}
                              {checklist.length > 0 && (
                                <span
                                  className={checked === checklist.length ? "is-complete" : ""}
                                  title={`チェック項目 ${checked}/${checklist.length}完了`}
                                >
                                  <IconChecklist size={14} aria-hidden="true" />
                                  {checked}/{checklist.length}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="task-board-card-footer">
                            <span
                              className={`task-board-assignee${ai ? ` is-ai work-${model.state}` : ""}`}
                              title={nextTurn}
                            >
                              {ai ? (
                                <IconRobot size={14} aria-hidden="true" />
                              ) : (
                                <IconUser size={14} aria-hidden="true" />
                              )}
                              <span>
                                {ai
                                  ? task.executor_identity || "AI"
                                  : task.intended_executor === "human"
                                    ? task.executor_identity || "他の人"
                                    : "自分"}
                              </span>
                              {ai && <small>{workLabel}</small>}
                            </span>
                            {!terminal && (
                              <AgentLaunchButton
                                task={task}
                                themes={themes}
                                repositoryContexts={repositoryContexts}
                                saveEntities={saveEntities}
                                setToast={setToast}
                              />
                            )}
                          </div>
                        </article>
                      </Fragment>
                    );
                  })}
                  {insertion(state)}
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
        })}
      </div>
    </>
  );
}
