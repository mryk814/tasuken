package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TodayPaneStateTest {
    @Test
    fun selectionAndScrollRestoreAfterRecreation() {
        val before = TodayPaneState()
        before.selectedTaskId = "10000000-0000-4000-8000-000000000001"
        before.recordScroll(7, 32)

        val restored = TodayPaneState.restore(before.save())

        assertEquals(before.selectedTaskId, restored.selectedTaskId)
        assertEquals(7, restored.listScrollIndex)
        assertEquals(32, restored.listScrollOffset)
    }
}
