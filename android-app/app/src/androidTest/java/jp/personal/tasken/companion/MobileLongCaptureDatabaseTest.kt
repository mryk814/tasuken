package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileLongCaptureDatabaseTest {
    private val context: Context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
        override fun getApplicationContext(): Context = this
        override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("capture535-db-$name", mode)
        override fun getFilesDir() = java.io.File(super.getFilesDir(), "capture535-db-test").apply { mkdirs() }
    }
    private val text = " \n" + "原".repeat(11945) + "🔬\nhttps://example.com/long-capture\n末尾も保持  \n"
    private val capturedAt = "2026-09-06T00:00:00Z"

    @Test
    fun longCaptureReopensAsOriginalThenStopsForOldDesktopAndExplicitlyRetriesSameEnvelope() = runBlocking {
        val name = "long-capture-${UUID.randomUUID()}.db"
        var database = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
        try {
            var dao = database.mobileDao()
            dao.upsertSyncState(syncState())
            var outbox = outbox(dao)
            val id = outbox.enqueueCapture(text, draftId = "long-capture", createdAt = capturedAt)
            assertEquals(id, outbox.enqueueCapture(text, draftId = "long-capture", createdAt = capturedAt))
            val original = dao.outboxForCapture(id).single()
            database.close()
            database = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
            dao = database.mobileDao()
            outbox = outbox(dao)
            assertEquals(text, dao.observePendingCaptures().first().single().toPendingCapture()?.text)
            assertEquals(original, dao.outboxForCapture(id).single())
            var attempts = 0
            assertFalse(outbox.drain("server-1") { payload ->
                attempts++
                assertEquals(original.envelopeJson, payload)
                MobileCommandSendResult.Rejected("capability_unavailable", LONG_CAPTURE_UPDATE_REQUIRED)
            })
            assertFalse(outbox.drain("server-1") { error("Nonretryable incompatibility must wait for the user") })
            assertEquals(1, attempts)
            val rejected = dao.outboxForCapture(id).single()
            assertEquals(text, rejected.toPendingCapture()?.text)
            assertEquals(LONG_CAPTURE_UPDATE_REQUIRED, rejected.toPendingCapture()?.status)
            assertTrue(rejected.toPendingCapture()?.canRetry == true)
            assertEquals(0, dao.retryRejectedCapture(original.commandId, "other-server"))
            assertEquals(1, dao.retryRejectedCapture(original.commandId, "server-1"))
            assertEquals(0, dao.retryRejectedCapture(original.commandId, "server-1"))
            assertEquals(original.envelopeJson, dao.outboxForCapture(id).single().envelopeJson)
            assertEquals(1, dao.outboxForCapture(id).single().attemptCount)
            assertFalse(outbox.drain("server-1") { payload ->
                attempts++
                assertEquals(original.envelopeJson, payload)
                receipt(original.commandId, id, 1, false)
            })
            assertEquals(2, attempts)
            assertEquals(1, dao.captureReceipt(id)?.serverVersion)
            assertEquals(0, dao.outboxCount())
            assertTrue(dao.observePendingCaptures().first().isEmpty())
            val undo = outbox.undoCapture(id)
            assertEquals(undo.commandId, outbox.undoCapture(id).commandId)
            assertFalse(outbox.drain("server-1") { receipt(requireNotNull(undo.commandId), id, 2, true) })
            assertNull(dao.captureReceipt(id))
            assertEquals(0, dao.outboxCount())
        } finally {
            database.close()
            context.deleteDatabase(name)
        }
    }

    @Test
    fun overLimitDraftAndOutboxWriteFailureDoNotLoseInputOrLeavePartialReceipt() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        val store = MobileCaptureDraftStore(context)
        try {
            val dao = database.mobileDao()
            dao.upsertSyncState(syncState())
            val outbox = outbox(dao)
            val overLimit = "長".repeat(12001)
            val draft = MobileCaptureDraft.fresh(text = overLimit, kind = MobileCaptureKind.Capture)
            assertTrue(store.save(MobileCaptureDraftSnapshot(draft, true)))
            assertTrue(runCatching { outbox.enqueueCapture(overLimit) }.isFailure)
            assertEquals(overLimit, MobileCaptureDraftStore(context).load()?.draft?.text)
            database.openHelper.writableDatabase.execSQL(
                "CREATE TRIGGER reject_capture_outbox BEFORE INSERT ON outbox_command " +
                    "BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END",
            )
            assertTrue(runCatching { outbox.enqueueCapture(text, draftId = "write-failure") }.isFailure)
            assertEquals(0, dao.outboxCount())
            database.openHelper.readableDatabase.query("SELECT COUNT(*) FROM capture_receipt").use {
                assertTrue(it.moveToFirst())
                assertEquals(0, it.getInt(0))
            }
            assertEquals(overLimit, MobileCaptureDraftStore(context).load()?.draft?.text)
        } finally {
            store.clear()
            database.close()
        }
    }

    private fun outbox(dao: MobileLocalDao) = MobileOutbox(context, dao, { "capture-test-device" },
        now = { Instant.parse(capturedAt) }, schedule = {})

    private fun syncState() = SyncStateEntity(serverId = "server-1", apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
        cursor = null, lastSuccessfulSyncAt = capturedAt, lastAttemptAt = capturedAt, lastError = null)

    private fun receipt(commandId: String, id: String, version: Int, deleted: Boolean): MobileCommandSendResult.CaptureApplied =
        MobileCommandSendResult.CaptureApplied(MobileCaptureCommandContract.decodeReceipt("""
            {"ok":true,"meta":{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"server-1",
            "serverRevision":$version,"generatedAt":"$capturedAt","truncated":false},
            "data":{"commandId":"$commandId","status":"applied","capture":{"id":"$id","version":$version,
            "capturedAt":"$capturedAt","deleted":$deleted}}}
        """.trimIndent()))
}
