package jp.personal.tasken.companion

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.ui.test.assert
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
        composeRule.onNodeWithText("今日やること").assertIsDisplayed()
        composeRule.onNodeWithText("最終同期", substring = true).assertIsDisplayed()
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
        composeRule.onNodeWithText("PCと同期中").assertIsDisplayed()
        assertEquals(bounds, composeRule.onNodeWithText(task(20).title).getBoundsInRoot())
        capture("02-refreshing")
        composeRule.runOnIdle {
            refreshing.value = false
            state.value = TodayUiState.Cached(tasks, SYNCED_AT, "PCへの接続を確認できませんでした。", TodayUiState.CachedRecovery.Reload)
        }
        composeRule.onNodeWithText("端末に保存済み").assertIsDisplayed()
        composeRule.onNodeWithText("PCへの接続を確認できませんでした。").assertIsDisplayed()
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
        composeRule.onNodeWithText("今日のタスクはありません").assertIsDisplayed()
        composeRule.onNodeWithText("再接続").assertIsDisplayed()
        capture("07-synced-empty")
    }

    @Test
    fun todayShellKeepsQuickCaptureAndThreeTabsVisible() {
        val repository = object : MobileTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(
                listOf(task(0), task(1)),
                SYNCED_AT,
            )
        }
        val viewModel = TodayViewModel(repository)
        composeRule.setContent {
            TaskenTheme { TodayApp(todayViewModel = viewModel) }
        }

        composeRule.waitUntil(5_000) { viewModel.uiState.value is TodayUiState.Success }
        composeRule.onNodeWithText("今日やること").assertIsDisplayed()
        composeRule.onNodeWithText(task(0).title).assertIsDisplayed()
        composeRule.onNodeWithTag("open-capture-action").assertIsDisplayed()
        // 追加の入口は1つ。長押しで話して追加できる。
        composeRule.onNodeWithTag("open-capture-action")
            .assert(androidx.compose.ui.test.SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsActions.OnLongClick))
        composeRule.onNodeWithText("ToDo").assertIsDisplayed()
        composeRule.onNodeWithText("AI").assertIsDisplayed()
        capture("08-today-shell")
    }

    @Test
    fun completionKeepsTheTaskInPlaceAndDoesNotSelectTheNextRow() {
        val tasks = (0..30).map(::task)
        val state = mutableStateOf<TodayUiState>(TodayUiState.Success(tasks, SYNCED_AT))
        val actionState = mutableStateOf<TaskActionUiState>(TaskActionUiState.Idle)
        lateinit var pane: TodayPaneState
        var selectedTaskId: String? = null
        composeRule.setContent {
            pane = rememberTodayPaneState(null)
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayListPane(
                        uiState = state.value,
                        themes = listOf(MobileTheme("research", "材料研究")),
                        paneState = pane,
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> },
                        onTaskSelected = { selectedTaskId = it },
                        actionState = actionState.value,
                        onTaskStateAction = { completed ->
                            val currentTasks = (state.value as TodayUiState.Success).tasks
                            state.value = TodayUiState.Success(
                                currentTasks.map { if (it.id == completed.id) it.copy(state = "done") else it },
                                SYNCED_AT,
                            )
                            actionState.value = TaskActionUiState.Queued(completed.id, requiresSync = true)
                        },
                        onChecklistUpdate = { _, _ -> },
                    )
                }
            }
        }
        composeRule.onNodeWithTag("today-task-list").performScrollToNode(hasText(task(21).title))
        composeRule.waitForIdle()
        val titleBounds = composeRule.onNodeWithText(task(20).title).getBoundsInRoot()
        val nextTitleBounds = composeRule.onNodeWithText(task(21).title).getBoundsInRoot()
        val controlBounds = composeRule.onNodeWithTag("task-state-action-task-20").getBoundsInRoot()
        val scroll = composeRule.runOnIdle { pane.listScrollIndex to pane.listScrollOffset }

        composeRule.onNodeWithTag("task-state-action-task-20").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithText(task(20).title).assertIsDisplayed()
        composeRule.onNodeWithTag("task-state-action-task-20")
            .assertContentDescriptionEquals("${task(20).title}を未完了に戻す")
        assertEquals(titleBounds, composeRule.onNodeWithText(task(20).title).getBoundsInRoot())
        assertEquals(controlBounds, composeRule.onNodeWithTag("task-state-action-task-20").getBoundsInRoot())
        assertEquals(scroll, composeRule.runOnIdle { pane.listScrollIndex to pane.listScrollOffset })
        assertEquals(null, selectedTaskId)
        assertEquals(TaskActionUiState.Queued("task-20", requiresSync = true), actionState.value)

        composeRule.onNodeWithTag("task-state-action-task-21").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("task-state-action-task-20")
            .assertContentDescriptionEquals("${task(20).title}を未完了に戻す")
        composeRule.onNodeWithTag("task-state-action-task-21")
            .assertContentDescriptionEquals("${task(21).title}を未完了に戻す")
        assertEquals(nextTitleBounds, composeRule.onNodeWithText(task(21).title).getBoundsInRoot())
        assertEquals(scroll, composeRule.runOnIdle { pane.listScrollIndex to pane.listScrollOffset })
        assertEquals(null, selectedTaskId)
        assertEquals(TaskActionUiState.Queued("task-21", requiresSync = true), actionState.value)
        capture("09-task-completed")
    }

    @Test
    fun gatewayFailureKeepsBothRecoveryActionsAvailable() {
        val actions = mutableListOf<String>()
        composeRule.setContent {
            val pane = rememberTodayPaneState(null)
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayListPane(
                        uiState = TodayUiState.Error(
                            message = "PCへ接続できませんでした。",
                            recovery = "接続先を確認して再試行してください。",
                        ),
                        themes = emptyList(),
                        paneState = pane,
                        onRetry = { actions += "reload" },
                        onRetryPairing = { actions += "pairing" },
                        onPair = { _, _ -> },
                        onTaskSelected = {},
                        actionState = TaskActionUiState.Idle,
                        onTaskStateAction = {},
                        onChecklistUpdate = { _, _ -> },
                    )
                }
            }
        }

        composeRule.onNodeWithText("PCへ接続できませんでした。").assertIsDisplayed()
        composeRule.onNodeWithText("再読み込み").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("やり直す").assertIsDisplayed().performClick()
        assertEquals(listOf("reload", "pairing"), actions)
        capture("10-gateway-failure")
    }

    private fun task(index: Int) = MobileTask(
        id = "task-$index",
        title = if (index == 0) {
            "比較実験 1：測定条件と観察結果を整理し、次の試験手順を確認する長いTaskタイトル"
        } else {
            "比較実験 ${index + 1}：測定条件と観察結果を確認する"
        },
        themeId = "research", state = "todo", workState = null,
        updatedAt = SYNCED_AT,
    )

    private fun capture(name: String) {
        composeRule.waitForIdle()
        composeRule.mainClock.advanceTimeBy(64)
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync()
        SystemClock.sleep(200)
        val directory = File(
            instrumentation.targetContext.getExternalFilesDir(null),
            "today-offline-delight-20260927",
        )
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }

    companion object { private const val SYNCED_AT = "2026-09-06T00:00:00Z" }
}
