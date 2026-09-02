package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TaskDelegationUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun aiReadyToggleRequestsOnlyTheFlagChange() {
        val request = mutableStateOf<Pair<String, Boolean>?>(null)
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task(),
                    actionState = TaskActionUiState.Idle,
                    aiReadyState = AiReadyUiState.Idle,
                    onStateAction = {},
                    onTaskAiReady = { task, enabled -> request.value = task.id to enabled },
                )
            }
        }
        composeRule.onNodeWithContentDescription("AI Readyにする").assertExists()
        composeRule.onNodeWithTag("task-ai-ready-toggle-task-1").assertIsOff().assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals("task-1" to true, request.value) }
    }

    @Test
    fun readyTaskCanBeReturnedToHumanWork() {
        val request = mutableStateOf<Pair<String, Boolean>?>(null)
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task().copy(workState = "ready_for_agent"),
                    actionState = TaskActionUiState.Idle,
                    aiReadyState = AiReadyUiState.Idle,
                    onStateAction = {},
                    onTaskAiReady = { task, enabled -> request.value = task.id to enabled },
                )
            }
        }
        composeRule.onNodeWithContentDescription("AI Readyを解除").assertExists()
        composeRule.onNodeWithTag("task-ai-ready-toggle-task-1").assertIsOn().assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals("task-1" to false, request.value) }
    }

    private fun task() = MobileTask(
        id = "task-1", version = 3, title = "Delegate", themeId = null, state = "todo",
        workState = "not_delegated", updatedAt = "2026-08-30T00:00:00Z",
    )

}
