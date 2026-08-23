package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskenTodayWidgetTest {
    @Test
    fun resolves_small_medium_large_and_fold_wide_layouts_from_available_size() {
        assertEquals(TaskenWidgetMode.Small, widgetModeFor(widthDp = 110, heightDp = 60))
        assertEquals(TaskenWidgetMode.Small, widgetModeFor(widthDp = 170, heightDp = 260))
        assertEquals(TaskenWidgetMode.Medium, widgetModeFor(widthDp = 250, heightDp = 160))
        assertEquals(TaskenWidgetMode.Large, widgetModeFor(widthDp = 250, heightDp = 230))
        assertEquals(TaskenWidgetMode.Wide, widgetModeFor(widthDp = 360, heightDp = 180))

        assertEquals(0, TaskenWidgetMode.Small.taskLimit)
        assertEquals(3, TaskenWidgetMode.Medium.taskLimit)
        assertEquals(6, TaskenWidgetMode.Large.taskLimit)
        assertEquals(5, TaskenWidgetMode.Wide.taskLimit)
    }

    @Test
    fun task_text_keeps_theme_and_exposes_pending_or_conflict_state() {
        val task = TaskenWidgetTask(
            id = "task-1",
            title = "旅程を確認",
            isDone = false,
            themeTitle = "Travel",
        )

        assertEquals("旅程を確認 · Travel", TaskenTodayWidget.taskText(task))
        assertEquals("↑ 旅程を確認 · Travel", TaskenTodayWidget.taskText(task.copy(isPending = true)))
        assertEquals(
            "⚠ 旅程を確認 · Travel",
            TaskenTodayWidget.taskText(task.copy(isPending = true, hasConflict = true)),
        )
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
        assertEquals("同期済み", TaskenTodayWidget.statusText(snapshot(syncedAt = "2026-08-22T00:00:00Z")))
    }
}
