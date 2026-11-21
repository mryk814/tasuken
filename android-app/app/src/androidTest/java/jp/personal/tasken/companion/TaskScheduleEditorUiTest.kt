package jp.personal.tasken.companion

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
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
        composeRule.onNodeWithTag("schedule-start-date").assertTextContains("8月24日（月）", substring = true)
        composeRule.onNodeWithTag("schedule-end-date").assertTextContains("未設定", substring = true)
        composeRule.onNodeWithTag("schedule-range-semantics").assertDoesNotExist()
        composeRule.onNodeWithTag("schedule-clear").assertIsEnabled()
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
        composeRule.onNodeWithTag("schedule-end-date").assertTextContains("8月30日（日）", substring = true)
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
        composeRule.waitUntil(timeoutMillis = 2_000) { submitted != null }

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
        composeRule.mainClock.advanceTimeBy(500)
        composeRule.waitForIdle()
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
        composeRule.onNodeWithTag("schedule-clear").assertIsNotEnabled()

        restorationTester.emulateSavedInstanceStateRestore()

        composeRule.onNodeWithTag("schedule-start-date").assertTextContains("未設定", substring = true)
        composeRule.onNodeWithTag("schedule-clear").assertIsNotEnabled()
    }

    /**
     * #786 の回帰テスト:
     * ListDetailPaneScaffold のように 1 つの詳細ペイン（SaveableStateHolder の同じ枠）で
     * タスク A（期限 2026-11-17）を開く → 一覧へ戻る → タスク B（期限 2027-01-14）を開いたとき、
     * A の予定の控えが B に復元されて即座に自動保存（上書き）されないことを確かめる。
     */
    @Test
    fun openingAnotherTaskInSharedDetailPaneDoesNotOverwriteItsSchedule() {
        val taskA = sampleTask(
            schedule(startDate = null, endDate = "2026-11-17", dateKind = "deadline").copy(
                id = "20000000-0000-4000-8000-00000000000a",
            ),
        ).copy(id = "10000000-0000-4000-8000-00000000000a", title = "今日の期限のタスク")
        val taskB = sampleTask(
            schedule(startDate = null, endDate = "2027-01-14", dateKind = "deadline").copy(
                id = "20000000-0000-4000-8000-00000000000b",
            ),
        ).copy(id = "10000000-0000-4000-8000-00000000000b", title = "未来の期限のタスク")

        val showDetail = mutableStateOf(true)
        val currentTask = mutableStateOf(taskA)
        val savedCalls = mutableListOf<Pair<String, MobileTaskScheduleDraft>>()

        composeRule.setContent {
            val holder = rememberSaveableStateHolder()
            MaterialTheme {
                if (showDetail.value) {
                    holder.SaveableStateProvider("detail-pane") {
                        TodayDetailPane(
                            task = currentTask.value,
                            actionState = TaskActionUiState.Idle,
                            onStateAction = {},
                            onScheduleUpdate = { task, draft -> savedCalls += task.id to draft },
                        )
                    }
                }
            }
        }

        composeRule.waitForIdle()
        // 一覧へ戻る（SaveableStateProvider が詳細ペインの保存状態を記録して破棄する）
        composeRule.runOnIdle { showDetail.value = false }
        composeRule.waitForIdle()
        // 別のタスク B を同じ詳細ペイン枠で開く
        composeRule.runOnIdle {
            currentTask.value = taskB
            showDetail.value = true
        }
        composeRule.mainClock.advanceTimeBy(500)
        composeRule.waitForIdle()

        composeRule.runOnIdle {
            assertEquals("タスクを開いただけで予定を上書き保存してはいけない", emptyList<Pair<String, MobileTaskScheduleDraft>>(), savedCalls)
        }
        composeRule.onNodeWithTag("schedule-summary").performScrollTo().assertTextContains("2027年1月14日（木）まで", substring = true)

        // さらにタスク B を閉じて外部（PC/MCP）で期日が更新された後にタスク B を開き直しても、旧控えで巻き戻らない
        composeRule.runOnIdle { showDetail.value = false }
        composeRule.waitForIdle()
        composeRule.runOnIdle {
            currentTask.value = taskB.copy(
                schedule = taskB.schedule?.copy(version = 3, endDate = "2027-02-01"),
            )
            showDetail.value = true
        }
        composeRule.mainClock.advanceTimeBy(500)
        composeRule.waitForIdle()

        composeRule.runOnIdle {
            assertEquals("外部更新後に開き直しても旧予定で巻き戻してはいけない", emptyList<Pair<String, MobileTaskScheduleDraft>>(), savedCalls)
        }
        composeRule.onNodeWithTag("schedule-summary").performScrollTo().assertTextContains("2027年2月1日（月）まで", substring = true)
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
    fun pendingConflictAndSavingKeepScheduleEditorClosed() {
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

        // 未完了(pending)/競合/保存中は予定編集のトグルが無効で、編集欄は開かない。
        assertScheduleEditorClosed()
        composeRule.runOnIdle { gate.intValue = 1 }
        assertScheduleEditorClosed()
        composeRule.runOnIdle { gate.intValue = 2 }
        assertScheduleEditorClosed()
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

    /** 予定欄の見た目を画像に残す（閉じた要約と、開いた編集欄）。 */
    @Test
    fun captureScheduleSummaryAndEditor() {
        val task = sampleTask(
            schedule(startDate = "2026-08-24", endDate = "2026-08-30", dateKind = "range", rangeSemantics = "once_within_window"),
        ).copy(plannedStartTime = "09:30", plannedDurationMinutes = 45)
        composeRule.setContent {
            TaskenTheme {
                androidx.compose.material3.Surface(
                    androidx.compose.ui.Modifier.fillMaxSize().safeDrawingPadding(),
                ) {
                    TodayDetailPane(task = task, actionState = TaskActionUiState.Idle, onStateAction = {})
                }
            }
        }
        composeRule.onNodeWithTag("schedule-summary").performScrollTo()
        capture("01-schedule-summary")
        openScheduleEditor()
        composeRule.onNodeWithTag("schedule-start-date").performScrollTo()
        capture("02-schedule-editor-dates")
        composeRule.onNodeWithTag("schedule-duration").performScrollTo()
        capture("03-schedule-editor-duration")
        // 開始時刻の欄はスマホから外した（#755 束9a）。
        composeRule.onNodeWithTag("schedule-start-time").assertDoesNotExist()
    }

    @Test
    fun settingADeadlineTimePreselectsThirtyMinutesAndSavesBothInOneChange() {
        var submitted: MobileTaskScheduleDraft? = null
        val task = sampleTask(schedule(startDate = null, endDate = "2026-11-19", dateKind = "deadline"))
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
        openScheduleEditor()
        composeRule.onNodeWithTag("schedule-notify-before").assertDoesNotExist()
        composeRule.onNodeWithTag("schedule-end-time").performScrollTo().performClick()
        composeRule.onNodeWithTag("schedule-end-time-picker").assertExists()
        composeRule.onNodeWithTag("schedule-end-time-confirm").performClick()
        composeRule.waitUntil(timeoutMillis = 2_000) { submitted != null }
        composeRule.runOnIdle {
            assertEquals(MobileTaskScheduleDraft(null, "2026-11-19", null, endTime = "17:00", notifyBeforeMinutes = 30), submitted)
        }
        composeRule.onNodeWithTag("schedule-end-time").assertTextContains("17:00", substring = true)
        composeRule.onNodeWithTag("schedule-notify-30").performScrollTo().assertIsSelected()
        capture("deadline-time-set")
    }

    @Test
    fun aStoredCustomLeadIsShownSelectedAndKeptWhenNothingChanges() {
        var submitted: MobileTaskScheduleDraft? = null
        val task = sampleTask(
            schedule(startDate = null, endDate = "2026-11-19", dateKind = "deadline")
                .copy(endTime = "02:00", notifyBeforeMinutes = 45),
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
        composeRule.onNodeWithTag("schedule-summary").assertTextContains("02:00まで・知らせ 45分前", substring = true)
        openScheduleEditor()
        composeRule.onNodeWithTag("schedule-notify-45").performScrollTo().assertIsSelected()
        composeRule.onNodeWithTag("schedule-notify-30").assertIsNotSelected()
        capture("deadline-time-custom-lead")
        composeRule.mainClock.advanceTimeBy(500)
        composeRule.waitForIdle()
        composeRule.runOnIdle { assertEquals(null, submitted) }
        // 前日を選ぶと、その分だけが変わって送られる。
        composeRule.onNodeWithTag("schedule-notify-1440").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 2_000) { submitted != null }
        composeRule.runOnIdle {
            assertEquals(MobileTaskScheduleDraft(null, "2026-11-19", null, endTime = "02:00", notifyBeforeMinutes = 1440), submitted)
        }
    }

    @Test
    fun clearingTheDatesClearsTheTimeAndTheTimeNeedsADate() {
        var submitted: MobileTaskScheduleDraft? = null
        val task = sampleTask(
            schedule(startDate = null, endDate = "2026-11-19", dateKind = "deadline")
                .copy(endTime = "23:59", notifyBeforeMinutes = 30),
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
        openScheduleEditor()
        composeRule.onNodeWithTag("schedule-end-clear").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 2_000) { submitted != null }
        composeRule.runOnIdle { assertEquals(MobileTaskScheduleDraft(null, null, null), submitted) }
        composeRule.onNodeWithTag("schedule-end-time").assertIsNotEnabled()
        composeRule.onNodeWithTag("schedule-notify-before").assertDoesNotExist()
    }

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val directory = java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "schedule-editor").apply { mkdirs() }
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        java.io.File(directory, "$name.png").outputStream().use {
            check(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
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

    private fun assertScheduleEditorClosed() {
        composeRule.onNodeWithTag("schedule-edit-toggle").assertIsNotEnabled()
        composeRule.onNodeWithTag("schedule-start-date").assertDoesNotExist()
        composeRule.onNodeWithTag("schedule-clear").assertDoesNotExist()
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
