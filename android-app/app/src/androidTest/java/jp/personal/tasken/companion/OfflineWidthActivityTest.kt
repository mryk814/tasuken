package jp.personal.tasken.companion

import android.content.Context
import android.graphics.Bitmap
import android.view.KeyEvent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileInputStream
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain

/** Uses only an unpaired debug profile on an emulator and restores its previous window override. */
class OfflineWidthActivityTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val taskId = "width-${UUID.randomUUID()}"
    private val title = "幅を変えても選択を保つTask"
    private val input = "未保存の入力を幅変更でも保持する🧪"
    private val titleDraft = "名前を編集中のまま幅を変える"
    private var previousSize: String? = null
    private var previousDraft: String? = null
    private var previousSync: SyncStateEntity? = null
    private var seeded = false
    private var sizeChanged = false
    private val fixture = object : ExternalResource() {
        override fun before() {
            try {
            check(context.packageName.endsWith(".debug"))
            check(shell("getprop ro.kernel.qemu").trim() == "1")
            check(!MobileGatewayConnectionStore(context).configuration().paired) {
                "Use an unpaired emulator debug profile, never a connected personal profile."
            }
            previousSize = Regex("Override size: (\\d+x\\d+)").find(shell("wm size"))?.groupValues?.get(1)
            val preferences = context.getSharedPreferences("tasken-mobile-input-recovery", Context.MODE_PRIVATE)
            previousDraft = preferences.getString("capture-draft-v1", null)
            val db = MobileLocalDatabase.open(context)
            runBlocking {
                previousSync = db.mobileDao().syncState()
                check(db.mobileDao().task(taskId) == null)
                db.mobileDao().upsertSyncState(SyncStateEntity(serverId = "isolated-width", apiVersion = 1,
                    schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null,
                    lastSuccessfulSyncAt = Instant.now().toString(), lastAttemptAt = null, lastError = null))
                seeded = true
                db.mobileDao().upsertTask(TaskCacheEntity(id = taskId, serverVersion = 1, title = title,
                    themeId = null, state = "todo", workState = null, todayDate = LocalDate.now().toString(),
                    updatedAt = Instant.now().toString(), optimisticCommandId = null))
            }
            check(preferences.edit().remove("capture-draft-v1").commit())
            sizeChanged = true
            shell("wm size 1080x2400")
            } catch (error: Throwable) {
                after()
                throw error
            }
        }

        override fun after() {
            try {
                if (sizeChanged) shell("wm size ${previousSize ?: "reset"}")
            } finally {
                if (seeded) {
                    val db = MobileLocalDatabase.open(context)
                    runBlocking {
                        db.mobileDao().deleteTask(taskId)
                        previousSync?.let { db.mobileDao().upsertSyncState(it) }
                            ?: db.openHelper.writableDatabase.execSQL("DELETE FROM sync_state")
                    }
                    check(context.getSharedPreferences("tasken-mobile-input-recovery", Context.MODE_PRIVATE)
                        .edit().putString("capture-draft-v1", previousDraft).commit())
                }
            }
        }
    }

    @get:Rule val rules: RuleChain = RuleChain.outerRule(fixture).around(compose)

    @Test fun selectedTaskAndBothDraftsSurviveCompactExpandedAndRecreation() {
        compose.onNodeWithTag("open-capture-action").performClick()
        compose.onNodeWithTag("capture-text-input").performTextInput(input)
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        compose.waitForIdle()
        if (compose.onAllNodesWithTag("capture-sheet-content").fetchSemanticsNodes().isNotEmpty()) {
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        }
        compose.onNodeWithTag("today-task-list").performScrollToNode(hasText(title))
        compose.onNodeWithText(title).performClick()
        compose.onNodeWithTag("task-title-edit-toggle").performClick()
        compose.onNodeWithTag("task-title").performTextReplacement(titleDraft)
        screenshot("01-compact-selected-draft")
        assertEquals(input, MobileCaptureDraftStore(context).load()?.draft?.text)

        shell("wm size 2200x1840")
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag("task-title").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("task-title").assertTextContains(titleDraft)
        compose.onNodeWithTag("today-task-list").assertIsDisplayed()
        assertEquals(input, MobileCaptureDraftStore(context).load()?.draft?.text)
        screenshot("02-expanded-selected-draft")

        compose.activityRule.scenario.recreate()
        compose.onNodeWithTag("task-title").assertTextContains(titleDraft)
        compose.onNodeWithTag("today-task-list").assertIsDisplayed()
        assertEquals(input, MobileCaptureDraftStore(context).load()?.draft?.text)
        screenshot("03-recreated-selected-draft")
    }

    private fun shell(command: String): String = instrumentation.uiAutomation.executeShellCommand(command).use {
        FileInputStream(it.fileDescriptor).bufferedReader().use { reader -> reader.readText() }
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val directory = File(context.getExternalFilesDir(null), "offline-width-activity")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
