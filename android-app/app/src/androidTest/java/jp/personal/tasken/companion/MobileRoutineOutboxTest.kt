package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import java.time.LocalDate
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
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
    private var oldDesktop = false
    /** false の時は、「1回足す」を受けるが受領に数を付けない版の Desktop として答える。 */
    private var receiptCounts = true
    /** false の間、続けることの読み出し（GET /v1/routines）だけが失敗する（送るのは通る）。 */
    private var routinesReadable = true

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
                path.startsWith("/v1/routines") && !routinesReadable -> GatewayHttpResponse(503, "")
                path.startsWith("/v1/routines") -> {
                    val today = readTodayCount()
                    val week = today + 2
                    GatewayHttpResponse(
                        200,
                        """{"ok":true,"meta":${meta()},"data":{"date":"2026-11-16","habits":[{"habitId":"habit-read","title":"論文を読む",""" +
                            """"scheduleLabel":"毎日1回","todayCount":$today,"nextSequence":${today + 1},"weekCount":$week,"weekTarget":7,""" +
                            """"todayLabel":"今日${today}回","weekLabel":"今週$week/7回","met":false}]}}""",
                    )
                }
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
        // mode を知らない古い Desktop の断り方。
        if (oldDesktop) {
            return GatewayHttpResponse(
                400,
                """{"ok":false,"meta":${meta()},"error":{"code":"validation_failed","message":"invalid","retryable":false}}""",
            )
        }
        val entry = "$habitId:${action.getValue("performedOn").jsonPrimitive.content}:${action.getValue("sequence").jsonPrimitive.int}"
        val performedOn = action.getValue("performedOn").jsonPrimitive.content
        val status = if (desktopEntries.add(entry)) "applied" else "no_change"
        if (dropNextReceipt) {
            dropNextReceipt = false
            throw IOException("receipt lost after the Desktop saved the record")
        }
        // 今の Desktop は「1回足す」の受領に、保存後のその Habit の数（記録の日の数）を付ける。
        val counts = if (receiptCounts && habitId == "habit-read" && performedOn == "2026-11-16") {
            val today = readTodayCount()
            ""","habit":{"habitId":"habit-read","date":"2026-11-16","todayCount":$today,"weekCount":${today + 2},"nextSequence":${today + 1}}"""
        } else {
            ""
        }
        return GatewayHttpResponse(200, """{"ok":true,"meta":${meta()},"data":{"commandId":"$commandId","status":"$status"$counts}}""")
    }

    /** Desktop の今日の数: 元からの 1 回と、届いた記録（habit-read・2026-11-16）。 */
    private fun readTodayCount(): Int = 1 + desktopEntries.count { it.startsWith("habit-read:2026-11-16:") }

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
        // not_found は、新しい Desktop でも止めた・消した続けることに返すので、PC を新しくする案内にはしない。
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

    /**
     * 読めた続けることは端末の写しに残り、圏外で開き直しても出せる。別の日を頼まれても最後の写しを返し
     * （呼ぶ側が今日の数を出さずに使う）、別の Desktop の写しは出さない。
     */
    @Test
    fun routinesReadOnceStayOnTheDeviceForTheSameDay() = runBlocking {
        val repository = repository()
        online = true
        val read = requireNotNull(repository.fetchRoutines("2026-11-16"))
        assertEquals("論文を読む", read.habits.single().title)

        online = false
        assertNull(repository.fetchRoutines("2026-11-16"))
        val copy = requireNotNull(repository.cachedRoutines("2026-11-16"))
        assertEquals(read.copy(maintenances = emptyList()), copy.routines)
        assertEquals("2026-11-16T02:00:00Z", copy.fetchedAt)
        // 前の日の写しも返す（名前と頻度だけを使う。今日の数は呼ぶ側が出さない）。
        assertEquals("2026-11-16", repository.cachedRoutines("2026-11-17")?.routines?.date)

        dao.upsertSyncState(requireNotNull(dao.syncState()).copy(serverId = "server-2"))
        assertNull(repository.cachedRoutines("2026-11-16"))
    }

    /** 筋書き A: 閉じている間に記録が届き、圏外で開く。写しの数に届いた分が入っていて、二重に押させない。 */
    @Test
    fun aRecordDeliveredWhileClosedIsInTheCopyWhenOpenedOffline() = runBlocking {
        val repository = repository()
        online = true
        requireNotNull(repository.fetchRoutines("2026-11-16"))
        online = false
        repository.recordRoutine(action())
        // 閉じている間に、送り手（WorkManager）だけが動いて届けた。
        online = true
        repository.synchronizeIfPaired()
        assertEquals(0, dao.outboxCount())
        online = false

        val habit = requireNotNull(repository.cachedRoutines("2026-11-16")).routines.habits.single()
        assertEquals(2, habit.todayCount)
        assertEquals("今日2回", habit.todayLabel)
        assertEquals("今週4/7回", habit.weekLabel)
        assertEquals(3, habit.nextSequence)
    }

    /** 筋書き B: 届いた後の読み直しが失敗する。画面は写しへ戻るが、届いた分は数から抜けない。 */
    @Test
    fun aRecordDeliveredWhenTheRereadFailsStaysCountedOnTheScreen() = runBlocking {
        val repository = repository()
        online = true
        val viewModel = TodayViewModel(repository, today = { LocalDate.parse("2026-11-16") })
        viewModel.loadNow()
        waitFor { viewModel.routines.value?.habits?.singleOrNull()?.habit?.todayCount == 1 }
        online = false
        viewModel.recordHabit(requireNotNull(viewModel.routines.value).habits.single().habit)
        waitFor { viewModel.routines.value?.habits?.single()?.unsent == 1 }
        assertEquals(2, viewModel.routines.value?.habits?.single()?.habit?.todayCount)

        online = true
        routinesReadable = false
        repository.synchronizeIfPaired()

        waitFor {
            val shown = viewModel.routines.value?.habits?.single()
            shown?.unsent == 0 && viewModel.routines.value?.copyAt != null
        }
        val shown = requireNotNull(viewModel.routines.value).habits.single()
        assertEquals(2, shown.habit.todayCount)
        assertEquals(3, shown.habit.nextSequence)
    }

    @Test
    fun recordsRefusedByAnOldDesktopSayToUpdateThePcAndCanBeSentAgainTogether() = runBlocking {
        val repository = repository()
        oldDesktop = true
        repository.recordRoutine(action(sequence = 2))
        repository.recordRoutine(action(sequence = 3))
        online = true
        repository.synchronizeIfPaired()
        val refused = repository.observePendingRoutineRecords().first()
        assertEquals(2, refused.size)
        assertTrue(refused.all { it.rejected && it.reason == ROUTINE_UPDATE_PC_REQUIRED })

        oldDesktop = false
        assertEquals(2, repository.retryAllRoutineRecords())
        assertTrue(repository.observePendingRoutineRecords().first().none { it.rejected })
        repository.synchronizeIfPaired()
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun aDiscardedRecordCanBePutBackAsItWas() = runBlocking {
        val repository = repository()
        refuseHabit = "habit-gone"
        repository.recordRoutine(action(habitId = "habit-gone", sequence = 1))
        online = true
        repository.synchronizeIfPaired()
        val before = requireNotNull(dao.routineRecords().single())

        val removed = requireNotNull(repository.discardRoutineRecord(before.commandId))
        assertEquals(0, dao.outboxCount())
        repository.restoreRoutineRecord(removed)

        assertEquals(before, dao.outbox(before.commandId))
    }

    /** 筋 A: 開いた時に、送り出しと読み直しが重なる。届いた記録を受領の数と読み直しで二重に数えない。 */
    @Test
    fun deliveryAndRereadOverlappingDoNotCountTwice() = runBlocking {
        val repository = repository()
        online = true
        val viewModel = TodayViewModel(repository, today = { LocalDate.parse("2026-11-16") })
        viewModel.loadNow()
        waitFor { viewModel.routines.value?.habits?.singleOrNull()?.habit?.todayCount == 1 }
        online = false
        viewModel.recordHabit(requireNotNull(viewModel.routines.value).habits.single().habit)
        waitFor { viewModel.routines.value?.habits?.single()?.unsent == 1 }

        online = true
        // 開いた時の読み込み: 列を送り、続けて Desktop から読み直す（届いた記録は読み直しにも入っている）。
        viewModel.loadNow()
        waitFor {
            val shown = viewModel.routines.value?.habits?.single()
            shown?.unsent == 0 && viewModel.routines.value?.copyAt == null
        }
        assertEquals(2, viewModel.routines.value?.habits?.single()?.habit?.todayCount)
        assertEquals(2, repository.cachedRoutines("2026-11-16")?.routines?.habits?.single()?.todayCount)
    }

    /** 筋 B: 応答を失って送り直す。間に読み直しが入っても、送り直しの受領で二重に足さない。 */
    @Test
    fun aResendAfterARereadDoesNotCountTwice() = runBlocking {
        val repository = repository()
        online = true
        requireNotNull(repository.fetchRoutines("2026-11-16"))
        online = false
        repository.recordRoutine(action())
        online = true
        dropNextReceipt = true
        repository.synchronizeIfPaired()
        assertEquals(1, dao.outboxCount())
        // 読み直しは、Desktop が保存した記録を数えている（今日 2 回）。
        assertEquals(2, requireNotNull(repository.fetchRoutines("2026-11-16")).habits.single().todayCount)

        repository.synchronizeIfPaired()

        assertEquals(0, dao.outboxCount())
        val habit = requireNotNull(repository.cachedRoutines("2026-11-16")).routines.habits.single()
        assertEquals(2, habit.todayCount)
        assertEquals("今週4/7回", habit.weekLabel)
    }

    /** 前の日の写しの間に今日の記録が届き、圏外で開き直す。その Habit は受領の数で今日の数を出す。 */
    @Test
    fun aRecordDeliveredWhileTheCopyIsFromYesterdayShowsTodaysCountWhenReopenedOffline() = runBlocking {
        seedYesterdayCopy()
        val repository = repository()
        repository.recordRoutine(action())
        online = true
        repository.synchronizeIfPaired()
        assertEquals(0, dao.outboxCount())
        online = false

        val viewModel = TodayViewModel(repository(), today = { LocalDate.parse("2026-11-16") })
        viewModel.loadNow()
        waitFor { viewModel.routines.value?.copyAt != null }
        val shown = requireNotNull(viewModel.routines.value).habits.single()
        assertTrue(shown.countsKnown)
        assertEquals(2, shown.habit.todayCount)
        assertEquals(0, shown.unsent)
    }

    /** 受領に数を付けない Desktop。前の日の写しの間に届いた今日の記録は、数を出さずに「+N」に残る。 */
    @Test
    fun withoutReceiptCountsADeliveredRecordStaysVisibleAsAddedToday() = runBlocking {
        receiptCounts = false
        seedYesterdayCopy()
        val repository = repository()
        repository.recordRoutine(action())
        online = true
        repository.synchronizeIfPaired()
        assertEquals(0, dao.outboxCount())
        online = false

        val viewModel = TodayViewModel(repository(), today = { LocalDate.parse("2026-11-16") })
        viewModel.loadNow()
        waitFor { viewModel.routines.value?.copyAt != null }
        val shown = requireNotNull(viewModel.routines.value).habits.single()
        assertEquals(false, shown.countsKnown)
        assertEquals(1, shown.uncounted)
        assertEquals(0, shown.unsent)

        // 写しが今日の物なら、記録の番号が写しの次の番号以上の時だけ 1 足す（受領に数が無い時の扱い）。
        online = true
        requireNotNull(repository.fetchRoutines("2026-11-16"))
        online = false
        repository.recordRoutine(action(sequence = 3))
        online = true
        repository.synchronizeIfPaired()
        assertEquals(3, requireNotNull(repository.cachedRoutines("2026-11-16")).routines.habits.single().todayCount)
    }

    /** 前の日（2026-11-15）に読めた写しを置く。 */
    private suspend fun seedYesterdayCopy() {
        val yesterday = MobileRoutinesDataDto(
            date = "2026-11-15",
            habits = listOf(
                MobileRoutineHabitDto(
                    habitId = "habit-read", title = "論文を読む", scheduleLabel = "毎日1回", todayCount = 1, nextSequence = 2,
                    weekCount = 7, weekTarget = 7, todayLabel = "今日1回", weekLabel = "今週7/7回", met = true,
                ),
            ),
        )
        dao.upsertRoutineCache(RoutineCacheEntity("server-1", "2026-11-15", MobileRoutineContract.encodeCopy(yesterday), "2026-11-15T12:00:00Z"))
    }

    private suspend fun waitFor(condition: () -> Boolean) {
        withTimeout(10_000) { while (!condition()) delay(50) }
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
