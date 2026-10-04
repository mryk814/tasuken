package jp.personal.tasken.companion

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Rule
import org.junit.Test

class AgentSessionTimelineUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun aiOriginAndAdoptedSessionCoexistWithoutChangingTask() {
        val time = "2026-10-03T08:00:00Z"
        val task = MobileTask("combined-task", "AI作成の測定条件を確認する", "research", "todo", "not_delegated", time,
            aiOrigin = MobileAiOrigin("Codex", time))
        val session = MobileAgentSessionDto("combined-session", "synthetic-combined-thread", "codex",
            "2026-10-03T09:00:00+09:00", "2026-10-03T10:00:00+09:00", "unknown",
            "測定条件を比較する", "条件を整理しました。", listOf("本人の確認待ち"))
        composeRule.setContent {
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayListPane(uiState = TodayUiState.Success(listOf(task), time),
                        themes = listOf(MobileTheme("research", "架空の研究")), paneState = TodayPaneState(),
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> }, onTaskSelected = {},
                        actionState = TaskActionUiState.Idle, onTaskStateAction = {}, onChecklistUpdate = { _, _ -> },
                        agentSessions = listOf(session))
                }
            }
        }
        composeRule.onNodeWithTag("agent-session-timeline").assertIsDisplayed()
        capture("combined-today-top")
        composeRule.onNodeWithTag("today-task-list").performScrollToIndex(1)
        composeRule.onNodeWithContentDescription("AI作成 · 未確認。作成元を表示").assertIsDisplayed()
        capture("combined-today-origin")
        composeRule.onNodeWithContentDescription("AI作成 · 未確認。作成元を表示").performClick()
        composeRule.onNodeWithText("Codex · 2026-10-03").assertIsDisplayed()
        composeRule.onNodeWithText("閉じる").performClick()
        composeRule.onNodeWithTag("today-task-list").performScrollToIndex(0)
        composeRule.onNodeWithTag("agent-session-combined-session").performClick()
        composeRule.onNodeWithTag("agent-session-detail").assertIsDisplayed()
        composeRule.onNodeWithText("本人の確認待ち").assertIsDisplayed()
        capture("combined-session-detail")
        composeRule.onNodeWithText("閉じる").performClick()
        composeRule.onNodeWithTag("today-task-list").performScrollToIndex(1)
        composeRule.onNodeWithContentDescription("AI作成 · 未確認。作成元を表示").assertIsDisplayed()
        org.junit.Assert.assertEquals("todo", task.state)
    }

    @Test
    fun todayWithNoTasksOpensAdoptedAgentSessionDetails() {
        val sessions = listOf(
            MobileAgentSessionDto("fixture-codex", "synthetic-native-thread", "codex", "2026-10-03T09:00:00+09:00", "2026-10-03T10:00:00+09:00", "completed", "週のAI作業を俯瞰できるようにする", "週表示とRepository filterを追加しました。", listOf("Android実機で確認")),
            MobileAgentSessionDto("fixture-opencode", "synthetic-opencode", "opencode", "2026-10-03T09:30:00+09:00", "2026-10-03T11:00:00+09:00", "unknown", "Session詳細を確認する", "選択した履歴を安全に取り込めました。"),
        )
        composeRule.setContent {
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayListPane(
                        uiState = TodayUiState.Empty, themes = emptyList(), paneState = TodayPaneState(),
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> }, onTaskSelected = {},
                        actionState = TaskActionUiState.Idle, onTaskStateAction = {}, onChecklistUpdate = { _, _ -> },
                        agentSessions = sessions,
                    )
                }
            }
        }
        composeRule.onNodeWithTag("agent-session-timeline").assertIsDisplayed()
        composeRule.onNodeWithText("OpenCode · 終了未確認").assertIsDisplayed()
        capture("android-today")
        composeRule.onNodeWithTag("agent-session-fixture-codex").performClick()
        composeRule.onNodeWithTag("agent-session-detail").assertIsDisplayed()
        composeRule.onNodeWithText("Android実機で確認").assertIsDisplayed()
        composeRule.onNodeWithText("synthetic-native-thread").performScrollTo().assertIsDisplayed()
        capture("android-detail")
        composeRule.onNodeWithText("閉じる").performScrollTo().performClick()
        composeRule.onNodeWithTag("agent-session-timeline").assertIsDisplayed()
    }

    @Test
    fun unavailableLogOffersRetryWithoutRemovingTasks() {
        composeRule.setContent {
            TaskenTheme {
                AgentSessionTimeline(emptyList(), unavailable = true)
            }
        }
        composeRule.onNodeWithText("AIログを取得できませんでした").assertIsDisplayed()
        composeRule.onNodeWithText("再読込").assertIsDisplayed()
    }

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        SystemClock.sleep(200)
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "agent-work-logs")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
