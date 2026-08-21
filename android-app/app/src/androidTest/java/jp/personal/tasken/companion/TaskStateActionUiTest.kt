package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test

class TaskStateActionUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun todoTaskShowsVisibleCompleteAction() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(sampleTask(), TaskActionUiState.Idle, onStateAction = {})
            }
        }

        composeRule.onNodeWithText("完了する").assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun doneTaskShowsVisibleReopenAction() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(sampleTask().copy(state = "done"), TaskActionUiState.Idle, onStateAction = {})
            }
        }

        composeRule.onNodeWithText("再開する").assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun pendingTaskExplainsWhyStateActionIsDisabled() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(sampleTask().copy(pending = true), TaskActionUiState.Idle, onStateAction = {})
            }
        }

        composeRule.onNodeWithText("同期後に操作").assertIsDisplayed().assertIsNotEnabled()
    }

    @Test
    fun conflictedTaskShowsBothExplicitResolutionActions() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    sampleTask().copy(
                        conflict = MobileTaskConflict(
                            commandId = "command-1",
                            intendedAction = "CompleteTask",
                            expectedVersion = 7,
                            serverVersion = 8,
                            serverState = "todo",
                            detectedAt = "2026-08-22T01:00:00Z",
                        ),
                    ),
                    TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithText("同期できなかった変更").assertIsDisplayed()
        composeRule.onNodeWithText("Desktop  未着手  v8").assertIsDisplayed()
        composeRule.onNodeWithText("この端末を採用").assertIsDisplayed().assertIsEnabled()
        composeRule.onNodeWithText("Desktopを採用").assertIsDisplayed().assertIsEnabled()
        composeRule.onNodeWithText("競合を解決してから操作").assertIsDisplayed().assertIsNotEnabled()
    }

    private fun sampleTask() = MobileTask(
        id = "10000000-0000-4000-8000-000000000001",
        title = "Task",
        themeId = null,
        state = "todo",
        workState = null,
        updatedAt = "2026-08-21T09:00:00.000Z",
    )
}
