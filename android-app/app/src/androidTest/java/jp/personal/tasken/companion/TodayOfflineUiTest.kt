package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TodayOfflineUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun refreshFailureAndReconnectKeepListPositionSelectionAndDraft() {
        val tasks = (0..30).map { task(it) }
        val state = mutableStateOf<TodayUiState>(TodayUiState.Success(tasks, SYNCED_AT))
        val refreshing = mutableStateOf(false)
        val restoration = StateRestorationTester(composeRule)
        lateinit var pane: TodayPaneState
        restoration.setContent {
            pane = rememberTodayPaneState(null)
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayListPane(
                        uiState = state.value,
                        refreshing = refreshing.value,
                        themes = listOf(MobileTheme("research", "材料研究")),
                        paneState = pane,
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> },
                        onTaskSelected = { pane.selectedTaskId = it },
                        actionState = TaskActionUiState.Idle,
                        onTaskStateAction = {}, onChecklistUpdate = { _, _ -> },
                    )
                }
            }
        }
        composeRule.onNodeWithTag("today-task-list").performScrollToNode(hasText(task(20).title))
        composeRule.runOnIdle {
            pane.selectedTaskId = "task-20"
            pane.captureDraft = MobileCaptureDraft.fresh(text = "比較条件を整理中。温度と保持時間を再確認する。")
        }
        composeRule.waitForIdle()
        val bounds = composeRule.onNodeWithText(task(20).title).getBoundsInRoot()
        val scroll = pane.listScrollIndex to pane.listScrollOffset
        capture("01-saved")
        composeRule.runOnIdle { refreshing.value = true }
        composeRule.onNodeWithText("PCへの接続を確認中").assertIsDisplayed()
        assertEquals(bounds, composeRule.onNodeWithText(task(20).title).getBoundsInRoot())
        capture("02-refreshing")
        composeRule.runOnIdle {
            refreshing.value = false
            state.value = TodayUiState.Cached(tasks, SYNCED_AT, "PCへの接続を確認できませんでした。", TodayUiState.CachedRecovery.Reload)
        }
        composeRule.onNodeWithText("PCへの接続を再確認してください", substring = true).assertIsDisplayed()
        assertEquals(bounds, composeRule.onNodeWithText(task(20).title).getBoundsInRoot())
        capture("03-offline")
        restoration.emulateSavedInstanceStateRestore()
        composeRule.runOnIdle {
            assertEquals("task-20", pane.selectedTaskId)
            assertEquals("比較条件を整理中。温度と保持時間を再確認する。", pane.captureDraft.text)
            assertEquals(scroll, pane.listScrollIndex to pane.listScrollOffset)
            state.value = TodayUiState.Success(tasks, SYNCED_AT)
        }
        composeRule.onNodeWithText(task(20).title).assertIsDisplayed()
        assertEquals(bounds, composeRule.onNodeWithText(task(20).title).getBoundsInRoot())
        capture("04-reconnected")
    }

    @Test
    fun firstFetchAndSyncedEmptyHaveDifferentScreens() {
        val state = mutableStateOf<TodayUiState>(TodayUiState.Loading)
        composeRule.setContent {
            val pane = rememberTodayPaneState(null)
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayListPane(
                        uiState = state.value, themes = emptyList(), paneState = pane,
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> }, onTaskSelected = {},
                        actionState = TaskActionUiState.Idle,
                        onTaskStateAction = {}, onChecklistUpdate = { _, _ -> },
                    )
                }
            }
        }
        composeRule.onNodeWithText("Todayを読み込んでいます").assertIsDisplayed()
        capture("05-first-fetch")
        composeRule.runOnIdle { state.value = TodayUiState.PairingRequired("") }
        capture("06-unpaired")
        composeRule.runOnIdle {
            state.value = TodayUiState.Cached(emptyList(), SYNCED_AT, "接続をやり直してください。", TodayUiState.CachedRecovery.RePair)
        }
        composeRule.onNodeWithText("今日のTaskはありません").assertIsDisplayed()
        composeRule.onNodeWithText("再接続").assertIsDisplayed()
        capture("07-synced-empty")
    }

    private fun task(index: Int) = MobileTask(
        id = "task-$index", title = "比較実験 ${index + 1}：測定条件と観察結果を確認する",
        themeId = "research", state = "todo", workState = null,
        updatedAt = SYNCED_AT,
    )

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "today-offline")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }

    companion object { private const val SYNCED_AT = "2026-09-06T00:00:00Z" }
}
