package jp.personal.tasken.companion

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AiTimelineUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun timelineShowsYourTurnFirstThenAiActivityNewestFirstWithSeenDivider() {
        val now = Instant.now()
        val tasks = listOf(
            aiTask("t-old", "粘度の文献を整理", "accepted", now.minusSeconds(3 * 86_400), "文献12件を条件別に表へまとめました。"),
            aiTask("t-new", "触媒Aの比較表を作る", "needs_human_review", now.minusSeconds(8 * 60), "3条件の比較表を作成しました。温度依存が大きいです。"),
            aiTask("t-work", "測定データを取り込む", "in_progress", now.minusSeconds(2 * 3_600), null),
        )
        val proposal = proposal(now.minusSeconds(40 * 60))
        var opened: String? = null
        composeRule.setContent {
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    AiInboxListPane(
                        uiState = TodayUiState.Success(tasks, now.toString()),
                        tasks = tasks,
                        themes = listOf(MobileTheme("catalyst", "触媒探索")),
                        proposals = listOf(proposal),
                        paneState = TodayPaneState(),
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> },
                        onTaskSelected = { opened = it },
                        attention = listOf(question()),
                        attentionCounts = MobileAttentionCountsDto(needsYou = 1, working = 1, queued = 0),
                        attentionFetchedAt = now.toString(),
                        attentionOnline = true,
                        seenBefore = now.minusSeconds(86_400),
                    )
                }
            }
        }
        composeRule.onNodeWithText("対応待ち 1").assertIsDisplayed()
        composeRule.onNodeWithText("25℃と40℃のどちらで進めますか。").assertIsDisplayed()
        composeRule.onNodeWithText("AIの動き").assertIsDisplayed()
        composeRule.onNodeWithText("8分前", substring = true).assertIsDisplayed()
        composeRule.onNodeWithTag("ai-seen-divider").assertIsDisplayed()

        // 新しい順：比較表（8分前）→ 提案（40分前）→ 取り込み（2時間前）→ 区切り → 文献（3日前）
        val newest = composeRule.onNodeWithText("触媒Aの比較表を作る").getBoundsInRoot().top
        val proposalTop = composeRule.onNodeWithText("考察メモを更新").getBoundsInRoot().top
        val divider = composeRule.onNodeWithTag("ai-seen-divider").getBoundsInRoot().top
        assertTrue(newest < proposalTop)
        assertTrue(proposalTop < divider)
        capture("01-ai-timeline")

        composeRule.onNodeWithText("触媒Aの比較表を作る").performClick()
        assertEquals("t-new", opened)
    }

    @Test
    fun timelineOrderAndRelativeTimeAreStable() {
        val now = Instant.parse("2026-09-27T12:00:00Z")
        assertEquals("たった今", relativeTimeLabel(now.minusSeconds(20), now))
        assertEquals("5分前", relativeTimeLabel(now.minusSeconds(300), now))
        assertEquals("3時間前", relativeTimeLabel(now.minusSeconds(3 * 3_600), now))
        assertEquals("昨日", relativeTimeLabel(now.minusSeconds(30 * 3_600), now))
        val entries = buildAiTimeline(
            listOf(
                aiTask("a", "A", "completed", now.minusSeconds(100), null),
                aiTask("b", "B", "blocked", now.minusSeconds(10), null),
                aiTask("c", "C", null, now, null),
            ),
            emptyList(),
        )
        assertEquals(listOf("timeline-task-b", "timeline-task-a"), entries.map { it.key })
    }

    private fun aiTask(id: String, title: String, workState: String?, at: Instant, summary: String?) = MobileTask(
        id = id,
        title = title,
        themeId = "catalyst",
        state = "doing",
        workState = workState,
        updatedAt = at.toString(),
        latestWorkReceipt = summary?.let { MobileWorkReceiptSummary("r-$id", at.toString(), "Codex", it) },
    )

    private fun proposal(at: Instant) = MobileTaskWorkProposal(
        id = "p-1", version = 1, taskId = "t-memo", taskVersion = 1, taskTitle = "考察メモを更新",
        themeId = "catalyst", workState = "in_progress", action = "report_done", caller = "Hermes",
        sourceApp = "hermes-discord", receivedAt = at.toString(), expectedTaskVersion = 1, stale = false,
        executorLabel = "Hermes", startedAt = null, reportedAt = at.toString(),
        summary = "温度条件ごとの差を考察メモへ追記しました。", completedItems = emptyList(),
        changedOrCreatedItems = emptyList(), verification = emptyList(), remainingWork = emptyList(),
        externalReferences = emptyList(), truncated = false,
    )

    private fun question() = AttentionRow(
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

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        SystemClock.sleep(200)
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "today-delight-20260927")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
