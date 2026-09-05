package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import java.time.LocalDate
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

        composeRule.onNodeWithText("未完了に戻す").assertIsDisplayed().assertIsEnabled()
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

        composeRule.onNodeWithText("未完了に変更").assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun humanReviewWorkStatesKeepStateActionDisabled() {
        val workState = mutableStateOf("needs_human_review")
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    sampleTask().copy(workState = workState.value),
                    TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }

        listOf("needs_human_review", "reported_done", "blocked").forEach { state ->
            composeRule.runOnIdle { workState.value = state }
            composeRule.onNodeWithText("Work Receiptを確認").assertIsDisplayed().assertIsNotEnabled()
        }
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

        composeRule.onNodeWithTag("task-title-edit-toggle").performClick()
        composeRule.onNodeWithTag("task-title").performTextReplacement("更新したTask")
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

    @Test
    fun todayScheduleActionIsVisibleAndSubmitsTheExplicitDate() {
        var submitted: LocalDate? = null
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    sampleTask(),
                    TaskActionUiState.Idle,
                    onStateAction = {},
                    onTodayDateUpdate = { _, date -> submitted = date },
                )
            }
        }

        composeRule.onNodeWithText("日付  未設定").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("今日に入れる").assertIsDisplayed().assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals(LocalDate.now(), submitted) }
    }

    @Test
    fun todayDateConflictShowsServerAndLocalValues() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    sampleTask().copy(
                        todayDate = "2026-08-20",
                        conflict = MobileTaskConflict(
                            commandId = "command-schedule",
                            intendedAction = "UpdateTask",
                            expectedVersion = 4,
                            serverVersion = 5,
                            serverState = "todo",
                            detectedAt = "2026-08-22T01:00:00Z",
                            serverTodayDate = "2026-08-20",
                            localTodayDate = null,
                            localTodayDateChanged = true,
                        ),
                    ),
                    TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithText("Desktop  日付 2026-08-20").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("この端末  日付 未設定").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun acceptedDesktopTitleReplacesTheStaleLocalDraft() {
        val conflicted = sampleTask().copy(
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
        )
        val task = mutableStateOf(sampleTask())
        val actionState = mutableStateOf<TaskActionUiState>(TaskActionUiState.Idle)
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(task.value, actionState.value, onStateAction = {})
            }
        }
        composeRule.onNodeWithTag("task-title-edit-toggle").performClick()
        composeRule.onNodeWithTag("task-title").performTextReplacement("端末の下書き")
        composeRule.runOnIdle { task.value = conflicted }
        composeRule.onNodeWithText("同期できなかった変更").assertIsDisplayed()

        composeRule.runOnIdle {
            task.value = conflicted.copy(conflict = null)
            actionState.value = TaskActionUiState.ConflictResolved(conflicted.id, keptLocal = false)
        }

        composeRule.onNodeWithTag("task-title").assertTextContains("Desktopの名前")
        composeRule.onNodeWithText("Task名を保存").assertIsNotEnabled()
    }

    @Test
    fun titleEditorFollowsSyncUntilEditedAndKeepsDraftAcrossClosing() {
        val task = mutableStateOf(sampleTask())
        var submitted = ""
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task.value,
                    TaskActionUiState.Idle,
                    onStateAction = {},
                    onTitleUpdate = { _, title -> submitted = title },
                )
            }
        }

        composeRule.runOnIdle { task.value = task.value.copy(title = "Desktopで更新した名前") }
        composeRule.onNodeWithTag("task-title-edit-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("task-title").assertTextContains("Desktopで更新した名前")
        composeRule.onNodeWithText("Task名を保存").assertIsNotEnabled()

        composeRule.onNodeWithTag("task-title").performTextReplacement("帰りに牛乳を買う")
        composeRule.onNodeWithTag("task-title-edit-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("task-title").assertDoesNotExist()
        composeRule.runOnIdle { task.value = task.value.copy(title = "Desktopから再び更新した名前") }
        composeRule.onNodeWithTag("task-title-edit-toggle").performClick()
        composeRule.onNodeWithTag("task-title").assertTextContains("帰りに牛乳を買う")

        composeRule.runOnIdle { task.value = task.value.copy(title = "編集中に届いたDesktopの名前") }
        composeRule.onNodeWithTag("task-title").assertTextContains("帰りに牛乳を買う")
        composeRule.onNodeWithText("Task名を保存").performScrollTo().assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals("帰りに牛乳を買う", submitted) }
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
