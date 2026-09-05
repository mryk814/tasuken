package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test

class TaskDailyDetailUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun originalInputIsOptionalAndFollowsTheSelectedTask() {
        val original = "# 補足\n朝食用。\n\n# 元の入力\n明日の帰りに牛乳と卵を買う\n卵は六個でよい"
        val current = mutableStateOf(task().copy(description = original))
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = current.value, actionState = TaskActionUiState.Idle, onStateAction = {},
                )
            }
        }
        composeRule.onNodeWithTag("task-description").assertDoesNotExist()
        composeRule.onNodeWithTag("task-description-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("task-description").assertTextEquals(original)
        composeRule.waitForIdle()
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val directory = java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "ux-organization").apply { mkdirs() }
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        java.io.File(directory, "03-task-original-detail.png").outputStream().use {
            check(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
        composeRule.onNodeWithTag("task-description-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("task-description").assertDoesNotExist()
        composeRule.runOnIdle { assertEquals(original, current.value.description) }
        composeRule.runOnIdle { current.value = task().copy(id = "another-task") }
        composeRule.onNodeWithTag("task-description-toggle").assertDoesNotExist()
        composeRule.onNodeWithTag("task-description").assertDoesNotExist()
    }

    @Test
    fun unsavedScheduleSurvivesClosingAndReopeningEditor() {
        var saved: MobileTaskScheduleDraft? = null
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task().copy(schedule = MobileTaskSchedule(
                        id = "schedule-1", version = 1, startDate = "2026-09-05", endDate = null,
                        dateKind = "point", rangeSemantics = null,
                    )),
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                    onScheduleUpdate = { _, draft -> saved = draft },
                )
            }
        }
        composeRule.onNodeWithTag("schedule-start-date").assertDoesNotExist()
        composeRule.onNodeWithTag("schedule-edit-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("schedule-start-clear").performScrollTo().performClick()
        composeRule.onNodeWithTag("schedule-edit-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("schedule-start-date").assertDoesNotExist()
        composeRule.onNodeWithTag("schedule-summary").assertTextEquals("予定なし")
        composeRule.onNodeWithText("未保存の予定があります").assertExists()
        composeRule.runOnIdle { assertEquals(null, saved) }
        composeRule.onNodeWithTag("schedule-edit-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("schedule-save").performScrollTo().assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals(MobileTaskScheduleDraft(null, null, null), saved) }
    }

    @Test
    fun checklistCompletesWithOneTapAndPreservesUnsubmittedRenameAcrossDisclosure() {
        val current = mutableStateOf(task().copy(checklistItems = listOf(
            MobileChecklistItem("milk", "牛乳", false, 0.0),
        )))
        var saves = 0
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = current.value,
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                    onChecklistUpdate = { _, items ->
                        saves += 1
                        current.value = current.value.copy(checklistItems = items)
                    },
                )
            }
        }
        composeRule.onNodeWithTag("checklist-label-milk").assertTextEquals("牛乳")
        composeRule.onNodeWithTag("checklist-toggle-milk").performScrollTo().performClick().assertIsOn()
        composeRule.runOnIdle {
            assertEquals(1, saves)
            assertNotNull(current.value.checklistItems.single().completedAt)
        }
        composeRule.onNodeWithTag("checklist-edit-milk").performScrollTo().performClick()
        val input = hasSetTextAction() and hasAnyAncestor(hasTestTag("checklist-item-milk"))
        composeRule.onNode(input).performTextReplacement("低脂肪牛乳")
        composeRule.onNodeWithTag("checklist-edit-milk").performScrollTo().performClick()
        composeRule.onNodeWithTag("checklist-label-milk").assertTextEquals("牛乳")
        composeRule.runOnIdle { assertEquals(1, saves) }
        composeRule.onNodeWithTag("checklist-edit-milk").performScrollTo().performClick()
        composeRule.onNode(input).assertTextEquals("低脂肪牛乳")
        composeRule.onNodeWithText("保存").performScrollTo().performClick()
        composeRule.runOnIdle {
            assertEquals(2, saves)
            assertEquals("低脂肪牛乳", current.value.checklistItems.single().title)
            assertEquals(true, current.value.checklistItems.single().done)
        }
    }

    @Test
    fun aiOptionsRemainReachableAndReadyOrFailedChangesStayVisible() {
        val current = mutableStateOf(task())
        val aiState = mutableStateOf<AiReadyUiState>(AiReadyUiState.Idle)
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = current.value, actionState = TaskActionUiState.Idle,
                    aiReadyState = aiState.value, onStateAction = {},
                )
            }
        }
        composeRule.onNodeWithTag("task-ai-ready-toggle-daily").assertDoesNotExist()
        composeRule.onNodeWithTag("task-ai-options-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("task-ai-ready-toggle-daily").performScrollTo().assertIsEnabled()
        composeRule.onNodeWithTag("task-ai-options-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("task-ai-ready-toggle-daily").assertDoesNotExist()
        composeRule.runOnIdle { current.value = current.value.copy(workState = "ready_for_agent") }
        composeRule.onNodeWithTag("task-ai-ready-toggle-daily").performScrollTo().assertIsOn()
        composeRule.runOnIdle {
            current.value = current.value.copy(workState = "not_delegated")
            aiState.value = AiReadyUiState.Unavailable("daily", "接続を確認して再試行してください。")
        }
        composeRule.onNodeWithText("接続を確認して再試行してください。").assertExists()
        composeRule.onNodeWithTag("task-ai-ready-toggle-daily").assertExists()
    }

    @Test
    fun checklistAddKeepsTextUntilSavedProjectionArrives() {
        val current = mutableStateOf(task())
        val requests = mutableListOf<List<MobileChecklistItem>>()
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = current.value, actionState = TaskActionUiState.Idle, onStateAction = {},
                    onChecklistUpdate = { _, items -> requests += items },
                )
            }
        }
        val input = composeRule.onNodeWithTag("checklist-add-title")
        input.performScrollTo().performTextReplacement("卵を買う")
        composeRule.onNodeWithTag("checklist-add").performScrollTo().performClick()
        input.assertTextEquals("項目を追加", "卵を買う")
        // No saved projection models a failed save. Retry must preserve both text and item identity.
        composeRule.onNodeWithTag("checklist-add").performClick()
        composeRule.runOnIdle {
            assertEquals(requests[0].single().id, requests[1].single().id)
            current.value = current.value.copy(checklistItems = requests.last())
        }
        input.assertTextEquals("項目を追加", "")
        composeRule.runOnIdle { assertEquals("卵を買う", current.value.checklistItems.single().title) }
    }

    private fun task() = MobileTask(
        id = "daily", title = "買い物", themeId = null, state = "todo", workState = "not_delegated",
        updatedAt = "2026-09-05T00:00:00Z",
    )
}
