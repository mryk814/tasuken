package jp.personal.tasken.companion

import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Rule
import org.junit.Test

/**
 * 提案への答えの見え方（#816）。答えは送信の列に積むので、圏外でも元のボタンのまま押せる。押した後の送る途中
 * （未送信の印）、受け取られなかった答え（戻りの印と理由）、提案が無くなった後に Task に残る答えを撮る。
 * 撮った物は `files/offline-look` に残る（取り出し方は OfflineLookCaptureTest の頭）。
 */
class ProposalOfflineLookCaptureTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun light() = answers(dark = false)

    @Test fun dark() = answers(dark = true)

    private fun answers(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        val proposal = proposal()
        val proposals = mutableStateOf(listOf(proposal))
        val decisions = mutableStateOf(emptyList<MobileProposalDecision>())
        composeRule.setContent {
            Themed(dark) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    TodayDetailPane(
                        task = task(),
                        actionState = TaskActionUiState.Idle,
                        taskWorkProposals = proposals.value,
                        proposalDecisions = decisions.value,
                        onStateAction = {},
                    )
                }
            }
        }
        composeRule.onNodeWithTag("proposal-reject-${proposal.id}").performScrollTo()
        capture("proposal-answer-ready-$suffix")

        decisions.value = listOf(decision(proposal, OutboxState.Pending))
        composeRule.onNodeWithTag("proposal-decision-pending-${proposal.id}").performScrollTo().assertIsDisplayed()
        capture("proposal-answer-pending-$suffix")

        val returned = decision(proposal, OutboxState.Rejected)
        decisions.value = listOf(returned)
        composeRule.onNodeWithTag("proposal-decision-returned-${returned.commandId}").performScrollTo().assertIsDisplayed()
        capture("proposal-answer-returned-$suffix")

        proposals.value = emptyList()
        composeRule.onNodeWithTag("proposal-decision-card-${returned.commandId}").performScrollTo().assertIsDisplayed()
        capture("proposal-answer-returned-gone-$suffix")
    }

    private fun decision(proposal: MobileTaskWorkProposal, state: String) = MobileProposalDecision(
        commandId = "command-1",
        proposalId = proposal.id,
        taskId = proposal.taskId,
        decision = "accept",
        state = state,
        reason = if (state == OutboxState.Rejected) PROPOSAL_DECISION_CONFLICT else null,
    )

    @Composable
    private fun Themed(dark: Boolean, content: @Composable () -> Unit) {
        val base = LocalConfiguration.current
        val configuration = Configuration(base).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
                if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        }
        CompositionLocalProvider(LocalConfiguration provides configuration) { TaskenTheme(content) }
    }

    private fun capture(name: String) {
        if (composeRule.mainClock.autoAdvance) composeRule.waitForIdle()
        SystemClock.sleep(800)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "offline-look")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }

    private fun task() = MobileTask(
        id = "task-1",
        title = "測定条件の比較をまとめる",
        themeId = null,
        state = "review",
        workState = "needs_human_review",
        updatedAt = "2026-11-16T10:00:00Z",
    )

    private fun proposal() = MobileTaskWorkProposal(
        id = "11111111-1111-5111-8111-111111111111",
        version = 1,
        taskId = "task-1",
        taskVersion = 3,
        taskTitle = "測定条件の比較をまとめる",
        themeId = null,
        workState = "in_progress",
        action = "report_done",
        caller = "Codex",
        sourceApp = "codex-cli",
        receivedAt = "2026-11-16T10:00:00Z",
        expectedTaskVersion = 3,
        stale = false,
        executorLabel = "Codex",
        startedAt = "2026-11-16T09:00:00Z",
        reportedAt = "2026-11-16T10:00:00Z",
        summary = "比較表を作りました。確かめてください。",
        completedItems = listOf("温度条件ごとの比較表"),
        changedOrCreatedItems = listOf("比較表.xlsx"),
        verification = listOf("元の測定値と突き合わせた"),
        remainingWork = listOf("考察の文"),
        externalReferences = emptyList(),
        truncated = false,
    )
}
