package jp.personal.tasken.companion

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.time.LocalDateTime
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** 場所のリマインダー（#727）の保存・送信・競合・通知の判定を、実際の Room で確かめる。 */
@RunWith(AndroidJUnit4::class)
class MobilePlaceReminderDatabaseTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private lateinit var outbox: MobileOutbox
    private val taskId = "10000000-0000-4000-8000-000000000727"
    private val place = MobilePlaceReminder("三ノ宮", 34.6937, 135.1956, 300, listOf(1, 5), "17:00", "21:00")

    @Before
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).allowMainThreadQueries().build()
        dao = database.mobileDao()
        outbox = MobileOutbox(context, dao, deviceId = { "android-test-device" }, now = { Instant.parse("2026-11-12T01:02:03Z") }, schedule = {})
        dao.upsertSyncState(SyncStateEntity(serverId = "server-1", apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = "cursor", lastSuccessfulSyncAt = "2026-11-12T01:00:00Z", lastAttemptAt = "2026-11-12T01:00:00Z", lastError = null))
        dao.upsertTask(cachedTask())
    }

    @After
    fun tearDown() {
        database.close()
        context.getSystemService(NotificationManager::class.java).cancelAll()
    }

    private fun cachedTask(state: String = "todo", placeJson: String? = null) = TaskCacheEntity(
        id = taskId, serverVersion = 4, title = "三ノ宮で買う", themeId = null, state = state, workState = null,
        todayDate = null, updatedAt = "2026-11-12T00:00:00Z", optimisticCommandId = null, placeReminderJson = placeJson,
    )

    private fun summary(version: Int, place: MobilePlaceReminder?) = MobileTaskSummaryDto(
        id = taskId, version = version, title = "三ノ宮で買う", themeId = null, state = "todo", workState = null,
        schedule = null, updatedAt = "2026-11-12T01:04:00Z", placeReminder = place,
    )

    private fun meta(revision: Int, generatedAt: String) = MobileResponseMetaDto(1, TASKEN_MOBILE_SCHEMA_VERSION, "server-1", revision, generatedAt, false)

    @Test
    fun attachAndDetachSendWholeValuePatchesWithTheCurrentValueAsBase() = runBlocking {
        val attach = outbox.enqueueUpdatePlaceReminder(taskId, place)
        val attachEnvelope = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(attach)).envelopeJson)
        assertEquals(setOf("placeReminder"), attachEnvelope.command.changes.keys)
        assertEquals(JsonNull, attachEnvelope.command.base.getValue("placeReminder"))
        assertEquals(
            setOf("name", "latitude", "longitude", "radiusMeters", "days", "timeFrom", "timeTo"),
            attachEnvelope.command.changes.getValue("placeReminder").jsonObject.keys,
        )
        // オフラインでもキャッシュにすぐ反映される。
        assertEquals(place, decodeMobilePlaceReminder(dao.task(taskId)?.placeReminderJson))

        // 送信前にさらに直すと、1 件の更新にまとまり、base は最初の値（null）のまま。
        val edited = place.copy(radiusMeters = 500)
        assertEquals(attach, outbox.enqueueUpdatePlaceReminder(taskId, edited))
        val coalesced = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(attach)).envelopeJson)
        assertEquals(JsonNull, coalesced.command.base.getValue("placeReminder"))
        assertEquals(500, decodeMobilePlaceReminder(dao.task(taskId)?.placeReminderJson)?.radiusMeters)
        assertEquals(1, dao.outboxCount())

        // 付けて外すと、もとと同じになるので送るものが残らない。
        outbox.enqueueUpdatePlaceReminder(taskId, null)
        assertEquals(0, dao.outboxCount())
        assertNull(dao.task(taskId)?.placeReminderJson)
    }

    @Test
    fun detachingAnExistingPlaceSendsNullWithThePlaceAsBase() = runBlocking {
        dao.upsertTask(cachedTask(placeJson = encodeMobilePlaceReminder(place)))
        val commandId = outbox.enqueueUpdatePlaceReminder(taskId, null)
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(commandId)).envelopeJson)
        assertEquals(JsonNull, envelope.command.changes.getValue("placeReminder"))
        assertEquals(place, decodePlaceReminderPatchValue(envelope.command.base.getValue("placeReminder")))
        assertNull(dao.task(taskId)?.placeReminderJson)
    }

    @Test
    fun placeOnATaskNotYetSentWaitsAsADependentUpdateBecauseCreateDoesNotCarryIt() = runBlocking {
        val newId = outbox.enqueueCreate("あとで場所を付ける", draftId = "place-draft")
        val createCommand = requireNotNull(dao.outbox(requireNotNull(dao.task(newId)?.optimisticCommandId)))
        val updateId = outbox.enqueueUpdatePlaceReminder(newId, place)
        val update = requireNotNull(dao.outbox(updateId))
        assertEquals("UpdateTask", update.commandName)
        assertEquals(createCommand.commandId, update.dependsOnCommandId)
        // 親（作成）の受領前は送れる封筒を持たない。作成の封筒は場所を含まない。
        assertEquals("", update.envelopeJson)
        assertFalse(createCommand.envelopeJson.contains("placeReminder"))
        assertEquals(place, decodeMobilePlaceReminder(dao.task(newId)?.placeReminderJson))
    }

    @Test
    fun receiptWithThePlaceConvergesTheCache() = runBlocking {
        val commandId = outbox.enqueueUpdatePlaceReminder(taskId, place)
        outbox.drain("server-1") {
            MobileCommandSendResult.Applied(MobileTaskCommandResponseDto(
                ok = true, meta = meta(10, "2026-11-12T01:04:00Z"),
                data = MobileTaskCommandReceiptDto(commandId = commandId, status = "applied", task = summary(5, place)),
            ))
        }
        assertNull(dao.outbox(commandId))
        assertEquals(place, decodeMobilePlaceReminder(dao.task(taskId)?.placeReminderJson))
        assertNull(dao.task(taskId)?.optimisticCommandId)
    }

    @Test
    fun conflictKeepsTheLocalPlaceAndKeepLocalResendsItAgainstTheServerValue() = runBlocking {
        val commandId = outbox.enqueueUpdatePlaceReminder(taskId, place)
        val serverPlace = place.copy(name = "元町", radiusMeters = 200)
        outbox.drain("server-1") {
            MobileCommandSendResult.Conflict(MobileTaskCommandErrorResponseDto(
                ok = false, meta = meta(11, "2026-11-12T01:05:00Z"),
                error = MobileTaskCommandErrorDto(
                    code = "version_conflict", message = "Taskが更新されています。", retryable = false,
                    conflict = MobileVersionConflictDto(
                        currentTask = summary(5, serverPlace), intendedAction = "UpdateTask",
                        expectedVersion = 4, conflictField = "task", expectedScheduleVersion = null,
                    ),
                ),
            ))
        }
        val conflict = requireNotNull(dao.conflict(commandId))
        assertTrue(conflict.localPlaceReminderChanged)
        assertEquals(place, decodeMobilePlaceReminder(conflict.localPlaceReminderJson))
        // 競合中のキャッシュは Desktop の値（ジオフェンスも Desktop の値になる）。
        assertEquals(serverPlace, decodeMobilePlaceReminder(dao.task(taskId)?.placeReminderJson))

        val replacementId = outbox.keepLocal(commandId)
        val replacement = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(dao.outbox(replacementId)).envelopeJson)
        assertEquals(5, replacement.command.expectedVersion)
        assertEquals(place, decodePlaceReminderPatchValue(replacement.command.changes.getValue("placeReminder")))
        assertEquals(serverPlace, decodePlaceReminderPatchValue(replacement.command.base.getValue("placeReminder")))
        assertEquals(place, decodeMobilePlaceReminder(dao.task(taskId)?.placeReminderJson))
    }

    @Test
    fun aDwellNotifiesOncePerDayAndSkipsFinishedOrUnplacedTasks() = runBlocking {
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        dao.upsertTask(cachedTask(placeJson = encodeMobilePlaceReminder(place)))
        val friday = LocalDateTime.of(2026, 11, 13, 18, 0)

        assertTrue(PlaceReminderNotifications.deliver(context, dao, taskId, friday))
        // notify() は非同期に反映されるので、出るまで少し待つ（待たないと稀に空振りする）。
        val manager = context.getSystemService(NotificationManager::class.java)
        val deadline = System.currentTimeMillis() + 5_000
        while (manager.activeNotifications.none { it.notification.channelId == PlaceReminderNotifications.ChannelId } &&
            System.currentTimeMillis() < deadline) Thread.sleep(100)
        val shown = manager.activeNotifications.single { it.notification.channelId == PlaceReminderNotifications.ChannelId }
        assertEquals("三ノ宮で買う", shown.notification.extras.getString("android.title"))
        assertEquals("三ノ宮", shown.notification.extras.getString("android.text"))
        assertEquals("2026-11-13", dao.placeReminderNoticeDate(taskId))

        // 駅前の GPS の揺れで同じ日に DWELL が重なっても、2 回目は出さない。
        assertFalse(PlaceReminderNotifications.deliver(context, dao, taskId, friday.plusMinutes(40)))
        // 条件の外（土曜は曜日が合わない）では出さない。翌金曜はまた出す。
        assertFalse(PlaceReminderNotifications.deliver(context, dao, taskId, friday.plusDays(1)))
        assertTrue(PlaceReminderNotifications.deliver(context, dao, taskId, friday.plusDays(7)))

        // 完了した Task は鳴らさない。
        dao.upsertTask(cachedTask(state = "done", placeJson = encodeMobilePlaceReminder(place)))
        assertFalse(PlaceReminderNotifications.deliver(context, dao, taskId, friday.plusDays(14)))
        // 場所を外された Task も鳴らさない。
        dao.upsertTask(cachedTask(placeJson = null))
        assertFalse(PlaceReminderNotifications.deliver(context, dao, taskId, friday.plusDays(21)))
        // cancel() も非同期に反映されるので、消えるまで少し待つ。
        val goneDeadline = System.currentTimeMillis() + 5_000
        while (manager.activeNotifications.any { it.tag == "tasken-place:$taskId" } && System.currentTimeMillis() < goneDeadline) Thread.sleep(100)
        assertEquals(0, manager.activeNotifications.count { it.tag == "tasken-place:$taskId" })
    }

    @Test
    fun aSkippedDwellInATimeWindowSchedulesARefitAndANotifiedOneDoesNot() = runBlocking {
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        dao.upsertTask(cachedTask(placeJson = encodeMobilePlaceReminder(place)))
        val refits = mutableListOf<Pair<String, LocalDateTime>>()
        // 17:00–21:00 の場所に金曜 16:55 に着いた: 見送って 17:00 に付け直す。
        assertFalse(PlaceReminderNotifications.deliver(context, dao, taskId, LocalDateTime.of(2026, 11, 13, 16, 55), true) { id, at -> refits += id to at })
        assertEquals(listOf(taskId to LocalDateTime.of(2026, 11, 13, 17, 0)), refits)
        refits.clear()
        // 17:03 に通知。通知した後は付け直さない（入り直したときに鳴る）。
        assertTrue(PlaceReminderNotifications.deliver(context, dao, taskId, LocalDateTime.of(2026, 11, 13, 17, 3), true) { id, at -> refits += id to at })
        assertTrue(refits.isEmpty())
        // 時間帯の無い場所は、見送っても付け直さない（毎晩 0:00 に鳴らさない）。
        dao.upsertTask(cachedTask(placeJson = encodeMobilePlaceReminder(place.copy(timeFrom = null, timeTo = null))))
        assertFalse(PlaceReminderNotifications.deliver(context, dao, taskId, LocalDateTime.of(2026, 11, 13, 18, 0), true) { id, at -> refits += id to at })
        assertTrue(refits.isEmpty())
    }

    @Test
    fun noticeIsNotRecordedWhileNotificationsAreNotAllowed() = runBlocking {
        // 権限の取り消しはプロセスごと落とすので、権限が無い状態は引数で作る。
        dao.upsertTask(cachedTask(placeJson = encodeMobilePlaceReminder(place)))
        val friday = LocalDateTime.of(2026, 11, 13, 18, 0)
        assertFalse(PlaceReminderNotifications.deliver(context, dao, taskId, friday, canPost = false))
        // 許可していないあいだは「通知した」にしない。許可すれば今日のうちに届く。
        assertNull(dao.placeReminderNoticeDate(taskId))
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        assertTrue(PlaceReminderNotifications.deliver(context, dao, taskId, friday.plusHours(1), canPost = true))
    }

    @Test
    fun claimingTheNoticeIsAtomicPerDayAndPrunedWithTheTask() = runBlocking {
        assertTrue(dao.claimPlaceReminderNotice(taskId, "2026-11-13"))
        assertFalse(dao.claimPlaceReminderNotice(taskId, "2026-11-13"))
        assertTrue(dao.claimPlaceReminderNotice(taskId, "2026-11-14"))
        dao.putPlaceReminderNotice(PlaceReminderNoticeEntity("gone-task", "2026-11-14"))
        dao.prunePlaceReminderNotices()
        assertEquals("2026-11-14", dao.placeReminderNoticeDate(taskId))
        assertNull(dao.placeReminderNoticeDate("gone-task"))
    }
}
