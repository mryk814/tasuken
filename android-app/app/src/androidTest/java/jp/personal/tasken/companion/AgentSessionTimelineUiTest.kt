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
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Rule
import org.junit.Test

class AgentSessionTimelineUiTest {
    @get:Rule val composeRule = createComposeRule()

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
        composeRule.onNodeWithText("synthetic-native-thread").assertIsDisplayed()
        capture("android-detail")
        composeRule.onNodeWithText("閉じる").performClick()
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
