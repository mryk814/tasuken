package jp.personal.tasken.companion

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskFiltersTest {
    private val today = LocalDate.of(2026, 9, 5)

    private fun task(id: String, date: String? = null, schedule: MobileTaskSchedule? = null) = MobileTask(
        id = id, title = id, themeId = null, state = "todo", workState = null,
        updatedAt = "2026-09-05T00:00:00Z", todayDate = date, schedule = schedule,
    )

    private fun schedule(start: String?, end: String?) = MobileTaskSchedule(
        id = null, version = null, startDate = start, endDate = end, dateKind = "planned",
        rangeSemantics = if (start != null && end != null && start != end) "ongoing" else null,
    )

    @Test
    fun todayMatchesExistingProjectionAndFutureDatesExcludeToday() {
        val tasks = listOf(
            task("past", "2026-09-04"), task("today", "2026-09-05"), task("future", "2026-09-06"),
            task("scheduled-today", schedule = schedule("2026-09-05", null)),
            task("scheduled-future", schedule = schedule("2026-09-06", null)),
            task("ongoing", schedule = schedule("2026-09-04", "2026-09-06")),
            task("past-schedule", schedule = schedule(null, "2026-09-04")),
            task("none"),
        )
        assertEquals(listOf("today"), filter(tasks, TaskScheduleFilter.Today))
        assertEquals(listOf("future", "scheduled-future", "ongoing"), filter(tasks, TaskScheduleFilter.Upcoming))
        assertEquals(listOf("none"), filter(tasks, TaskScheduleFilter.Unscheduled))
        assertEquals(tasks.map { it.id }, filter(tasks, TaskScheduleFilter.All))
    }

    @Test
    fun stateSearchThemeAndScheduleComposeWithoutChangingOrder() {
        val tasks = listOf(
            task("buy milk").copy(themeId = "home"),
            task("BUY bread").copy(themeId = "home", state = "done"),
            task("buy eggs").copy(themeId = "work"),
            task("buy tea", "2026-09-06").copy(themeId = "home"),
            task("buy coffee").copy(state = "cancelled"),
        )
        assertEquals(listOf("buy milk"), filterDailyTasks(tasks, " BUY ", TaskListFilter.Open,
            TaskScheduleFilter.Unscheduled, "home", today).map { it.id })
        assertEquals(listOf("BUY bread"), filterDailyTasks(tasks, "buy", TaskListFilter.Done,
            TaskScheduleFilter.All, "home", today).map { it.id })
        assertEquals(listOf("buy coffee"), filterDailyTasks(tasks, "", TaskListFilter.All,
            TaskScheduleFilter.All, "", today).map { it.id })
        assertEquals(emptyList<String>(), filterDailyTasks(tasks, "", TaskListFilter.Open,
            TaskScheduleFilter.All, "missing", today).map { it.id })
    }

    @Test
    fun scheduleObjectWithoutDatesIsUnscheduledAndInvalidDateDoesNotCrash() {
        val tasks = listOf(task("empty", schedule = schedule(null, null)), task("invalid", "bad-date"))
        assertEquals(listOf("empty"), filter(tasks, TaskScheduleFilter.Unscheduled))
        assertEquals(emptyList<String>(), filter(tasks, TaskScheduleFilter.Upcoming))
    }

    private fun filter(tasks: List<MobileTask>, scheduleFilter: TaskScheduleFilter) =
        filterDailyTasks(tasks, "", TaskListFilter.All, scheduleFilter, null, today).map { it.id }
}
