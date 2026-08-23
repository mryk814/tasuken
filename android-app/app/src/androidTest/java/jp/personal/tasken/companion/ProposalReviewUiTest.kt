package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
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
                    proposalReviewOnline = true,
                    onStateAction = {},
                    onProposalDecision = { _, decision -> decisions += decision },
                )
            }
        }

        composeRule.onNodeWithTag("proposal-detail-${proposal.id}").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("AI Proposal").assertIsDisplayed()
        composeRule.onNodeWithText("完了報告").assertIsDisplayed()
        composeRule.onNodeWithText("• Gateway contract").assertIsDisplayed()
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").assertIsEnabled().performClick()
        composeRule.onNodeWithTag("proposal-reject-${proposal.id}").assertIsEnabled().performClick()
        assertEquals(listOf("accept", "reject"), decisions)
    }

    @Test
    fun offlineOrStalePreviewCannotBeApproved() {
        val proposal = proposal()
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    taskWorkProposals = listOf(proposal.copy(stale = true)),
                    proposalReviewOnline = false,
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("proposal-detail-${proposal.id}").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Taskが更新されています。承認せず、AIへ再報告を依頼してください。")
            .assertIsDisplayed()
        composeRule.onNodeWithTag("proposal-approve-${proposal.id}").assertIsNotEnabled()
        composeRule.onNodeWithTag("proposal-reject-${proposal.id}").assertIsNotEnabled()
    }

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
