package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test

class MobileCaptureRecoveryUiTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun copiesOriginalAndProtectsCurrentDraftUntilExplicitRestore() {
        val entry = MobileRecoveredInput("entry", "2026-09-01T00:00:00Z", "unreadable", "原文\n壊れたJSON")
        val canRestore = mutableStateOf(false)
        var copied: String? = null
        var restored: MobileRecoveredInput? = null
        compose.setContent {
            val clipboard = LocalClipboardManager.current
            TaskenTheme {
                MobileCaptureRecoveryDialog(listOf(entry), canRestore.value,
                    onRestore = { restored = it; true }, onDelete = { false }, onDismiss = {
                        copied = clipboard.getText()?.text
                    })
            }
        }
        capture("01-list")
        compose.onNodeWithTag("recovery-entry-entry").performClick()
        compose.onNodeWithTag("recovery-content").assertTextEquals(entry.raw)
        compose.onNodeWithTag("recovery-restore").assertIsNotEnabled()
        capture("02-original-restore-disabled")
        compose.onNodeWithTag("recovery-copy").performClick()
        compose.onNodeWithText("コピーしました").assertExists()
        compose.onNodeWithTag("recovery-restore").assertIsNotEnabled()
        capture("03-copied")
        compose.runOnIdle { canRestore.value = true }
        compose.onNodeWithTag("recovery-restore").assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals(entry.raw, copied)
            assertEquals(entry, restored)
        }
    }

    @Test
    fun deletionRequiresConfirmationAndFailureKeepsContentVisible() {
        val entry = MobileRecoveredInput("entry", "", "unreadable", "回収する本文")
        var deleted = false
        compose.setContent {
            TaskenTheme {
                MobileCaptureRecoveryDialog(listOf(entry), false,
                    onRestore = { false }, onDelete = { deleted = true; false }, onDismiss = {})
            }
        }
        compose.onNodeWithTag("recovery-entry-entry").performClick()
        compose.onNodeWithTag("recovery-delete").performClick()
        compose.runOnIdle { assertFalse(deleted) }
        capture("04-delete-confirmation")
        compose.onNodeWithTag("recovery-confirm-delete").performClick()
        compose.onNodeWithTag("recovery-content").assertTextEquals(entry.text)
        compose.onNodeWithText("削除できませんでした。もう一度お試しください。").assertExists()
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "input-recovery")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
