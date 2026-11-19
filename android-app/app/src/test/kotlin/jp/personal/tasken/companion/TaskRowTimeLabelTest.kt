package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 一覧の行の時刻情報（#783）。短い形と、無い時に何も出さないことを確かめる。 */
class TaskRowTimeLabelTest {
    private val today = LocalDate.of(2026, 11, 16)
    private val zone: ZoneId = ZoneId.of("Asia/Tokyo")

    @Test
    fun schedule_row_label_names_deadline_point_and_range() {
        assertNull(scheduleRowLabel(null, null, today))
        assertEquals("期限 11/21", scheduleRowLabel(null, LocalDate.of(2026, 11, 21), today))
        assertEquals(
            "11/21",
            scheduleRowLabel(LocalDate.of(2026, 11, 21), LocalDate.of(2026, 11, 21), today),
        )
        assertEquals("11/21", scheduleRowLabel(LocalDate.of(2026, 11, 21), null, today))
        assertEquals(
            "11/21〜11/28",
            scheduleRowLabel(LocalDate.of(2026, 11, 21), LocalDate.of(2026, 11, 28), today),
        )
        // 年が違う期限は年を付ける（先の年の予定と取り違えない）。
        assertEquals("期限 2027/1/14", scheduleRowLabel(null, LocalDate.of(2027, 1, 14), today))
    }

    @Test
    fun reminder_row_label_shows_time_only_for_today() {
        assertEquals("19:00", reminderRowLabel("2026-11-16T19:00", today, zone))
        assertEquals("11/18 19:00", reminderRowLabel("2026-11-18T19:00", today, zone))
        // 時差つきの値は、この端末の現地時刻に直してから同じ形にする。
        assertEquals("11/18 19:00", reminderRowLabel("2026-11-18T19:00:00+09:00", today, zone))
        assertEquals("2027/1/14 09:00", reminderRowLabel("2027-01-14T09:00", today, zone))
    }

    @Test
    fun reminder_row_label_hides_missing_or_unreadable_values() {
        assertNull(reminderRowLabel(null, today, zone))
        assertNull(reminderRowLabel("", today, zone))
        // 時刻の無い日付だけの値は、行には出さない。
        assertNull(reminderRowLabel("2026-11-18", today, zone))
    }
}
