package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.os.Process
import androidx.room.Room
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Run with -e captureProcessPhase seed, force-stop the test target, then run with phase verify. */
class MobileLongCaptureProcessTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun rawDraftAndPendingCaptureSurviveProcessExit() = runBlocking {
        val phase = InstrumentationRegistry.getArguments().getString("captureProcessPhase")
        assumeTrue(phase in setOf("seed", "verify"))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context: Context = object : ContextWrapper(instrumentation.targetContext) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("capture535-process-$name", mode)
            override fun getFilesDir() = File(super.getFilesDir(), "capture535-process-test").apply { mkdirs() }
        }
        val databaseName = "capture-process-535.db"
        val prefs = context.getSharedPreferences("capture-process-535", Context.MODE_PRIVATE)
        val text = " \n" + "原".repeat(11994) + "🔬\n "
        assertEquals(12000, text.length)
        if (phase == "seed") context.deleteDatabase(databaseName)
        val database = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName).build()
        val draftStore = MobileCaptureDraftStore(context)
        try {
            val dao = database.mobileDao()
            if (phase == "seed") {
                dao.upsertSyncState(SyncStateEntity(serverId = "capture-process-server", apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                    cursor = null, lastSuccessfulSyncAt = "2026-09-06T00:00:00Z", lastAttemptAt = "2026-09-06T00:00:00Z", lastError = null))
                val draft = MobileCaptureDraft.fresh(text = text, kind = MobileCaptureKind.Capture,
                    newId = { "capture-process-535" })
                assertTrue(draftStore.save(MobileCaptureDraftSnapshot(draft, true)))
                MobileOutbox(context, dao, { "capture-process-device" }, schedule = {})
                    .enqueueCapture(text, draftId = draft.draftId, createdAt = draft.createdAt)
                assertTrue(prefs.edit().putInt("seedPid", Process.myPid()).commit())
            } else {
                assertTrue(prefs.contains("seedPid"))
                assertNotEquals(prefs.getInt("seedPid", -1), Process.myPid())
                assertEquals(text, draftStore.load()?.draft?.text)
                val entry = requireNotNull(dao.observePendingCaptures().first().single().toPendingCapture())
                assertEquals(text, entry.text)
                composeRule.setContent {
                    TaskenTheme { MobilePendingCaptureDialog(listOf(entry), onRetry = { false }, onDismiss = {}) }
                }
                composeRule.onNodeWithTag("pending-capture-${entry.commandId}").performClick()
                composeRule.onNodeWithTag("pending-capture-body").assertTextContains(text)
                composeRule.waitForIdle()
                val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "long-capture-535")
                check(directory.isDirectory || directory.mkdirs())
                val image = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                File(directory, "05-process-recovered-body.png").outputStream().use {
                    check(image.compress(Bitmap.CompressFormat.PNG, 100, it))
                }
                image.recycle()
            }
        } finally {
            database.close()
            if (phase == "verify") {
                draftStore.clear()
                prefs.edit().clear().commit()
                context.deleteDatabase(databaseName)
            }
        }
    }
}
