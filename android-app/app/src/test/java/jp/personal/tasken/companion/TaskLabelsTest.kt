package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskLabelsTest {
    @Test
    fun `canonical work states use Japanese labels`() {
        assertEquals("未委任", taskWorkStateLabel("not_delegated"))
        assertEquals("AI Ready", taskWorkStateLabel("ready_for_agent"))
        assertEquals("作業中", taskWorkStateLabel("in_progress"))
        assertEquals("報告済み", taskWorkStateLabel("reported_done"))
        assertEquals("確認待ち", taskWorkStateLabel("needs_human_review"))
        assertEquals("確認済み", taskWorkStateLabel("accepted"))
        assertEquals("停止中", taskWorkStateLabel("blocked"))
        assertEquals("失敗", taskWorkStateLabel("failed"))
    }

    @Test
    fun `legacy work state aliases stay readable`() {
        assertEquals("委任済み", taskWorkStateLabel("delegated"))
        assertEquals("作業中", taskWorkStateLabel("working"))
        assertEquals("確認待ち", taskWorkStateLabel("needs_review"))
        assertEquals("確認済み", taskWorkStateLabel("completed"))
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
