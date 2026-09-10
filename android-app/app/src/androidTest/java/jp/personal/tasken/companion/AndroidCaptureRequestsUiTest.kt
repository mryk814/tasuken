package jp.personal.tasken.companion

import android.graphics.Bitmap
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class AndroidCaptureRequestsUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun snackbarAppearsAboveContentWithoutMovingTheList() {
        val task = MobileTask("toast-fixture", "測定結果を整理する", null, "todo", null, "2026-09-08T00:00:00Z")
        val repository = object : MobileTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(listOf(task), "2026-09-08T00:00:00Z")
        }
        lateinit var model: TodayViewModel
        composeRule.setContent {
            val base = LocalContext.current
            val isolated = remember { object : ContextWrapper(base) {
                override fun getSharedPreferences(name: String, mode: Int) = base.getSharedPreferences("toast-requests-$name", mode)
            } }
            model = viewModel(factory = TodayViewModelFactory(repository))
            CompositionLocalProvider(LocalContext provides isolated) { TaskenTheme { TodayApp(model) } }
        }
        composeRule.waitUntil { composeRule.onAllNodesWithText(task.title).fetchSemanticsNodes().isNotEmpty() }
        val before = composeRule.onNodeWithText(task.title).getBoundsInRoot()
        composeRule.runOnIdle { model.updateTaskTitle(task, "変更後の名前") }
        composeRule.waitUntil { composeRule.onAllNodesWithText("この環境ではTaskを編集できません。").fetchSemanticsNodes().isNotEmpty() }
        val message = composeRule.onNodeWithText("この環境ではTaskを編集できません。").getBoundsInRoot()
        val action = composeRule.onNodeWithTag("open-voice-capture-action").getBoundsInRoot()
        assertTrue(message.bottom < action.top)
        assertEquals(before, composeRule.onNodeWithText(task.title).getBoundsInRoot())
        screenshot("09-top-notification")
    }

    @Test fun recognitionTextGrowsInsideFixedAreaAndConfirmStaysAbovePhotos() {
        val speech = mutableStateOf<ShortSpeechUiState>(ShortSpeechUiState.Listening(MobileSpeechRecognitionMode.OnDevice))
        val draft = mutableStateOf(MobileCaptureDraft.fresh())
        var stopped = false
        composeRule.setContent {
            TaskenTheme {
                CaptureTaskSheet(draft = draft.value, state = CaptureUiState.Idle, speechState = speech.value,
                    themes = emptyList(), themeCatalogState = MobileThemeCatalogState.Loading(),
                    onDraftChanged = { draft.value = draft.value.withText(it) }, onThemeSelected = {}, onKindSelected = {},
                    onSubmit = {}, onStartVoice = {}, onStopVoice = { stopped = true }, onDismiss = {})
            }
        }
        composeRule.onNodeWithTag("capture-voice-action").performScrollTo().assertIsDisplayed()
        val before = composeRule.onNodeWithTag("capture-voice-action").getBoundsInRoot()
        val status = composeRule.onNodeWithTag("capture-speech-status").getBoundsInRoot()
        assertTrue(status.bottom <= before.top)
        // 音声と写真は同じ副操作行に並ぶ。
        assertEquals(
            before.top.value.toDouble(),
            composeRule.onNodeWithTag("capture-photo-action").getBoundsInRoot().top.value.toDouble(),
            1.0,
        )
        composeRule.onNodeWithTag("capture-submit-row").performScrollTo().assertIsDisplayed()
        val photo = composeRule.onNodeWithTag("capture-photo-action").getBoundsInRoot()
        val submit = composeRule.onNodeWithTag("capture-submit-row").getBoundsInRoot()
        assertTrue(photo.bottom <= submit.top)
        screenshot("01-listening")
        for ((name, state) in listOf(
            "02-partial-short" to ShortSpeechUiState.Partial(MobileSpeechRecognitionMode.OnDevice, "明日の会議で"),
            "03-partial-long" to ShortSpeechUiState.Partial(MobileSpeechRecognitionMode.OnDevice, "明日の会議で実験結果を報告して、次の条件を確認する。".repeat(90)),
            "04-listening-again" to ShortSpeechUiState.Listening(MobileSpeechRecognitionMode.OnDevice),
            "05-processing" to ShortSpeechUiState.Processing(MobileSpeechRecognitionMode.OnDevice),
        )) {
            composeRule.runOnIdle { speech.value = state }
            composeRule.waitForIdle()
            val after = composeRule.onNodeWithTag("capture-voice-action").getBoundsInRoot()
            assertEquals(before.top.value, after.top.value, 1f)
            composeRule.onNodeWithTag("capture-voice-action").assertIsDisplayed()
            screenshot(name)
        }
        composeRule.runOnIdle { speech.value = ShortSpeechUiState.Listening(MobileSpeechRecognitionMode.OnDevice) }
        composeRule.onNodeWithTag("capture-voice-action").performClick()
        composeRule.runOnIdle { assertTrue(stopped) }
    }

    @Test fun directSettingsRequireConsentAndKeepFailedInputThenSaveDisableAndDelete() {
        val store = DirectCaptureSettingsStore(ApplicationProvider.getApplicationContext())
        store.clear()
        val current = mutableStateOf(store.settings())
        try {
            composeRule.setContent {
                TaskenTheme {
                    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
                        DirectCaptureSettingsControls(current.value, store, true) { current.value = it }
                    }
                }
            }
            composeRule.onNodeWithTag("capture-direct-ai-settings").performClick()
            composeRule.onNodeWithTag("direct-ai-model").performTextReplacement("fixture-model")
            composeRule.onNodeWithTag("direct-ai-key").performScrollTo().performTextReplacement("fixture-secret")
            composeRule.onNodeWithTag("direct-ai-consent").assertIsOff()
            screenshot("06-settings-before-consent")
            composeRule.onNodeWithTag("direct-ai-save").performScrollTo().performClick()
            composeRule.waitUntil { store.settings().hasApiKey }
            assertFalse(store.settings().enabled)
            composeRule.onNodeWithTag("capture-direct-ai-settings").performScrollTo().performClick()
            assertEquals("", composeRule.onNodeWithTag("direct-ai-key").fetchSemanticsNode().config[SemanticsProperties.InputText].text)
            composeRule.onNodeWithTag("direct-ai-key").performTextReplacement("invalid\nkey")
            composeRule.onNodeWithTag("direct-ai-consent").performScrollTo().performClick()
            composeRule.onNodeWithTag("direct-ai-save").performScrollTo().performClick()
            composeRule.waitUntil { composeRule.onAllNodesWithTag("direct-ai-error").fetchSemanticsNodes().isNotEmpty() }
            assertEquals("invalid\nkey", composeRule.onNodeWithTag("direct-ai-key").fetchSemanticsNode().config[SemanticsProperties.InputText].text)
            screenshot("07-settings-failure-input-retained")
            composeRule.onNodeWithTag("direct-ai-key").performScrollTo().performTextReplacement("")
            composeRule.onNodeWithTag("direct-ai-save").performScrollTo().performClick()
            composeRule.waitUntil { store.settings().enabled }
            screenshot("08-settings-enabled")
            composeRule.onNodeWithTag("capture-direct-ai-settings").performScrollTo().performClick()
            composeRule.onNodeWithTag("direct-ai-disable").performScrollTo().performClick()
            composeRule.waitUntil { !store.settings().enabled }
            composeRule.onNodeWithTag("capture-direct-ai-settings").performScrollTo().performClick()
            composeRule.onNodeWithTag("direct-ai-delete").performScrollTo().performClick()
            composeRule.waitUntil { !store.settings().hasApiKey }
        } finally { store.clear() }
    }

    @Test fun pcIndependentSettingsAreReachableInsideTaskSheetWithKeyboard() {
        val store = DirectCaptureSettingsStore(ApplicationProvider.getApplicationContext())
        store.clear()
        try {
            composeRule.setContent {
                TaskenTheme {
                    CaptureTaskSheet(draft = MobileCaptureDraft.fresh(text = "明日の会議で測定結果を報告する"),
                        state = CaptureUiState.Idle, speechState = ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.OnDevice),
                        themes = emptyList(), themeCatalogState = MobileThemeCatalogState.Loading(),
                        onDraftChanged = {}, onThemeSelected = {}, onKindSelected = {}, onOrganize = { error("No inference in settings test") },
                        onSubmit = {}, onStartVoice = {}, onStopVoice = {}, onDismiss = {})
                }
            }
            composeRule.onNodeWithTag("capture-direct-ai-settings").performScrollTo().performClick()
            composeRule.onNodeWithTag("direct-ai-model").performScrollTo().performTextReplacement("fixture-model")
            composeRule.onNodeWithTag("direct-ai-key").performScrollTo().performTextReplacement("fixture-secret")
            // IME animation runs outside the Compose clock. Wait before choosing the final scroll offset.
            InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(500, 5000)
            composeRule.onNodeWithTag("direct-ai-consent").performScrollTo().performClick()
            composeRule.onNodeWithTag("direct-ai-save").performScrollTo().assertIsDisplayed()
            screenshot("10-settings-in-task-sheet-keyboard")
            composeRule.onNodeWithTag("direct-ai-save").performClick()
            composeRule.waitUntil { store.settings().enabled }
            // 保存後は設定が閉じるため、送信先は開き直して確認する。
            composeRule.onNodeWithTag("capture-direct-ai-settings").performScrollTo().performClick()
            composeRule.onNodeWithTag("capture-ai-destination").performScrollTo().assertTextEquals("送信先: OpenAI（Androidから直接・PCオフでも利用可）")
        } finally { store.clear() }
    }

    private fun screenshot(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.waitForIdle(500, 5000)
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "ux-android-requests")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
