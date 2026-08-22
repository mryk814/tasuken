package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TaskPlannedScheduleEditorUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun emptyPlannedScheduleShowsUnsetAndSaveStaysDisabled() {
        setDetail()

        composeRule.onNodeWithTag("planned-schedule-kind").performScrollTo().assertTextEquals("未設定")
        composeRule.onNodeWithTag("planned-schedule-save").assertIsNotEnabled()
    }

    @Test
    fun validTimeAndDurationEnableSaveAndSubmitAtomicDraft() {
        var submitted: MobilePlannedScheduleDraft? = null
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(),
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                    onPlannedScheduleUpdate = { _, draft -> submitted = draft },
                )
            }
        }

        composeRule.onNodeWithTag("planned-start-time").performScrollTo().performTextInput("10:00")
        composeRule.onNodeWithTag("planned-duration-minutes").performScrollTo().performTextInput("90")
        composeRule.onNodeWithTag("planned-schedule-kind").assertTextEquals("10:00 / 90分")
        composeRule.onNodeWithTag("planned-schedule-save").assertIsEnabled().performClick()

        assertEquals(MobilePlannedScheduleDraft("10:00", 90), submitted)
    }

    @Test
    fun invalidStartTimeKeepsSaveDisabled() {
        setDetail()

        composeRule.onNodeWithTag("planned-start-time").performScrollTo().performTextInput("25:00")
        composeRule.onNodeWithTag("planned-duration-minutes").performScrollTo().performTextInput("90")
        composeRule.onNodeWithTag("planned-schedule-save").assertIsNotEnabled()
    }

    @Test
    fun plannedScheduleDraftSurvivesSavedInstanceStateRestoration() {
        val restorationTester = StateRestorationTester(composeRule)
        restorationTester.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask("09:00", 30),
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("planned-start-clear").performScrollTo().performClick()
        composeRule.onNodeWithTag("planned-start-time").performTextInput("10:00")
        composeRule.onNodeWithTag("planned-duration-clear").performScrollTo().performClick()
        composeRule.onNodeWithTag("planned-duration-minutes").performTextInput("90")
        composeRule.onNodeWithTag("planned-schedule-kind").assertTextEquals("10:00 / 90分")
        composeRule.onNodeWithTag("planned-schedule-save").assertIsEnabled()

        restorationTester.emulateSavedInstanceStateRestore()

        composeRule.onNodeWithTag("planned-start-time").assertTextContains("10:00")
        composeRule.onNodeWithTag("planned-duration-minutes").assertTextContains("90")
        composeRule.onNodeWithTag("planned-schedule-kind").assertTextEquals("10:00 / 90分")
        composeRule.onNodeWithTag("planned-schedule-save").assertIsEnabled()
    }

    @Test
    fun plannedScheduleConflictShowsServerAndLocalTimes() {
        val task = sampleTask(
            plannedStartTime = "11:00",
            plannedDurationMinutes = 60,
        ).copy(
            conflict = MobileTaskConflict(
                commandId = "command-planned",
                intendedAction = "UpdateTask",
                expectedVersion = 4,
                serverVersion = 5,
                serverState = "todo",
                detectedAt = "2026-08-22T01:00:00Z",
                serverPlannedStartTime = "11:00",
                serverPlannedDurationMinutes = 60,
                localPlannedStartTime = "09:30",
                localPlannedDurationMinutes = 45,
                localPlannedScheduleChanged = true,
            ),
        )
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task,
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("planned-schedule-save").assertIsNotEnabled()
        composeRule.onNodeWithText("Desktop  時刻 11:00 / 60分").assertExists()
        composeRule.onNodeWithText("この端末  時刻 09:30 / 45分").assertExists()
    }

    private fun setDetail(
        plannedStartTime: String? = null,
        plannedDurationMinutes: Int? = null,
    ) {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(plannedStartTime, plannedDurationMinutes),
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }
    }

    private fun sampleTask(
        plannedStartTime: String? = null,
        plannedDurationMinutes: Int? = null,
    ) = MobileTask(
        id = "10000000-0000-4000-8000-000000000001",
        title = "Task",
        themeId = null,
        state = "todo",
        workState = null,
        updatedAt = "2026-08-21T09:00:00.000Z",
        plannedStartTime = plannedStartTime,
        plannedDurationMinutes = plannedDurationMinutes,
    )
}
