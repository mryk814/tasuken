package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.os.Process
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Invoke with captureOrganizationPhase=seed, force-stop, then invoke with verify. */
class CaptureOrganizationProcessTest {
    @Test
    fun candidateEditsAndLocalTasksSurviveProcessExit() = runBlocking {
        val phase = InstrumentationRegistry.getArguments().getString("captureOrganizationPhase")
        assumeTrue(phase in setOf("seed", "verify"))
        val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) =
                super.getSharedPreferences("organization554-$name", mode)
            override fun getFilesDir() = File(super.getFilesDir(), "organization554").apply { mkdirs() }
        }
        val prefs = context.getSharedPreferences("process", Context.MODE_PRIVATE)
        val databaseName = "organization554.db"
        if (phase == "seed") context.deleteDatabase(databaseName)
        val database = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName).build()
        val store = MobileCaptureDraftStore(context)
        val expected = MobileCaptureDraft.fresh(
            text = "研究の原文".repeat(1000), newId = { "organization554" },
            now = { java.time.Instant.parse("2026-09-08T00:00:00Z") },
        ).withOrganizations(List(8) { index ->
            MobileCaptureOrganization(
                title = "候補 $index", themeId = if (index == 1) "research" else null,
                endDate = "2026-09-20", checklist = listOf("確認", "記録"),
                supplement = "詳しい補足", excluded = index == 0,
            )
        })
        try {
            val outbox = MobileOutbox(context, database.mobileDao(), { "organization554-device" }, schedule = {})
            if (phase == "seed") {
                database.mobileDao().upsertSyncState(SyncStateEntity(
                    serverId = "organization554-server", apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                    cursor = null, lastSuccessfulSyncAt = "2026-09-08T00:00:00Z",
                    lastAttemptAt = "2026-09-08T00:00:00Z", lastError = null,
                ))
                assertTrue(store.save(MobileCaptureDraftSnapshot(expected, true)))
                val ids = outbox.enqueueCreateTasks(expected.organizedTaskDrafts(), null)
                assertTrue(prefs.edit().putInt("pid", Process.myPid()).putString("ids", ids.joinToString(",")).commit())
            } else {
                assertNotEquals(prefs.getInt("pid", -1), Process.myPid())
                val restored = requireNotNull(store.load()).draft
                assertEquals(expected, restored)
                val ids = outbox.enqueueCreateTasks(restored.organizedTaskDrafts(), null)
                assertEquals(prefs.getString("ids", null), ids.joinToString(","))
                assertEquals(7, database.mobileDao().tasks().size)
                val first = requireNotNull(database.mobileDao().task(ids.first()))
                assertEquals("research", first.themeId)
                assertEquals("候補 1", first.title)
                assertEquals(7, database.mobileDao().outboxCount())
            }
        } finally {
            database.close()
            if (phase == "verify") {
                store.clear()
                prefs.edit().clear().commit()
                context.deleteDatabase(databaseName)
            }
        }
    }
}
