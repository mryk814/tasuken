package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class MobileRecallDatabaseTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val date = LocalDate.parse("2026-09-06")
    private val zone = ZoneId.of("Asia/Tokyo")
    private val at = "2026-09-05T16:10:00Z"
    private fun state(id: String = "recall-server") = SyncStateEntity(serverId = id, apiVersion = 1,
        schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null, lastSuccessfulSyncAt = at, lastAttemptAt = null, lastError = null)
    private fun event(id: String, source: String = id, type: String = "task") = MobileRecallEvent(id,
        if (type == "task") "task_completed" else "recorded", "記録 $source", "原記録の索引 $source", date.toString(), "01:10",
        MobileRecallClassification(if (type == "capture_entry") "input" else "work_recorded"), MobileRecallSource(type, source, "available"))
    private fun response(events: List<MobileRecallEvent>, next: String? = null, offset: Int = 0,
        revision: String = "generation-1", timezone: String = zone.id, status: String = "ok"): GatewayHttpResponse {
        val value = MobileRecallResponse(true, MobileResponseMetaDto(1, TASKEN_MOBILE_SCHEMA_VERSION, "recall-server", 1, at, next != null),
            MobileRecallData(events, next != null, MobileRecallPage(status, MobileRecallPeriod(date.toString(), timezone),
                500, events.size, offset, next, revision, at)))
        return GatewayHttpResponse(200, MobileRecallContract.json.encodeToString(value))
    }

    @Test fun moreThan500KeepsPublishedSnapshotUntilNewGenerationCompletesAndSurvivesRestartOffline() = runBlocking {
        val name = "recall-549-${UUID.randomUUID()}.db"
        var db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
        try {
            var dao = db.mobileDao(); dao.upsertSyncState(state())
            var reply = response((1..500).map { event("old-$it") }, "opaque+/=cursor")
            var requested = ""
            var reader = MobileRecallReader(dao) { requested = it; reply }
            assertNull(reader.observe(date, zone).first().lastFetchedAt)
            reader.refresh(date, zone, false)
            assertEquals(500, reader.observe(date, zone).first().rows.size)
            assertTrue(reader.observe(date, zone).first().partial)
            reply = response(listOf(event("old-501")), offset = 500)
            reader.refresh(date, zone, true)
            assertTrue(requested.contains("cursor=opaque%2B%2F%3Dcursor"))
            assertEquals(501, reader.observe(date, zone).first().rows.size)
            assertFalse(reader.observe(date, zone).first().partial)
            reply = response((1..500).map { event("new-$it") }, "new-cursor", revision = "generation-2")
            reader.refresh(date, zone, false)
            assertTrue(reader.observe(date, zone).first().showingPreviousSnapshot)
            assertEquals("old-501", reader.observe(date, zone).first().rows.last().id)
            reply = GatewayHttpResponse(503, "offline")
            reader.refresh(date, zone, true)
            assertEquals(501, reader.observe(date, zone).first().rows.size)
            db.close(); db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build(); dao = db.mobileDao()
            reader = MobileRecallReader(dao) { throw java.io.IOException("PC offline") }
            reader.refresh(date, zone, true)
            assertEquals("old-501", reader.observe(date, zone).first().rows.last().id)
            assertNotNull(reader.observe(date, zone).first().error)
            reader = MobileRecallReader(dao) { response(listOf(event("new-501")), offset = 500, revision = "generation-2") }
            reader.refresh(date, zone, true)
            val final = reader.observe(date, zone).first()
            assertFalse(final.partial); assertEquals(501, final.rows.size)
            assertTrue(final.rows.all { it.id.startsWith("new-") })
        } finally { db.close(); context.deleteDatabase(name) }
    }

    @Test fun pendingSourcesRemainAfterReceiptAndDoNotReturnAfterCanonicalRemoval() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(state())
            val outbox = MobileOutbox(context, dao, { "device" }, schedule = {})
            val captureId = outbox.enqueueCapture("  原文\n🔬 ", draftId = "capture-input", createdAt = at)
            val workLog = MobileWorkLogDraft(id = "note-input", body = "Task外の検討", performedDate = date.toString(), enteredAt = at)
            MobileWorkLogOutbox(dao, { "device" }, {}).record(workLog)
            var reply = response(emptyList())
            val reader = MobileRecallReader(dao) { reply }
            reader.refresh(date, zone, false)
            assertEquals(2, reader.observe(date, zone).first().rows.size)
            // Receipt application removes outbox entries. The durable source text must bridge the next query.
            val captureCommand = requireNotNull(dao.observePendingCaptures().first().single())
            dao.deleteOutbox(captureCommand.commandId)
            dao.upsertCaptureReceipt(requireNotNull(dao.captureReceipt(captureId)).copy(serverVersion = 1, optimisticCommandId = null))
            dao.deleteOutbox(workLog.id)
            dao.upsertWorkLog(requireNotNull(dao.workLog(workLog.id)).copy(serverVersion = 1, optimisticCommandId = null))
            assertEquals(2, reader.observe(date, zone).first().rows.size)
            reply = response(listOf(event("synthetic-input:$captureId", captureId, "capture_entry"), event("change-note", workLog.id, "work_log")))
            reader.refresh(date, zone, false)
            val accepted = reader.observe(date, zone).first()
            assertEquals(2, accepted.rows.size)
            assertEquals(2, accepted.rows.map { it.source.type to it.source.id }.distinct().size)
            assertEquals("  原文\n🔬 ", accepted.rows.first().capture?.text)
            // A later complete query no longer contains either source (removed/moved/organized on Desktop).
            reply = response(emptyList(), revision = "after-removal")
            reader.refresh(date, zone, false)
            assertTrue(reader.observe(date, zone).first().rows.isEmpty())
            assertEquals("Task外の検討", dao.workLog(workLog.id)?.body)
            assertEquals("  原文\n🔬 ", dao.observeRecallCaptures().first().single().body)
        } finally { db.close() }
    }

    @Test fun calendarTimezoneServerAndOldGatewayStayDistinctFromConfirmedEmpty() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(state())
            val outbox = MobileOutbox(context, dao, { "device" }, schedule = {})
            outbox.enqueueCapture("日付跨ぎ", createdAt = at)
            var reply = GatewayHttpResponse(404, "old gateway")
            val reader = MobileRecallReader(dao) { reply }
            reader.refresh(date, zone, false)
            val old = reader.observe(date, zone).first()
            assertNull(old.lastFetchedAt); assertNotNull(old.error); assertEquals(1, old.rows.size)
            assertTrue(reader.observe(date.minusDays(1), zone).first().rows.isEmpty())
            assertEquals(1, reader.observe(date.minusDays(1), ZoneId.of("America/Los_Angeles")).first().rows.size)
            reply = response(emptyList(), timezone = "UTC")
            reader.refresh(date, zone, false)
            assertNull(reader.observe(date, zone).first().lastFetchedAt)
            reply = response(emptyList())
            reader.refresh(date, zone, false)
            assertNotNull(reader.observe(date, zone).first().lastFetchedAt)
            assertNull(reader.observe(date, ZoneId.of("UTC")).first().lastFetchedAt)
            dao.upsertSyncState(state("other-server"))
            assertTrue(reader.observe(date, zone).first().rows.isEmpty())
            assertNull(reader.observe(date, zone).first().lastFetchedAt)
        } finally { db.close() }
    }

    @Test fun captureUndoAndAtomicFailureDoNotLeaveARecallGhost() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(state())
            val outbox = MobileOutbox(context, dao, { "device" }, schedule = {})
            db.openHelper.writableDatabase.execSQL("CREATE TRIGGER reject_capture BEFORE INSERT ON outbox_command BEGIN SELECT RAISE(ABORT, 'injected'); END")
            assertTrue(runCatching { outbox.enqueueCapture("失敗しても原文を保持", createdAt = at) }.isFailure)
            assertTrue(dao.observeRecallCaptures().first().isEmpty())
            db.openHelper.writableDatabase.execSQL("DROP TRIGGER reject_capture")
            val id = outbox.enqueueCapture("取り消す入力", createdAt = at)
            assertEquals(1, dao.observeRecallCaptures().first().size)
            outbox.undoCapture(id)
            assertTrue(dao.observeRecallCaptures().first().isEmpty())
            assertEquals(0, dao.outboxCount())
        } finally { db.close() }
    }

    @Test fun sameNoteIdOnAnotherServerDoesNotOverwriteBodyOrSilentlyOpenEmptyDetail() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(state())
            val original = WorkLogCacheEntity("shared-note", "recall-server", 1, "元のDesktopの本文", date.toString(), at, null, null, false, false, null)
            dao.cacheRecallWorkLog(original)
            dao.upsertSyncState(state("other-server"))
            val failed = runCatching { dao.cacheRecallWorkLog(original.copy(serverId = "other-server", body = "別のDesktop")) }
            assertTrue(failed.exceptionOrNull() is MobileRecallSourceUnavailable)
            assertEquals(original, dao.workLog(original.id))
        } finally { db.close() }
    }

    @Test fun resyncFailureKeepsOldSnapshotAndDoesNotAcknowledgeUnpublishedSources() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(state())
            var reply = response(listOf(event("previous")))
            val reader = MobileRecallReader(dao) { reply }
            reader.refresh(date, zone, false)
            val log = MobileWorkLogDraft(id = "new-note", body = "同期済み未掲載", performedDate = date.toString(), enteredAt = at)
            MobileWorkLogOutbox(dao, { "device" }, {}).record(log)
            dao.deleteOutbox(log.id); dao.upsertWorkLog(requireNotNull(dao.workLog(log.id)).copy(serverVersion = 1, optimisticCommandId = null))
            reply = response(listOf(event("new-official", log.id, "work_log")), next = "continuation", revision = "next")
            reader.refresh(date, zone, false)
            val during = reader.observe(date, zone).first()
            assertEquals(setOf("previous", "local-work-log:new-note"), during.rows.map { it.id }.toSet())
            assertFalse(dao.observeRecallSeenSources().first().any { it.sourceId == log.id })
            reply = response(emptyList(), status = "resync_required")
            reader.refresh(date, zone, true)
            assertEquals(2, reader.observe(date, zone).first().rows.size)
            assertNotNull(reader.observe(date, zone).first().error)
        } finally { db.close() }
    }
}
