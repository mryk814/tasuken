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
    fun noticedTodayInTheWindowGoesToTheNextDaysWindowStart() {
        val window = place.copy(timeFrom = "17:00", timeTo = "21:00")
        assertEquals(at(14, 17), nextEligibleAt(window, "todo", at(13, 17, 5), LocalDate.of(2026, 11, 13)))
    }

    @Test
    fun placesWithoutATimeWindowNeverGetARefitSoNobodyIsWokenAtMidnight() {
        // 自宅のような場所。見送る理由は曜日違いか通知済み。次に入り直したときに判定する。
        assertNull(nextEligibleAt(place, "todo", at(13, 9, 5), LocalDate.of(2026, 11, 13)))
        assertNull(nextEligibleAt(place.copy(days = listOf(1)), "todo", at(12, 10), null))
    }

    @Test
    fun overMidnightWindowsAreRefitAtTheirStartOnMatchingDays() {
        val night = place.copy(days = listOf(5), timeFrom = "22:00", timeTo = "02:00")
        // 金曜 15:00 に見送った（窓の前）: 22:00。
        assertEquals(at(13, 22), nextEligibleAt(night, "todo", at(13, 15), null))
        // 金曜 23:00 に通知済み: 次の金曜の窓の始まり（0:00 には付け直さない）。
        assertEquals(at(20, 22), nextEligibleAt(night, "todo", at(13, 23), LocalDate.of(2026, 11, 13)))
        // 土曜 03:00（窓の外）: 次の金曜の 22:00。
        assertEquals(at(20, 22), nextEligibleAt(night, "todo", at(14, 3), null))
    }

    @Test
    fun theContinuationOfAnOverMidnightWindowCountsAsTheDayItStarted() {
        val night = place.copy(days = listOf(5), timeFrom = "22:00", timeTo = "02:00")
        assertEquals(LocalDate.of(2026, 11, 13), PlaceReminderPolicy.noticeDate(night, at(13, 23)))
        assertEquals(LocalDate.of(2026, 11, 13), PlaceReminderPolicy.noticeDate(night, at(14, 1)))
        assertEquals(LocalDate.of(2026, 11, 14), PlaceReminderPolicy.noticeDate(night, at(14, 12)))
        // 金曜の窓で通知済みなら、土曜 01:00（同じ窓の続き）では鳴らさない。
        assertFalse(PlaceReminderPolicy.shouldNotify(night, "todo", at(14, 1), LocalDate.of(2026, 11, 13)))
        // まだ通知していなければ、続きでも鳴る。
        assertTrue(PlaceReminderPolicy.shouldNotify(night, "todo", at(14, 1), null))
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
