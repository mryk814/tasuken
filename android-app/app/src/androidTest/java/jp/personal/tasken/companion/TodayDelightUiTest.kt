package jp.personal.tasken.companion

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TodayDelightUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun swipeCompletesAndMovesToTomorrowWithoutOpeningTheTask() {
        val state = mutableStateOf<TodayUiState>(TodayUiState.Success(sampleTasks(), SYNCED_AT))
        val feedback = mutableStateOf<TaskCompletionFeedback?>(null)
        val moved = mutableListOf<Pair<String, LocalDate?>>()
        var selected: String? = null
        composeRule.setContent {
            val pane = rememberTodayPaneState(null)
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayListPane(
                        uiState = state.value,
                        themes = THEMES,
                        paneState = pane,
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> },
                        onTaskSelected = { selected = it },
                        actionState = TaskActionUiState.Idle,
                        onTaskStateAction = { task ->
                            val tasks = (state.value as TodayUiState.Success).tasks
                            state.value = TodayUiState.Success(
                                tasks.map { if (it.id == task.id) it.copy(state = if (it.state == "done") "todo" else "done") else it },
                                SYNCED_AT,
                            )
                            feedback.value = TaskCompletionFeedback(task.id, SystemClock.elapsedRealtimeNanos())
                        },
                        onChecklistUpdate = { _, _ -> },
                        onTodayDateUpdate = { task, date -> moved += task.id to date },
                        completionFeedback = feedback.value,
                    )
                }
            }
        }
        composeRule.onNodeWithText("あと4件").assertIsDisplayed()
        composeRule.onNodeWithText("1/5").assertIsDisplayed()
        capture("01-progress-header")

        composeRule.onNodeWithTag("task-swipe-t2").performTouchInput { swipeRight(startX = left + 40f, endX = right - 40f) }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("task-state-action-t2").assertContentDescriptionEquals("${TITLES[1]}を未完了に戻す")
        composeRule.onNodeWithText("あと3件").assertIsDisplayed()
        assertEquals(null, selected)

        composeRule.onNodeWithTag("task-swipe-t3").performTouchInput { swipeLeft(startX = right - 40f, endX = left + 40f) }
        composeRule.waitForIdle()
        assertEquals(listOf("t3" to LocalDate.now().plusDays(1)), moved)
        assertEquals(null, selected)

        // 完了の粒が広がっている途中を撮る。
        composeRule.mainClock.autoAdvance = false
        composeRule.onNodeWithTag("task-state-action-t4").performTouchInput { down(center); up() }
        composeRule.mainClock.advanceTimeBy(160)
        captureNow("02-completion-burst")
        composeRule.mainClock.autoAdvance = true
        composeRule.waitForIdle()
        capture("03-after-completions")

        // 表示中に最後の1件を終えた時だけ、全部完了を祝う。
        composeRule.onNodeWithTag("task-swipe-t5").performTouchInput { swipeRight(startX = left + 40f, endX = right - 40f) }
        composeRule.waitForIdle()
        composeRule.onNodeWithText("あと1件").assertIsDisplayed()
        composeRule.onNodeWithTag("task-swipe-t3").performTouchInput { swipeRight(startX = left + 40f, endX = right - 40f) }
        composeRule.waitForIdle()
        composeRule.onNodeWithText("ぜんぶ完了！おつかれさま").assertIsDisplayed()
        composeRule.onNodeWithText("5/5").assertIsDisplayed()
        capture("04-all-done")
    }

    @Test
    fun headerCollapsesWhileTheListIsScrolled() {
        val many = (1..20).map { index ->
            MobileTask(
                id = "m$index", title = "比較実験 $index：測定条件を確認する", themeId = "catalyst",
                state = if (index <= 3) "done" else "todo", workState = null, updatedAt = SYNCED_AT,
                todayDate = LocalDate.now().toString(),
            )
        }
        composeRule.setContent {
            val pane = rememberTodayPaneState(null)
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayListPane(
                        uiState = TodayUiState.Success(many, SYNCED_AT), themes = THEMES, paneState = pane,
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> }, onTaskSelected = {},
                        actionState = TaskActionUiState.Idle,
                        onTaskStateAction = {}, onChecklistUpdate = { _, _ -> },
                    )
                }
            }
        }
        composeRule.onNodeWithTag("today-task-list").performScrollToNode(hasText("比較実験 15：測定条件を確認する"))
        composeRule.waitForIdle()
        composeRule.onNodeWithText("あと17件").assertIsDisplayed()
        capture("08-collapsed-header")
    }

    @Test
    fun offlineAndRepairStatesKeepReasonAndRecoveryVisible() {
        val state = mutableStateOf<TodayUiState>(
            TodayUiState.Cached(sampleTasks(), SYNCED_AT, "PCへの接続を確認できませんでした。", TodayUiState.CachedRecovery.Reload),
        )
        composeRule.setContent {
            val pane = rememberTodayPaneState(null)
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayListPane(
                        uiState = state.value, themes = THEMES, paneState = pane,
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> }, onTaskSelected = {},
                        actionState = TaskActionUiState.Idle,
                        onTaskStateAction = {}, onChecklistUpdate = { _, _ -> },
                    )
                }
            }
        }
        composeRule.onNodeWithText("端末に保存済み").assertIsDisplayed()
        composeRule.onNodeWithText("PCへの接続を確認できませんでした。").assertIsDisplayed()
        capture("05-offline")
        composeRule.runOnIdle {
            state.value = TodayUiState.Cached(sampleTasks(), SYNCED_AT, "Desktopとの接続をやり直してください。", TodayUiState.CachedRecovery.RePair)
        }
        composeRule.onNodeWithText("再接続").assertIsDisplayed()
        capture("06-repair")
    }

    @Test
    fun shellLeadsWithProgressAndKeepsCaptureEntrances() {
        val repository = object : MobileTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(sampleTasks(), SYNCED_AT)
        }
        val viewModel = TodayViewModel(repository)
        composeRule.setContent { TaskenTheme { TodayApp(todayViewModel = viewModel) } }
        composeRule.waitUntil(5_000) { viewModel.uiState.value is TodayUiState.Success }
        composeRule.onNodeWithText("あと4件").assertIsDisplayed()
        capture("07-shell")
    }

    private fun sampleTasks(): List<MobileTask> = TITLES.mapIndexed { index, title ->
        MobileTask(
            id = "t${index + 1}",
            title = title,
            themeId = if (index % 2 == 0) "catalyst" else "sample",
            state = if (index == 5) "done" else "todo",
            workState = null,
            updatedAt = SYNCED_AT,
            todayDate = LocalDate.now().toString(),
            checklistItems = if (index == 0) {
                listOf(
                    MobileChecklistItem("c1", "測定値を確認", done = true, sortOrder = 1.0),
                    MobileChecklistItem("c2", "比較図を作る", done = false, sortOrder = 2.0),
                )
            } else {
                emptyList()
            },
        )
    }.take(5).let { tasks -> tasks.mapIndexed { i, t -> if (i == 0) t.copy(state = "done") else t } }

    private fun capture(name: String) {
        composeRule.waitForIdle()
        composeRule.mainClock.advanceTimeBy(64)
        composeRule.waitForIdle()
        captureNow(name)
    }

    private fun captureNow(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        SystemClock.sleep(200)
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "today-delight-20260927")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }

    companion object {
        private const val SYNCED_AT = "2026-09-27T00:05:00Z"
        private val THEMES = listOf(MobileTheme("catalyst", "触媒探索"), MobileTheme("sample", "試料評価"))
        private val TITLES = listOf(
            "触媒Aの測定結果を比較",
            "試料Bを準備",
            "考察メモを見直す",
            "比較図を作る",
            "温度条件の違いを記録",
        )
    }
}
