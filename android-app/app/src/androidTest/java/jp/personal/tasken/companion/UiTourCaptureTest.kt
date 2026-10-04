package jp.personal.tasken.companion

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import java.time.LocalDate
import org.junit.Rule
import org.junit.Test

/** UI改革の目視用。主要画面を順に撮るだけで、判定は各画面のテストが行う。 */
class UiTourCaptureTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun capturesShellSurfaces() {
        val repository = object : MobileTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(sampleTasks(), SYNCED_AT)
        }
        val viewModel = TodayViewModel(repository)
        composeRule.setContent { TaskenTheme { TodayApp(todayViewModel = viewModel) } }
        composeRule.waitUntil(5_000) { viewModel.uiState.value is TodayUiState.Success }
        capture("01-today")
        step("02-today-long-press") { composeRule.onNodeWithText(TITLES[2]).performTouchInput { longClick() } }
        back()
        step("03-capture-sheet") { composeRule.onNodeWithTag("open-capture-action").performClick() }
        step("03b-capture-memo") { composeRule.onNodeWithTag("capture-mode-memo").performClick() }
        back()
        back()
        step("04-tasks-tab") { composeRule.onNodeWithTag("nav-tasks").performClick() }
        step("06-feed-tab") { composeRule.onNodeWithTag("nav-feed").performClick() }
        step("07-records-tab") { composeRule.onNodeWithTag("nav-records").performClick() }
        step("08-sync-sheet") { composeRule.onNodeWithTag("open-sync-status").performClick() }
        back()
        step("09-settings-sheet") { composeRule.onNodeWithTag("open-settings").performClick() }
        back()
    }

    @Test
    fun capturesTaskDetail() {
        val task = sampleTasks()[1].copy(
            themeId = "catalyst",
            workState = "not_delegated",
            description = "試料Bの前処理を済ませ、比較用のロットを確保する。",
        )
        composeRule.setContent {
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayDetailPane(
                        task = task,
                        actionState = TaskActionUiState.Idle,
                        onRecordWorkLog = {},
                        onReadRelatedDocuments = {},
                        onReadThemeContext = {},
                        themes = THEMES,
                        onStateAction = {},
                        onNavigateBack = {},
                    )
                }
            }
        }
        capture("10-task-detail")
        step("11-task-detail-ai") { composeRule.onNodeWithTag("task-ai-options-toggle").performClick() }
    }

    @Test
    fun capturesFeed() {
        val now = Instant.now()
        val tasks = listOf(
            sampleTasks()[3].copy(
                workState = "in_progress",
                updatedAt = now.minusSeconds(600).toString(),
                latestWorkReceipt = MobileWorkReceiptSummary("r1", now.minusSeconds(600).toString(), "Claude", "比較図の軸を揃え、温度ごとに色を分けました。"),
            ),
            sampleTasks()[4].copy(
                workState = "needs_human_review",
                updatedAt = now.minusSeconds(5400).toString(),
                latestWorkReceipt = MobileWorkReceiptSummary("r2", now.minusSeconds(5400).toString(), "Codex", "温度条件の違いを表にまとめました。確認をお願いします。"),
            ),
        )
        val attention = listOf(
            AttentionRow(
                attentionId = "task-work:request:1",
                kind = AttentionKind.AnswerRequest,
                taskId = "t3",
                taskTitle = "粘度測定の条件を決める",
                taskVersion = 12,
                headline = "測定温度が決まっていません。",
                summary = "測定温度が決まっていません。",
                questionOrAction = "25℃と40℃のどちらで進めますか。",
                agentLabel = "Codex",
                requestId = "33333333-3333-4333-8333-333333333333",
                canReply = true,
            ),
        )
        composeRule.setContent {
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    FeedListPane(
                        uiState = TodayUiState.Success(tasks, SYNCED_AT),
                        tasks = tasks,
                        themes = THEMES,
                        proposals = emptyList(),
                        feedPosts = listOf(
                            MobileFeedPostDto(
                                postId = "own-1", authorKind = "human", authorLabel = "自分", topic = "own_note",
                                createdAt = now.minusSeconds(120).toString(),
                                body = listOf("今日は粘度の実験を進める。", "温度条件は明日決める。"),
                                themeName = "触媒探索",
                            ),
                            MobileFeedPostDto(
                                postId = "ai-1", authorKind = "ai", authorLabel = "Codex", topic = "insight",
                                createdAt = now.minusSeconds(900).toString(),
                                body = listOf("温度を25℃に揃えると、粘度の再現性が上がりました。", "40℃は次回に回します。"),
                                taskId = "t3", taskTitle = "考察メモを見直す", themeName = "触媒探索",
                                attachment = MobileFeedAttachmentDto("note_draft", "粘度測定は温度を先に揃える"),
                                link = MobileFeedLinkDto("https://example.com/viscosity", "測定ガイド", null),
                            ),
                        ),
                        paneState = TodayPaneState(),
                        onRetry = {},
                        onRetryPairing = {},
                        onPair = { _, _ -> },
                        onTaskSelected = {},
                        attention = attention,
                        attentionCounts = MobileAttentionCountsDto(needsYou = 1, working = 1, queued = 0),
                        attentionFetchedAt = now.toString(),
                        attentionOnline = true,
                        seenBefore = now.minusSeconds(3600),
                    )
                }
            }
        }
        capture("12-feed")
        step("13-feed-long-press") { composeRule.onNodeWithText(TITLES[3]).performTouchInput { longClick() } }
        back()
        step("14-feed-needs-you") { composeRule.onNodeWithTag("feed-filter-needs-you").performClick() }
    }

    private fun step(name: String, action: () -> Unit) {
        runCatching(action).onFailure { android.util.Log.w("UiTour", "$name skipped", it) }
        capture(name)
    }

    private fun back() {
        InstrumentationRegistry.getInstrumentation().uiAutomation.performGlobalAction(
            android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK,
        )
        composeRule.waitForIdle()
        SystemClock.sleep(400)
    }

    private fun capture(name: String) {
        composeRule.waitForIdle()
        SystemClock.sleep(600)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "ui-tour")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }

    private fun sampleTasks(): List<MobileTask> = TITLES.mapIndexed { index, title ->
        MobileTask(
            id = "t${index + 1}",
            title = title,
            themeId = if (index % 2 == 0) "catalyst" else "sample",
            state = if (index == 0) "done" else "todo",
            workState = null,
            updatedAt = SYNCED_AT,
            todayDate = if (index < 5) LocalDate.now().toString() else null,
            checklistItems = if (index == 1) {
                listOf(
                    MobileChecklistItem("c1", "測定値を確認", done = true, sortOrder = 1.0),
                    MobileChecklistItem("c2", "比較図を作る", done = false, sortOrder = 2.0),
                )
            } else {
                emptyList()
            },
        )
    }

    companion object {
        private const val SYNCED_AT = "2026-10-04T00:05:00Z"
        private val THEMES = listOf(MobileTheme("catalyst", "触媒探索", "#8A2F3B"), MobileTheme("sample", "試料評価", "#3B6E9E"))
        private val TITLES = listOf(
            "触媒Aの測定結果を比較",
            "試料Bを準備",
            "考察メモを見直す",
            "比較図を作る",
            "温度条件の違いを記録",
            "学会要旨の下書き",
            "装置メンテナンスの予約",
        )
    }
}
