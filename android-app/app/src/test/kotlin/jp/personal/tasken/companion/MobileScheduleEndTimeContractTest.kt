package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 期限の時刻と知らせ（#785）の Mobile 契約。golden は contracts/mobile/v1/task-schedule-end-time.golden.json を
 * Desktop の tests/task-notifications.test.mjs と共有する。
 */
class MobileScheduleEndTimeContractTest {
    private val golden = Json.parseToJsonElement(
        requireNotNull(javaClass.classLoader?.getResource("task-schedule-end-time.golden.json")).readText(),
    ).jsonObject
    private val strict = Json { ignoreUnknownKeys = false }

    private fun summarySchedule(name: String): MobileTaskScheduleDto =
        strict.decodeFromJsonElement(MobileTaskScheduleDto.serializer(), golden.getValue(name).jsonObject.getValue("schedule"))

    @Test
    fun theSummaryCarriesTheTimeAndLeadOrNulls() {
        val timed = summarySchedule("taskSummaryWithTime").toMobileTaskSchedule()
        assertEquals("02:00", timed.endTime)
        assertEquals(30, timed.notifyBeforeMinutes)
        val untimed = summarySchedule("taskSummaryWithoutTime").toMobileTaskSchedule()
        assertNull(untimed.endTime)
        assertNull(untimed.notifyBeforeMinutes)
    }

    @Test
    fun anUnreadableTimeIsReadAsNoTimeWithoutRejectingTheTask() {
        assertEquals(null to null, readableScheduleEnd(null, "2026-11-19", "day", "25:99", 30))
        assertEquals("02:00" to null, readableScheduleEnd(null, "2026-11-19", "day", "02:00", 99999))
        // 日付の無い日程・日単位でない日程の時刻は無いもの（Desktop の scheduleEnd と同じ）。
        assertEquals(null to null, readableScheduleEnd(null, null, "day", "02:00", 30))
        assertEquals(null to null, readableScheduleEnd("2026-11-01", "2026-11-30", "month", "02:00", 30))
        // 開始日だけの一日の予定にも時刻を持てる。
        assertEquals("09:00" to 0, readableScheduleEnd("2026-11-19", null, "day", "09:00", 0))
    }

    @Test
    fun everyGoldenUpdateIsAValidEnvelope() {
        listOf("updateTaskSetTime", "updateTaskChangeLead", "updateTaskClearTime", "updateTaskOldShapeDateOnly").forEach { name ->
            val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(golden.getValue(name).toString())
            assertEquals(name, setOf("schedule"), envelope.command.changes.keys)
        }
    }

    private fun schedule(start: String?, end: String?, time: String?, lead: Int?, withTime: Boolean = true) = buildJsonObject {
        put("startDate", start?.let(::JsonPrimitive) ?: JsonNull)
        put("endDate", end?.let(::JsonPrimitive) ?: JsonNull)
        put("rangeSemantics", JsonNull)
        if (withTime) {
            put("endTime", time?.let(::JsonPrimitive) ?: JsonNull)
            put("notifyBeforeMinutes", lead?.let(::JsonPrimitive) ?: JsonNull)
        }
    }

    private fun update(change: JsonObject, base: JsonObject): String {
        val envelope = golden.getValue("updateTaskSetTime").jsonObject
        val command = envelope.getValue("command").jsonObject
        return JsonObject(
            envelope + ("command" to JsonObject(
                command + mapOf(
                    "changes" to buildJsonObject { put("schedule", change) },
                    "base" to buildJsonObject { put("schedule", base) },
                ),
            )),
        ).toString()
    }

    @Test
    fun theGatewayRulesAreCheckedBeforeSending() {
        val base = schedule(null, "2026-11-19", null, null)
        // 時刻は日付のある日程にだけ。知らせは時刻がある時だけ。時刻の形は HH:mm。
        listOf(
            schedule(null, null, "02:00", null),
            schedule(null, "2026-11-19", null, 30),
            schedule(null, "2026-11-19", "2:00", null),
            schedule(null, "2026-11-19", "02:00", 10081),
            schedule(null, "2026-11-19", "02:00", -1),
        ).forEach { change ->
            assertThrows(change.toString(), IllegalArgumentException::class.java) {
                MobileTaskCommandContract.decodeUpdateEnvelope(update(change, base))
            }
        }
        // 片方の欄だけを載せた形も断る（そろえて載せるか、載せないか）。
        val half = JsonObject(schedule(null, "2026-11-19", "02:00", null) - "notifyBeforeMinutes")
        assertThrows(IllegalArgumentException::class.java) { MobileTaskCommandContract.decodeUpdateEnvelope(update(half, base)) }
        MobileTaskCommandContract.decodeUpdateEnvelope(update(schedule(null, "2026-11-19", "23:59", 0), base))
    }

    @Test
    fun timeKeysAreLeftOutWhenNeitherSideHasATimeSoAnOldDesktopAcceptsDateEdits() {
        val (changes, base) = alignScheduleTimeKeys(
            buildJsonObject { put("schedule", schedule(null, "2026-11-20", null, null)) },
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", null, null)) },
        )
        assertEquals(setOf("startDate", "endDate", "rangeSemantics"), changes.getValue("schedule").jsonObject.keys)
        assertEquals(setOf("startDate", "endDate", "rangeSemantics"), base.getValue("schedule").jsonObject.keys)
        // golden の古い形（日付だけ）と同じ。
        assertEquals(
            golden.getValue("updateTaskOldShapeDateOnly").jsonObject.getValue("command").jsonObject.getValue("changes").jsonObject
                .getValue("schedule").jsonObject.keys,
            changes.getValue("schedule").jsonObject.keys,
        )
    }

    @Test
    fun timeKeysGoOnBothSidesWhenEitherSideHasATime() {
        val setTime = alignScheduleTimeKeys(
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", "02:00", 30)) },
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", null, null, withTime = false)) },
        )
        val golden = golden.getValue("updateTaskSetTime").jsonObject.getValue("command").jsonObject
        assertEquals(golden.getValue("changes"), setTime.first)
        assertEquals(golden.getValue("base"), setTime.second)
        val clear = alignScheduleTimeKeys(
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", null, null)) },
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", "02:00", 1440)) },
        )
        val clearGolden = this.golden.getValue("updateTaskClearTime").jsonObject.getValue("command").jsonObject
        assertEquals(clearGolden.getValue("changes"), clear.first)
        assertEquals(clearGolden.getValue("base"), clear.second)
        // 予定の無かった Task に日付と時刻を付ける（前は null のまま）。
        val fromNothing = alignScheduleTimeKeys(
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", "02:00", 30)) },
            buildJsonObject { put("schedule", JsonNull) },
        )
        assertEquals(JsonNull, fromNothing.second.getValue("schedule"))
    }

    @Test
    fun aCreateWithoutATimeSendsNoTimeKeysAndAPreviousVersionsCreateStillReads() {
        val envelope = MobileCreateTaskEnvelopeDto(
            apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, requestId = "r", commandId = "c",
            idempotencyKey = "c", clientDeviceId = "d", issuedAt = "2026-11-18T00:00:00Z",
            command = MobileCreateTaskCommandDto(
                name = "CreateTask",
                task = MobileCreateTaskCandidateDto(id = "task", title = "株の申込み", projectId = null, state = "todo", todayDate = null),
                schedule = MobileCreateTaskScheduleDto(endDate = "2026-11-19"),
            ),
        )
        val plain = MobileTaskCommandContract.encode(envelope)
        assertFalse(plain.contains("endTime"))
        assertFalse(plain.contains("notifyBeforeMinutes"))
        assertEquals(envelope, MobileTaskCommandContract.decodeCreateEnvelope(plain))
        val timed = envelope.copy(command = envelope.command.copy(schedule = MobileCreateTaskScheduleDto(endDate = "2026-11-19", endTime = "02:00", notifyBeforeMinutes = 30)))
        val encoded = MobileTaskCommandContract.encode(timed)
        assertTrue(encoded.contains("\"endTime\":\"02:00\""))
        assertEquals(timed, MobileTaskCommandContract.decodeCreateEnvelope(encoded))
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(timed.copy(command = timed.command.copy(schedule = MobileCreateTaskScheduleDto(endTime = "02:00"))))
        }
    }

    private fun cache(time: String? = "02:00", lead: Int? = 30) = TaskCacheEntity(
        id = "task", serverVersion = 3, title = "株の申込み", themeId = null, state = "todo", workState = null,
        todayDate = null, updatedAt = "2026-11-18T00:00:00Z", optimisticCommandId = null,
        scheduleId = "schedule", scheduleVersion = 2, scheduleEndDate = "2026-11-19", scheduleDateKind = "deadline",
        scheduleConfidence = "fixed", scheduleGranularity = "day", scheduleEndTime = time, scheduleNotifyBeforeMinutes = lead,
    )

    @Test
    fun aPreviousVersionsDateOnlyEditKeepsTheCachedTimeAndClearingTheDatesClearsIt() {
        val moved = MobileTaskEditIntent(
            buildJsonObject { put("schedule", schedule(null, "2026-11-20", null, null, withTime = false)) },
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", null, null, withTime = false)) },
        ).project(cache(), "command", "2026-11-18T00:01:00Z")
        assertEquals("2026-11-20", moved.scheduleEndDate)
        assertEquals("02:00", moved.scheduleEndTime)
        assertEquals(30, moved.scheduleNotifyBeforeMinutes)
        val cleared = MobileTaskEditIntent(
            buildJsonObject { put("schedule", schedule(null, null, null, null, withTime = false)) },
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", null, null, withTime = false)) },
        ).project(cache(), "command", "2026-11-18T00:01:00Z")
        assertNull(cleared.scheduleEndTime)
        assertNull(cleared.scheduleNotifyBeforeMinutes)
        val newLead = MobileTaskEditIntent(
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", "02:00", 1440)) },
            buildJsonObject { put("schedule", schedule(null, "2026-11-19", "02:00", 30)) },
        ).project(cache(), "command", "2026-11-18T00:01:00Z")
        assertEquals(1440, newLead.scheduleNotifyBeforeMinutes)
    }

    private fun rejection(serverId: String = "server-1", code: String = "validation_failed") = GatewayHttpResponse(
        status = 400,
        body = """{"ok":false,"meta":{"apiVersion":1,"schemaVersion":7,"serverId":"$serverId","serverRevision":1,"generatedAt":"2026-11-18T00:00:00Z","truncated":false},"error":{"code":"$code","message":"bad","retryable":false}}""",
    )

    @Test
    fun anOldDesktopRejectingATimeIsToldApartFromOtherRejections() {
        val setTime = golden.getValue("updateTaskSetTime").toString()
        assertTrue(isUnsupportedScheduleTime(setTime, rejection(), "server-1"))
        assertFalse(isUnsupportedScheduleTime(setTime, rejection("server-2"), "server-1"))
        assertFalse(isUnsupportedScheduleTime(setTime, rejection(code = "version_conflict"), "server-1"))
        assertFalse(isUnsupportedScheduleTime(golden.getValue("updateTaskOldShapeDateOnly").toString(), rejection(), "server-1"))
        assertTrue(SCHEDULE_TIME_UPDATE_REQUIRED.startsWith("時刻の同期にはDesktopの更新が必要です"))
    }

    @Test
    fun aResponseWithoutTheKeyIsAnOldDesktop() {
        assertTrue(serverReportsScheduleTime(golden.getValue("taskSummaryWithoutTime").toString()))
        assertFalse(serverReportsScheduleTime(golden.getValue("updateTaskOldShapeDateOnly").toString()))
    }

    @Test
    fun theLeadLabelsMatchThePresets() {
        assertEquals(listOf("なし", "ちょうど", "10分前", "30分前", "1時間前", "前日"), notifyBeforePresets.map(::notifyBeforeLabel))
        assertEquals("45分前", notifyBeforeLabel(45))
        assertEquals("2日前", notifyBeforeLabel(2880))
        assertEquals("1時間30分前", notifyBeforeLabel(90))
    }
}
