package jp.personal.tasken.companion

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class ScheduleFormattingTest {
    private val today = LocalDate.of(2026, 10, 7) // 水曜

    @Test
    fun date_label_uses_month_day_weekday_and_relative_words() {
        assertEquals("8月24日（月）", scheduleDateLabel(LocalDate.of(2026, 8, 24), today))
        assertEquals("10月7日（水） 今日", scheduleDateLabel(today, today))
        assertEquals("10月8日（木） 明日", scheduleDateLabel(today.plusDays(1), today))
        assertEquals("2027年1月5日（火）", scheduleDateLabel(LocalDate.of(2027, 1, 5), today))
    }

    @Test
    fun summary_names_point_deadline_and_range_and_appends_duration() {
        assertEquals("予定なし", scheduleSummaryText(null, null, null, today))
        assertEquals("8月24日（月）", scheduleSummaryText(LocalDate.of(2026, 8, 24), null, null, today))
        assertEquals("8月30日（日）まで", scheduleSummaryText(null, LocalDate.of(2026, 8, 30), null, today))
        assertEquals(
            "8月24日（月） 〜 8月30日（日）・45分",
            scheduleSummaryText(LocalDate.of(2026, 8, 24), LocalDate.of(2026, 8, 30), 45, today),
        )
        assertEquals("1時間30分", scheduleSummaryText(null, null, 90, today))
    }

    @Test
    fun duration_label_and_quick_dates() {
        assertEquals("45分", durationLabel(45))
        assertEquals("2時間", durationLabel(120))
        assertEquals("1時間30分", durationLabel(90))
        assertEquals(
            listOf("今日" to today, "明日" to today.plusDays(1), "来週月曜" to LocalDate.of(2026, 10, 12)),
            quickScheduleDates(today),
        )
        // 月曜当日なら翌週の月曜を指す。
        assertEquals(LocalDate.of(2026, 10, 19), quickScheduleDates(LocalDate.of(2026, 10, 12)).last().second)
    }
}
