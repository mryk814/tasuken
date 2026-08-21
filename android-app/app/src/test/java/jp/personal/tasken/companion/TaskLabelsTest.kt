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
}
