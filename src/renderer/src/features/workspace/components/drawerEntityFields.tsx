import { useEffect, useRef, useState } from "react";

import { todayIso } from "../../../utils/dataFormat.js";
import type { DrawerConfig, SaveEntities, WorkspaceData } from "../types";
import { dateOnly, str, uuid } from "../lib/format";
import { normalizeTaskShelf } from "../lib/taskShelves";
import { normalizeReminderDateTime } from "../lib/reminders";
import { listTaskSections, normalizeTaskSectionId } from "../lib/taskSections";
import {
  CAPTURE_ENTRY_STATE_LABELS,
  PLAN_NODE_STATE_LABELS,
  PLAN_NODE_TYPE_LABELS,
  SCHEDULE_RANGE_SEMANTICS_HINTS,
  SCHEDULE_RANGE_SEMANTICS_LABELS,
  TASK_STATE_LABELS,
  TASK_REQUESTER_LABELS,
  TASK_INTENDED_EXECUTOR_LABELS,
  WAITING_STATE_LABELS,
} from "../domain-model/labels";
import { buildSaveTaskOperations } from "../domain-model/persistence";
import { DEFAULT_RANGE_SEMANTICS } from "../domain-model/scheduleSemantics";
import type { Schedule, ScheduleRangeSemantics, Task } from "../domain-model/types";
import { Field, ThemeSelect } from "./common";
import { TaskRepositoryContextFields } from "./repositoryContextFields";

const REPEAT_FREQUENCY_LABELS = {
  daily: "毎日",
  weekly: "毎週",
  monthly: "毎月",
};
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
// 期間内に一度を先に置き、新規の日付範囲の自然な既定にする（#309）。
const RANGE_SEMANTICS_ORDER: ScheduleRangeSemantics[] = ["once_within_window", "ongoing"];

export function findSchedule(
  data: WorkspaceData,
  ownerType: string,
  ownerId: string,
  passedSchedule?: unknown,
): Schedule | undefined {
  if (passedSchedule && typeof passedSchedule === "object" && "id" in (passedSchedule as object)) {
    return passedSchedule as unknown as Schedule;
  }
  return (data.schedules || []).find(
    (schedule) =>
      (schedule as unknown as Schedule).owner_type === ownerType &&
      (schedule as unknown as Schedule).owner_id === ownerId,
  ) as unknown as Schedule | undefined;
}

function normalizeChecklistItems(entity: DrawerConfig["entity"]) {
  const items = Array.isArray(entity.checklist_items) ? entity.checklist_items : [];
  return items
    .map((item, index) => ({
      id: str((item as Record<string, unknown>).id) || uuid(),
      title: str((item as Record<string, unknown>).title),
      done: Boolean((item as Record<string, unknown>).done),
      completed_at: str((item as Record<string, unknown>).completed_at),
      sort_order: Number((item as Record<string, unknown>).sort_order ?? index),
    }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function TaskFields({
  entity,
  data,
  saveEntities,
  onChecklistSavePending,
  onChecklistSaved,
  onChecklistDraftChange,
}: {
  entity: DrawerConfig["entity"];
  data: WorkspaceData;
  saveEntities?: SaveEntities;
  onChecklistSavePending?: (promise: Promise<boolean>) => void;
  onChecklistSaved?: () => void;
  onChecklistDraftChange?: () => void;
}) {
  const schedule = findSchedule(data, "task", str(entity.id), entity._schedule);
  const taskSections = listTaskSections(data.views || [], str(entity.project_id));
  const repeatRule =
    entity.repeat_rule && typeof entity.repeat_rule === "object"
      ? (entity.repeat_rule as Record<string, unknown>)
      : null;
  const [repeatFrequency, setRepeatFrequency] = useState(str(repeatRule?.frequency));
  const initialChecklist = normalizeChecklistItems(entity);
  const [checklist, setChecklist] = useState(initialChecklist);
  const checklistRef = useRef(initialChecklist);
  const [activeChecklistItemId, setActiveChecklistItemId] = useState(() =>
    str(entity._focusChecklistItem),
  );
  const checklistInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const skipNextChecklistBlurRef = useRef<string | null>(null);
  const checklistSaveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const [checklistSaveState, setChecklistSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >(entity.id ? "saved" : "idle");
  const selectedWeekdays = Array.isArray(repeatRule?.weekdays)
    ? repeatRule.weekdays.map((value) => Number(value))
    : [];
  const fallbackMonthDay = dateOnly(schedule?.end_date || schedule?.start_date || todayIso()).slice(
    -2,
  );
  const canAutoSaveChecklist = Boolean(entity.id && saveEntities);
  const entityId = str(entity.id);
  useEffect(() => {
    if (!activeChecklistItemId) return;
    const input = checklistInputRefs.current[activeChecklistItemId];
    if (!input) return;
    input.focus();
    input.select();
  }, [activeChecklistItemId, checklist.length]);
  // 日付範囲の意味（#309）。既存の未分類データは編集で触るまで未分類のまま残す。
  const [startDate, setStartDate] = useState(dateOnly(schedule?.start_date));
  const [endDate, setEndDate] = useState(dateOnly(schedule?.end_date));
  const [rangeSemantics, setRangeSemantics] = useState<ScheduleRangeSemantics>(
    schedule?.range_semantics === "ongoing" ? "ongoing" : DEFAULT_RANGE_SEMANTICS,
  );
  const isDateRange = Boolean(startDate && endDate && endDate > startDate);

  function saveChecklist(
    nextChecklist: ReturnType<typeof normalizeChecklistItems>,
  ): Promise<boolean> {
    checklistRef.current = nextChecklist;
    setChecklist(nextChecklist);
    if (!canAutoSaveChecklist || !saveEntities) return Promise.resolve(true);
    const saving = checklistSaveQueueRef.current.then(async () => {
      const items = nextChecklist
        .map((item, index) => ({ ...item, title: item.title.trim(), sort_order: index }))
        .filter((item) => item.title);
      const task: Task = {
        id: entityId,
        title: str(entity.title),
        project_id: (entity.project_id as string | null) ?? null,
        section_id: normalizeTaskSectionId(entity.section_id, taskSections, str(entity.project_id)),
        plan_node_id: (entity.plan_node_id as string | null) ?? null,
        parent_task_id: (entity.parent_task_id as string | null) ?? null,
        state: (str(entity.state) || "todo") as Task["state"],
        requester: (str(entity.requester) || "self") as Task["requester"],
        intended_executor: (str(entity.intended_executor) || "self") as Task["intended_executor"],
        executor_identity: (entity.executor_identity as string | null) ?? null,
        work_state: (str(entity.work_state) ||
          (str(entity.intended_executor) === "ai_agent"
            ? "ready_for_agent"
            : "not_delegated")) as Task["work_state"],
        work_started_at: (entity.work_started_at as string | null) ?? null,
        work_reported_at: (entity.work_reported_at as string | null) ?? null,
        work_review_note: (entity.work_review_note as string | null) ?? null,
        priority: str(entity.priority) === "high" ? "high" : "normal",
        planning_shelf: normalizeTaskShelf(entity.planning_shelf),
        reminder_at: normalizeReminderDateTime(entity.reminder_at),
        description: (entity.description as string | null) ?? null,
        completion_note: (entity.completion_note as string | null) ?? null,
        repeat_rule: repeatRule as Task["repeat_rule"],
        repeat_series_id: (entity.repeat_series_id as string | null) ?? null,
        repeat_parent_task_id: (entity.repeat_parent_task_id as string | null) ?? null,
        checklist_items: items,
        repository_context_mode: (str(entity.repository_context_mode) ||
          "inherit") as Task["repository_context_mode"],
        repository_context_ids: Array.isArray(entity.repository_context_ids)
          ? entity.repository_context_ids.map(String)
          : [],
        primary_repository_context_id:
          (entity.primary_repository_context_id as string | null) ?? null,
        repository_subdirectory: (entity.repository_subdirectory as string | null) ?? null,
        repository_branch_hint: (entity.repository_branch_hint as string | null) ?? null,
        repository_context_detachments: Array.isArray(entity.repository_context_detachments)
          ? (entity.repository_context_detachments as Array<Record<string, unknown>>)
          : undefined,
        legacy_item_id: (entity.legacy_item_id as string | null) ?? null,
        created_at: str(entity.created_at) || new Date().toISOString(),
      };
      try {
        setChecklistSaveState("saving");
        await saveEntities(buildSaveTaskOperations(task), "チェックリストを保存しました。");
        setChecklistSaveState("saved");
        onChecklistSaved?.();
        return true;
      } catch {
        setChecklistSaveState("error");
        return false;
      }
    });
    checklistSaveQueueRef.current = saving;
    onChecklistSavePending?.(saving);
    return saving;
  }

  function addChecklistItem() {
    const id = uuid();
    const current = checklistRef.current;
    const next = [
      ...current,
      { id, title: "", done: false, completed_at: "", sort_order: current.length },
    ];
    checklistRef.current = next;
    setChecklist(next);
    setActiveChecklistItemId(id);
    onChecklistDraftChange?.();
  }

  const preservedSectionId =
    normalizeTaskSectionId(entity.section_id, taskSections, str(entity.project_id)) || "";
  const preservedShelf = normalizeTaskShelf(entity.planning_shelf) || "";
  const intendedExecutorValue = str(entity.intended_executor);
  const initialIntendedExecutor = Object.prototype.hasOwnProperty.call(
    TASK_INTENDED_EXECUTOR_LABELS,
    intendedExecutorValue,
  )
    ? intendedExecutorValue
    : "self";
  const [intendedExecutor, setIntendedExecutor] = useState(initialIntendedExecutor);
  const preservedWorkState =
    str(entity.work_state) ||
    (intendedExecutor === "ai_agent" ? "ready_for_agent" : "not_delegated");
  return (
    <>
      <Field label="タイトル">
        <input name="title" autoFocus={!activeChecklistItemId} defaultValue={str(entity.title)} />
      </Field>
      <ThemeSelect themes={data.themes} value={str(entity.project_id)} allowPersonal />
      <TaskRepositoryContextFields entity={entity} data={data} />
      <input type="hidden" name="section_id" defaultValue={preservedSectionId} />
      <Field label="状態">
        <select name="state" defaultValue={str(entity.state) || "todo"}>
          {Object.entries(TASK_STATE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <label className="toggle priority-toggle">
        <input
          name="priority_flag"
          type="checkbox"
          defaultChecked={str(entity.priority) === "high"}
        />
        旗を付ける
      </label>
      <input type="hidden" name="planning_shelf" defaultValue={preservedShelf} />
      <Field label="リマインダー">
        <input
          name="reminder_at"
          type="datetime-local"
          defaultValue={normalizeReminderDateTime(entity.reminder_at) || ""}
        />
      </Field>
      <div className="form-grid">
        <Field label="開始">
          <input
            name="start_date"
            type="date"
            defaultValue={dateOnly(schedule?.start_date)}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>
        <Field label="期限">
          <input
            name="end_date"
            type="date"
            defaultValue={dateOnly(schedule?.end_date)}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </Field>
      </div>
      {/* 日付範囲を指定したときだけ意味を尋ねる。単日には不要な選択を出さない（#309）。 */}
      {isDateRange && (
        <fieldset className="range-semantics-field">
          <legend>この期間の意味</legend>
          {RANGE_SEMANTICS_ORDER.map((value) => (
            <label key={value} className="toggle range-semantics-choice">
              <input
                type="radio"
                name="range_semantics"
                value={value}
                checked={rangeSemantics === value}
                onChange={() => setRangeSemantics(value)}
              />
              <span>
                <strong>{SCHEDULE_RANGE_SEMANTICS_LABELS[value]}</strong>
                <small>{SCHEDULE_RANGE_SEMANTICS_HINTS[value]}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <Field label="説明">
        <textarea name="description" defaultValue={str(entity.description)} />
      </Field>
      {/* 完了時のひとことは説明と混ぜず、完了の記録として別に持つ（#308）。 */}
      <Field label="完了時のひとこと">
        <input name="completion_note" defaultValue={str(entity.completion_note)} />
      </Field>
      <section className="drawer-subsection">
        <div className="section-heading">
          <h2>繰り返し</h2>
        </div>
        <div className="form-grid">
          <Field label="頻度">
            <select
              name="repeat_frequency"
              value={repeatFrequency}
              onChange={(event) => setRepeatFrequency(event.target.value)}
            >
              <option value="">なし</option>
              {Object.entries(REPEAT_FREQUENCY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="間隔">
            <input
              name="repeat_interval"
              type="number"
              min="1"
              max="365"
              defaultValue={str(repeatRule?.interval) || "1"}
              disabled={!repeatFrequency}
            />
          </Field>
        </div>
        {repeatFrequency === "weekly" && (
          <div className="weekday-picker">
            {WEEKDAY_LABELS.map((label, index) => (
              <label key={label} className="weekday-choice">
                <input
                  name="repeat_weekdays"
                  type="checkbox"
                  value={index}
                  defaultChecked={selectedWeekdays.includes(index)}
                />
                {label}
              </label>
            ))}
          </div>
        )}
        {repeatFrequency === "monthly" && (
          <Field label="毎月の日">
            <input
              name="repeat_month_day"
              type="number"
              min="1"
              max="31"
              defaultValue={str(repeatRule?.month_day) || fallbackMonthDay}
            />
          </Field>
        )}
        {repeatFrequency && (
          <div className="form-grid">
            <Field label="次回の基準">
              <select
                name="repeat_next_from"
                defaultValue={str(repeatRule?.next_from) || "scheduled"}
              >
                <option value="scheduled">予定日から</option>
                <option value="completed">完了日から</option>
              </select>
            </Field>
            <Field label="終了日">
              <input name="repeat_until" type="date" defaultValue={dateOnly(repeatRule?.until)} />
            </Field>
          </div>
        )}
      </section>
      <section className="drawer-subsection">
        <div className="section-heading">
          <h2>チェックリスト</h2>
          {canAutoSaveChecklist && (
            <span
              className={`save-status save-status-${checklistSaveState}`}
              role="status"
              aria-live="polite"
            >
              {checklistSaveState === "saving"
                ? "保存中"
                : checklistSaveState === "error"
                  ? "保存できませんでした"
                  : "保存済み"}
            </span>
          )}
          <button className="text-button compact" type="button" onClick={addChecklistItem}>
            追加
          </button>
        </div>
        <div className="task-checklist-editor">
          {checklist.map((item, index) => (
            <div className="task-checklist-row" key={item.id}>
              <input type="hidden" name="checklist_id" value={item.id} />
              <input
                type="hidden"
                name={`checklist_completed_at_${index}`}
                value={item.completed_at}
              />
              <label className="checklist-toggle">
                <input
                  name={`checklist_done_${index}`}
                  type="checkbox"
                  checked={item.done}
                  onChange={(event) => {
                    const done = event.target.checked;
                    const next = checklistRef.current.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, done, completed_at: done ? new Date().toISOString() : "" }
                        : entry,
                    );
                    void saveChecklist(next);
                    onChecklistDraftChange?.();
                  }}
                />
              </label>
              <input
                name="checklist_title"
                ref={(input) => {
                  checklistInputRefs.current[item.id] = input;
                }}
                value={item.title}
                onInput={(event) => {
                  const next = checklistRef.current.map((entry) =>
                    entry.id === item.id ? { ...entry, title: event.currentTarget.value } : entry,
                  );
                  checklistRef.current = next;
                  setChecklist(next);
                  onChecklistDraftChange?.();
                }}
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.altKey
                  )
                    return;
                  if (
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229 ||
                    !item.title.trim()
                  )
                    return;
                  event.preventDefault();
                  skipNextChecklistBlurRef.current = item.id;
                  const nextId = uuid();
                  const next = [
                    ...checklistRef.current.map((entry) =>
                      entry.id === item.id ? { ...entry, title: entry.title.trim() } : entry,
                    ),
                    {
                      id: nextId,
                      title: "",
                      done: false,
                      completed_at: "",
                      sort_order: checklistRef.current.length,
                    },
                  ];
                  checklistRef.current = next;
                  setChecklist(next);
                  setActiveChecklistItemId(nextId);
                  onChecklistDraftChange?.();
                  void saveChecklist(next);
                }}
                onBlur={() => {
                  if (skipNextChecklistBlurRef.current === item.id) {
                    skipNextChecklistBlurRef.current = null;
                    return;
                  }
                  const next = checklistRef.current.map((entry) =>
                    entry.id === item.id ? { ...entry, title: entry.title.trim() } : entry,
                  );
                  if (next.some((entry) => entry.id === item.id && entry.title))
                    void saveChecklist(next);
                }}
                placeholder="手順"
              />
              <button
                className="text-button compact"
                type="button"
                onClick={() => {
                  const next = checklistRef.current.filter((entry) => entry.id !== item.id);
                  void saveChecklist(next);
                  onChecklistDraftChange?.();
                }}
              >
                削除
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="drawer-subsection">
        <div className="section-heading">
          <h2>担当</h2>
          <span className="field-help">依頼者と担当を指定します。</span>
        </div>
        <div className="form-grid">
          <Field label="依頼者">
            <select name="requester" defaultValue={str(entity.requester) || "self"}>
              {Object.entries(TASK_REQUESTER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="担当">
            <select
              name="intended_executor"
              value={intendedExecutor}
              onChange={(event) => setIntendedExecutor(event.target.value)}
            >
              {Object.entries(TASK_INTENDED_EXECUTOR_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="担当者名">
          <input
            name="executor_identity"
            defaultValue={str(entity.executor_identity)}
            placeholder="例: Codex / 山田"
          />
        </Field>
        <input type="hidden" name="work_state" value={preservedWorkState} readOnly />
      </section>
      {schedule && <input type="hidden" name="_schedule_id" value={schedule.id} />}
    </>
  );
}

export function WaitingFields({
  entity,
  data,
}: {
  entity: DrawerConfig["entity"];
  data: WorkspaceData;
}) {
  const schedule = findSchedule(data, "waiting", str(entity.id), entity._schedule);
  return (
    <>
      <Field label="タイトル">
        <input name="title" autoFocus defaultValue={str(entity.title)} />
      </Field>
      <Field label="相手">
        <input name="waiting_for" defaultValue={str(entity.waiting_for)} />
      </Field>
      <ThemeSelect themes={data.themes} value={str(entity.project_id)} allowPersonal />
      <Field label="状態">
        <select name="state" defaultValue={str(entity.state) || "waiting"}>
          {Object.entries(WAITING_STATE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="期限">
        <input name="end_date" type="date" defaultValue={dateOnly(schedule?.end_date)} />
      </Field>
      <Field label="確認リマインダー">
        <input
          name="check_reminder_at"
          type="datetime-local"
          defaultValue={normalizeReminderDateTime(entity.check_reminder_at) || ""}
        />
      </Field>
      <Field label="次アクション">
        <input name="next_action" defaultValue={str(entity.next_action)} />
      </Field>
      <Field label="説明">
        <textarea name="description" defaultValue={str(entity.description)} />
      </Field>
      {schedule && <input type="hidden" name="_schedule_id" value={schedule.id} />}
    </>
  );
}

export function PlanNodeFields({
  entity,
  data,
}: {
  entity: DrawerConfig["entity"];
  data: WorkspaceData;
}) {
  const schedule = findSchedule(data, "plan_node", str(entity.id), entity._schedule);
  const initialNodeType = str(entity.node_type) || str(entity.type) || "phase";
  const focusTitle = Boolean(entity._focusTitle);
  const [nodeType, setNodeType] = useState(initialNodeType);
  const isChildPlan = Boolean(entity.parent_plan_node_id || entity._parent_plan_node_item_id);
  const showRangeInputs = isChildPlan && nodeType !== "milestone";
  const showMilestoneDate = nodeType === "milestone";
  const [dateUnit, setDateUnit] = useState(
    str(schedule?.granularity) === "month" || str(entity.schedule_granularity) === "month"
      ? "month"
      : "day",
  );
  const scheduledStart = schedule?.start_date || entity.start_date;
  const scheduledEnd = schedule?.end_date || entity.end_date;
  const startValue =
    dateUnit === "month" ? dateOnly(scheduledStart).slice(0, 7) : dateOnly(scheduledStart);
  const endValue =
    dateUnit === "month" ? dateOnly(scheduledEnd).slice(0, 7) : dateOnly(scheduledEnd);
  const milestoneDate = dateOnly(scheduledEnd || scheduledStart);
  return (
    <>
      <Field label="タイトル">
        <input name="title" autoFocus={focusTitle} defaultValue={str(entity.title)} />
      </Field>
      <ThemeSelect themes={data.themes} value={str(entity.project_id)} allowPersonal />
      <div className="form-grid">
        <Field label="種類">
          <select
            name="node_type"
            value={nodeType}
            onChange={(event) => setNodeType(event.target.value)}
          >
            {Object.entries(PLAN_NODE_TYPE_LABELS)
              .filter(([value]) => value === "phase" || value === "milestone")
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="状態">
          <select name="node_state" defaultValue={str(entity.state) || "planned"}>
            {Object.entries(PLAN_NODE_STATE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {showRangeInputs && (
        <>
          <div className="form-grid">
            <Field label="予定の入力単位">
              <select
                name="schedule_input_unit"
                value={dateUnit}
                onChange={(event) => setDateUnit(event.target.value)}
              >
                <option value="day">日単位</option>
                <option value="month">月単位</option>
              </select>
            </Field>
          </div>
          <div className="form-grid" key={dateUnit}>
            <Field label="開始">
              <input
                name="start_date"
                type={dateUnit === "month" ? "month" : "date"}
                defaultValue={startValue}
              />
            </Field>
            <Field label="期限">
              <input
                name="end_date"
                type={dateUnit === "month" ? "month" : "date"}
                defaultValue={endValue}
              />
            </Field>
          </div>
        </>
      )}
      {showMilestoneDate && (
        <Field label="日付">
          <input name="start_date" type="date" defaultValue={milestoneDate} />
        </Field>
      )}
      <Field label="説明">
        <textarea name="description" defaultValue={str(entity.description)} />
      </Field>
      {(showRangeInputs || showMilestoneDate) && schedule && (
        <input type="hidden" name="_schedule_id" value={schedule.id} />
      )}
    </>
  );
}

export function CaptureEntryFields({ entity }: { entity: DrawerConfig["entity"] }) {
  return (
    <>
      <Field label="タイトル">
        <input name="title" autoFocus defaultValue={str(entity.title)} />
      </Field>
      <Field label="本文">
        <textarea name="text" defaultValue={str(entity.text)} />
      </Field>
      <Field label="記録日">
        <input name="captured_at" type="date" defaultValue={dateOnly(entity.captured_at)} />
      </Field>
      <Field label="状態">
        <select name="entry_state" defaultValue={str(entity.state) || "untriaged"}>
          {Object.entries(CAPTURE_ENTRY_STATE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
