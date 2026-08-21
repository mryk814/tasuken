package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskenTodayWidgetTest {
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
