package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskenTodayWidgetTest {
    @Test
    fun resolves_small_medium_large_tall_and_fold_wide_layouts_from_available_size() {
        assertEquals(TaskenWidgetMode.Small, widgetModeFor(widthDp = 110, heightDp = 60))
        assertEquals(TaskenWidgetMode.Small, widgetModeFor(widthDp = 170, heightDp = 260))
        assertEquals(TaskenWidgetMode.Medium, widgetModeFor(widthDp = 250, heightDp = 160))
        assertEquals(TaskenWidgetMode.Large, widgetModeFor(widthDp = 250, heightDp = 230))
        assertEquals(TaskenWidgetMode.Large, widgetModeFor(widthDp = 200, heightDp = 240))
        assertEquals(TaskenWidgetMode.Wide, widgetModeFor(widthDp = 360, heightDp = 180))
        assertEquals(TaskenWidgetMode.Large, widgetModeFor(widthDp = 360, heightDp = 230))
        assertEquals(TaskenWidgetMode.Large, widgetModeFor(widthDp = 250, heightDp = 315))
        assertEquals(TaskenWidgetMode.Tall, widgetModeFor(widthDp = 250, heightDp = 316))
        assertEquals(TaskenWidgetMode.Tall, widgetModeFor(widthDp = 360, heightDp = 366))

        assertEquals(0, TaskenWidgetMode.Small.taskLimit)
        assertEquals(2, TaskenWidgetMode.Medium.taskLimit)
        assertEquals(4, TaskenWidgetMode.Large.taskLimit)
        assertEquals(6, TaskenWidgetMode.Tall.taskLimit)
        assertEquals(2, TaskenWidgetMode.Wide.taskLimit)
    }

    @Test
    fun task_text_hides_pending_and_theme_name_but_keeps_conflict_state() {
        val task = TaskenWidgetTask(
            id = "task-1",
            title = "旅程を確認",
            isDone = false,
            themeTitle = "Travel",
        )

        assertEquals("旅程を確認", TaskenTodayWidget.taskText(task))
        // 返信待ちのような送信待ち表示は行に出さない（ヘッダの件数表示に集約）。
        assertEquals("旅程を確認", TaskenTodayWidget.taskText(task.copy(isPending = true)))
        assertEquals(
            "競合 ・ 旅程を確認",
            TaskenTodayWidget.taskText(task.copy(isPending = true, hasConflict = true)),
        )
        assertEquals(
            "要確認 ・ 旅程を確認",
            TaskenTodayWidget.taskText(task.copy(requiresWorkReceipt = true)),
        )
    }

    @Test
    fun widget_sections_split_overdue_today_and_upcoming() {
        assertEquals("期限切れ", widgetSectionFor("2026-09-09", "2026-09-10"))
        assertEquals("今日", widgetSectionFor("2026-09-10", "2026-09-10"))
        assertEquals("今後", widgetSectionFor("2026-09-11", "2026-09-10"))
        assertEquals("日付なし", widgetSectionFor(null, "2026-09-10"))

        val tasks = listOf(
            TaskenWidgetTask("future", "今後", false),
            TaskenWidgetTask("today", "今日", false),
            TaskenWidgetTask("overdue", "期限切れ", false),
        )
        val dates = mapOf("future" to "2026-09-11", "today" to "2026-09-10", "overdue" to "2026-09-09")
        val ordered = orderWidgetTasks(tasks, "2026-09-10", dates)
        assertEquals(listOf("overdue", "today", "future"), ordered.map { it.id })
    }

    @Test
    fun theme_color_mapping_matches_app_chart_tokens() {
        assertEquals(0xFF8A2F3B.toInt(), widgetThemeColorInt(null))
        assertEquals(0xFF2D7FB8.toInt(), widgetThemeColorInt("chart-2"))
        assertEquals(0xFF2E8B57.toInt(), widgetThemeColorInt("chart-3"))
    }

    @Test
    fun total_count_is_not_capped_by_the_number_of_rendered_rows() {
        val snapshot = TaskenWidgetSnapshot(
            tasks = List(6) { index -> TaskenWidgetTask("task-$index", "Task $index", false) },
            totalTaskCount = 9,
            pendingCount = 0,
            conflictCount = 0,
            lastSuccessfulSyncAt = null,
        )

        assertEquals("9件", TaskenTodayWidget.taskCountText(snapshot))
        assertEquals("", TaskenTodayWidget.taskCountText(snapshot.copy(totalTaskCount = 0)))
    }

    @Test
    fun status_prioritizes_conflict_then_pending_then_sync_state() {
        fun snapshot(pending: Int = 0, conflict: Int = 0, syncedAt: String? = null) = TaskenWidgetSnapshot(
            tasks = emptyList(),
            pendingCount = pending,
            conflictCount = conflict,
            lastSuccessfulSyncAt = syncedAt,
        )

        assertEquals("競合 1件", TaskenTodayWidget.statusText(snapshot(pending = 2, conflict = 1)))
        assertEquals("送信待ち 2件", TaskenTodayWidget.statusText(snapshot(pending = 2)))
        assertEquals("未同期", TaskenTodayWidget.statusText(snapshot()))
        assertEquals("", TaskenTodayWidget.statusText(snapshot(syncedAt = "2026-08-22T00:00:00Z")))
    }
}
