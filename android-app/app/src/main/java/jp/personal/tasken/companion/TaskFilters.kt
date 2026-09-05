package jp.personal.tasken.companion

import java.time.LocalDate

enum class TaskScheduleFilter { All, Today, Upcoming, Unscheduled }

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
        // The existing Today projection is defined by todayDate, not Schedule.
        TaskScheduleFilter.Today -> task.todayDate == today.toString()
        TaskScheduleFilter.Upcoming -> listOf(task.todayDate, task.schedule?.startDate, task.schedule?.endDate)
            .any { value -> value?.let { runCatching { LocalDate.parse(it).isAfter(today) }.getOrDefault(false) } == true }
        TaskScheduleFilter.Unscheduled -> task.todayDate == null &&
            task.schedule?.startDate == null && task.schedule?.endDate == null
    }
    matchesTheme && matchesSchedule
}
