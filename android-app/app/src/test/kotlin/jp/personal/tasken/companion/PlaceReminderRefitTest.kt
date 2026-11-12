package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.LocalDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaceReminderRefitTest {
    private val place = MobilePlaceReminder("三ノ宮", 34.6937, 135.1956, 300)

    // 2026-11-12 は木曜、13 は金曜、14 は土曜
    private fun at(day: Int, hour: Int = 0, minute: Int = 0) = LocalDateTime.of(2026, 11, day, hour, minute)

    @Test
    fun beforeTheWindowItIsTheWindowStart() {
        val window = place.copy(timeFrom = "17:00", timeTo = "21:00")
        // 17:00–21:00 の場所に 16:55 に着いた。17:00 に付け直せば、まだ中にいれば 17:03 に鳴る。
        assertEquals(at(13, 17), nextEligibleAt(window, "todo", at(13, 16, 55), null))
    }

    @Test
    fun afterTheWindowItIsTomorrowsWindowStart() {
        val window = place.copy(timeFrom = "17:00", timeTo = "21:00")
        assertEquals(at(14, 17), nextEligibleAt(window, "todo", at(13, 21, 30), null))
    }

    @Test
    fun overMidnightWindowResumesAtMidnightWhenTheStartDayMatches() {
        val night = place.copy(days = listOf(5), timeFrom = "22:00", timeTo = "02:00")
        // 金曜 23:00 に通知済み: 翌日 0:00 は金曜の窓の続きで、日付が変わっているので次に合う。
        assertEquals(at(14, 0), nextEligibleAt(night, "todo", at(13, 23), LocalDate.of(2026, 11, 13)))
        // 金曜 15:00 に見送った（窓の前）: 22:00。
        assertEquals(at(13, 22), nextEligibleAt(night, "todo", at(13, 15), null))
        // 土曜 03:00（窓の外）: 次の金曜の 22:00。
        assertEquals(at(20, 22), nextEligibleAt(night, "todo", at(14, 3), null))
    }

    @Test
    fun wrongWeekdaySkipsToTheNextMatchingDay() {
        val mondayOnly = place.copy(days = listOf(1))
        // 木曜: 次の月曜 0:00（時間帯が無ければ 0:00 から合う）。
        assertEquals(LocalDateTime.of(2026, 11, 16, 0, 0), nextEligibleAt(mondayOnly, "todo", at(12, 10), null))
    }

    @Test
    fun alreadyNotifiedTodayWaitsForTomorrowMidnight() {
        // 三ノ宮の職場に 9:00 からいる。通知済みなら翌日 0:00 に付け直し、中にいれば鳴る。
        assertEquals(at(14, 0), nextEligibleAt(place, "todo", at(13, 9, 5), LocalDate.of(2026, 11, 13)))
    }

    @Test
    fun finishedTasksAndNeverMatchingPlacesHaveNoNextTime() {
        assertNull(nextEligibleAt(place, "done", at(13, 9), null))
        assertNull(nextEligibleAt(place, "cancelled", at(13, 9), null))
    }

    @Test
    fun oldServerRejectionOfPlaceReminderIsRecognizedOnlyFromThePairedServer() {
        val envelope = """{"command":{"name":"UpdateTask","taskId":"t","expectedVersion":1,"changes":{"placeReminder":null},"base":{"placeReminder":null}}}"""
        fun response(status: Int, serverId: String, code: String) = GatewayHttpResponse(
            status, """{"ok":false,"meta":{"serverId":"$serverId"},"error":{"code":"$code","message":"x"}}""",
        )
        assertTrue(isUnsupportedPlaceReminder(envelope, response(400, "s1", "validation_failed"), "s1"))
        assertFalse(isUnsupportedPlaceReminder(envelope, response(400, "other", "validation_failed"), "s1"))
        assertFalse(isUnsupportedPlaceReminder(envelope, response(500, "s1", "validation_failed"), "s1"))
        val title = """{"command":{"name":"UpdateTask","changes":{"title":"x"},"base":{"title":"y"}}}"""
        assertFalse(isUnsupportedPlaceReminder(title, response(400, "s1", "validation_failed"), "s1"))
    }

    @Test
    fun missingKeyMeansUnknownButNullMeansNoPlace() {
        val old = """{"data":{"tasks":[{"id":"t","title":"x"}]}}"""
        val current = """{"data":{"tasks":[{"id":"t","title":"x","placeReminder":null}]}}"""
        assertFalse(serverReportsPlaceReminder(old))
        assertTrue(serverReportsPlaceReminder(current))
    }

    @Test
    fun lastLocationIsUsedOnlyWhenFreshAndAccurate() {
        assertTrue(isUsableLastLocation(30_000, 20f))
        assertFalse(isUsableLastLocation(121_000, 20f))
        assertFalse(isUsableLastLocation(30_000, 150f))
        assertFalse(isUsableLastLocation(30_000, null))
        assertFalse(isUsableLastLocation(-1, 20f))
    }
}
