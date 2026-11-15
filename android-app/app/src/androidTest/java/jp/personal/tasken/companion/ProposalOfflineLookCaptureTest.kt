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
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Rule
import org.junit.Test

/**
 * つながらない時の提案の「採る」「見送る」（共通の「使えない」の形）と、押した時の首振りと一言、つながった後を撮る。
 * 撮った物は `files/offline-look` に残る（取り出し方は OfflineLookCaptureTest の頭）。
 */
class ProposalOfflineLookCaptureTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun light() = offlineThenOnline(dark = false)

    @Test fun dark() = offlineThenOnline(dark = true)

    @Test fun checkingLight() = checking(dark = false)

    @Test fun checkingDark() = checking(dark = true)

    /** 読み直しの間。「使えない」の形にせず、元のボタンを押せない状態で出す。 */
    private fun checking(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        val proposal = proposal()
        composeRule.setContent {
            Themed(dark) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    TodayDetailPane(
                        task = task(),
                        actionState = TaskActionUiState.Idle,
                        taskWorkProposals = listOf(proposal),
                        proposalReviewOnline = false,
                        proposalReviewChecking = true,
                        onStateAction = {},
                    )
                }
            }
        }
        composeRule.onNodeWithTag("proposal-reject-${proposal.id}").performScrollTo()
        capture("proposal-checking-$suffix")
    }

    private fun offlineThenOnline(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        val online = mutableStateOf(false)
        val proposal = proposal()
        composeRule.setContent {
            Themed(dark) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    TodayDetailPane(
                        task = task(),
                        actionState = TaskActionUiState.Idle,
                        taskWorkProposals = listOf(proposal),
                        proposalReviewOnline = online.value,
                        onStateAction = {},
                    )
                }
            }
        }
        composeRule.onNodeWithTag("proposal-reject-${proposal.id}").performScrollTo()
        capture("proposal-offline-$suffix")

        // 1 回押して一言を出し、見える所まで送る。止めた時計のままでは送りが待ち続けるので、ここは動かしたまま。
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").performClick()
        composeRule.onNodeWithTag("proposal-offline-hint-${proposal.id}").performScrollTo().assertIsDisplayed()
        // もう一度押し、首を一番大きく振った所（-14°、押して 80ms）で止めて撮る。
        composeRule.mainClock.autoAdvance = false
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").performClick()
        composeRule.mainClock.advanceTimeBy(80)
        capture("proposal-offline-nudged-$suffix")
        composeRule.mainClock.autoAdvance = true

        online.value = true
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("proposal-offline-hint-${proposal.id}").assertDoesNotExist()
        capture("proposal-online-$suffix")
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
