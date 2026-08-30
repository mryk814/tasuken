package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test

class TaskDelegationUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun delegationRequiresPreviewAndKeepsInputAcrossPreviewState() {
        lateinit var preview: MobileTaskContextPreview
        composeRule.setContent {
            var state by remember { mutableStateOf<TaskDelegationUiState>(TaskDelegationUiState.Idle) }
            preview = preview()
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    taskDelegationState = state,
                    onStateAction = {},
                    onTaskContextPreview = { state = TaskDelegationUiState.PreviewAvailable(preview) },
                    onTaskDelegate = { _, _, _ -> },
                )
            }
        }
        composeRule.onNodeWithTag("task-delegation-submit-task-1").assertIsNotEnabled()
        composeRule.onNodeWithTag("task-delegation-expected-task-1").performTextInput("完了条件")
        composeRule.onNodeWithTag("task-delegation-instruction-task-1").performTextInput("追加指示")
        composeRule.onNodeWithTag("task-delegation-preview-task-1").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("task-delegation-submit-task-1").assertIsEnabled()
        composeRule.onNodeWithTag("task-delegation-expected-task-1").assertTextContains("完了条件")
        composeRule.onNodeWithTag("task-delegation-instruction-task-1").assertTextContains("追加指示")
        composeRule.onNodeWithText("正式なTask本文").assertExists()
        composeRule.onNodeWithTag("task-context-preview-policy-task-1")
            .assertTextContains("可視性 agent", substring = true)
        composeRule.onNodeWithText("理由: same_theme").assertExists()
    }

    private fun task() = MobileTask(
        id = "task-1", version = 3, title = "Delegate", themeId = null, state = "todo",
        workState = "not_delegated", updatedAt = "2026-08-30T00:00:00Z",
    )

    private fun preview(): MobileTaskContextPreview {
        val fingerprint = "sha256:" + "a".repeat(64)
        val ai = MobileTaskContextPreviewAiDto(
            visibility = listOf("agent"),
            visibilitySource = "task_policy",
            authority = "read",
            freshness = "fresh",
            summaryAuthority = "canonical",
        )
        val data = MobileTaskContextPreviewDataDto(
            contextFingerprint = fingerprint,
            task = MobileTaskContextPreviewTaskDto(
                id = "task-1",
                version = 3,
                title = "Task",
                description = "正式なTask本文",
                state = "todo",
                workState = "not_delegated",
                updatedAt = "2026-08-30T00:00:00Z",
                ai = ai,
            ),
            related = MobileTaskContextPreviewRelatedDto(),
            contextSelection = MobileTaskContextSelectionDto(
                schema = "tasken-context-selection/v1",
                included = listOf(
                    MobileTaskContextSelectionIncludedDto(
                        ref = MobileTaskContextPreviewRefDto("task-1", "task"),
                        reason = "same_theme",
                        title = "Task",
                        ai = ai,
                    ),
                ),
                excluded = listOf(
                    MobileTaskContextSelectionExcludedDto(
                        ref = MobileTaskContextPreviewRefDto("hidden", "note"),
                        reason = "hidden_by_policy",
                        count = 1,
                    ),
                ),
                truncated = false,
            ),
        )
        return MobileTaskContextPreview(
            taskId = "task-1",
            taskVersion = 3,
            fingerprint = fingerprint,
            title = "Task",
            includedCount = 1,
            excludedCount = 1,
            truncated = false,
            warnings = emptyList(),
            data = data,
        )
    }
}
