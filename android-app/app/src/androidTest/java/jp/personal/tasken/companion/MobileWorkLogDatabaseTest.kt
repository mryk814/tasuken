package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.*
import org.junit.Test

class MobileWorkLogDatabaseTest {
    /**
     * 作業記録の AI 整理はスマホから外した（#755 束9a）。新しい版は採用の命令を作らないが、前の版が送信待ちに
     * 残した AdoptWorkLogOrganization は消さずに送り、Desktop の受け取りを記録する（Gateway は束9b まで受ける）。
     */
    @Test fun legacyAdoptCommandLeftByOldVersionIsStillSentAndRecorded() = runBlocking {
        val name = "work-log-legacy-adopt-${UUID.randomUUID()}.db"
        var db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
        val draft = MobileWorkLogDraft(id = "source", body = "原因は温度が怪しい。", enteredAt = time)
        try {
            var dao = db.mobileDao(); dao.upsertSyncState(state())
            // 前の版が adoptOrganization で残した形をそのまま置く。
            val envelope = MobileWorkLogEnvelope(
                requestId = "work-log-organization-adopt-once", commandId = "adopt-once", idempotencyKey = "adopt-once",
                clientDeviceId = "device", issuedAt = time,
                command = buildJsonObject {
                    put("name", "AdoptWorkLogOrganization"); put("sourceId", draft.id); put("sourceVersion", 1)
                    put("proposal", MobileWorkLogContract.json.parseToJsonElement("""{"done":[],"observations":[],"unresolved":["原因は温度が怪しい。"],"nextActions":[]}"""))
                },
            )
            val envelopeJson = MobileWorkLogContract.json.encodeToString(envelope)
            dao.upsertWorkLog(WorkLogCacheEntity(draft.id, "server-540", 1, draft.body, draft.performedDate, draft.enteredAt, null, null, false, false, "adopt-once", "original-envelope"))
            dao.upsertWorkLogOrganization(WorkLogOrganizationEntity(draft.id, "server-540", 1, "adopt-once", time, "adopting", null))
            dao.insertOutbox(OutboxCommandEntity(
                commandId = "adopt-once", idempotencyKey = "adopt-once", requestId = envelope.requestId,
                clientDeviceId = "device", issuedAt = time, commandName = "AdoptWorkLogOrganization",
                envelopeJson = envelopeJson, serverId = "server-540", state = OutboxState.Pending, attemptCount = 0,
                createdAt = time, lastAttemptAt = null, lastError = null, workLogId = draft.id,
            ))
            // 版を上げた後の起動を真似る。送信待ちの命令は残っている。
            db.close(); db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build(); dao = db.mobileDao()
            assertEquals(1, dao.outboxCount())
            val sender = MobileOutbox(context, dao, { "device" }, schedule = {})
            assertFalse(sender.drain("server-540") {
                assertEquals(envelopeJson, it)
                receipt(draft, "adopt-once", 2, false)
            })
            assertEquals("adopted", dao.workLogOrganization(draft.id)?.state)
            assertEquals(draft.body, dao.workLog(draft.id)?.body)
            assertNull(dao.workLog(draft.id)?.optimisticCommandId)
            assertEquals(0, dao.outboxCount())
        } finally { db.close(); context.deleteDatabase(name) }
    }

    private val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
        override fun getApplicationContext(): Context = this
        override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("work-log-540-db-$name", mode)
    }
    private val time = "2026-09-06T23:55:00+09:00"
    private val body = " \n原文🔬\n" + "記".repeat(11980) + "\n末尾  "
    private fun state() = SyncStateEntity(serverId = "server-540", apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
        cursor = null, lastSuccessfulSyncAt = time, lastAttemptAt = null, lastError = null)

    @Test fun originalAndStableCommandReopenThenRetryUnsupportedGateway() = runBlocking {
        val name = "work-log-${UUID.randomUUID()}.db"
        var db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
        try {
            var dao = db.mobileDao()
            dao.upsertSyncState(state())
            val draft = MobileWorkLogDraft(body = body, performedDate = "2026-09-06", enteredAt = time, themeId = "theme", taskId = "task")
            var workLogs = MobileWorkLogOutbox(dao, { "device" }, {})
            assertEquals(draft.id, workLogs.record(draft))
            assertEquals(draft.id, workLogs.record(draft))
            assertEquals(1, dao.outboxCount())
            val original = requireNotNull(dao.outbox(draft.id))
            db.close()
            db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
            dao = db.mobileDao()
            workLogs = MobileWorkLogOutbox(dao, { "device" }, {})
            assertEquals(body, dao.workLog(draft.id)?.body)
            assertEquals("2026-09-06", dao.workLog(draft.id)?.performedDate)
            assertEquals(original, dao.outbox(draft.id))
            val sender = MobileOutbox(context, dao, { "device" }, now = { Instant.parse("2026-09-08T00:00:00Z") }, schedule = {})
            assertFalse(sender.drain("server-540") { MobileCommandSendResult.Rejected("validation_failed", "旧Gateway") })
            assertFalse(sender.drain("server-540") { error("Explicit retry required") })
            assertEquals(body, dao.workLog(draft.id)?.body)
            workLogs.retry(draft.id)
            assertFalse(sender.drain("server-540") {
                assertEquals(original.envelopeJson, it)
                receipt(draft, draft.id, 1, false)
            })
            assertEquals(0, dao.outboxCount())
            assertEquals(body, dao.workLog(draft.id)?.body)
            assertEquals(1, dao.workLog(draft.id)?.serverVersion)
            dao.upsertWorkLog(requireNotNull(dao.workLog(draft.id)).copy(body = "Desktopで追記した本文", themeId = "personal"))
            assertEquals(draft.id, workLogs.record(draft))
            assertEquals(0, dao.outboxCount())
            assertEquals("Desktopで追記した本文", dao.workLog(draft.id)?.body)
            assertEquals(0, dao.tasks().size)
            workLogs.delete(draft.id)
            val deletion = requireNotNull(dao.workLog(draft.id)?.optimisticCommandId)
            assertFalse(sender.drain("server-540") { receipt(draft, deletion, 2, true) })
            assertTrue(dao.workLog(draft.id)?.deleted == true)
            workLogs.restore(draft.id)
            val restore = requireNotNull(dao.workLog(draft.id)?.optimisticCommandId)
            assertFalse(sender.drain("server-540") { receipt(draft, restore, 3, false) })
            assertFalse(requireNotNull(dao.workLog(draft.id)).deleted)
            assertEquals(body, dao.workLog(draft.id)?.body)
            workLogs.delete(draft.id)
            assertFalse(sender.drain("server-540") { MobileCommandSendResult.Rejected("entity_conflict", "Desktopで変更されています") })
            assertFalse(requireNotNull(dao.workLog(draft.id)).deleted)
            dao.refreshWorkLog(requireNotNull(dao.workLog(draft.id)).copy(serverVersion = 4, body = "Desktopの最新本文"))
            assertEquals(0, dao.outboxCount())
            assertNull(dao.workLog(draft.id)?.optimisticCommandId)
            assertEquals("Desktopの最新本文", dao.workLog(draft.id)?.body)
        } finally { db.close(); context.deleteDatabase(name) }
    }

    @Test fun atomicSaveFailureAndUnsentCancellationKeepOriginalInput() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        val store = MobileWorkLogDraftStore(context)
        try {
            val dao = db.mobileDao()
            dao.upsertSyncState(state())
            val draft = MobileWorkLogDraft(body = body, enteredAt = time)
            assertTrue(store.save(draft))
            db.openHelper.writableDatabase.execSQL("CREATE TRIGGER reject_work_log BEFORE INSERT ON outbox_command BEGIN SELECT RAISE(ABORT, 'injected'); END")
            val workLogs = MobileWorkLogOutbox(dao, { "device" }, {})
            assertTrue(runCatching { workLogs.record(draft) }.isFailure)
            assertNull(dao.workLog(draft.id))
            assertEquals(0, dao.outboxCount())
            assertEquals(draft, store.load())
            db.openHelper.writableDatabase.execSQL("DROP TRIGGER reject_work_log")
            workLogs.record(draft)
            val envelope = dao.outbox(draft.id)?.envelopeJson
            workLogs.delete(draft.id)
            assertTrue(requireNotNull(dao.workLog(draft.id)).deleted)
            assertEquals(0, dao.outboxCount())
            assertEquals(body, dao.workLog(draft.id)?.body)
            workLogs.restore(draft.id)
            assertEquals(envelope, dao.outbox(draft.id)?.envelopeJson)
            assertEquals(1, dao.observeWorkLogs().first().size)
            assertTrue(runCatching { workLogs.record(draft.copy(body = "別の本文")) }.isFailure)
            assertEquals(body, dao.workLog(draft.id)?.body)
        } finally { store.clear(); db.close() }
    }

    @Test fun wrongReceiptCannotOverwriteLocalBodyOrDropPendingCommand() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao(); dao.upsertSyncState(state())
            val draft = MobileWorkLogDraft(body = body, enteredAt = time)
            MobileWorkLogOutbox(dao, { "device" }, {}).record(draft)
            val sender = MobileOutbox(context, dao, { "device" }, schedule = {})
            assertTrue(sender.drain("server-540") { receipt(draft.copy(id = "wrong-note"), draft.id, 1, false) })
            assertEquals(body, dao.workLog(draft.id)?.body)
            assertEquals(1, dao.outboxCount())
            assertTrue(runCatching { MobileWorkLogContract.record(draft.copy(body = "a\uD800"), "device") }.isFailure)
        } finally { db.close() }
    }

    private fun receipt(draft: MobileWorkLogDraft, commandId: String, version: Int, deleted: Boolean) = MobileCommandSendResult.WorkLogApplied(
        MobileWorkLogResponse(true, MobileResponseMetaDto(1, TASKEN_MOBILE_SCHEMA_VERSION, "server-540", version, time, false),
            MobileWorkLogResponseData(commandId, "applied", MobileWorkLogDto(draft.id, version, draft.body,
                draft.performedDate, draft.enteredAt, draft.themeId, draft.taskId, false, deleted))),
    )
}
