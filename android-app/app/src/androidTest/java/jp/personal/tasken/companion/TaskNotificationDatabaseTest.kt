package jp.personal.tasken.companion

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.service.notification.StatusBarNotification
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
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
 * 時刻と期限の知らせ（#753）を、実際の Room と通知で確かめる: 写しから通知を組む・アラームの掛け直し・
 * 通知からの完了と「後で」が未送信の列に入る・競合で端末の値を黙って捨てない。
 */
@RunWith(AndroidJUnit4::class)
class TaskNotificationDatabaseTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private lateinit var outbox: MobileOutbox
    private lateinit var manager: NotificationManager
    private val tokyo = ZoneId.of("Asia/Tokyo")
    private val dueId = "10000000-0000-4000-8000-000000000753"
    private val timedId = "10000000-0000-4000-8000-000000000754"
    private val alarms = mutableListOf<LocalDateTime?>()

    @Before
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        manager = context.getSystemService(NotificationManager::class.java)
        manager.cancelAll()
        TaskNotificationSettings.writeFired(context, emptyMap())
        TaskNotificationSettings.setDueTimes(context, TaskNotificationPlan.DefaultDueTimes)
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).allowMainThreadQueries().build()
        dao = database.mobileDao()
        outbox = MobileOutbox(context, dao, deviceId = { "android-test-device" }, now = { Instant.parse("2026-11-16T05:30:10Z") }, schedule = {})
        dao.upsertSyncState(SyncStateEntity(serverId = "server-1", apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = "cursor", lastSuccessfulSyncAt = "2026-11-16T00:00:00Z", lastAttemptAt = "2026-11-16T00:00:00Z", lastError = null))
        dao.upsertTask(task(dueId, "書類を出す", dueDate = "2026-11-16"))
        dao.upsertTask(task(timedId, "電話する", reminderAt = "2026-11-16T14:30"))
    }

    @After
    fun tearDown() {
        database.close()
        manager.cancelAll()
        TaskNotificationSettings.writeFired(context, emptyMap())
        TaskNotificationSettings.setDueTimes(context, TaskNotificationPlan.DefaultDueTimes)
    }

    private fun task(id: String, title: String, state: String = "todo", reminderAt: String? = null, dueDate: String? = null) = TaskCacheEntity(
        id = id, serverVersion = 4, title = title, themeId = null, state = state, workState = null,
        todayDate = null, updatedAt = "2026-11-16T00:00:00Z", optimisticCommandId = null, reminderAt = reminderAt,
        scheduleId = dueDate?.let { "schedule-$id" }, scheduleVersion = dueDate?.let { 1 }, scheduleEndDate = dueDate,
        scheduleDateKind = dueDate?.let { "deadline" },
    )

    private fun at(day: Int, hour: Int, minute: Int = 0) = LocalDateTime.of(2026, 11, day, hour, minute)

    private suspend fun sync(now: LocalDateTime, canPost: Boolean = true) =
        TaskNotificationScheduler.sync(context, dao, now, tokyo, canPost) { alarms += it }

    private fun shown(): List<StatusBarNotification> = manager.activeNotifications.filter {
        it.notification.channelId == TaskNotificationScheduler.ChannelId && it.tag?.startsWith("tasken-time:") == true
    }

    private fun summary(): StatusBarNotification? = manager.activeNotifications.singleOrNull { it.tag == "tasken-time-summary" }

    /** notify() と cancel() は非同期に反映されるので、その数になるまで少し待つ。 */
    private fun awaitShown(count: Int): List<StatusBarNotification> {
        val deadline = System.currentTimeMillis() + 5_000
        while (shown().size != count && System.currentTimeMillis() < deadline) Thread.sleep(100)
        return shown()
    }

    private fun summary(version: Int, reminderAt: String?) = MobileTaskSummaryDto(
        id = timedId, version = version, title = "電話する", themeId = null, state = "todo", workState = null,
        schedule = null, updatedAt = "2026-11-16T05:31:00Z", reminderAt = reminderAt,
    )

    private fun meta(revision: Int, generatedAt: String) = MobileResponseMetaDto(1, TASKEN_MOBILE_SCHEMA_VERSION, "server-1", revision, generatedAt, false)

    @Test
    fun theAlarmIsSetForTheNextNoticeAndNoticesAreBuiltFromTheLocalCopy() = runBlocking {
        // 朝 8 時: まだ何も出さず、アラームは 9 時（期限の日の知らせ）。
        assertEquals(emptyList<TaskNotice>(), sync(at(16, 8)))
        assertEquals(at(16, 9), alarms.last())
        assertEquals(0, shown().size)

        // 9 時にアラームが鳴った: 期限の知らせを出し、次は 14:30（時刻を付けた Task）。
        assertEquals(listOf("due:$dueId:2026-11-16T09:00"), sync(at(16, 9)).map { it.key })
        assertEquals(at(16, 14, 30), alarms.last())
        val due = awaitShown(1).single()
        assertEquals("書類を出す", due.notification.extras.getString("android.title"))
        assertEquals("今日が期限", due.notification.extras.getString("android.text"))
        // ロック画面に出る公開版は、題名を持たない。
        val public = requireNotNull(due.notification.publicVersion)
        assertEquals("Tasken", public.extras.getString("android.title"))
        assertEquals("Task の期限 1 件", public.extras.getString("android.text"))
        assertEquals(listOf("完了", "1 時間後", "明日"), due.notification.actions.map { it.title.toString() })

        // 同じ知らせは 2 度出さない（アラームの掛け直しや同期のたびに鳴らない）。
        manager.cancelAll()
        awaitShown(0)
        assertEquals(emptyList<TaskNotice>(), sync(at(16, 9, 5)))
        assertEquals(0, shown().size)

        // 14:30: 時刻の知らせ。もう先の知らせが無いので、アラームは外す。
        assertEquals(listOf("time:$timedId:2026-11-16T14:30"), sync(at(16, 14, 30)).map { it.key })
        assertNull(alarms.last())
        val timed = awaitShown(1).single()
        assertEquals("電話する", timed.notification.extras.getString("android.title"))
        assertEquals("14:30", timed.notification.extras.getString("android.text"))
        assertEquals("Task の時刻 1 件", requireNotNull(timed.notification.publicVersion).extras.getString("android.text"))
    }

    @Test
    fun aRebootAfterTheTimeStillDeliversAndASecondDueTimeAddsAnotherAlarm() = runBlocking {
        TaskNotificationSettings.setDueTimes(context, listOf(LocalTime.of(9, 0), LocalTime.of(17, 0)))
        // 9 時に電源が切れていて、10 時に起動した（再起動の受け手は同じ sync を呼ぶ）。
        assertEquals(listOf("due:$dueId:2026-11-16T09:00"), sync(at(16, 10)).map { it.key })
        assertEquals(at(16, 14, 30), alarms.last())
        awaitShown(1)
        assertEquals(listOf("time:$timedId:2026-11-16T14:30"), sync(at(16, 14, 31)).map { it.key })
        assertEquals(at(16, 17), alarms.last())
        assertEquals(listOf("due:$dueId:2026-11-16T17:00"), sync(at(16, 17)).map { it.key })
        assertNull(alarms.last())
    }

    @Test
    fun withoutTheNotificationPermissionNothingIsMarkedAsNotified() = runBlocking {
        assertEquals(emptyList<TaskNotice>(), sync(at(16, 9), canPost = false))
        assertEquals(0, shown().size)
        assertEquals(emptyMap<String, String>(), TaskNotificationSettings.fired(context))
        // 権限を付けた後の同期で、今日のうちに届く。
        assertEquals(1, sync(at(16, 9, 10)).size)
    }

    @Test
    fun completingFromTheNotificationWritesLocallyFirstAndQueuesTheCommand() = runBlocking {
        sync(at(16, 9))
        awaitShown(1)
        assertTrue(
            TaskNotificationActions.handle(
                context, dao, dueId, TaskNotificationAction.Complete, at(16, 9, 1), tokyo,
                complete = { outbox.enqueueComplete(it) },
                snooze = { id, value -> outbox.enqueueUpdateReminderAt(id, value) },
            ),
        )
        // つながっていなくても、写しはすぐ完了になり、送るものが列に残る。
        assertEquals("done", dao.task(dueId)?.state)
        val command = requireNotNull(dao.outbox(requireNotNull(dao.task(dueId)?.optimisticCommandId)))
        assertEquals("CompleteTask", command.commandName)
        assertEquals(OutboxState.Pending, command.state)
        awaitShown(0)
        // 完了した Task は、2 回目の時刻になっても知らせない。
        TaskNotificationSettings.setDueTimes(context, listOf(LocalTime.of(9, 0), LocalTime.of(17, 0)))
        assertEquals(emptyList<String>(), sync(at(16, 17)).map { it.key }.filter { dueId in it })
    }

    @Test
    fun snoozingMovesTheReminderAndReArmsTheAlarm() = runBlocking {
        sync(at(16, 14, 30))
        awaitShown(2)
        // 通知は 1 つに束ねられる。束の見出し（ロック画面に出る）には、題名でなく件数だけを出す。
        val deadline = System.currentTimeMillis() + 5_000
        while (summary() == null && System.currentTimeMillis() < deadline) Thread.sleep(100)
        val bundle = requireNotNull(summary()).notification
        assertEquals("Task の期限 1 件・時刻 1 件", bundle.extras.getString("android.text"))
        assertEquals("Task の期限 1 件・時刻 1 件", requireNotNull(bundle.publicVersion).extras.getString("android.text"))
        assertTrue(
            TaskNotificationActions.handle(
                context, dao, timedId, TaskNotificationAction.SnoozeHour, at(16, 14, 30).plusSeconds(10), tokyo,
                complete = { outbox.enqueueComplete(it) },
                snooze = { id, value -> outbox.enqueueUpdateReminderAt(id, value) },
            ),
        )
        assertEquals("2026-11-16T15:30:00+09:00", dao.task(timedId)?.reminderAt)
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(
            requireNotNull(dao.outbox(requireNotNull(dao.task(timedId)?.optimisticCommandId))).envelopeJson,
        )
        assertEquals(setOf("reminderAt"), envelope.command.changes.keys)
        assertEquals("2026-11-16T15:30:00+09:00", envelope.command.changes.getValue("reminderAt").jsonPrimitive.content)
        // base は写しの値（Desktop の画面が書いた時差なしの形）のまま送る。
        assertEquals("2026-11-16T14:30", envelope.command.base.getValue("reminderAt").jsonPrimitive.content)
        assertNull(envelope.command.expectedScheduleVersion)

        // 掛け直すと、アラームは 1 時間後。その時刻にもう一度知らせる。
        assertEquals(emptyList<TaskNotice>(), sync(at(16, 14, 31)))
        assertEquals(at(16, 15, 30), alarms.last())
        assertEquals(listOf(dueId), awaitShown(1).map { it.tag.removePrefix("tasken-time:") })
        // 「後で」にした通知だけが消え、残った通知と束は消えない（束を消すと、中の通知も一緒に消える）。
        val updated = System.currentTimeMillis() + 5_000
        while (summary()?.notification?.extras?.getString("android.text") != "Task の期限 1 件" && System.currentTimeMillis() < updated) Thread.sleep(100)
        assertEquals("Task の期限 1 件", summary()?.notification?.extras?.getString("android.text"))
        assertEquals(listOf(dueId), shown().map { it.tag.removePrefix("tasken-time:") })
        assertEquals(listOf("time:$timedId:2026-11-16T15:30"), sync(at(16, 15, 30)).map { it.key })

        // 明日: 明日の期限の知らせの時刻（09:00）。
        TaskNotificationActions.handle(
            context, dao, timedId, TaskNotificationAction.SnoozeTomorrow, at(16, 15, 31), tokyo,
            complete = { outbox.enqueueComplete(it) },
            snooze = { id, value -> outbox.enqueueUpdateReminderAt(id, value) },
        )
        assertEquals("2026-11-17T09:00:00+09:00", dao.task(timedId)?.reminderAt)
        // 送信前の変更は 1 件にまとまり、base は最初の値のまま。
        assertEquals(1, dao.outboxCount())
        sync(at(16, 15, 32))
        assertEquals(at(17, 9), alarms.last())
    }

    @Test
    fun aTaskThatCannotBeChangedFromHereKeepsItsNotificationAndSaysSo() = runBlocking {
        sync(at(16, 9))
        awaitShown(1)
        assertFalse(
            TaskNotificationActions.handle(
                context, dao, dueId, TaskNotificationAction.Complete, at(16, 9, 1), tokyo,
                complete = { error("Taskの同期競合を解決してから編集してください。") },
                snooze = { _, _ -> },
            ),
        )
        assertEquals("todo", dao.task(dueId)?.state)
        val deadline = System.currentTimeMillis() + 5_000
        while (shown().singleOrNull()?.notification?.extras?.getString("android.text") == "今日が期限" && System.currentTimeMillis() < deadline) Thread.sleep(100)
        val kept = shown().single()
        assertEquals("書類を出す", kept.notification.extras.getString("android.title"))
        assertEquals("ここからは変えられませんでした。開いて確かめてください", kept.notification.extras.getString("android.text"))
    }

    @Test
    fun aTaskCompletedElsewhereLosesItsNotificationOnTheNextSync() = runBlocking {
        sync(at(16, 9))
        awaitShown(1)
        // 同期で、ほかの端末の完了が写しに届いた。
        dao.upsertTask(task(dueId, "書類を出す", state = "done", dueDate = "2026-11-16"))
        sync(at(16, 9, 30))
        awaitShown(0)
        assertEquals(0, shown().size)
        // 最後の 1 つが消えたら、束も片付ける。
        sync(at(16, 9, 31))
        val gone = System.currentTimeMillis() + 5_000
        while (summary() != null && System.currentTimeMillis() < gone) Thread.sleep(100)
        assertNull(summary())
    }

    @Test
    fun aConflictKeepsTheLocalSnoozeAndKeepLocalResendsItAgainstTheServerValue() = runBlocking {
        val commandId = outbox.enqueueUpdateReminderAt(timedId, "2026-11-16T15:30:00+09:00")
        outbox.drain("server-1") {
            MobileCommandSendResult.Conflict(MobileTaskCommandErrorResponseDto(
                ok = false, meta = meta(11, "2026-11-16T05:32:00Z"),
                error = MobileTaskCommandErrorDto(
                    code = "version_conflict", message = "Taskが更新されています。", retryable = false,
                    conflict = MobileVersionConflictDto(
                        currentTask = summary(5, "2026-11-18T10:00:00+09:00"), intendedAction = "UpdateTask",
                        expectedVersion = 4, conflictField = "task", expectedScheduleVersion = null,
                    ),
                ),
            ))
        }
        // 端末で選んだ「後で」は捨てずに、競合として残す。写しは Desktop の値になる。
        val conflict = requireNotNull(dao.conflict(commandId))
        assertTrue(conflict.localReminderAtChanged)
        assertEquals("2026-11-16T15:30:00+09:00", conflict.localReminderAt)
        assertEquals("2026-11-18T10:00:00+09:00", dao.task(timedId)?.reminderAt)

        val replacementId = outbox.keepLocal(commandId)
        val replacement = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(replacementId)).envelopeJson)
        assertEquals(5, replacement.command.expectedVersion)
        assertEquals("2026-11-16T15:30:00+09:00", replacement.command.changes.getValue("reminderAt").jsonPrimitive.content)
        assertEquals("2026-11-18T10:00:00+09:00", replacement.command.base.getValue("reminderAt").jsonPrimitive.content)
        assertEquals("2026-11-16T15:30:00+09:00", dao.task(timedId)?.reminderAt)
    }

    @Test
    fun theReceiptConvergesTheCacheAndClearingSendsNull() = runBlocking {
        val commandId = outbox.enqueueUpdateReminderAt(timedId, "2026-11-16T15:30:00+09:00")
        outbox.drain("server-1") {
            MobileCommandSendResult.Applied(MobileTaskCommandResponseDto(
                ok = true, meta = meta(10, "2026-11-16T05:31:00Z"),
                data = MobileTaskCommandReceiptDto(commandId = commandId, status = "applied", task = summary(5, "2026-11-16T15:30:00+09:00")),
            ))
        }
        assertNull(dao.outbox(commandId))
        assertEquals("2026-11-16T15:30:00+09:00", dao.task(timedId)?.reminderAt)
        assertNull(dao.task(timedId)?.optimisticCommandId)

        val clearId = outbox.enqueueUpdateReminderAt(timedId, null)
        val clear = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(clearId)).envelopeJson)
        assertEquals(JsonNull, clear.command.changes.getValue("reminderAt"))
        assertNull(dao.task(timedId)?.reminderAt)
    }
}
