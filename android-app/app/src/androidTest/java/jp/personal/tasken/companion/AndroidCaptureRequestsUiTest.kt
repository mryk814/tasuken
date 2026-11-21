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
        val action = composeRule.onNodeWithTag("open-capture-action").getBoundsInRoot()
        assertTrue(message.bottom < action.top)
        assertEquals(before, composeRule.onNodeWithText(task.title).getBoundsInRoot())
        screenshot("09-top-notification")
    }

    @Test fun addSheetOffersNoAiOrganizing() {
        composeRule.setContent {
            TaskenTheme {
                CaptureTaskSheet(draft = MobileCaptureDraft.fresh(text = "明日の会議で測定結果を報告する"),
                    state = CaptureUiState.Idle,
                    themes = emptyList(), themeCatalogState = MobileThemeCatalogState.Loading(),
                    onDraftChanged = {}, onThemeSelected = {}, onKindSelected = {},
                    onSubmit = {}, onDismiss = {})
            }
        }
        // 入力の AI 整理と、端末から直接の AI 設定はスマホから外した（#755 束9a）。
        composeRule.onNodeWithTag("capture-organize").assertDoesNotExist()
        composeRule.onNodeWithTag("capture-direct-ai-settings").assertDoesNotExist()
        composeRule.onNodeWithTag("capture-kind-capture").assertDoesNotExist()
        // 音声入力はスマホから外した（#808）。写真と確定はキーボード直上の同じ1段にある。
        composeRule.onNodeWithTag("capture-voice-action").assertDoesNotExist()
        val photo = composeRule.onNodeWithTag("capture-photo-action").getBoundsInRoot()
        val submit = composeRule.onNodeWithTag("capture-submit-row").getBoundsInRoot()
        assertTrue(submit.top <= photo.top && photo.bottom <= submit.bottom)
        screenshot("12-add-sheet-without-ai-organizing")
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
