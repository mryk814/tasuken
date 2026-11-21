package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ProposalReviewUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun safeProposalSectionsCanBeApprovedOrRejectedWhileOnline() {
        val decisions = mutableListOf<String>()
        val proposal = proposal()
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    taskWorkProposals = listOf(proposal),
                    onStateAction = {},
                    onProposalDecision = { _, decision -> decisions += decision },
                )
            }
        }

        composeRule.onNodeWithTag("proposal-detail-${proposal.id}").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("AIの提案").assertIsDisplayed()
        composeRule.onNodeWithText("完了報告").assertIsDisplayed()
        composeRule.onNodeWithText("• Gateway contract").assertIsDisplayed()
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").assertIsEnabled().performClick()
        composeRule.onNodeWithTag("proposal-reject-${proposal.id}").assertIsEnabled().performClick()
        assertEquals(listOf("accept", "reject"), decisions)
    }

    @Test
    fun stalePreviewCannotBeApprovedButCanBeRejected() {
        val decisions = mutableListOf<String>()
        val proposal = proposal()
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    taskWorkProposals = listOf(proposal.copy(stale = true)),
                    onStateAction = {},
                    onProposalDecision = { _, decision -> decisions += decision },
                )
            }
        }

        composeRule.onNodeWithTag("proposal-detail-${proposal.id}").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Taskが更新されています。採らずに、AIへ再報告を依頼してください。")
            .assertIsDisplayed()
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").assertIsNotEnabled()
        composeRule.onNodeWithTag("proposal-reject-${proposal.id}").performScrollTo().assertIsEnabled().performClick()
        assertEquals(listOf("reject"), decisions)
    }

    /**
     * 送る途中の答え（取り消しの待ちの間も、届くまでも）のカードは外れて見えない（#774）。
     * 外れていく動きの間に押しても、答えを重ねない。
     */
    @Test
    fun aQueuedAnswerTakesTheCardOutAndCannotBePressedAgain() {
        val decisions = mutableListOf<String>()
        val proposal = proposal()
        val decided = mutableStateOf<Map<String, String>>(emptyMap())
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    taskWorkProposals = listOf(proposal),
                    proposalDecisions = listOf(decision(proposal, state = OutboxState.Pending)),
                    decidedProposals = decided.value,
                    onStateAction = {},
                    onProposalDecision = { _, decision -> decisions += decision },
                )
            }
        }

        // 列の答えが画面に届く前（外す前）でも、もう一度は押させない。
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").performScrollTo().performClick()
        assertEquals(emptyList<String>(), decisions)

        decided.value = mapOf(proposal.id to "accept")
        // 判が降りて止まり、薄れて詰まるまで（動きを減らす設定でも 500ms 置く）。
        composeRule.mainClock.advanceTimeBy(2_000)
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("proposal-detail-${proposal.id}").assertDoesNotExist()
    }

    /** 受け取られなかった答えは理由と一緒に残り、提案がまだ待っていれば、もう一度答えられ、閉じられる。 */
    @Test
    fun aReturnedAnswerKeepsItsReasonAndTheProposalCanBeAnsweredAgain() {
        val decisions = mutableListOf<String>()
        val discarded = mutableListOf<String>()
        val proposal = proposal()
        val returned = decision(proposal, state = OutboxState.Rejected, reason = PROPOSAL_DECISION_CONFLICT)
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    taskWorkProposals = listOf(proposal),
                    proposalDecisions = listOf(returned),
                    onStateAction = {},
                    onProposalDecision = { _, decision -> decisions += decision },
                    onProposalDecisionDiscard = { discarded += it },
                )
            }
        }

        composeRule.onNodeWithTag("proposal-decision-returned-${returned.commandId}").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("「採る」は届きませんでした").assertIsDisplayed()
        composeRule.onNodeWithText(PROPOSAL_DECISION_CONFLICT).assertIsDisplayed()
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").performScrollTo().assertIsEnabled().performClick()
        composeRule.onNodeWithTag("proposal-decision-discard-${returned.commandId}").performScrollTo().performClick()
        assertEquals(listOf("accept"), decisions)
        assertEquals(listOf(returned.commandId), discarded)
    }

    /** 提案が PC で片付いて無くなっても、受け取られなかった答えは閉じるまで Task の詳細に残る。 */
    @Test
    fun aReturnedAnswerStaysOnTheTaskAfterTheProposalIsGone() {
        val discarded = mutableListOf<String>()
        val returned = decision(proposal(), state = OutboxState.Rejected, reason = PROPOSAL_DECISION_CONFLICT)
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    proposalDecisions = listOf(returned),
                    onStateAction = {},
                    onProposalDecisionDiscard = { discarded += it },
                )
            }
        }

        composeRule.onNodeWithTag("proposal-decision-card-${returned.commandId}").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("proposal-decision-discard-${returned.commandId}").performScrollTo().performClick()
        assertEquals(listOf(returned.commandId), discarded)
    }

    /** Task が写しから消えていても、受け取られなかった答えは同期の一覧から閉じられる。 */
    @Test
    fun aReturnedAnswerCanBeClosedFromTheSyncSheetWithoutItsTask() {
        val closed = mutableListOf<String>()
        val returned = decision(proposal(), state = OutboxState.Rejected, reason = PROPOSAL_DECISION_GONE).copy(code = "not_found")
        val summary = syncSummary(
            TodayUiState.Success(emptyList(), "2026-11-21T00:00:00Z"),
            pending = 0, tasks = emptyList(), captures = emptyList(), recoveredInputs = 0,
            proposalDecisions = listOf(returned),
        )
        composeRule.setContent {
            MaterialTheme {
                SyncStatusSheet(
                    summary = summary,
                    refreshing = false,
                    onSyncNow = {},
                    onRepair = {},
                    onOpenUnsentCaptures = {},
                    onOpenRecoveredInputs = {},
                    onDismiss = {},
                    onCloseProposalDecision = { closed += it },
                )
            }
        }

        composeRule.onNodeWithText("「採る」を確かめられませんでした。$PROPOSAL_DECISION_GONE").assertIsDisplayed()
        composeRule.onNodeWithTag("sync-returned-open-0").assertDoesNotExist()
        composeRule.onNodeWithTag("sync-returned-close-0").performClick()
        assertEquals(listOf(returned.commandId), closed)
    }

    private fun decision(proposal: MobileTaskWorkProposal, state: String, reason: String? = null) = MobileProposalDecision(
        commandId = "command-1",
        proposalId = proposal.id,
        taskId = proposal.taskId,
        decision = "accept",
        state = state,
        reason = reason,
    )

    private fun task() = MobileTask(
        id = "task-1",
        title = "AI review",
        themeId = null,
        state = "review",
        workState = "needs_human_review",
        updatedAt = "2026-08-21T10:00:00Z",
    )

    private fun proposal() = MobileTaskWorkProposal(
        id = "11111111-1111-5111-8111-111111111111",
        version = 1,
        taskId = "task-1",
        taskVersion = 3,
        taskTitle = "AI review",
        themeId = null,
        workState = "in_progress",
        action = "report_done",
        caller = "Hermes",
        sourceApp = "hermes-discord",
        receivedAt = "2026-08-21T10:00:00Z",
        expectedTaskVersion = 3,
        stale = false,
        executorLabel = "Hermes",
        startedAt = "2026-08-21T09:00:00Z",
        reportedAt = "2026-08-21T10:00:00Z",
        summary = "確認してください。",
        completedItems = listOf("Gateway contract"),
        changedOrCreatedItems = listOf("MobileProposalDto.kt"),
        verification = listOf("instrumentation"),
        remainingWork = listOf("Fold7 signoff"),
        externalReferences = emptyList(),
        truncated = false,
    )
}
