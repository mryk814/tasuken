package jp.personal.tasken.companion

import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * 提案を決める型（#774）の、採る（判が降りる）・見送る（右へ流れる）・帯（印と 5 秒の線）・取り消し（戻る）を撮る。
 * 撮った物は `files/decision-look` に残る（取り出し方は OfflineLookCaptureTest の頭）。
 */
class ProposalDecisionLookCaptureTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun light() = decide(dark = false)

    @Test fun dark() = decide(dark = true)

    private fun decide(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        val proposal = proposal()
        val decided = mutableStateOf<Map<String, String>>(emptyMap())
        val band = mutableStateOf<HeldProposalDecision?>(null)
        val pressed = mutableListOf<String>()
        composeRule.setContent {
            Themed(dark) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Box(Modifier.fillMaxSize()) {
                        TodayDetailPane(
                            task = task(),
                            actionState = TaskActionUiState.Idle,
                            taskWorkProposals = listOf(proposal),
                            decidedProposals = decided.value,
                            onStateAction = {},
                            onProposalDecision = { target, decision ->
                                pressed += decision
                                decided.value = decided.value + (target.id to decision)
                                band.value = HeldProposalDecision("command-${pressed.size}", target.id, decision, System.currentTimeMillis())
                            },
                        )
                        DecisionBand(
                            band = band.value,
                            onUndo = { held ->
                                band.value = null
                                decided.value = decided.value - held.proposalId
                            },
                            modifier = Modifier.align(Alignment.TopCenter),
                        )
                    }
                }
            }
        }
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").performScrollTo()

        // 採る: 判が降りて沈んだ所（押して 140ms）と、止まっている所（400ms）。
        composeRule.mainClock.autoAdvance = false
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").performClick()
        composeRule.mainClock.advanceTimeBy(140)
        capture("decision-adopt-mid-$suffix")
        composeRule.mainClock.advanceTimeBy(260)
        capture("decision-adopt-landed-$suffix")
        composeRule.mainClock.advanceTimeBy(1_000)
        capture("decision-band-adopt-$suffix")
        composeRule.mainClock.autoAdvance = true
        composeRule.onNodeWithTag("decision-band").assertIsDisplayed()

        // 取り消す: カードが戻り、判が浮いて消える。
        composeRule.mainClock.autoAdvance = false
        composeRule.onNodeWithTag("decision-undo").performClick()
        composeRule.mainClock.advanceTimeBy(300)
        capture("decision-undo-adopt-$suffix")
        composeRule.mainClock.autoAdvance = true
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("proposal-reject-${proposal.id}").performScrollTo().assertIsDisplayed()

        // 見送る: 右へ流れる途中（120ms）と、帯。
        composeRule.mainClock.autoAdvance = false
        composeRule.onNodeWithTag("proposal-reject-${proposal.id}").performClick()
        composeRule.mainClock.advanceTimeBy(120)
        capture("decision-dismiss-mid-$suffix")
        composeRule.mainClock.advanceTimeBy(1_000)
        capture("decision-band-dismiss-$suffix")
        composeRule.mainClock.autoAdvance = true
        assertEquals(listOf("accept", "reject"), pressed)
    }

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
        SystemClock.sleep(500)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "decision-look")
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
