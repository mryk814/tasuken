package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AiOriginUiTest {
    @get:Rule val composeRule = createComposeRule()
    @Test fun relatedNoteKeepsOriginAndProvidesTapExplanation() {
        val origin = MobileAiOrigin("Codex", "2026-10-03T08:00:00Z")
        val note = RelatedSummary("note", "ai-note", "測定条件の比較と次回の実験手順を整理したメモ", 1, "available",
            listOf(RelatedReason("related_to", "from_task")), origin)
        val state = MutableStateFlow(RelatedDocumentsState(documents = listOf(note), fetchedAt = origin.receivedAt))
        val repository = object : MobileRelatedDocumentsRepository {
            override fun observeRelatedDocuments(taskId: String) = state
            override suspend fun refreshRelatedDocuments(taskId: String, nextPage: Boolean) {}
            override suspend fun loadRelatedDocument(taskId: String, type: String, id: String) {}
        }
        composeRule.setContent { TaskenTheme { MobileRelatedDocumentsSheet(repository, "origin-task", {}) } }
        composeRule.onNodeWithContentDescription("AI作成 · 未確認。作成元を表示").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("Codex · 2026-10-03").assertIsDisplayed()
        capture("note-explanation")
        composeRule.onNodeWithText("閉じる").performClick()
        capture("note-unseen")
        composeRule.runOnIdle { state.value = state.value.copy(documents = listOf(note.copy(aiOrigin = origin.copy(seenAt = "2026-10-03T09:00:00Z")))) }
        composeRule.onNodeWithContentDescription("AI作成 · 既読。作成元を表示").assertIsDisplayed()
        capture("note-seen")
    }
    @Test fun originIsTappableAndSeenUpdateNeverChangesTaskState() {
        val origin = MobileAiOrigin("Codex", "2026-10-03T08:00:00Z")
        val task = MobileTask("origin-task", "比較実験の測定条件と観察結果を確認する長いTaskタイトル", "research", "todo", "not_delegated", origin.receivedAt, aiOrigin = origin)
        val state = mutableStateOf<TodayUiState>(TodayUiState.Success(listOf(task,
            task.copy(id = "human-task", title = "次回ミーティングの準備", aiOrigin = null)), origin.receivedAt))
        composeRule.setContent { TaskenTheme { Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
            TodayListPane(uiState = state.value, refreshing = false, themes = listOf(MobileTheme("research", "材料研究")),
                paneState = rememberTodayPaneState(null), onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> }, onTaskSelected = {},
                actionState = TaskActionUiState.Idle, onTaskStateAction = {}, onChecklistUpdate = { _, _ -> })
        } } }
        composeRule.runOnIdle { state.value = TodayUiState.Success(listOf(task.copy(aiOrigin = null)), origin.receivedAt) }
        composeRule.onNodeWithContentDescription("AI作成 · 未確認。作成元を表示").assertDoesNotExist()
        capture("task-before-no-origin")
        composeRule.runOnIdle { state.value = TodayUiState.Success(listOf(task,
            task.copy(id = "human-task", title = "次回ミーティングの準備", aiOrigin = null)), origin.receivedAt) }
        val mark = composeRule.onNodeWithContentDescription("AI作成 · 未確認。作成元を表示")
        mark.assertIsDisplayed().assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        capture("task-unseen")
        mark.performClick()
        composeRule.onNodeWithText("Codex · 2026-10-03").assertIsDisplayed()
        capture("task-explanation")
        composeRule.onNodeWithText("閉じる").performClick()
        mark.assertIsDisplayed()
        composeRule.runOnIdle { state.value = TodayUiState.Success(listOf(task.copy(aiOrigin = origin.copy(seenAt = "2026-10-03T09:00:00Z"))), origin.receivedAt) }
        composeRule.onNodeWithContentDescription("AI作成 · 既読。作成元を表示").assertIsDisplayed()
        composeRule.runOnIdle { assertEquals("todo", (state.value as TodayUiState.Success).tasks[0].state) }
        capture("task-seen")
    }
    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "ai-origin-ui")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
