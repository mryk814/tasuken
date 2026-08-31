package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class TaskEntryFlowUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun addImmediatelyFocusesTaskNameAndKeyboardCanSubmit() {
        val pane = TodayPaneState()
        val submitted = mutableListOf<String>()
        showCapture(pane) { behavior ->
            submitted += pane.captureDraft.text
            if (behavior == CaptureCompletionBehavior.Continue) pane.continueCapture()
            else pane.captureOpen = false
        }

        composeRule.onNodeWithText("追加").performClick()
        capture("01-add-open")
        composeRule.onNodeWithText("Task名").assertIsFocused().performTextInput("実験結果を整理する")
        composeRule.runOnIdle { assertEquals(false, pane.captureInputFocusRequested) }
        val submitBounds = composeRule.onNodeWithTag("capture-submit-row").getBoundsInRoot()
        val themeBounds = composeRule.onNodeWithText("Theme（任意）").getBoundsInRoot()
        assertTrue(submitBounds.bottom <= themeBounds.top)
        capture("02-add-entered")
        composeRule.onNodeWithTag("capture-submit-continue").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals("", pane.captureDraft.text) }
        composeRule.onNodeWithText("Task名").assertIsFocused().performTextInput("比較条件を確認する")
        composeRule.onNodeWithText("Task名").performImeAction()
        composeRule.runOnIdle { assertEquals(listOf("実験結果を整理する", "比較条件を確認する"), submitted) }
        composeRule.onNodeWithText("Task名").assertDoesNotExist()
    }

    @Test
    fun sharedCaptureKeepsItsTextWithoutTakingFocus() {
        val pane = TodayPaneState()
        pane.openCapture(
            MobileCaptureSource.ShareTarget,
            initialText = "打ち合わせで受け取った比較条件を、次の実験で確認する",
            sharedMimeType = "text/plain",
        )
        showCapture(pane, dark = true)
        composeRule.onNodeWithTag("capture-kind-capture").assertIsDisplayed()
        composeRule.onNodeWithText("打ち合わせで受け取った比較条件を、次の実験で確認する")
            .assertIsNotFocused()
        capture("05-shared-capture-dark")
    }

    private fun showCapture(
        pane: TodayPaneState,
        dark: Boolean = false,
        onSubmit: (CaptureCompletionBehavior) -> Unit = {},
    ) {
        composeRule.setContent {
            MaterialTheme(colorScheme = if (dark) taskenDarkColorScheme() else taskenLightColorScheme()) {
                Button(
                    modifier = Modifier.safeDrawingPadding(),
                    onClick = { pane.openCapture(MobileCaptureSource.AndroidApp) },
                ) {
                    Text("追加")
                }
                if (pane.captureOpen) {
                    CaptureTaskSheet(
                        draft = pane.captureDraft,
                        state = CaptureUiState.Idle,
                        speechState = ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.OnDevice),
                        themes = emptyList(),
                        themeCatalogState = MobileThemeCatalogState.Available(emptyList(), "fixture", 1, ""),
                        onDraftChanged = { pane.captureDraft = pane.captureDraft.withText(it) },
                        onThemeSelected = { pane.captureDraft = pane.captureDraft.withThemeId(it) },
                        onKindSelected = { pane.captureDraft = pane.captureDraft.withKind(it) },
                        requestInputFocus = pane.captureInputFocusRequested,
                        onInputFocusHandled = pane::consumeInputFocusRequest,
                        onSubmit = onSubmit,
                        onStartVoice = {},
                        onStopVoice = {},
                        onDismiss = { pane.captureOpen = false },
                    )
                }
            }
        }

    }

    @Test
    fun detailOffersCompleteAndReopenBeforeScrolling() {
        val task = mutableStateOf(
            MobileTask(
                id = "10000000-0000-4000-8000-000000000001",
                title = "実験結果を整理して、次回の打ち合わせで比較条件を確認する",
                themeId = null,
                state = "todo",
                workState = null,
                updatedAt = "2026-08-31T00:00:00.000Z",
            ),
        )
        composeRule.setContent {
            MaterialTheme(colorScheme = taskenLightColorScheme()) {
                Column(modifier = Modifier.safeDrawingPadding()) {
                    TodayDetailPane(
                        task.value,
                        TaskActionUiState.Idle,
                        onStateAction = { task.value = it.copy(state = if (it.state == "done") "todo" else "done") },
                    )
                }
            }
        }

        capture("03-detail-open")
        composeRule.onNodeWithText("完了する").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("未完了に戻す").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals("todo", task.value.state) }
        capture("04-detail-reopened")
    }

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "ux-audit")
        check(directory.isDirectory || directory.mkdirs())
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use {
            check(screenshot.compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
    }
}
