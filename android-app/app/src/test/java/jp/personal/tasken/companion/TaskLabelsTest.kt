package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskLabelsTest {
    @Test
    fun `work state labels do not expose storage values`() {
        assertEquals("未委任", taskWorkStateLabel("not_delegated"))
        assertEquals("確認待ち", taskWorkStateLabel("needs_review"))
    }

    @Test
    fun `unknown work state remains observable`() {
        assertEquals("future_state", taskWorkStateLabel("future_state"))
    }

    @Test
    fun `today date label distinguishes today unset and another date`() {
        assertEquals("今日", taskTodayDateLabel("2026-08-22", "2026-08-22"))
        assertEquals("未設定", taskTodayDateLabel(null, "2026-08-22"))
        assertEquals("2026-08-23", taskTodayDateLabel("2026-08-23", "2026-08-22"))
    }
}
