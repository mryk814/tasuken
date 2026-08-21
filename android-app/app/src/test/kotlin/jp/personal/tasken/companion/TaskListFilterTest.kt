package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskListFilterTest {
    private val tasks = listOf(
        task("1", "解析計画", "todo"),
        task("2", "解析完了", "done"),
        task("3", "実験中止", "cancelled"),
    )

    @Test
    fun open_filter_excludes_terminal_tasks() {
        assertEquals(listOf("1"), filterCachedTasks(tasks, "", TaskListFilter.Open).map(MobileTask::id))
    }

    @Test
    fun done_filter_and_search_compose_without_hidden_rules() {
        assertEquals(listOf("2"), filterCachedTasks(tasks, "解析", TaskListFilter.Done).map(MobileTask::id))
        assertEquals(emptyList<String>(), filterCachedTasks(tasks, "実験", TaskListFilter.Done).map(MobileTask::id))
    }

    @Test
    fun all_filter_searches_titles_case_insensitively() {
        val english = tasks + task("4", "Review Results", "review")
        assertEquals(listOf("4"), filterCachedTasks(english, "review", TaskListFilter.All).map(MobileTask::id))
    }

    private fun task(id: String, title: String, state: String) = MobileTask(
        id = id,
        title = title,
        themeId = null,
        state = state,
        workState = null,
        updatedAt = "2026-08-22T00:00:00Z",
    )
}
