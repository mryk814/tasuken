package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 続けることの記録は、Desktopへ直接送らず送信の列に先に書く。つながらない間は端末に残り、
 * つながったら同じ commandId で送り直す。応答を失った再送でも Desktop の記録は増えず、
 * 断られた記録は理由と一緒に列に残り、後ろの命令を止めない。HTTP の境目だけを差し替える。
 */
@RunWith(AndroidJUnit4::class)
class MobileRoutineOutboxTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private lateinit var store: MobileGatewayConnectionStore
    private var scheduled = 0

    /** Desktop 側の記録。habitEntryId と同じく、Habit・日・回の組で一つ。 */
    private val desktopEntries = linkedSetOf<String>()
    private val sentRoutineBodies = mutableListOf<String>()
    private var online = false
    private var dropNextReceipt = false
    private var refuseHabit: String? = null

    @Before
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.mobileDao()
        dao.upsertSyncState(
            SyncStateEntity(
                serverId = "server-1",
                apiVersion = 1,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = "task-cursor",
                lastSuccessfulSyncAt = "2026-11-16T00:00:00Z",
                lastAttemptAt = "2026-11-16T00:00:00Z",
                lastError = null,
            ),
        )
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "h".repeat(43), setOf("mobile:read", "mobile:task-write", "mobile:capture-write"))
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    private fun repository() = AndroidMobileTaskRepository(
        context = context,
        store = store,
        database = database,
        scheduleOutboxOnStart = false,
        httpClient = MobileGatewayHttpClient { _, path, method, body, _ ->
            if (!online) throw IOException("offline")
            when {
                path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(200, page("tasks"))
                path == "/v1/routine-actions" && method == "POST" -> routineAnswer(requireNotNull(body))
                path == "/v1/commands" -> {
                    val commandId = Json.parseToJsonElement(requireNotNull(body)).jsonObject.getValue("commandId").jsonPrimitive.content
                    GatewayHttpResponse(200, """{"ok":true,"meta":${meta()},"data":{"commandId":"$commandId","status":"applied","task":${taskJson()}}}""")
                }
                else -> GatewayHttpResponse(404, "")
            }
        },
        scheduleOutbox = { scheduled += 1 },
    )

    private fun routineAnswer(body: String): GatewayHttpResponse {
        sentRoutineBodies += body
        val envelope = Json.parseToJsonElement(body).jsonObject
        val commandId = envelope.getValue("commandId").jsonPrimitive.content
        val action = envelope.getValue("action").jsonObject
        val habitId = action.getValue("habitId").jsonPrimitive.content
        if (habitId == refuseHabit) {
            return GatewayHttpResponse(
                404,
                """{"ok":false,"meta":${meta()},"error":{"code":"not_found","message":"not found","retryable":false}}""",
            )
        }
        val entry = "$habitId:${action.getValue("performedOn").jsonPrimitive.content}:${action.getValue("sequence").jsonPrimitive.int}"
        val status = if (desktopEntries.add(entry)) "applied" else "no_change"
        if (dropNextReceipt) {
            dropNextReceipt = false
            throw IOException("receipt lost after the Desktop saved the record")
        }
        return GatewayHttpResponse(200, """{"ok":true,"meta":${meta()},"data":{"commandId":"$commandId","status":"$status"}}""")
    }

    private fun action(habitId: String = "habit-read", sequence: Int = 2) =
        MobileRoutineActionDto(name = ROUTINE_RECORD_COMMAND, performedOn = "2026-11-16", habitId = habitId, sequence = sequence)

    @Test
    fun anOfflineRecordIsWrittenToTheDeviceFirstAndSentWhenTheDesktopIsReachable() = runBlocking {
        val repository = repository()

        assertEquals(MobileRoutineActionResult.Queued, repository.recordRoutine(action()))
        // 2 回目の押下は、Today に出ている次の番号が古くても、列にある記録の次の回になる。
        assertEquals(MobileRoutineActionResult.Queued, repository.recordRoutine(action()))

        val queued = repository.observePendingRoutineRecords().first()
        assertEquals(listOf(2, 3), queued.map { it.sequence })
        assertTrue(queued.none { it.rejected })
        assertEquals(2, dao.pendingCount())
        assertEquals(2, scheduled)

        // つながらない間は、送ろうとしても端末に残る。
        assertFalse(repository.synchronizeIfPaired())
        assertEquals(2, repository.observePendingRoutineRecords().first().size)

        online = true
        repository.synchronizeIfPaired()

        assertEquals(setOf("habit-read:2026-11-16:2", "habit-read:2026-11-16:3"), desktopEntries)
        assertTrue(repository.observePendingRoutineRecords().first().isEmpty())
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun aResendAfterALostReceiptKeepsTheSameCommandAndDoesNotRecordTwice() = runBlocking {
        val repository = repository()
        repository.recordRoutine(action())
        online = true
        dropNextReceipt = true

        repository.synchronizeIfPaired()
        // Desktop は保存したが、応答が届かなかった。記録は列に残る。
        assertEquals(1, desktopEntries.size)
        val waiting = repository.observePendingRoutineRecords().first().single()
        assertEquals(OutboxState.RetryWait, waiting.state)

        repository.synchronizeIfPaired()

        assertEquals(2, sentRoutineBodies.size)
        assertEquals(sentRoutineBodies[0], sentRoutineBodies[1])
        assertEquals(1, desktopEntries.size)
        assertNull(dao.outbox(waiting.commandId))
    }

    @Test
    fun aRefusedRecordStaysWithItsReasonAndDoesNotHoldBackTheRest() = runBlocking {
        val repository = repository()
        refuseHabit = "habit-gone"
        repository.recordRoutine(action(habitId = "habit-gone", sequence = 1))
        repository.recordRoutine(action(habitId = "habit-read", sequence = 2))
        online = true

        repository.synchronizeIfPaired()

        assertEquals(setOf("habit-read:2026-11-16:2"), desktopEntries)
        val refused = repository.observePendingRoutineRecords().first().single()
        assertEquals("habit-gone", refused.habitId)
        assertTrue(refused.rejected)
        assertTrue(requireNotNull(refused.reason).contains("見つかりませんでした"))
        // 断られた記録は送る数（waiting）には入らず、同期の一覧の「受け取られなかった」に出る。
        assertEquals(0, dao.pendingCount())

        // 送り直すと、同じ commandId・同じ番号で列へ戻る。
        refuseHabit = null
        repository.retryRoutineRecord(refused.commandId)
        assertEquals(OutboxState.Pending, dao.outbox(refused.commandId)?.state)
        repository.synchronizeIfPaired()
        assertTrue("habit-gone:2026-11-16:1" in desktopEntries)
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun onlyARefusedRecordCanBeDiscardedByTheOwner() = runBlocking {
        val repository = repository()
        refuseHabit = "habit-gone"
        repository.recordRoutine(action(habitId = "habit-gone", sequence = 1))
        val waiting = repository.observePendingRoutineRecords().first().single()

        // まだ送っていない記録は消せない（黙って落とさない）。
        assertTrue(runCatching { repository.discardRoutineRecord(waiting.commandId) }.isFailure)
        assertEquals(1, dao.outboxCount())

        online = true
        repository.synchronizeIfPaired()
        repository.discardRoutineRecord(waiting.commandId)

        assertEquals(0, dao.outboxCount())
    }

    private fun meta(): String =
        """{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"server-1",""" +
            """"serverRevision":8,"generatedAt":"2026-11-16T02:00:00Z","truncated":false}"""

    private fun taskJson(): String =
        """{"id":"task-a","version":2,"title":"A","themeId":null,"state":"todo","workState":null,""" +
            """"todayDate":"2026-11-16","schedule":null,"updatedAt":"2026-11-16T02:00:00Z"}"""

    private fun page(field: String): String =
        """{"ok":true,"meta":${meta()},"data":{"$field":[],"nextCursor":"task-cursor","hasMore":false}}"""
}
