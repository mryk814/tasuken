package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 端末にだけある続けることの記録を、Desktopの数に重ねる決まり（押した時点で記録済みに見せ、二重に数えない）。 */
class MobileRoutineOverlayTest {
    private val habit = MobileRoutineHabitDto(
        habitId = "habit-read",
        title = "論文を読む",
        scheduleLabel = "週3回",
        todayCount = 1,
        nextSequence = 2,
        weekCount = 2,
        weekTarget = 3,
        todayLabel = "今日1回",
        weekLabel = "今週2/3回",
        met = false,
    )
    private val server = MobileRoutinesDataDto(date = "2026-11-16", habits = listOf(habit))

    private fun record(sequence: Int, state: String = OutboxState.Pending, date: String = "2026-11-16", habitId: String = "habit-read") =
        MobilePendingRoutineRecord("c-$habitId-$date-$sequence", habitId, date, sequence, state, reason = null)

    @Test
    fun aQueuedRecordIsCountedAtOnceAndMarkedUnsent() {
        val shown = overlayPendingRoutines(server, listOf(record(2))).habits.single()

        assertEquals(1, shown.unsent)
        assertEquals(2, shown.habit.todayCount)
        assertEquals("今日2回", shown.habit.todayLabel)
        assertEquals("今週3/3回", shown.habit.weekLabel)
        assertTrue(shown.habit.met)
        // 次に押した記録は、列にある記録と別の回になる。
        assertEquals(3, shown.habit.nextSequence)
    }

    @Test
    fun aRecordTheDesktopAlreadyCountsIsNotAddedTwice() {
        // 応答を失って列に残った再送: Desktopは既に 2 回目を数え、次は 3。
        val counted = server.copy(habits = listOf(habit.copy(todayCount = 2, nextSequence = 3, todayLabel = "今日2回")))
        val shown = overlayPendingRoutines(counted, listOf(record(2, OutboxState.RetryWait))).habits.single()

        assertEquals(0, shown.unsent)
        assertEquals("今日2回", shown.habit.todayLabel)
        assertEquals(3, shown.habit.nextSequence)
    }

    @Test
    fun aRejectedRecordIsNotCountedButKeepsItsNumberAndShowsAsReturned() {
        val shown = overlayPendingRoutines(server, listOf(record(2, OutboxState.Rejected))).habits.single()

        assertEquals(0, shown.unsent)
        assertEquals(1, shown.returned)
        assertEquals("今日1回", shown.habit.todayLabel)
        // 送り直した時に、新しい記録と同じ回にならない。
        assertEquals(3, shown.habit.nextSequence)
    }

    @Test
    fun recordsOfOtherDaysAndHabitsDoNotChangeTodaysCount() {
        val shown = overlayPendingRoutines(
            server,
            listOf(record(1, date = "2026-11-15"), record(1, habitId = "habit-walk")),
        ).habits.single()

        assertEquals(0, shown.unsent)
        assertEquals(habit, shown.habit)
    }

    @Test
    fun theDayLimitStopsFurtherRecords() {
        val full = server.copy(habits = listOf(habit.copy(nextSequence = 50)))
        val shown = overlayPendingRoutines(full, listOf(record(50))).habits.single()

        assertNull(shown.habit.nextSequence)
    }

    @Test
    fun aQueuedRowIsReadBackFromTheOutbox() {
        val envelope = MobileRoutineActionEnvelopeDto(
            apiVersion = TASKEN_MOBILE_API_VERSION,
            schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            requestId = "request-1",
            commandId = "command-1",
            idempotencyKey = "command-1",
            clientDeviceId = "device",
            issuedAt = "2026-11-16T09:00:00Z",
            action = MobileRoutineContract.habitAction(habit, "2026-11-16"),
        )
        val row = OutboxCommandEntity(
            commandId = "command-1", idempotencyKey = "command-1", requestId = "request-1", clientDeviceId = "device",
            issuedAt = envelope.issuedAt, commandName = ROUTINE_RECORD_COMMAND, envelopeJson = MobileRoutineContract.encode(envelope),
            serverId = "server-1", state = OutboxState.Rejected, attemptCount = 1, createdAt = envelope.issuedAt,
            lastAttemptAt = envelope.issuedAt,
            lastError = """{"code":"not_found","message":"PC にこの続けることが見つかりませんでした。","retryable":false}""",
        )

        val read = requireNotNull(row.toPendingRoutineRecord())

        assertEquals(MobilePendingRoutineRecord("command-1", "habit-read", "2026-11-16", 2, OutboxState.Rejected, "PC にこの続けることが見つかりませんでした。"), read)
        assertNull(row.copy(commandName = "CreateCapture").toPendingRoutineRecord())
    }

    // 2026-11-16 は月曜。週は Desktop と同じく月曜始まり。
    private val wednesday = server.copy(date = "2026-11-18")

    @Test
    fun anUnsentRecordOfAnEarlierDayInTheSameWeekCountsForTheWeekAndIsMarked() {
        val shown = overlayPendingRoutines(wednesday, listOf(record(1, date = "2026-11-17"), record(1, date = "2026-11-15"))).habits.single()

        assertEquals(1, shown.unsent)
        assertEquals("今日1回", shown.habit.todayLabel)
        assertEquals("今週3/3回", shown.habit.weekLabel)
        assertEquals(2, shown.habit.nextSequence)
    }

    @Test
    fun aCopyOfAnEarlierDayKeepsNamesButNotTodaysCountsAndStillTakesRecords() {
        val shown = overlayPendingRoutines(
            server.copy(date = "2026-11-17"),
            listOf(record(1, date = "2026-11-17"), record(2, date = "2026-11-17")),
            copyAt = "2026-11-16T21:00:00Z",
            countsKnown = false,
        )

        assertEquals(false, shown.countsKnown)
        assertEquals(2, shown.habits.single().unsent)
        // 次の押下は、列にある今日の記録の次（置き場所は Desktop が「1回足す」で決める）。
        assertEquals(3, shown.habits.single().habit.nextSequence)
    }

    @Test
    fun aDeliveredRecordIsAddedToTheCopyForTheDayAndTheWeek() {
        val sameDay = server.withDeliveredRecord("habit-read", "2026-11-16").habits.single()
        assertEquals("今日2回", sameDay.todayLabel)
        assertEquals("今週3/3回", sameDay.weekLabel)
        assertEquals(3, sameDay.nextSequence)

        val earlier = wednesday.withDeliveredRecord("habit-read", "2026-11-17").habits.single()
        assertEquals("今日1回", earlier.todayLabel)
        assertEquals("今週3/3回", earlier.weekLabel)
        assertEquals(2, earlier.nextSequence)

        // 前の週の記録と、ほかの Habit の記録は数を変えない。
        assertEquals(server, server.withDeliveredRecord("habit-read", "2026-11-15"))
        assertEquals(server, server.withDeliveredRecord("habit-walk", "2026-11-16"))
    }
}
