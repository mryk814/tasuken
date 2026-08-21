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
                TodayDetailPane(sampleTask(), TaskActionUiState.Idle) {}
            }
        }

        composeRule.onNodeWithText("完了する").assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun doneTaskShowsVisibleReopenAction() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(sampleTask().copy(state = "done"), TaskActionUiState.Idle) {}
            }
        }

        composeRule.onNodeWithText("再開する").assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun pendingTaskExplainsWhyStateActionIsDisabled() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(sampleTask().copy(pending = true), TaskActionUiState.Idle) {}
            }
        }

        composeRule.onNodeWithText("同期後に操作").assertIsDisplayed().assertIsNotEnabled()
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
