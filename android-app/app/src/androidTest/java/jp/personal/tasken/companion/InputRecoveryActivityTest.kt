package jp.personal.tasken.companion

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import android.view.KeyEvent
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain

/** Runs only in the isolated debug application on the test emulator. */
class InputRecoveryActivityTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val text = "回復する入力\n日本語と🧪、https://example.test/recovery\n末尾も保持する  "
    private lateinit var store: MobileCaptureDraftStore
    private lateinit var entryId: String
    private lateinit var originalDraftId: String
    private var savedPreference: String? = null
    private var existingEntries = emptySet<String>()
    private val fixture = object : ExternalResource() {
        override fun before() {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            check(context.packageName.endsWith(".debug"))
            val preferences = context.getSharedPreferences("tasken-mobile-input-recovery", Context.MODE_PRIVATE)
            savedPreference = preferences.getString("capture-draft-v1", null)
            store = MobileCaptureDraftStore(context)
            existingEntries = store.recoveredInputs().map { it.id }.toSet()
            val oldTime = Instant.now().minusSeconds(10 * 24 * 60 * 60)
            val oldDraft = MobileCaptureDraft.fresh(text = text, now = { oldTime })
            originalDraftId = oldDraft.draftId
            check(MobileCaptureDraftStore(context, now = { oldTime }).save(
                MobileCaptureDraftSnapshot(oldDraft, captureOpen = false),
            ))
        }

        override fun after() {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            val preferences = context.getSharedPreferences("tasken-mobile-input-recovery", Context.MODE_PRIVATE)
            check(preferences.edit().putString("capture-draft-v1", savedPreference).commit())
            store.recoveredInputs().filter { it.id !in existingEntries }.forEach {
                check(store.deleteRecoveredInput(it.id))
            }
        }
    }

    @get:Rule val rules: RuleChain = RuleChain.outerRule(fixture).around(compose)

    @Test
    fun expiredDraftIsRestoredThroughAppAndSurvivesRecreation() {
        compose.onNodeWithTag("open-input-recovery").assertIsDisplayed().performClick()
        entryId = store.recoveredInputs().single { it.snapshot?.draft?.draftId == originalDraftId }.id
        compose.onNodeWithTag("recovery-entry-$entryId").performClick()
        compose.onNodeWithTag("recovery-content").assertTextContains(text)
        screenshot("01-app-recovery")
        compose.onNodeWithTag("recovery-restore").performClick()
        compose.onNodeWithTag("capture-text-input").assertTextContains(text)
        compose.waitForIdle()
        val restored = checkNotNull(store.load())
        assertNotEquals(originalDraftId, restored.draft.draftId)
        assertEquals(text, restored.draft.text)
        assertEquals(text, store.recoveredInputs().single { it.id == entryId }.text)

        compose.activityRule.scenario.recreate()
        compose.onNodeWithTag("capture-text-input").assertTextContains(text)
        screenshot("02-app-recreated-draft")
        assertEquals(restored.draft.draftId, checkNotNull(store.load()).draft.draftId)

        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        compose.onNodeWithTag("open-input-recovery").performClick()
        compose.onNodeWithTag("recovery-entry-$entryId").performClick()
        compose.onNodeWithTag("recovery-restore").assertIsNotEnabled()
        assertEquals(text, checkNotNull(store.load()).draft.text)
        screenshot("03-current-draft-protected")
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "input-recovery-activity")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use {
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        bitmap.recycle()
    }
}
