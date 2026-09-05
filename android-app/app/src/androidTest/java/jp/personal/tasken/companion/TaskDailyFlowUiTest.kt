package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class TaskDailyFlowUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun dailyFiltersRestoreAndEmptyResultsCanBeCleared() {
        val restoration = StateRestorationTester(composeRule)
        lateinit var pane: TodayPaneState
        val tasks = listOf(
            task("milk", "牛乳を買う"),
            task("cleaning", "クリーニングを受け取る").copy(todayDate = "2099-12-01"),
            task("research", "研究の比較条件を整理する", "research"),
        )
        restoration.setContent {
            pane = rememberTodayPaneState(null)
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TasksListPane(
                        uiState = TodayUiState.Success(tasks, "2026-09-05T00:00:00Z"),
                        tasks = tasks,
                        themes = listOf(MobileTheme("research", "研究")),
                        paneState = pane,
                        onRetry = {},
                        onRetryPairing = {},
                        onPair = { _, _ -> },
                        onTaskSelected = {},
                        actionState = TaskActionUiState.Idle,
                        onTaskStateAction = {},
                    )
                }
            }
        }
        capture("01-daily-tasks")
        composeRule.onNodeWithTag("task-filters-toggle").performClick()
        composeRule.onNodeWithTag("task-schedule-filter-Unscheduled").performScrollTo().performClick()
        composeRule.onNodeWithTag("task-theme-filter-unassigned").performClick()
        composeRule.onNodeWithText("牛乳を買う").assertIsDisplayed()
        composeRule.onNodeWithText("クリーニングを受け取る").assertDoesNotExist()
        composeRule.onNodeWithText("研究の比較条件を整理する").assertDoesNotExist()
        capture("02-unassigned-unscheduled")

        restoration.emulateSavedInstanceStateRestore()
        composeRule.runOnIdle {
            assertEquals(TaskScheduleFilter.Unscheduled, pane.taskScheduleFilter)
            assertEquals("", pane.taskThemeId)
        }
        composeRule.onNodeWithTag("task-schedule-filter-Unscheduled").assertIsSelected()
        composeRule.onNodeWithTag("task-theme-filter-unassigned").assertIsSelected()
        composeRule.onNodeWithText("牛乳を買う").assertIsDisplayed()

        composeRule.onNodeWithText("完了").performClick()
        composeRule.onNodeWithText("条件に合うTaskはありません").assertIsDisplayed()
        capture("03-empty-filter-results")
        composeRule.onNodeWithText("絞り込みを解除").performClick()
        composeRule.onNodeWithText("牛乳を買う").assertIsDisplayed()
        composeRule.onNodeWithText("クリーニングを受け取る").assertIsDisplayed()
        composeRule.onNodeWithText("研究の比較条件を整理する").assertIsDisplayed()
        composeRule.runOnIdle {
            assertEquals(TaskListFilter.Open, pane.taskFilter)
            assertEquals(TaskScheduleFilter.All, pane.taskScheduleFilter)
            assertEquals(null, pane.taskThemeId)
        }
    }

    @Test
    fun speechRequiresConfirmationAndPreservesTitleAfterFailure() {
        val mode = MobileSpeechRecognitionMode.OnDevice
        val draft = mutableStateOf(MobileCaptureDraft.fresh(text = "牛乳を買う"))
        val speech = mutableStateOf<ShortSpeechUiState>(ShortSpeechUiState.Idle(mode))
        var voiceStarts = 0
        val submitted = mutableListOf<String>()
        composeRule.setContent {
            TaskenTheme {
                CaptureTaskSheet(
                    draft = draft.value,
                    state = CaptureUiState.Idle,
                    speechState = speech.value,
                    themes = listOf(MobileTheme("research", "研究")),
                    themeCatalogState = MobileThemeCatalogState.Available(emptyList(), "fixture", 1, ""),
                    onDraftChanged = { draft.value = draft.value.withText(it) },
                    onThemeSelected = { draft.value = draft.value.withThemeId(it) },
                    onKindSelected = { draft.value = draft.value.withKind(it) },
                    onSubmit = { submitted += draft.value.text },
                    onStartVoice = { voiceStarts++ },
                    onStopVoice = {},
                    onDismiss = {},
                )
            }
        }
        // Run on a compact S23 / phone AVD: the primary voice action must be visible without scrolling.
        composeRule.onNodeWithTag("capture-voice-action").assertIsDisplayed().assertIsEnabled()
        capture("04-title-and-voice")
        composeRule.onNodeWithTag("capture-voice-action").performClick()
        composeRule.runOnIdle { assertEquals(1, voiceStarts) }
        listOf(
            ShortSpeechUiState.Listening(mode),
            ShortSpeechUiState.Partial(mode, "クリーニングを"),
            ShortSpeechUiState.Processing(mode),
        ).forEach { busy ->
            composeRule.runOnIdle { speech.value = busy }
            composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
            composeRule.onNodeWithTag("capture-submit-continue").assertIsNotEnabled()
            composeRule.onNodeWithTag("capture-text-input").assertIsNotEnabled()
            composeRule.runOnIdle { assertEquals(emptyList<String>(), submitted) }
        }
        composeRule.runOnIdle {
            speech.value = ShortSpeechUiState.Error("音声を認識できませんでした。もう一度話してください。")
        }
        composeRule.onNodeWithText("牛乳を買う").assertIsDisplayed()
        composeRule.onNodeWithTag("capture-text-input").assertIsEnabled()
        composeRule.onNodeWithTag("capture-voice-action").assertIsDisplayed().assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals(2, voiceStarts) }
        capture("05-speech-error-keeps-title")

        val result = ShortSpeechRecognitionResult("クリーニングを受け取る", mode, "ja-JP", 0.9f)
        composeRule.runOnIdle {
            draft.value = draft.value.withSpeechResult(result)
            speech.value = ShortSpeechUiState.Result(result)
        }
        composeRule.onNodeWithText("クリーニングを受け取る").assertIsDisplayed()
        composeRule.onNodeWithTag("capture-submit-close").assertIsEnabled()
        composeRule.runOnIdle { assertEquals(emptyList<String>(), submitted) }
        capture("06-speech-title-confirmation")
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().performClick()
        composeRule.runOnIdle { assertEquals(listOf("クリーニングを受け取る"), submitted) }
    }

    @Test
    fun longSpokenCaptureStaysReadableAndThemeSelectionDoesNotOpenKeyboard() {
        val text = "映画のあとに考えたこと。\n今の案は操作が多いので、まず短い入力で残せる形を試したい。\n理由や迷いも、あとから読み返せるようにそのまま残しておく。"
        val draft = mutableStateOf(MobileCaptureDraft.fresh(
            text = text, source = MobileCaptureSource.AndroidSpeech, kind = MobileCaptureKind.Capture,
        ))
        var submitted: MobileCaptureDraft? = null
        composeRule.setContent {
            TaskenTheme {
                CaptureTaskSheet(
                    draft = draft.value,
                    state = CaptureUiState.Idle,
                    speechState = ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.OnDevice),
                    themes = listOf(MobileTheme("ideas", "考えごと")),
                    themeCatalogState = MobileThemeCatalogState.Available(emptyList(), "fixture", 1, ""),
                    onDraftChanged = { draft.value = draft.value.withText(it) },
                    onThemeSelected = { draft.value = draft.value.withThemeId(it) },
                    onKindSelected = { draft.value = draft.value.withKind(it) },
                    onSubmit = { submitted = draft.value },
                    onStartVoice = {}, onStopVoice = {}, onDismiss = {},
                )
            }
        }
        val input = composeRule.onNodeWithTag("capture-text-input")
        input.assertTextContains(text).assertIsNotFocused()
        val bounds = input.getBoundsInRoot()
        assertTrue((bounds.bottom - bounds.top).value > 80f)
        capture("07-long-spoken-capture")
        composeRule.onNodeWithTag("capture-classification-toggle").performScrollTo().performClick()
        composeRule.onNodeWithTag("capture-theme-option-ideas").performScrollTo().performClick()
        input.assertIsNotFocused().assertTextContains(text)
        val overLimit = text + "補足".repeat(250)
        composeRule.runOnIdle { draft.value = draft.value.withText(overLimit) }
        input.assertTextContains(overLimit)
        composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
        composeRule.onNodeWithTag("capture-submit-continue").assertIsNotEnabled()
        capture("08-over-limit-keeps-full-draft")
        input.performScrollTo().performTextReplacement(text)
        composeRule.runOnIdle { assertEquals(text, draft.value.text) }
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertEquals(text, submitted?.text)
            assertEquals("ideas", submitted?.projectId)
            assertEquals(MobileCaptureKind.Capture, submitted?.kind)
        }
    }

    private fun task(id: String, title: String, themeId: String? = null) = MobileTask(
        id = id,
        title = title,
        themeId = themeId,
        state = "todo",
        workState = null,
        updatedAt = "2026-09-05T00:00:00Z",
    )

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "ux-daily")
        check(directory.isDirectory || directory.mkdirs())
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use {
            check(screenshot.compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
    }
}
