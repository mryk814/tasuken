package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TaskScheduleEditorUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun pointScheduleShowsExecutionDateWithoutRangeMeaning() {
        setDetail(
            schedule = schedule(
                startDate = "2026-08-24",
                endDate = null,
                dateKind = "point",
            ),
        )

        composeRule.onNodeWithTag("schedule-kind").assertTextEquals("実施日")
        composeRule.onNodeWithTag("schedule-start-date").assertTextContains("2026-08-24", substring = true)
        composeRule.onNodeWithTag("schedule-end-date").assertTextContains("未設定", substring = true)
        composeRule.onNodeWithTag("schedule-range-semantics").assertDoesNotExist()
        composeRule.onNodeWithTag("schedule-save").assertIsNotEnabled()
    }

    @Test
    fun deadlineScheduleUsesOnlyTheEndDate() {
        setDetail(
            schedule = schedule(
                startDate = null,
                endDate = "2026-08-30",
                dateKind = "deadline",
            ),
        )

        composeRule.onNodeWithTag("schedule-kind").assertTextEquals("期限")
        composeRule.onNodeWithTag("schedule-start-date").assertTextContains("未設定", substring = true)
        composeRule.onNodeWithTag("schedule-end-date").assertTextContains("2026-08-30", substring = true)
        composeRule.onNodeWithTag("schedule-range-semantics").assertDoesNotExist()
    }

    @Test
    fun rangeMeaningCanChangeWithoutChangingItsDates() {
        var submitted: MobileTaskScheduleDraft? = null
        val task = sampleTask(
            schedule = schedule(
                startDate = "2026-08-24",
                endDate = "2026-08-30",
                dateKind = "range",
                rangeSemantics = "once_within_window",
            ),
        )
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task,
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                    onScheduleUpdate = { _, draft -> submitted = draft },
                )
            }
        }

        composeRule.onNodeWithTag("schedule-kind").assertTextEquals("期間内に一度")
        openScheduleEditor()
        composeRule.onNodeWithText("この期間の意味").assertExists()
        composeRule.onNodeWithTag("schedule-range-once").assertIsSelected()
        composeRule.onNodeWithTag("schedule-range-ongoing").performScrollTo().performClick()
        composeRule.onNodeWithTag("schedule-range-ongoing").assertIsSelected()
        composeRule.onNodeWithTag("schedule-save").assertIsEnabled().performClick()

        composeRule.runOnIdle {
            assertEquals(
                MobileTaskScheduleDraft("2026-08-24", "2026-08-30", "ongoing"),
                submitted,
            )
        }
    }

    @Test
    fun legacyRangeStaysUnclassifiedUntilTheUserChoosesMeaning() {
        var submitted: MobileTaskScheduleDraft? = null
        val task = sampleTask(
            schedule = schedule(
                startDate = "2026-08-24",
                endDate = "2026-08-30",
                dateKind = "range",
                rangeSemantics = null,
            ),
        )
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task,
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                    onScheduleUpdate = { _, draft -> submitted = draft },
                )
            }
        }

        composeRule.onNodeWithTag("schedule-kind").assertTextEquals("期間未分類")
        openScheduleEditor()
        composeRule.onNodeWithTag("schedule-range-unspecified").assertTextEquals("期間未分類")
        composeRule.onNodeWithTag("schedule-range-once").assertIsNotSelected()
        composeRule.onNodeWithTag("schedule-range-ongoing").assertIsNotSelected()
        composeRule.onNodeWithTag("schedule-save").assertIsNotEnabled()
        composeRule.runOnIdle { assertEquals(null, submitted) }
    }

    @Test
    fun clearedDraftSurvivesSavedInstanceStateRestoration() {
        val restorationTester = StateRestorationTester(composeRule)
        val task = sampleTask(
            schedule = schedule(
                startDate = "2026-08-24",
                endDate = null,
                dateKind = "point",
            ),
        )
        restorationTester.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = task,
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }

        openScheduleEditor()
        composeRule.onNodeWithTag("schedule-start-clear").performScrollTo().performClick()
        composeRule.onNodeWithTag("schedule-start-date").assertTextContains("未設定", substring = true)
        composeRule.onNodeWithTag("schedule-save").assertIsEnabled()

        restorationTester.emulateSavedInstanceStateRestore()

        composeRule.onNodeWithTag("schedule-start-date").assertTextContains("未設定", substring = true)
        composeRule.onNodeWithTag("schedule-save").assertIsEnabled()
    }

    @Test
    fun startAndEndFieldsOpenTheirMaterialDatePickers() {
        setDetail(schedule = null)

        composeRule.onNodeWithTag("schedule-start-date").performScrollTo().performClick()
        composeRule.onNodeWithText("開始を選択").assertExists()
        composeRule.onNodeWithText("キャンセル").performClick()

        composeRule.onNodeWithTag("schedule-end-date").performScrollTo().performClick()
        composeRule.onNodeWithText("期限を選択").assertExists()
    }

    @Test
    fun pendingConflictAndSavingEachDisableScheduleEditing() {
        val gate = mutableIntStateOf(0)
        val task = sampleTask(
            schedule = schedule(
                startDate = "2026-08-24",
                endDate = null,
                dateKind = "point",
            ),
        )
        composeRule.setContent {
            val gatedTask = when (gate.intValue) {
                0 -> task.copy(pending = true)
                1 -> task.copy(conflict = sampleConflict())
                else -> task
            }
            val actionState = if (gate.intValue == 2) {
                TaskActionUiState.Saving(task.id)
            } else {
                TaskActionUiState.Idle
            }
            MaterialTheme {
                TodayDetailPane(
                    task = gatedTask,
                    actionState = actionState,
                    onStateAction = {},
                )
            }
        }

        openScheduleEditor()
        assertScheduleDisabled()
        composeRule.runOnIdle { gate.intValue = 1 }
        assertScheduleDisabled()
        composeRule.runOnIdle { gate.intValue = 2 }
        assertScheduleDisabled()
    }

    @Test
    fun scheduleConflictShowsDatesMeaningAndUnsetSides() {
        val mode = mutableIntStateOf(0)
        val serverRange = schedule(
            startDate = "2026-08-24",
            endDate = "2026-08-30",
            dateKind = "range",
            rangeSemantics = "once_within_window",
        )
        val localRange = MobileTaskScheduleDraft(
            startDate = "2026-09-01",
            endDate = "2026-09-05",
            rangeSemantics = "ongoing",
        )
        composeRule.setContent {
            val conflict = if (mode.intValue == 0) {
                sampleConflict().copy(
                    serverSchedule = serverRange,
                    localSchedule = MobileTaskScheduleDraft(null, null, null),
                    localScheduleChanged = true,
                )
            } else {
                sampleConflict().copy(
                    serverSchedule = null,
                    localSchedule = localRange,
                    localScheduleChanged = true,
                )
            }
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(serverRange).copy(conflict = conflict),
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithText(
            "Desktop  予定 開始 2026-08-24 / 期限 2026-08-30 / 期間内に一度",
        ).assertExists()
        composeRule.onNodeWithText("この端末  予定 未設定").assertExists()

        composeRule.runOnIdle { mode.intValue = 1 }

        composeRule.onNodeWithText("Desktop  予定 未設定").assertExists()
        composeRule.onNodeWithText(
            "この端末  予定 開始 2026-09-01 / 期限 2026-09-05 / 期間中継続",
        ).assertExists()
    }

    private fun setDetail(schedule: MobileTaskSchedule?) {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(schedule),
                    actionState = TaskActionUiState.Idle,
                    onStateAction = {},
                )
            }
        }
        openScheduleEditor()
    }

    private fun openScheduleEditor() {
        composeRule.onNodeWithTag("schedule-edit-toggle").performScrollTo().performClick()
    }

    private fun assertScheduleDisabled() {
        composeRule.onNodeWithTag("schedule-start-date").assertIsNotEnabled()
        composeRule.onNodeWithTag("schedule-end-date").assertIsNotEnabled()
        composeRule.onNodeWithTag("schedule-start-clear").assertIsNotEnabled()
        composeRule.onNodeWithTag("schedule-save").assertIsNotEnabled()
    }

    private fun sampleTask(schedule: MobileTaskSchedule?) = MobileTask(
        id = "10000000-0000-4000-8000-000000000001",
        title = "Task",
        themeId = null,
        state = "todo",
        workState = null,
        updatedAt = "2026-08-21T09:00:00.000Z",
        schedule = schedule,
    )

    private fun schedule(
        startDate: String?,
        endDate: String?,
        dateKind: String,
        rangeSemantics: String? = null,
    ) = MobileTaskSchedule(
        id = "20000000-0000-4000-8000-000000000001",
        version = 2,
        startDate = startDate,
        endDate = endDate,
        dateKind = dateKind,
        rangeSemantics = rangeSemantics,
    )

    private fun sampleConflict() = MobileTaskConflict(
        commandId = "command-schedule",
        intendedAction = "UpdateTask",
        expectedVersion = 2,
        serverVersion = 3,
        serverState = "todo",
        detectedAt = "2026-08-22T01:00:00Z",
    )
}
