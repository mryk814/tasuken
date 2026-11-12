package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.LocalDateTime
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MobilePlaceReminderTest {
    private val json = Json { ignoreUnknownKeys = false }
    private val sannomiya = MobilePlaceReminder("三ノ宮", 34.6937, 135.1956, 300, emptyList(), null, null)

    // 2026-11-13 は金曜、14 は土曜、15 は日曜
    private fun at(day: Int, hour: Int, minute: Int = 0) = LocalDateTime.of(2026, 11, day, hour, minute)

    @Test
    fun anOpenTaskInsideTheConditionNotifiesOnceADay() {
        assertTrue(PlaceReminderPolicy.shouldNotify(sannomiya, "todo", at(13, 18), null))
        // 駅前で GPS が揺れて DWELL が何度来ても、同じ日の 2 回目は鳴らさない（仮運用で起きた連打）。
        assertFalse(PlaceReminderPolicy.shouldNotify(sannomiya, "todo", at(13, 18, 30), LocalDate.of(2026, 11, 13)))
        // 昨日通知していても、今日はまた通知する。
        assertTrue(PlaceReminderPolicy.shouldNotify(sannomiya, "todo", at(14, 9), LocalDate.of(2026, 11, 13)))
    }

    @Test
    fun doneOrCancelledTasksNeverNotify() {
        assertFalse(PlaceReminderPolicy.shouldNotify(sannomiya, "done", at(13, 18), null))
        assertFalse(PlaceReminderPolicy.shouldNotify(sannomiya, "cancelled", at(13, 18), null))
        listOf("todo", "doing", "waiting", "review").forEach {
            assertTrue(PlaceReminderPolicy.shouldNotify(sannomiya, it, at(13, 18), null))
        }
    }

    @Test
    fun weekdaysUseSundayAsZero() {
        val sundayOnly = sannomiya.copy(days = listOf(0))
        assertTrue(PlaceReminderPolicy.matchesSchedule(sundayOnly, at(15, 12)))
        assertFalse(PlaceReminderPolicy.matchesSchedule(sundayOnly, at(14, 12)))
        val saturday = sannomiya.copy(days = listOf(6))
        assertTrue(PlaceReminderPolicy.matchesSchedule(saturday, at(14, 12)))
        assertFalse(PlaceReminderPolicy.matchesSchedule(saturday, at(15, 12)))
        val weekdays = sannomiya.copy(days = listOf(1, 2, 3, 4, 5))
        assertTrue(PlaceReminderPolicy.matchesSchedule(weekdays, at(13, 12)))
        assertFalse(PlaceReminderPolicy.matchesSchedule(weekdays, at(14, 12)))
    }

    @Test
    fun timeWindowWithinOneDay() {
        val evening = sannomiya.copy(timeFrom = "17:00", timeTo = "21:00")
        assertFalse(PlaceReminderPolicy.matchesSchedule(evening, at(13, 16, 59)))
        assertTrue(PlaceReminderPolicy.matchesSchedule(evening, at(13, 17)))
        assertTrue(PlaceReminderPolicy.matchesSchedule(evening, at(13, 21)))
        assertFalse(PlaceReminderPolicy.matchesSchedule(evening, at(13, 21, 1)))
    }

    @Test
    fun timeWindowOverMidnightBelongsToTheDayItStarted() {
        val night = sannomiya.copy(days = listOf(5), timeFrom = "22:00", timeTo = "02:00")
        assertTrue(PlaceReminderPolicy.matchesSchedule(night, at(13, 23)))
        // 金曜の窓は土曜の午前 1 時にも続く。
        assertTrue(PlaceReminderPolicy.matchesSchedule(night, at(14, 1)))
        assertFalse(PlaceReminderPolicy.matchesSchedule(night, at(14, 2, 1)))
        assertFalse(PlaceReminderPolicy.matchesSchedule(night, at(14, 12)))
        // 土曜の夜は金曜ではないので合わない。金曜の午前 1 時も前日（木曜）の窓なので合わない。
        assertFalse(PlaceReminderPolicy.matchesSchedule(night, at(14, 23)))
        assertFalse(PlaceReminderPolicy.matchesSchedule(night, at(13, 1)))
        // 曜日が毎日なら、日またぎだけを見る。
        val everyNight = night.copy(days = emptyList())
        assertTrue(PlaceReminderPolicy.matchesSchedule(everyNight, at(15, 0, 30)))
        assertFalse(PlaceReminderPolicy.matchesSchedule(everyNight, at(15, 12)))
    }

    @Test
    fun geofenceTargetsAreOpenPlacedTasksCappedAtOneHundred() {
        fun task(id: String, state: String = "todo", place: MobilePlaceReminder? = sannomiya) =
            MobileTask(id, id, null, state, null, "2026-11-12T00:00:00Z", placeReminder = place)
        val targets = placeReminderGeofenceTargets(listOf(
            task("open"), task("done", "done"), task("cancelled", "cancelled"), task("none", place = null),
        ))
        assertEquals(listOf("open"), targets.map { it.first })
        val many = (0 until 130).map { task("t%03d".format(it)) }
        assertEquals(PLACE_REMINDER_GEOFENCE_LIMIT, placeReminderGeofenceTargets(many).size)
    }

    @Test
    fun previousPlacesAreDistinctByNameNewestFirst() {
        fun task(id: String, updatedAt: String, place: MobilePlaceReminder?) =
            MobileTask(id, id, null, "todo", null, updatedAt, placeReminder = place)
        val moved = sannomiya.copy(latitude = 34.7, radiusMeters = 500)
        val places = previousPlaceReminders(listOf(
            task("a", "2026-11-01T00:00:00Z", sannomiya),
            task("b", "2026-11-05T00:00:00Z", moved),
            task("c", "2026-11-03T00:00:00Z", MobilePlaceReminder("自宅", 35.0, 135.0, 200)),
            task("d", "2026-11-04T00:00:00Z", null),
        ))
        assertEquals(listOf("三ノ宮", "自宅"), places.map { it.name })
        assertEquals(moved, places.first())
    }

    @Test
    fun summaryDtoDecodesWithAndWithoutPlaceReminder() {
        val old = """{"id":"task","version":1,"title":"買う","themeId":null,"state":"todo","workState":null,"schedule":null,"updatedAt":"2026-11-12T00:00:00Z"}"""
        assertNull(json.decodeFromString<MobileTaskSummaryDto>(old).placeReminder)
        val withPlace = old.dropLast(1) + ""","placeReminder":{"name":"三ノ宮","latitude":34.6937,"longitude":135.1956,"radiusMeters":300,"days":[1,5],"timeFrom":"17:00","timeTo":"21:00"}}"""
        val decoded = json.decodeFromString<MobileTaskSummaryDto>(withPlace).placeReminder
        assertEquals(MobilePlaceReminder("三ノ宮", 34.6937, 135.1956, 300, listOf(1, 5), "17:00", "21:00"), decoded)
        validateMobilePlaceReminder(decoded)
        val nulls = old.dropLast(1) + ""","placeReminder":null}"""
        assertNull(json.decodeFromString<MobileTaskSummaryDto>(nulls).placeReminder)
        val unknown = old.dropLast(1) + ""","placeReminder":{"name":"x","latitude":1,"longitude":1,"radiusMeters":300,"days":[],"timeFrom":null,"timeTo":null,"extra":1}}"""
        assertThrows(Exception::class.java) { json.decodeFromString<MobileTaskSummaryDto>(unknown) }
    }

    @Test
    fun validationMatchesTheServerRanges() {
        validateMobilePlaceReminder(sannomiya)
        listOf(
            sannomiya.copy(name = ""),
            sannomiya.copy(name = " 三ノ宮"),
            sannomiya.copy(name = "あ".repeat(81)),
            sannomiya.copy(latitude = 90.1),
            sannomiya.copy(longitude = -180.1),
            sannomiya.copy(latitude = Double.NaN),
            sannomiya.copy(radiusMeters = 99),
            sannomiya.copy(radiusMeters = 2001),
            sannomiya.copy(days = listOf(7)),
            sannomiya.copy(days = listOf(2, 2)),
            sannomiya.copy(days = listOf(3, 1)),
            sannomiya.copy(timeFrom = "17:00"),
            sannomiya.copy(timeTo = "21:00"),
            sannomiya.copy(timeFrom = "24:00", timeTo = "21:00"),
            sannomiya.copy(timeFrom = "9:00", timeTo = "21:00"),
        ).forEach { assertThrows(it.toString(), IllegalArgumentException::class.java) { validateMobilePlaceReminder(it) } }
        validateMobilePlaceReminder(sannomiya.copy(radiusMeters = 100, days = listOf(0, 6), timeFrom = "22:00", timeTo = "02:00"))
        validateMobilePlaceReminder(sannomiya.copy(name = "あ".repeat(80), latitude = -90.0, longitude = 180.0, radiusMeters = 2000))
    }

    @Test
    fun updatePatchRoundTripsWithAllSevenKeysAndNullRemoves() {
        val value = placeReminderPatchValue(sannomiya.copy(days = listOf(1), timeFrom = "17:00", timeTo = "21:00")).jsonObject
        assertEquals(setOf("name", "latitude", "longitude", "radiusMeters", "days", "timeFrom", "timeTo"), value.keys)
        assertEquals(JsonPrimitive(300), value["radiusMeters"])
        // 時間帯なしでも null を明示して 7 つそろえる。
        val noWindow = placeReminderPatchValue(sannomiya).jsonObject
        assertEquals(JsonNull, noWindow["timeFrom"])
        assertEquals(JsonNull, noWindow["timeTo"])

        fun envelope(changes: JsonObject, base: JsonObject) = MobileTaskUpdateEnvelopeDto(
            apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            requestId = "request-1", commandId = "command-1", idempotencyKey = "command-1",
            clientDeviceId = "device-1", issuedAt = "2026-11-12T01:00:00Z",
            command = MobileTaskUpdateCommandDto(
                name = "UpdateTask", taskId = "task-1", expectedVersion = 3,
                expectedScheduleVersion = null, changes = changes, base = base,
            ),
        )
        val attach = envelope(buildJsonObject { put("placeReminder", value) }, buildJsonObject { put("placeReminder", JsonNull) })
        assertEquals(attach, MobileTaskCommandContract.decodeUpdateEnvelope(MobileTaskCommandContract.encode(attach)))
        val detach = envelope(buildJsonObject { put("placeReminder", JsonNull) }, buildJsonObject { put("placeReminder", value) })
        assertEquals(detach, MobileTaskCommandContract.decodeUpdateEnvelope(MobileTaskCommandContract.encode(detach)))

        val missingKey = JsonObject(value - "timeTo")
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(envelope(buildJsonObject { put("placeReminder", missingKey) }, buildJsonObject { put("placeReminder", JsonNull) }))
        }
        val outOfRange = JsonObject(value + ("radiusMeters" to JsonPrimitive(50)))
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(envelope(buildJsonObject { put("placeReminder", outOfRange) }, buildJsonObject { put("placeReminder", JsonNull) }))
        }
        // 場所は他の欄と同じ patch に混ぜない（plannedSchedule と同じ 1 欄ずつの規則）。
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(envelope(
                buildJsonObject { put("placeReminder", value); put("title", JsonPrimitive("x")) },
                buildJsonObject { put("placeReminder", JsonNull); put("title", JsonPrimitive("y")) },
            ))
        }
    }
}
