package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 時刻と期限の知らせの決まり（#753）。Desktop の tests/task-notifications.test.mjs と同じ場面を確かめる。 */
class TaskNotificationPlanTest {
    private val tokyo = ZoneId.of("Asia/Tokyo")
    private val nine = listOf(LocalTime.of(9, 0))

    private fun at(day: Int, hour: Int, minute: Int = 0) = LocalDateTime.of(2026, 11, day, hour, minute)

    private fun task(
        id: String = "task",
        state: String = "todo",
        reminderAt: String? = null,
        dueDate: LocalDate? = null,
        title: String = "書類を出す",
    ) = NotifiableTask(id, title, state, reminderAt, dueDate)

    private fun keys(tasks: List<NotifiableTask>, now: LocalDateTime, dueTimes: List<LocalTime> = nine, zone: ZoneId = tokyo) =
        TaskNotificationPlan.dueNotices(tasks, dueTimes, now, zone).map { it.key }

    @Test
    fun aFloatingTimeIsReadAsLocalAndAnOffsetTimeAsAnInstant() {
        assertEquals(at(16, 9), TaskNotificationPlan.parseReminderAt("2026-11-16T09:00", tokyo))
        // 時差つきは、数字を拾うのでなく瞬間として現地に直す。
        assertEquals(at(16, 9), TaskNotificationPlan.parseReminderAt("2026-11-16T00:00:00Z", tokyo))
        assertEquals(at(16, 9), TaskNotificationPlan.parseReminderAt("2026-11-16T09:00:00+09:00", tokyo))
        assertEquals(at(16, 9, 30), TaskNotificationPlan.parseReminderAt("2026-11-15T19:30:00.000-05:00", tokyo))
        // 同じ値でも、端末の時差が違えば現地の時刻は違う（時差なしの値だけが、どこでも同じ数字で鳴る）。
        assertEquals(LocalDateTime.of(2026, 11, 15, 19, 0), TaskNotificationPlan.parseReminderAt("2026-11-16T00:00:00Z", ZoneId.of("America/New_York")))
        assertEquals(at(16, 9), TaskNotificationPlan.parseReminderAt("2026-11-16T09:00", ZoneId.of("America/New_York")))
        listOf(null, "", "あした", "2026-11-16", "2026-11-16T24:00", "2026-11-16T09:60").forEach {
            assertNull(it, TaskNotificationPlan.parseReminderAt(it, tokyo))
        }
        assertTrue(isMobileReminderAt(null))
        assertTrue(isMobileReminderAt("2026-11-16T09:00"))
        assertFalse(isMobileReminderAt("あした"))
    }

    @Test
    fun theDueTimesDefaultToNineAndAllowASecond() {
        assertEquals(nine, TaskNotificationPlan.normalizeDueTimes(emptyList()))
        assertEquals(nine, TaskNotificationPlan.normalizeDueTimes(listOf("")))
        assertEquals(listOf(LocalTime.of(7, 30)), TaskNotificationPlan.normalizeDueTimes(listOf("07:30")))
        assertEquals(
            listOf(LocalTime.of(9, 0), LocalTime.of(12, 0)),
            TaskNotificationPlan.normalizeDueTimes(listOf("09:00", "09:00", "25:00", "12:00", "18:00")),
        )
    }

    @Test
    fun theDueDateIsTheEndDateOrTheSingleDay() {
        assertEquals(LocalDate.of(2026, 11, 20), TaskNotificationPlan.dueDate(null, "2026-11-20"))
        assertEquals(LocalDate.of(2026, 11, 20), TaskNotificationPlan.dueDate("2026-11-18", "2026-11-20"))
        assertEquals(LocalDate.of(2026, 11, 18), TaskNotificationPlan.dueDate("2026-11-18", null))
        assertNull(TaskNotificationPlan.dueDate(null, null))
    }

    @Test
    fun aDueDayNotifiesAtTheChosenTimesOnThatDayOnly() {
        val tasks = listOf(task(dueDate = LocalDate.of(2026, 11, 16)))
        assertEquals(emptyList<String>(), keys(tasks, at(15, 23, 59)))
        assertEquals(emptyList<String>(), keys(tasks, at(16, 8, 59)))
        assertEquals(listOf("due:task:2026-11-16T09:00"), keys(tasks, at(16, 9)))
        // 9 時に端末が眠っていても、その日のうちなら後から知らせる。
        assertEquals(listOf("due:task:2026-11-16T09:00"), keys(tasks, at(16, 23, 59)))
        // 日付が変わったら、きのうの期限は知らせない。
        assertEquals(emptyList<String>(), keys(tasks, at(17, 0)))
        val twice = listOf(LocalTime.of(9, 0), LocalTime.of(17, 0))
        assertEquals(listOf("due:task:2026-11-16T09:00"), keys(tasks, at(16, 12), twice))
        assertEquals(listOf("due:task:2026-11-16T09:00", "due:task:2026-11-16T17:00"), keys(tasks, at(16, 17), twice))
    }

    @Test
    fun aTimedTaskNotifiesAtItsTimeAndUpToADayLate() {
        val tasks = listOf(task(reminderAt = "2026-11-16T14:30"))
        assertEquals(emptyList<String>(), keys(tasks, at(16, 14, 29)))
        assertEquals(listOf("time:task:2026-11-16T14:30"), keys(tasks, at(16, 14, 30)))
        // 秒は切り捨てる（14:30:40 に起きたアラームでも、14:30 の知らせを出す）。
        assertEquals(listOf("time:task:2026-11-16T14:30"), keys(tasks, at(16, 14, 30).plusSeconds(40)))
        // 日付をまたいでも 24 時間までは出す（夜の時刻を、朝に起こした端末が知らせる）。
        assertEquals(1, keys(tasks, at(17, 14, 29)).size)
        assertEquals(0, keys(tasks, at(17, 14, 30)).size)
        // 時差つきの値は、その瞬間に知らせる。
        val zoned = listOf(task(reminderAt = "2026-11-16T05:30:00Z"))
        assertEquals(0, keys(zoned, at(16, 14, 29)).size)
        assertEquals(1, keys(zoned, at(16, 14, 30)).size)
    }

    @Test
    fun closedTasksStaySilentAndTimeAndDueNotifySeparately() {
        val day = LocalDate.of(2026, 11, 16)
        val tasks = listOf(
            task("done", "done", "2026-11-16T09:30", day),
            task("cancelled", "cancelled", "2026-11-16T09:30", day),
            task("both", "todo", "2026-11-16T09:30", day),
        )
        assertEquals(listOf("due:both:2026-11-16T09:00", "time:both:2026-11-16T09:30"), keys(tasks, at(16, 10)))
    }

    @Test
    fun theNextAlarmIsTheNearestFutureTrigger() {
        val tasks = listOf(
            task("timed", reminderAt = "2026-11-16T14:30"),
            task("due", dueDate = LocalDate.of(2026, 11, 17)),
            task("done", "done", "2026-11-16T10:00"),
        )
        val twice = listOf(LocalTime.of(9, 0), LocalTime.of(17, 0))
        assertEquals(at(16, 14, 30), TaskNotificationPlan.nextTriggerAt(tasks, twice, at(16, 10), tokyo))
        // ちょうどその時刻は「いま出す」側。次のアラームはその先。
        assertEquals(at(17, 9), TaskNotificationPlan.nextTriggerAt(tasks, twice, at(16, 14, 30), tokyo))
        assertEquals(at(17, 17), TaskNotificationPlan.nextTriggerAt(tasks, twice, at(17, 9), tokyo))
        assertNull(TaskNotificationPlan.nextTriggerAt(tasks, twice, at(17, 17), tokyo))
        assertNull(TaskNotificationPlan.nextTriggerAt(emptyList(), twice, at(16, 10), tokyo))
    }

    @Test
    fun snoozingWritesAnInstantAndCrossesMidnightAndMonths() {
        assertEquals(
            "2026-11-16T15:30:00+09:00",
            TaskNotificationPlan.snoozedReminderAt(SnoozeChoice.Hour, at(16, 14, 30).plusSeconds(20), nine, tokyo),
        )
        assertEquals(
            "2027-01-01T00:30:00+09:00",
            TaskNotificationPlan.snoozedReminderAt(SnoozeChoice.Hour, LocalDateTime.of(2026, 12, 31, 23, 30), nine, tokyo),
        )
        assertEquals(
            "2026-12-01T09:00:00+09:00",
            TaskNotificationPlan.snoozedReminderAt(SnoozeChoice.Tomorrow, at(30, 23, 59), nine, tokyo),
        )
        // 明日は、期限の知らせの早い方の時刻。
        assertEquals(
            "2026-11-17T07:30:00+09:00",
            TaskNotificationPlan.snoozedReminderAt(SnoozeChoice.Tomorrow, at(16, 14, 30), listOf(LocalTime.of(18, 0), LocalTime.of(7, 30)), tokyo),
        )
        // 書いた値を読み直すと、同じ現地時刻に鳴る。
        val written = TaskNotificationPlan.snoozedReminderAt(SnoozeChoice.Hour, at(16, 14, 30), nine, tokyo)
        assertEquals(at(16, 15, 30), TaskNotificationPlan.parseReminderAt(written, tokyo))
    }

    @Test
    fun firedNoticesOlderThanTwoDaysAreForgotten() {
        assertEquals(
            mapOf("edge" to "2026-11-14", "today" to "2026-11-16"),
            TaskNotificationPlan.pruneFired(
                mapOf("old" to "2026-11-13", "edge" to "2026-11-14", "today" to "2026-11-16"),
                LocalDate.of(2026, 11, 16),
            ),
        )
    }

    @Test
    fun aNotificationStaysOnlyWhileItsReasonHolds() {
        val due = LocalDate.of(2026, 11, 16)
        val open = task(reminderAt = "2026-11-16T14:30", dueDate = due)
        assertTrue(TaskNotificationScheduler.isStillCurrent(open, TaskNoticeKind.Time, at(16, 14, 30), tokyo))
        assertTrue(TaskNotificationScheduler.isStillCurrent(open, TaskNoticeKind.Due, at(16, 9), tokyo))
        // 完了・削除（写しに無い）・「後で」で時刻を先へ送った・期限の日を変えた、で消える。
        assertFalse(TaskNotificationScheduler.isStillCurrent(open.copy(state = "done"), TaskNoticeKind.Time, at(16, 14, 30), tokyo))
        assertFalse(TaskNotificationScheduler.isStillCurrent(null, TaskNoticeKind.Due, at(16, 9), tokyo))
        assertFalse(TaskNotificationScheduler.isStillCurrent(open.copy(reminderAt = "2026-11-16T15:30:00+09:00"), TaskNoticeKind.Time, at(16, 14, 30), tokyo))
        assertFalse(TaskNotificationScheduler.isStillCurrent(open.copy(dueDate = due.plusDays(1)), TaskNoticeKind.Due, at(16, 9), tokyo))
    }

    @Test
    fun theLockScreenTextCarriesOnlyTheKindAndCount() {
        val notice = TaskNotice("due:task:2026-11-16T09:00", TaskNoticeKind.Due, "task", "通帳を持って銀行へ", at(16, 9))
        assertEquals("Task の期限 1 件", TaskNotificationScheduler.publicText(TaskNoticeKind.Due))
        assertEquals("Task の時刻 1 件", TaskNotificationScheduler.publicText(TaskNoticeKind.Time))
        assertFalse(TaskNotificationScheduler.publicText(notice.kind).contains(notice.title))
        // 2 つ以上を束ねた見出しも、種類ごとの件数だけ。
        assertEquals("Task の期限 2 件・時刻 1 件", TaskNotificationScheduler.summaryText(listOf(TaskNoticeKind.Due, TaskNoticeKind.Time, TaskNoticeKind.Due)))
        assertEquals("Task の時刻 2 件", TaskNotificationScheduler.summaryText(listOf(TaskNoticeKind.Time, TaskNoticeKind.Time)))
        assertEquals("Task の知らせ 2 件", TaskNotificationScheduler.summaryText(listOf(TaskNoticeKind.Due, null)))
        assertEquals("今日が期限", TaskNotificationScheduler.privateText(notice, at(16, 9)))
        val timed = notice.copy(kind = TaskNoticeKind.Time, at = at(16, 14, 30))
        assertEquals("14:30", TaskNotificationScheduler.privateText(timed, at(16, 14, 30)))
        // きのうの時刻を今日出す時は、日付も添える。
        assertEquals("11/16 14:30", TaskNotificationScheduler.privateText(timed, at(17, 8)))
    }

    @Test
    fun aStaleCopyIsNamedOnTheNotification() {
        assertNull(TaskNotificationScheduler.staleCopyNote("2026-11-16T00:00:00Z", at(16, 14), tokyo))
        assertEquals("同期 3日前", TaskNotificationScheduler.staleCopyNote("2026-11-13T00:00:00Z", at(16, 14), tokyo))
        assertEquals("未同期", TaskNotificationScheduler.staleCopyNote(null, at(16, 14), tokyo))
    }

    @Test
    fun theReminderPatchValueIsAStringOrNull() {
        assertNull(decodeReminderAtPatchValue(JsonNull))
        assertEquals("2026-11-16T09:00:00+09:00", decodeReminderAtPatchValue(JsonPrimitive("2026-11-16T09:00:00+09:00")))
        assertTrue(serverReportsReminderAt("""{"reminderAt":null}"""))
        assertFalse(serverReportsReminderAt("""{"placeReminder":null}"""))
        assertEquals("11/16 09:00", reminderAtLabel("2026-11-16T09:00:00+09:00", tokyo))
        assertEquals("なし", reminderAtLabel(null, tokyo))
    }

    @Test
    fun theWidgetPutsTasksWithANearDueDateFirst() {
        val today = "2026-11-16"
        val day = LocalDate.parse(today)
        assertEquals(WidgetDueSoonSection, widgetSectionFor(null, today, day))
        assertEquals(WidgetDueSoonSection, widgetSectionFor("2026-11-20", today, day.minusDays(2)))
        assertEquals(WidgetDueSoonSection, widgetSectionFor(today, today, day.plusDays(3)))
        // 4 日より先の期限は、今までどおり扱う日で分ける。
        assertEquals("今日", widgetSectionFor(today, today, day.plusDays(4)))
        assertEquals("日付なし", widgetSectionFor(null, today, null))

        val tasks = listOf("today-plain", "far-due", "tomorrow-due", "overdue", "today-due", "undated").map { TaskenWidgetTask(it, it, false) }
        val todayDates = mapOf("today-plain" to today, "far-due" to today, "tomorrow-due" to null, "overdue" to "2026-11-20", "today-due" to today, "undated" to null)
        val dueDates = mapOf("far-due" to day.plusDays(10), "tomorrow-due" to day.plusDays(1), "overdue" to day.minusDays(2), "today-due" to day)
        assertEquals(
            listOf("overdue", "today-due", "tomorrow-due", "far-due", "today-plain", "undated"),
            orderWidgetTasks(tasks, today, todayDates, dueDates).map { it.id },
        )
        assertEquals("今日", TaskNotificationPlan.dueLabel(day, day))
        assertEquals("明日", TaskNotificationPlan.dueLabel(day.plusDays(1), day))
        assertEquals("11/19", TaskNotificationPlan.dueLabel(day.plusDays(3), day))
        assertEquals("2日超過", TaskNotificationPlan.dueLabel(day.minusDays(2), day))
    }
}
