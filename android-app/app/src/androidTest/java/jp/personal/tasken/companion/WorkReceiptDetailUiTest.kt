package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class WorkReceiptDetailUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun canonicalReceiptSectionsAndOfflineCacheStateAreVisible() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    workReceiptDetailState = WorkReceiptDetailUiState.Available(
                        detail = detail(),
                        fromCache = true,
                        warning = "保存済みのWork Receiptを表示しています。",
                    ),
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("work-receipt-detail").assertIsDisplayed()
        composeRule.onNodeWithText("Offline cache").assertIsDisplayed()
        composeRule.onNodeWithText("完了").assertIsDisplayed()
        composeRule.onNodeWithText("• Gateway contract").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("確認").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("PR #472").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun failedDetailCanBeRetriedWithoutChangingTaskState() {
        var retried = ""
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    workReceiptDetailState = WorkReceiptDetailUiState.Error(
                        receiptId = "receipt-1",
                        message = "Desktopへ接続できません。",
                    ),
                    onStateAction = {},
                    onWorkReceiptRetry = { selectedTask, receiptId ->
                        retried = "${selectedTask.id}:$receiptId"
                    },
                )
            }
        }

        composeRule.onNodeWithText("詳細を再読み込み").performClick()
        assertEquals("task-1:receipt-1", retried)
    }

    @Test
    fun liveLatestReceiptEnablesAcceptAndReturnWhileCachedReceiptStaysReadOnly() {
        var reviewed = ""
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    workReceiptDetailState = WorkReceiptDetailUiState.Available(
                        detail = detail(),
                        fromCache = false,
                    ),
                    humanReviewOnline = true,
                    onStateAction = {},
                    onHumanReview = { _, action, note -> reviewed = "$action:${note.orEmpty()}" },
                )
            }
        }

        composeRule.onNodeWithTag("human-review-accept-task-1").performScrollTo().performClick()
        assertEquals("accept:", reviewed)
        composeRule.onNodeWithTag("human-review-note-task-1").performScrollTo().performTextInput("確認を追加")
        composeRule.onNodeWithTag("human-review-return-task-1").performClick()
        assertEquals("return:確認を追加", reviewed)

        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    workReceiptDetailState = WorkReceiptDetailUiState.Available(
                        detail = detail(),
                        fromCache = true,
                    ),
                    humanReviewOnline = true,
                    onStateAction = {},
                )
            }
        }
        composeRule.onNodeWithTag("human-review-accept-task-1").performScrollTo().assertIsNotEnabled()
        composeRule.onNodeWithText("最新のWork Receipt詳細を読み込んでから判断してください。").assertIsDisplayed()
    }

    @Test
    fun blockedReceiptOffersCanonicalReplyWithoutAccept() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task().copy(workState = "blocked"),
                    actionState = TaskActionUiState.Idle,
                    workReceiptDetailState = WorkReceiptDetailUiState.Available(detail(), fromCache = false),
                    humanReviewOnline = true,
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithText("AIへ情報を返す").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("human-review-accept-task-1").assertDoesNotExist()
        composeRule.onNodeWithText("返信する").assertIsDisplayed()
    }

    private fun task() = MobileTask(
        id = "task-1",
        version = 4,
        title = "AI review",
        themeId = null,
        state = "review",
        workState = "needs_human_review",
        updatedAt = "2026-08-21T10:00:00Z",
        latestWorkReceipt = MobileWorkReceiptSummary(
            id = "receipt-1",
            reportedAt = "2026-08-21T10:00:00Z",
            executorLabel = "Codex",
            summary = "確認してください。",
        ),
    )

    private fun detail() = MobileWorkReceiptDetail(
        id = "receipt-1",
        taskId = "task-1",
        executorKind = "ai_agent",
        executorLabel = "Codex",
        startedAt = "2026-08-21T09:00:00Z",
        reportedAt = "2026-08-21T10:00:00Z",
        reportKind = "report",
        summary = "確認してください。",
        completedItems = listOf("Gateway contract"),
        changedOrCreatedItems = listOf("MobileWorkReceiptDto.kt"),
        verification = listOf("instrumentation"),
        remainingWork = listOf("Fold7 signoff"),
        externalReferences = listOf(
            MobileWorkReceiptExternalReference(
                kind = "pull_request",
                provider = "github",
                displayLabel = "PR #472",
                url = "https://github.com/mryk814/tasuken/pull/472",
                externalId = "472",
            ),
        ),
        truncated = false,
    )
}
