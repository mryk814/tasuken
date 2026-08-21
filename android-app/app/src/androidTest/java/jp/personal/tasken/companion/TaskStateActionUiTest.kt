package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNode
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assert.assertEquals
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
    fun unsentCompleteCanBeChangedBackToReopen() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    sampleTask().copy(state = "done", pending = true, canChangePendingState = true),
                    TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithText("再開に変更").assertIsDisplayed().assertIsEnabled()
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

    @Test
    fun titleEditIsVisibleAndSubmitsAFieldPatch() {
        var submitted = ""
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    sampleTask(),
                    TaskActionUiState.Idle,
                    onStateAction = {},
                    onTitleUpdate = { _, title -> submitted = title },
                )
            }
        }

        composeRule.onNode(hasSetTextAction()).performTextReplacement("更新したTask")
        composeRule.onNodeWithText("Task名を保存").assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals("更新したTask", submitted) }
    }

    @Test
    fun titleConflictShowsServerAndLocalValues() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    sampleTask().copy(
                        title = "Desktopの名前",
                        conflict = MobileTaskConflict(
                            commandId = "command-update",
                            intendedAction = "UpdateTask",
                            expectedVersion = 4,
                            serverVersion = 5,
                            serverState = "todo",
                            localTitle = "端末の名前",
                            detectedAt = "2026-08-22T01:00:00Z",
                        ),
                    ),
                    TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithText("Desktop  Desktopの名前").assertIsDisplayed()
        composeRule.onNodeWithText("この端末  端末の名前").assertIsDisplayed()
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
