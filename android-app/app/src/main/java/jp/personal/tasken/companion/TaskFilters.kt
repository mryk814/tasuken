package jp.personal.tasken.companion

import java.time.LocalDate

enum class TaskScheduleFilter { All, Today, Upcoming, Unscheduled }

internal fun isOngoingScheduleRange(
    startDate: String?,
    endDate: String?,
    rangeSemantics: String?,
): Boolean {
    if (rangeSemantics != "ongoing" || startDate.isNullOrBlank() || endDate.isNullOrBlank()) return false
    val start = runCatching { LocalDate.parse(startDate) }.getOrNull() ?: return false
    val end = runCatching { LocalDate.parse(endDate) }.getOrNull() ?: return false
    return end.isAfter(start)
}

/**
 * 予定（Schedule）から Today 判定・ウィジェットの期限判定に使う期日を取り出す。
 * 期間中継続（ongoing）の範囲は締切ではないので対象外（Desktop の selectTodayTasks と揃える）。
 */
internal fun scheduleDueDateForToday(
    startDate: String?,
    endDate: String?,
    rangeSemantics: String?,
): LocalDate? {
    if (isOngoingScheduleRange(startDate, endDate, rangeSemantics)) return null
    return TaskNotificationPlan.dueDate(startDate, endDate)
}

/**
 * 今日（Today）の一覧・進捗に並べる Task かどうか（#784）。
 * - todayDate == today: 今日扱う予定のタスク（完了済みも今日の達成として残す）
 * - 期日 == today: 今日が期限・実施日のタスク（完了済みも今日の達成として残す）
 * - 期日 < today かつ未完了: 期日超過の未完了タスク（完了済みは過去の完了なので出さない）
 * - 中止（cancelled）は含めない。
 * Room の observeTasks / tasksForDate の SQL 条件と同じ定義を保つ。
 */
internal fun isTaskOnToday(
    todayDate: String?,
    scheduleStartDate: String?,
    scheduleEndDate: String?,
    scheduleRangeSemantics: String?,
    state: String,
    today: LocalDate = LocalDate.now(),
): Boolean {
    if (state == "cancelled") return false
    if (todayDate == today.toString()) return true
    val due = scheduleDueDateForToday(scheduleStartDate, scheduleEndDate, scheduleRangeSemantics) ?: return false
    return when {
        due == today -> true
        due.isBefore(today) -> state != "done"
        else -> false
    }
}

internal fun isTaskOnToday(task: MobileTask, today: LocalDate = LocalDate.now()): Boolean =
    isTaskOnToday(
        todayDate = task.todayDate,
        scheduleStartDate = task.schedule?.startDate,
        scheduleEndDate = task.schedule?.endDate,
        scheduleRangeSemantics = task.schedule?.rangeSemantics,
        state = task.state,
        today = today,
    )

internal fun filterDailyTasks(
    tasks: List<MobileTask>,
    search: String,
    filter: TaskListFilter,
    scheduleFilter: TaskScheduleFilter,
    themeId: String?,
    today: LocalDate = LocalDate.now(),
): List<MobileTask> = filterCachedTasks(tasks, search, filter).filter { task ->
    val matchesTheme = when (themeId) {
        null -> true
        "" -> task.themeId.isNullOrEmpty()
        else -> task.themeId == themeId
    }
    val matchesSchedule = when (scheduleFilter) {
        TaskScheduleFilter.All -> true
        TaskScheduleFilter.Today -> isTaskOnToday(task, today)
        TaskScheduleFilter.Upcoming -> listOf(task.todayDate, task.schedule?.startDate, task.schedule?.endDate)
            .any { value -> value?.let { runCatching { LocalDate.parse(it).isAfter(today) }.getOrDefault(false) } == true }
        TaskScheduleFilter.Unscheduled -> task.todayDate == null &&
            task.schedule?.startDate == null && task.schedule?.endDate == null
    }
    matchesTheme && matchesSchedule
}
