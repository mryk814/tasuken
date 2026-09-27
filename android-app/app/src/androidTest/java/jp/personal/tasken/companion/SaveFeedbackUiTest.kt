package jp.personal.tasken.companion

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import org.junit.Rule
import org.junit.Test

/** 端末に保存できた時だけ、保存の印と追加行の光が一度出る。 */
class SaveFeedbackUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun captureSheetShowsSavedStampOnlyAfterSaveAndThenFades() {
        val saved = mutableStateOf<Long?>(null)
        composeRule.setContent {
            TaskenTheme {
                CaptureTaskSheet(
                    draft = MobileCaptureDraft.fresh(), state = CaptureUiState.Idle,
                    speechState = ShortSpeechUiState.Idle(null), themes = emptyList(),
                    themeCatalogState = MobileThemeCatalogState.Loading(),
                    onDraftChanged = {}, onThemeSelected = {}, onKindSelected = {}, onSubmit = {},
                    onStartVoice = {}, onStopVoice = {}, onDismiss = {},
                    savedEventKey = saved.value,
                )
            }
        }
        composeRule.onAllNodesWithTag("capture-saved-stamp").assertCountEquals(0)
        composeRule.mainClock.autoAdvance = false
        composeRule.runOnIdle { saved.value = 1L }
        composeRule.mainClock.advanceTimeBy(200)
        composeRule.onNodeWithTag("capture-saved-stamp").assertIsDisplayed()
        capture("01-capture-saved-stamp")
        composeRule.mainClock.advanceTimeBy(2_400)
        composeRule.onAllNodesWithTag("capture-saved-stamp").assertCountEquals(0)
    }

    @Test fun justAddedRowIsTintedOnce() {
        val added = mutableStateOf<Set<String>>(emptySet())
        val tasks = listOf("測定条件を確認", "試料Bを準備", "比較図を作る").mapIndexed { index, title ->
            MobileTask("a$index", title, null, "todo", null, "2026-09-27T00:00:00Z", todayDate = LocalDate.now().toString())
        }
        composeRule.setContent {
            val pane = rememberTodayPaneState(null)
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TodayTaskList(
                        tasks, pane, onTaskSelected = {}, themes = emptyList(),
                        actionState = TaskActionUiState.Idle, onTaskStateAction = {},
                        justAddedIds = added.value,
                    )
                }
            }
        }
        composeRule.mainClock.autoAdvance = false
        composeRule.runOnIdle { added.value = setOf("a2") }
        composeRule.mainClock.advanceTimeBy(300)
        capture("02-just-added-row")
        composeRule.mainClock.advanceTimeBy(2_000)
        composeRule.onNodeWithTag("task-swipe-a2").assertIsDisplayed()
    }

    private fun capture(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        SystemClock.sleep(200)
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "save-feedback-20260927")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
