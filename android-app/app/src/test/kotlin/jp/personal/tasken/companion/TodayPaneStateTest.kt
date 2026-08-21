package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TodayPaneStateTest {
    @Test
    fun selectionAndScrollRestoreAfterRecreation() {
        val before = TodayPaneState()
        before.selectedTaskId = "10000000-0000-4000-8000-000000000001"
        before.recordScroll(7, 32)
        before.captureDraft = "折りたたみ後も残す"
        before.captureOpen = true
        before.activeSection = AppSection.Tasks
        before.taskSearch = "解析"
        before.taskFilter = TaskListFilter.Done
        before.recordTaskScroll(4, 18)

        val restored = TodayPaneState.restore(before.save())

        assertEquals(before.selectedTaskId, restored.selectedTaskId)
        assertEquals(7, restored.listScrollIndex)
        assertEquals(32, restored.listScrollOffset)
        assertEquals("折りたたみ後も残す", restored.captureDraft)
        assertEquals(true, restored.captureOpen)
        assertEquals(AppSection.Tasks, restored.activeSection)
        assertEquals("解析", restored.taskSearch)
        assertEquals(TaskListFilter.Done, restored.taskFilter)
        assertEquals(4, restored.taskListScrollIndex)
        assertEquals(18, restored.taskListScrollOffset)
    }
}
