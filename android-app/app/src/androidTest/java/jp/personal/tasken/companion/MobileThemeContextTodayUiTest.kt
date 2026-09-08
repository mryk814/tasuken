package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileThemeContextTodayUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun taskSelectionAndScrollSurviveThemeRoundTrip() {
        val repository = FixtureRepository()
        compose.setContent {
            val activityContext = LocalContext.current
            val isolated = remember(activityContext) { object : ContextWrapper(activityContext) {
                override fun getApplicationContext(): Context = this
                override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("theme-551-today-$name", mode)
            } }
            CompositionLocalProvider(LocalContext provides isolated) {
                TaskenTheme { TodayApp(viewModel(factory = TodayViewModelFactory(repository))) }
            }
        }
        compose.onAllNodesWithText(repository.task.title, useUnmergedTree = true).onFirst().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("task-detail-content").fetchSemanticsNodes().size == 1 }
        compose.onNodeWithTag("task-theme-context").performScrollTo()
        val before = compose.onNodeWithTag("task-detail-content").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        compose.onNodeWithTag("task-theme-context").performClick()
        compose.onNodeWithText(repository.theme.charter!!.purpose).assertIsDisplayed()
        compose.onNodeWithText("Taskへ戻る").performClick()
        compose.onNodeWithTag("task-title-display").assertTextContains(repository.task.title)
        compose.onNodeWithTag("task-theme-context").assertIsDisplayed()
        assertEquals(before, compose.onNodeWithTag("task-detail-content").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value())
        compose.onNodeWithTag("task-theme-context").performClick()
        compose.onNodeWithText("Taskへ戻る").performClick()
        assertEquals(before, compose.onNodeWithTag("task-detail-content").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value())
        compose.onNodeWithTag("task-title-edit-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("task-title").performTextReplacement("保存前の測定メモ")
        compose.onNodeWithTag("task-theme-context").performScrollTo().performClick()
        compose.onNodeWithText("Taskへ戻る").performClick()
        compose.onNodeWithTag("task-title").assertTextContains("保存前の測定メモ")
    }
    private class FixtureRepository : MobileTaskRepository, MobileOfflineTaskRepository, MobileThemeContextRepository {
        val theme = themeContextFixture()
        val task = MobileTask("theme-task", "測定結果を比較する", theme.id, "todo", null,
            updatedAt = "2026-09-06T08:00:00Z", description = "詳細の位置を保つ。\n".repeat(30))
        val state = MutableStateFlow(ThemeContextState(ThemeContextContent.Available, theme, "2026-09-06T08:00:00Z"))
        override fun loadToday() = MobileTodayResult.Available(listOf(task), "2026-09-06T08:00:00Z")
        override fun observeCachedTasks() = flowOf(listOf(task))
        override fun observePendingCount() = flowOf(0)
        override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?): String = error("Read-only fixture")
        override suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult = error("Read-only fixture")
        override suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult = error("Read-only fixture")
        override fun observeThemeContext(themeId: String) = state
        override suspend fun refreshThemeContext(themeId: String) = Unit
    }
}
