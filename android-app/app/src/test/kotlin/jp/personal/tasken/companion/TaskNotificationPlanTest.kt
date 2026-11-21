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
    fun theWidgetPutsTodayFirstThenNearDueDateThenCarryover() {
        val today = "2026-11-16"
        val day = LocalDate.parse(today)
        // 期日が今日または超過のタスクは todayDate に関係なく「今日」先頭に入る（#784・#787）。
        assertEquals("今日", widgetSectionFor(null, today, day))
        assertEquals("今日", widgetSectionFor("2026-11-20", today, day.minusDays(2)))
        // 今日の予定（todayDate == today）は期限が近くても「今日」に留める（#787）。
        assertEquals("今日", widgetSectionFor(today, today, day.plusDays(3)))
        assertEquals("今日", widgetSectionFor(today, today, day.plusDays(4)))
        // 今日以外で 1〜3 日先の期限は「今日」の次の「期限が近い」に入る。
        assertEquals(WidgetDueSoonSection, widgetSectionFor(null, today, day.plusDays(1)))
        assertEquals(WidgetDueSoonSection, widgetSectionFor("2026-11-14", today, day.plusDays(3)))
        // ongoing 期間は締切ではないので「今日」や「期限が近い」へ吸い上げない。
        assertEquals("今後", widgetSectionFor("2026-11-20", today, day, isOngoingRange = true))
        assertEquals("日付なし", widgetSectionFor(null, today, null))

        val tasks = listOf("today-plain", "far-due", "tomorrow-due", "overdue", "today-due", "carryover", "undated")
            .map { TaskenWidgetTask(it, it, false) }
        val todayDates = mapOf(
            "today-plain" to today,
            "far-due" to today,
            "tomorrow-due" to null,
            "overdue" to "2026-11-20",
            "today-due" to today,
            "carryover" to "2026-11-10",
            "undated" to null,
        )
        val dueDates = mapOf(
            "far-due" to day.plusDays(10),
            "tomorrow-due" to day.plusDays(1),
            "overdue" to day.minusDays(2),
            "today-due" to day,
        )
        assertEquals(
            listOf("overdue", "today-due", "far-due", "today-plain", "tomorrow-due", "carryover", "undated"),
            orderWidgetTasks(tasks, today, todayDates, dueDates).map { it.id },
        )
        assertEquals("今日", TaskNotificationPlan.dueLabel(day, day))
        assertEquals("明日", TaskNotificationPlan.dueLabel(day.plusDays(1), day))
        assertEquals("11/19", TaskNotificationPlan.dueLabel(day.plusDays(3), day))
        assertEquals("2日超過", TaskNotificationPlan.dueLabel(day.minusDays(2), day))
        // 期限の時刻（#785）: 後ろに時刻を付け、期限の日のうちに時刻を過ぎたらその分から超過。
        assertEquals("今日 23:59", TaskNotificationPlan.dueLabel(day, day, "23:59", LocalTime.of(23, 58)))
        assertEquals("23:59 超過", TaskNotificationPlan.dueLabel(day, day, "23:59", LocalTime.of(23, 59)))
        assertEquals("明日 02:00", TaskNotificationPlan.dueLabel(day.plusDays(1), day, "02:00", LocalTime.of(23, 0)))
        assertEquals("2日超過", TaskNotificationPlan.dueLabel(day.minusDays(2), day, "02:00", LocalTime.of(9, 0)))
        // 同じ期限の日の中は、時刻の早い順（時刻の無いものは後ろ）。
        val sameDay = listOf("late", "plain", "early").map { TaskenWidgetTask(id = it, title = it, isDone = false) }
        assertEquals(
            listOf("early", "late", "plain"),
            orderWidgetTasks(
                sameDay,
                today,
                sameDay.associate { it.id to null },
                sameDay.associate { it.id to day },
                endTimes = mapOf("late" to "23:59", "plain" to null, "early" to "02:00"),
            ).map { it.id },
        )
    }

    private fun timed(time: String?, lead: Int?, due: LocalDate = LocalDate.of(2026, 11, 19), id: String = "kabu") =
        NotifiableTask(id, "株の申込み", "todo", null, due, time?.let(LocalTime::parse), lead)

    private fun endKeys(task: NotifiableTask, now: LocalDateTime) =
        TaskNotificationPlan.dueNotices(listOf(task), nine, now, tokyo).filter { it.kind == TaskNoticeKind.End }.map { it.key }

    @Test
    fun theDeadlineTimeNotifiesNMinutesBeforeAndRefiresWhenChanged() {
        // tests/task-notifications.test.mjs の「#785 期限の時刻の N 分前に知らせ…」と同じ場面。
        val task = timed("02:00", 30)
        assertEquals(emptyList<String>(), endKeys(task, at(19, 1, 29)))
        assertEquals(listOf("end:kabu:2026-11-19T02:00:30"), endKeys(task, at(19, 1, 30)))
        // 逃した分は 24 時間まで。
        assertEquals(listOf("end:kabu:2026-11-19T02:00:30"), endKeys(task, at(20, 1, 29)))
        assertEquals(emptyList<String>(), endKeys(task, at(20, 1, 30)))
        // 日をまたぐ前の知らせ（1日前）と、ちょうど（0）。
        assertEquals(listOf("end:kabu:2026-11-19T02:00:1440"), endKeys(timed("02:00", 1440), at(18, 2)))
        assertEquals(listOf("end:kabu:2026-11-19T02:00:0"), endKeys(timed("02:00", 0), at(19, 2)))
        // 知らせの無い時刻・時刻の無い期限は End を出さない。
        assertEquals(emptyList<String>(), endKeys(timed("02:00", null), at(19, 1, 45)))
        assertEquals(emptyList<String>(), endKeys(timed(null, 30), at(19, 1, 45)))
        // 変えると鍵が変わる（もう一度知らせる）。
        assertFalse(endKeys(timed("01:50", 30), at(19, 1, 45)) == endKeys(task, at(19, 1, 45)))
        // アラームは End の時刻にも掛かる（つながらなくても鳴る）。
        assertEquals(at(19, 1, 30), TaskNotificationPlan.nextTriggerAt(listOf(task), nine, at(19, 0, 10), tokyo))
        // 見出しは出す時の時刻で決め、本文の先頭に時刻を付ける。
        val endAt = at(19, 2)
        assertEquals("あと30分で期限", TaskNotificationPlan.endNoticeTitle(endAt, at(19, 1, 30)))
        assertEquals("まもなく期限", TaskNotificationPlan.endNoticeTitle(endAt, at(19, 1, 59)))
        assertEquals("期限を過ぎました", TaskNotificationPlan.endNoticeTitle(endAt, at(19, 2)))
        assertEquals("あと1時間で期限", TaskNotificationPlan.endNoticeTitle(endAt, at(19, 1)))
        assertEquals("あと1時間15分で期限", TaskNotificationPlan.endNoticeTitle(endAt, at(19, 0, 45)))
        assertEquals("あと1日で期限", TaskNotificationPlan.endNoticeTitle(endAt, at(18, 2)))
        val notice = TaskNotificationPlan.dueNotices(listOf(task), nine, at(19, 1, 30), tokyo).single { it.kind == TaskNoticeKind.End }
        assertEquals("02:00 株の申込み", TaskNotificationPlan.dueNoticeLine(notice))
        assertEquals("書類を出す", TaskNotificationPlan.dueNoticeLine(notice.copy(endAt = null, title = "書類を出す")))
        // 「後で」は期限の知らせと同じく、本人が付けた先のリマインダーを上書きしない。
        assertFalse(TaskNotificationPlan.snoozeWritesReminder(TaskNoticeKind.End, "2026-11-19T21:00", at(19, 1, 30), tokyo))
        assertTrue(TaskNotificationPlan.snoozeWritesReminder(TaskNoticeKind.End, null, at(19, 1, 30), tokyo))
        // 時刻・知らせを変えたら、出ている End の通知は理由が無くなる。
        assertTrue(TaskNotificationScheduler.isStillCurrent(task, TaskNoticeKind.End, at(19, 1, 30), tokyo))
        assertFalse(TaskNotificationScheduler.isStillCurrent(timed("02:00", 10), TaskNoticeKind.End, at(19, 1, 30), tokyo))
    }

    private fun dues(time: String?, now: LocalDateTime, dueTimes: List<LocalTime> = nine, due: LocalDate = LocalDate.of(2026, 11, 19)) =
        TaskNotificationPlan.dueNotices(listOf(timed(time, null, due, "a")), dueTimes, now, tokyo)
            .filter { it.kind == TaskNoticeKind.Due }
            .map { it.key to if (it.dueTomorrow) "tomorrow" else "today" }

    @Test
    fun anEarlyDeadlineMovesTheDueDayNoticeToThePreviousDay() {
        // tests/task-notifications.test.mjs の「#785 期限の日の知らせ…」と同じ場面。
        assertEquals(listOf("due:a:2026-11-19T09:00" to "today"), dues("23:59", at(19, 9)))
        assertEquals(emptyList<Pair<String, String>>(), dues("23:59", at(18, 9)))
        // 02:00 の期限: 前の日の 09:00 に「明日が期限」。当日 09:00（過ぎた後）には出さない。
        assertEquals(listOf("due:a:2026-11-18T09:00:2026-11-19" to "tomorrow"), dues("02:00", at(18, 9)))
        assertEquals(emptyList<Pair<String, String>>(), dues("02:00", at(19, 9)))
        // ちょうど同じ時刻も前の日。
        assertEquals(listOf("due:a:2026-11-18T09:00:2026-11-19" to "tomorrow"), dues("09:00", at(18, 9)))
        // 2 回目の時刻は、それぞれで決める。
        val twice = listOf(LocalTime.of(9, 0), LocalTime.of(17, 0))
        assertEquals(listOf("due:a:2026-11-19T09:00" to "today"), dues("12:00", at(19, 18), twice))
        assertEquals(listOf("due:a:2026-11-18T17:00:2026-11-19" to "tomorrow"), dues("12:00", at(18, 18), twice))
        // 「明日が期限」の後で期限をその日に移すと、同じ時刻の「今日が期限」は別の鍵で出る。
        assertEquals(listOf("due:a:2026-11-18T09:00" to "today"), dues("23:59", at(18, 9, 30), due = LocalDate.of(2026, 11, 18)))
        // 時刻の無い期限は今までどおり。
        assertEquals(listOf("due:a:2026-11-19T09:00" to "today"), dues(null, at(19, 9)))
        // 前の日の知らせはアラームの時刻にも入り、出ている通知は前の日の分として残る。
        val early = timed("02:00", null, id = "a")
        assertEquals(at(18, 9), TaskNotificationPlan.nextTriggerAt(listOf(early), nine, at(18, 8), tokyo))
        assertTrue(TaskNotificationScheduler.isStillCurrent(early, TaskNoticeKind.Due, at(18, 9), tokyo))
        assertFalse(TaskNotificationScheduler.isStillCurrent(early, TaskNoticeKind.Due, at(19, 9), tokyo))
        // 通知の文。
        val notice = TaskNotificationPlan.dueNotices(listOf(early), nine, at(18, 9), tokyo).single()
        assertEquals("明日 02:00 が期限", TaskNotificationScheduler.privateText(notice, at(18, 9)))
        assertEquals("Task の期限 2 件", TaskNotificationScheduler.summaryText(listOf(TaskNoticeKind.Due, TaskNoticeKind.End)))
    }

    @Test
    fun theCachedTimeIsReadOnlyWhenTheScheduleHasADay() {
        val row = TaskCacheEntity(
            id = "a", serverVersion = 1, title = "提出", themeId = null, state = "todo", workState = null, todayDate = null,
            updatedAt = "2026-11-18T00:00:00Z", optimisticCommandId = null, scheduleEndDate = "2026-11-19",
            scheduleGranularity = "day", scheduleEndTime = "02:00", scheduleNotifyBeforeMinutes = 30,
        )
        assertEquals(LocalTime.of(2, 0), row.toNotifiableTask().endTime)
        assertEquals(30, row.toNotifiableTask().notifyBeforeMinutes)
        assertNull(row.copy(scheduleGranularity = "week").toNotifiableTask().endTime)
        assertNull(row.copy(scheduleEndTime = "25:00").toNotifiableTask().notifyBeforeMinutes)
    }

    @Test
    fun snoozingADueNoticeNeverOverwritesAFutureReminderTheUserSet() {
        val now = at(16, 9, 5)
        // 期限の通知の「後で」: 本人が付けた先の時刻（17:00）がある時は書かない。その時刻がそのまま鳴る。
        assertFalse(TaskNotificationPlan.snoozeWritesReminder(TaskNoticeKind.Due, "2026-11-16T17:00", now, tokyo))
        assertFalse(TaskNotificationPlan.snoozeWritesReminder(TaskNoticeKind.Due, "2026-11-20T00:00:00Z", now, tokyo))
        // 時刻が無い・もう過ぎている・読めない時は書く。
        assertTrue(TaskNotificationPlan.snoozeWritesReminder(TaskNoticeKind.Due, null, now, tokyo))
        assertTrue(TaskNotificationPlan.snoozeWritesReminder(TaskNoticeKind.Due, "2026-11-16T09:00", now, tokyo))
        assertTrue(TaskNotificationPlan.snoozeWritesReminder(TaskNoticeKind.Due, "2026-11-16T09:05", now, tokyo))
        assertTrue(TaskNotificationPlan.snoozeWritesReminder(TaskNoticeKind.Due, "あした", now, tokyo))
        // 時刻の通知の「後で」は、その時刻を先へ送るので、いつも書く。
        assertTrue(TaskNotificationPlan.snoozeWritesReminder(TaskNoticeKind.Time, "2026-11-16T17:00", now, tokyo))
        assertTrue(TaskNotificationPlan.snoozeWritesReminder(null, "2026-11-16T17:00", now, tokyo))
    }

    @Test
    fun theSuggestedSecondTimeIsLaterThanTheFirst() {
        assertEquals(LocalTime.of(15, 0), TaskNotificationPlan.suggestedSecondDueTime(LocalTime.of(9, 0)))
        assertEquals(LocalTime.of(21, 0), TaskNotificationPlan.suggestedSecondDueTime(LocalTime.of(15, 0)))
        assertEquals(LocalTime.of(23, 59), TaskNotificationPlan.suggestedSecondDueTime(LocalTime.of(21, 0)))
        assertNull(TaskNotificationPlan.suggestedSecondDueTime(LocalTime.of(23, 59)))
    }

    @Test
    fun anUnreadableReminderIsReadAsNoneWithoutRejectingTheWholeResponse() {
        val meta = """{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"server-1","serverRevision":2,"generatedAt":"2026-11-16T00:00:00Z","truncated":false}"""
        fun task(id: String, reminderAt: String) =
            """{"id":"$id","version":1,"title":"題名","themeId":null,"state":"todo","workState":"not_delegated","todayDate":"2026-11-16","schedule":null,"updatedAt":"2026-11-16T00:00:00Z","reminderAt":$reminderAt}"""
        // 時差 +19:00、小数秒 10 桁、無い日付。どれも欄だけ「時刻なし」にして、ほかの Task は読める。
        val unreadable = listOf("\"2026-11-16T09:00:00+19:00\"", "\"2026-11-16T09:00:00.1234567890Z\"", "\"2026-02-30T09:00\"")
        val tasks = unreadable.mapIndexed { index, value -> task("10000000-0000-4000-8000-00000000000$index", value) } +
            task("10000000-0000-4000-8000-000000000009", "\"2026-11-16T09:00:00+09:00\"")
        val bootstrap = MobileSyncContract.decodeBootstrap("""{"ok":true,"meta":$meta,"data":{"tasks":[${tasks.joinToString(",")}],"nextCursor":"c","hasMore":false}}""")
        assertEquals(listOf(null, null, null, "2026-11-16T09:00:00+09:00"), bootstrap.data.tasks.map { readableReminderAt(it.reminderAt) })
        val sync = MobileSyncContract.decodeSync("""{"ok":true,"meta":$meta,"data":{"changes":[{"kind":"upsert","task":${tasks[0]}}],"nextCursor":"c2","hasMore":false}}""")
        assertNull(readableReminderAt(sync.data.changes.single().task?.reminderAt))
        val today = MobileTodayContract.decodeSuccess("""{"ok":true,"meta":$meta,"data":{"date":"2026-11-16","items":[${tasks.joinToString(",")}],"nextCursor":null}}""")
        assertEquals(4, today.data.items.size)
    }
}
