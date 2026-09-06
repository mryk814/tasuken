package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Real Desktop commands verify that whole Checklist values never silently replace concurrent edits. */
class MobileTaskStructuredGatewayTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val client = MobileGatewayFixtureClient()
    private val initial = listOf(MobileChecklistItem("one", "一つ目", false, 0.0), MobileChecklistItem("two", "二つ目", false, 1.0))

    @Test fun sameItemDifferentItemAndDeleteEditKeepBothChecklistValues() = runBlocking {
        assumeTrue(client.available)
        for (scenario in listOf("same", "different", "delete")) {
            val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
            try {
                val dao = db.mobileDao()
                val outbox = prepare(dao)
                val id = outbox.enqueueCreate("Checklist $scenario", checklistItems = initial)
                assertFalse(outbox.drain(client.serverId, client::send))
                val local = if (scenario == "delete") initial.drop(1).mapIndexed { index, item -> item.copy(sortOrder = index.toDouble()) } else initial.map { if (it.id == "one") it.copy(title = "端末で編集した一つ目") else it }
                val remote = initial.map {
                    if (it.id == if (scenario == "different") "two" else "one") it.copy(title = "Desktopの編集") else it
                }
                val root = outbox.enqueueUpdateChecklist(id, local)
                outbox.enqueueComplete(id)
                val command = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(root)).envelopeJson)
                assertTrue(client.send(remoteEnvelope(command, buildJsonObject {
                    put("checklistItems", Json.parseToJsonElement(encodeMobileChecklist(remote)))
                })) is MobileCommandSendResult.Applied)
                assertFalse(outbox.drain(client.serverId, client::send))
                if (scenario == "different") {
                    assertNull(dao.conflict(root))
                    assertEquals(listOf(local.first(), remote.last()), decodeMobileChecklist(requireNotNull(dao.task(id)).checklistJson))
                    assertEquals("done", dao.task(id)?.state)
                    assertEquals(0, dao.outboxCount())
                    continue
                }
                val conflict = requireNotNull(dao.conflict(root))
                assertEquals(local, decodeMobileChecklist(requireNotNull(conflict.localChecklistJson)))
                assertEquals(remote, decodeMobileChecklist(requireNotNull(dao.task(id)).checklistJson))
                assertEquals(OutboxState.Blocked, dao.taskDescendants(root).single().state)
                outbox.acceptServer(root)
                assertEquals(remote, decodeMobileChecklist(requireNotNull(dao.task(id)).checklistJson))
                assertEquals(0, dao.outboxCount())
            } finally { db.close() }
        }
    }

    @Test fun scheduleVersionConflictRetainsDatesAndTimeThenExplicitRetryUsesCurrentVersions() = runBlocking {
        assumeTrue(client.available)
        val db = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        try {
            val dao = db.mobileDao()
            val outbox = prepare(dao)
            val id = outbox.enqueueCreate("日付と時刻の競合", schedule = MobileCreateTaskScheduleDto("2026-09-08", "2026-09-10", "ongoing"))
            assertFalse(outbox.drain(client.serverId, client::send))
            val before = requireNotNull(dao.task(id))
            val root = outbox.enqueueUpdateSchedule(id, MobileTaskScheduleDraft("2026-09-08", "2026-09-12", "ongoing", "10:15", 90))
            outbox.enqueueUpdateChecklist(id, initial)
            outbox.enqueueComplete(id)
            val command = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(root)).envelopeJson)
            val remoteChanges = buildJsonObject {
                put("schedule", buildJsonObject {
                    put("startDate", JsonPrimitive("2026-09-08")); put("endDate", JsonPrimitive("2026-09-11")); put("rangeSemantics", JsonPrimitive("ongoing"))
                })
            }
            val remoteCommand = command.copy(command = command.command.copy(changes = remoteChanges,
                base = JsonObject(command.command.base.filterKeys { it == "schedule" })))
            assertTrue(client.send(remoteEnvelope(remoteCommand, remoteChanges)) is MobileCommandSendResult.Applied)
            var conflictField: String? = null
            assertFalse(outbox.drain(client.serverId) { envelope ->
                client.send(envelope).also { result ->
                    if (result is MobileCommandSendResult.Conflict) conflictField = result.response.error.conflict?.conflictField
                }
            })
            val conflict = requireNotNull(dao.conflict(root))
            assertEquals("schedule", conflictField)
            assertEquals("2026-09-12", conflict.localScheduleEndDate)
            assertEquals("10:15", conflict.localPlannedStartTime)
            assertEquals("2026-09-11", dao.task(id)?.scheduleEndDate)
            val replacement = outbox.keepLocal(root)
            val retry = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(replacement)).envelopeJson)
            assertEquals(before.scheduleVersion!! + 1, retry.command.expectedScheduleVersion)
            assertEquals(requireNotNull(dao.task(id)).serverVersion, retry.command.expectedVersion)
            assertFalse(outbox.drain(client.serverId, client::send))
            assertEquals(0, dao.outboxCount())
            assertEquals("2026-09-12", dao.task(id)?.scheduleEndDate)
            assertEquals("10:15", dao.task(id)?.plannedStartTime)
            assertEquals(90, dao.task(id)?.plannedDurationMinutes)
            assertEquals(initial, decodeMobileChecklist(requireNotNull(dao.task(id)).checklistJson))
            assertEquals("done", dao.task(id)?.state)
        } finally { db.close() }
    }

    private suspend fun prepare(dao: MobileLocalDao): MobileOutbox {
        dao.upsertSyncState(SyncStateEntity(serverId = client.serverId, apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            cursor = null, lastSuccessfulSyncAt = Instant.now().toString(), lastAttemptAt = null, lastError = null))
        return MobileOutbox(context, dao, { client.deviceId }, schedule = {})
    }

    private fun remoteEnvelope(original: MobileTaskUpdateEnvelopeDto, changes: JsonObject): String {
        val id = UUID.randomUUID().toString()
        return MobileTaskCommandContract.encode(original.copy(requestId = UUID.randomUUID().toString(), commandId = id,
            idempotencyKey = id, command = original.command.copy(changes = changes)))
    }
}
