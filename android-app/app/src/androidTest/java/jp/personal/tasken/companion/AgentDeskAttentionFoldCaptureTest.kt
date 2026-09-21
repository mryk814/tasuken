package jp.personal.tasken.companion

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test

/**
 * Foldの展開幅（#601）での見え方の記録。
 *
 * 一覧の隣に要対応の詳細（質問と回答欄）を並べた状態を撮る。
 * 判定は [AgentDeskAttentionUiTest] が行い、ここは目視の材料だけを残す。
 */
class AgentDeskAttentionFoldCaptureTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun capturesTheListAndDetailPanesSideBySide() {
        val body = mutableStateOf("25℃で進めてください。")
        composeRule.setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Row(modifier = Modifier.fillMaxSize()) {
                        Box(modifier = Modifier.weight(1f, fill = true)) {
                            AiInboxListPane(
                                uiState = TodayUiState.Cached(
                                    tasks = emptyList(),
                                    generatedAt = "2026-09-20T00:00:00Z",
                                    message = "Desktopへ接続できません。",
                                    recovery = TodayUiState.CachedRecovery.Reload,
                                ),
                                tasks = emptyList(),
                                themes = emptyList(),
                                proposals = emptyList(),
                                paneState = TodayPaneState(),
                                onRetry = {},
                                onRetryPairing = {},
                                onPair = { _, _ -> },
                                onTaskSelected = {},
                                attention = listOf(row()),
                                attentionCounts = MobileAttentionCountsDto(needsYou = 1, working = 0, queued = 0),
                                attentionFetchedAt = "2026-09-20T08:00:00Z",
                                attentionOnline = true,
                                attentionInDetailPane = true,
                                selectedAttentionId = row().attentionId,
                                onAttentionSelected = {},
                            )
                        }
                        Box(modifier = Modifier.weight(1f, fill = true).testTag("fold-detail-slot")) {
                            AttentionDetailPane(
                                row = row(),
                                body = body.value,
                                onBodyChange = { body.value = it },
                                state = AgentReplyUiState.Idle,
                                online = true,
                                onSend = {},
                                onOpenTask = {},
                                onBack = {},
                            )
                        }
                    }
                }
            }
        }

        composeRule.onNodeWithTag("attention-reply-open-${row().attentionId}").performScrollTo().performClick()
        composeRule.waitForIdle()
        capture("fold-attention-detail")
    }

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val directory =
            java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "agent-desk").apply { mkdirs() }
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        java.io.File(directory, "$name.png").outputStream().use {
            check(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
    }

    private fun row() = AttentionRow(
        attentionId = "task-work:request:1",
        kind = AttentionKind.AnswerRequest,
        taskId = "task-viscosity",
        taskTitle = "粘度測定の条件を決める",
        taskVersion = 12,
        headline = "測定温度が決まっていません。",
        summary = "測定温度が決まっていません。",
        questionOrAction = "25℃と40℃のどちらで進めますか。",
        agentLabel = "Codex",
        requestId = "33333333-3333-4333-8333-333333333333",
        canReply = true,
    )
}
