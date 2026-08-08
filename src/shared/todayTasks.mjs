import {
  getScheduleKind,
  isExecutionWindowOpenOn,
  isScheduleDueOn,
  isScheduleOngoingOn,
  isScheduleOverdueOn,
} from "./scheduleSemantics.mjs";

export const TODAY_TASK_POLICY = Object.freeze({
  includeExecutionWindow: false,
  includeOngoing: false,
  includeOverdue: false,
  includeCompleted: false,
});

/**
 * Canonical ordered Task projection.  Callers choose policy explicitly while
 * all date meaning and ordering remains here.
 */
export function selectTodayTasks(tasks, schedules, date, options = TODAY_TASK_POLICY) {
  const {
    includeExecutionWindow = false,
    includeOngoing = false,
    includeOverdue = false,
    includeCompleted = false,
  } = options;
  const byOwner = new Map(
    schedules.filter((schedule) => schedule.owner_type === "task")
      .map((schedule) => [String(schedule.owner_id), schedule]),
  );
  const rows = [];
  for (const task of tasks) {
    if (["cancelled"].includes(String(task.state))) continue;
    if (!includeCompleted && String(task.state) === "done") continue;
    const schedule = byOwner.get(String(task.id));
    if (!schedule) continue;
    const kind = getScheduleKind(schedule);
    const overdue = isScheduleOverdueOn(schedule, date);
    const due = kind !== "ongoing_period" && isScheduleDueOn(schedule, date);
    const ongoing = isScheduleOngoingOn(schedule, date);
    const executionWindow = isExecutionWindowOpenOn(schedule, date);
    if (overdue && includeOverdue) rows.push({ task, schedule, bucket: "overdue" });
    else if (due) rows.push({ task, schedule, bucket: "due" });
    else if (ongoing && includeOngoing) rows.push({ task, schedule, bucket: "ongoing" });
    else if (executionWindow && includeExecutionWindow) rows.push({ task, schedule, bucket: "execution_window" });
  }
  const bucketOrder = { overdue: 0, due: 1, ongoing: 2, execution_window: 3 };
  return rows.sort((a, b) => Number(a.task.state === "done") - Number(b.task.state === "done")
    || bucketOrder[a.bucket] - bucketOrder[b.bucket]
    || Number(b.task.priority === "high") - Number(a.task.priority === "high")
    || String(a.schedule.end_date || a.schedule.start_date || "9999-12-31").localeCompare(String(b.schedule.end_date || b.schedule.start_date || "9999-12-31"))
    || String(a.task.title || "").localeCompare(String(b.task.title || ""), "ja")
    || String(a.task.id).localeCompare(String(b.task.id)));
}
