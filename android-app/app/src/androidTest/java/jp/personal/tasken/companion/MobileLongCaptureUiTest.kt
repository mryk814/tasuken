package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class MobileLongCaptureUiTest {
    @get:Rule val composeRule = createComposeRule()
    private val suffix = "\n🔬原文の末尾 https://example.com/capture\n  "
    private val text = " \n観察したこと。\n".let { prefix -> prefix + "記録と迷いをそのまま残す。\n".repeat(900) }
        .take(12000 - suffix.length) + suffix

    @Test
    fun twelveThousandCharactersCanBeSavedWithoutAiAndKeepPrimaryActionsReachable() {
        val draft = mutableStateOf(MobileCaptureDraft.fresh(text = text, kind = MobileCaptureKind.Capture))
        var submitted: String? = null
        composeRule.setContent {
            TaskenTheme {
                CaptureTaskSheet(
                    draft.value, CaptureUiState.Idle, ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.Unknown),
                    emptyList(), MobileThemeCatalogState.Available(emptyList(), "fixture", 1, ""),
                    onDraftChanged = { draft.value = draft.value.withText(it) }, onThemeSelected = {}, onKindSelected = {},
                    onSubmit = { submitted = draft.value.text }, onStartVoice = {}, onStopVoice = {}, onDismiss = {},
                )
            }
        }
        assertEquals(12000, text.length)
        val input = composeRule.onNodeWithTag("capture-text-input")
        input.assertTextContains(text).assertIsNotFocused()
        val bounds = input.getBoundsInRoot()
        assertTrue((bounds.bottom - bounds.top).value < 290f)
        screenshot("01-long-input")
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals(text, submitted) }
        screenshot("02-long-save-actions")
    }

    @Test
    fun overLimitTextCanBeCopiedAndEditedWithoutTruncation() {
        val overLimit = text + "末"
        val draft = mutableStateOf(MobileCaptureDraft.fresh(text = overLimit, kind = MobileCaptureKind.Capture))
        lateinit var clipboard: ClipboardManager
        composeRule.setContent {
            clipboard = LocalClipboardManager.current
            TaskenTheme {
                CaptureTaskSheet(
                    draft.value, CaptureUiState.Idle, ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.Unknown),
                    emptyList(), MobileThemeCatalogState.Available(emptyList(), "fixture", 1, ""),
                    onDraftChanged = { draft.value = draft.value.withText(it) }, onThemeSelected = {}, onKindSelected = {},
                    onSubmit = {}, onStartVoice = {}, onStopVoice = {}, onDismiss = {},
                )
            }
        }
        composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
        composeRule.onNodeWithTag("capture-copy-full-text").performScrollTo().performClick()
        composeRule.runOnIdle {
            assertEquals(overLimit, clipboard.getText()?.text)
            assertEquals(overLimit, draft.value.text)
        }
        screenshot("03-over-limit-copy")
        composeRule.onNodeWithTag("capture-text-input").performScrollTo().performTextReplacement(text)
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().assertIsEnabled()
        composeRule.runOnIdle { assertEquals(text, draft.value.text) }
    }

    @Test
    fun unsupportedDesktopShowsFullPendingOriginalAndExplicitRetry() {
        lateinit var clipboard: ClipboardManager
        var retried: String? = null
        composeRule.setContent {
            clipboard = LocalClipboardManager.current
            TaskenTheme {
                MobilePendingCaptureDialog(
                    listOf(MobilePendingCapture("long-command", text, "2026-09-06", LONG_CAPTURE_UPDATE_REQUIRED, true)),
                    onRetry = { retried = it; true }, onDismiss = {},
                )
            }
        }
        composeRule.onNodeWithTag("pending-capture-long-command").performClick()
        composeRule.onNodeWithTag("pending-capture-body").assertTextContains(text)
        composeRule.onNodeWithTag("pending-capture-status").assertTextContains(LONG_CAPTURE_UPDATE_REQUIRED)
        composeRule.onNodeWithTag("capture-copy-full-text").performScrollTo().performClick()
        composeRule.runOnIdle { assertEquals(text, clipboard.getText()?.text) }
        composeRule.onNodeWithTag("pending-capture-retry").performScrollTo().assertIsDisplayed().assertIsEnabled()
        screenshot("04-old-desktop-retry")
        composeRule.onNodeWithTag("pending-capture-body").performSemanticsAction(SemanticsActions.ScrollBy) { scroll ->
            scroll(0f, 100000f)
        }
        composeRule.waitForIdle()
        val range = composeRule.onNodeWithTag("pending-capture-body").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
        assertTrue(range.value() > 0f && range.value() == range.maxValue())
        screenshot("06-full-text-end")
        composeRule.onNodeWithTag("pending-capture-retry").performClick()
        composeRule.runOnIdle { assertEquals("long-command", retried) }
    }

    @Test
    fun failedAiOrganizationCanStillSaveOriginalAsCapture() {
        val draft = mutableStateOf(MobileCaptureDraft.fresh(text = text))
        var submitted: MobileCaptureDraft? = null
        composeRule.setContent {
            TaskenTheme {
                CaptureTaskSheet(
                    draft.value, CaptureUiState.Idle, ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.Unknown),
                    emptyList(), MobileThemeCatalogState.Available(emptyList(), "fixture", 1, ""),
                    onDraftChanged = { draft.value = draft.value.withText(it) }, onThemeSelected = {},
                    onKindSelected = { draft.value = draft.value.withKind(it) },
                    onOrganize = { error("provider unavailable") },
                    onSubmit = { submitted = draft.value }, onStartVoice = {}, onStopVoice = {}, onDismiss = {},
                )
            }
        }
        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        composeRule.onNodeWithTag("capture-organization-error").assertExists()
        composeRule.runOnIdle { assertEquals(text, draft.value.text) }
        composeRule.onNodeWithTag("capture-kind-capture").performScrollTo().performClick()
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().assertIsEnabled().performClick()
        composeRule.runOnIdle {
            assertEquals(MobileCaptureKind.Capture, submitted?.kind)
            assertEquals(text, submitted?.text)
        }
    }

    private fun screenshot(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "long-capture-535")
        check(directory.isDirectory || directory.mkdirs())
        val image = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(image.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        image.recycle()
    }
}
