package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Rule
import org.junit.Test

class DirectAiSettingsSheetUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun standaloneSettingsExplainOfflineUseWithoutDesktopKeyTransfer() {
        val store = DirectCaptureSettingsStore(InstrumentationRegistry.getInstrumentation().targetContext)
        store.clear()
        try {
            composeRule.setContent {
                MaterialTheme {
                    DirectAiSettingsSheet(store, onChanged = {}, onDismiss = {})
                }
            }

            composeRule.onNodeWithTag("direct-ai-settings-title").assertExists()
            composeRule.onNodeWithTag("capture-direct-ai-settings").assertIsDisplayed()
            composeRule.onNodeWithText("整理の実行時はこの設定が自動で使われます。", substring = true).assertIsDisplayed()
            composeRule.onNodeWithText("Desktopのキーが転送されることはありません。", substring = true).assertIsDisplayed()
            screenshot("11-standalone-direct-ai-settings")
            composeRule.onNodeWithTag("direct-ai-settings-close").performClick()
        } finally {
            store.clear()
        }
    }

    private fun screenshot(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "ux-android-requests").apply { mkdirs() }
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
