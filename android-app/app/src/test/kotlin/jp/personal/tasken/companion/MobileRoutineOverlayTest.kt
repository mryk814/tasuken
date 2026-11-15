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

    private fun copyOf(data: MobileRoutinesDataDto) = MobileRoutinesCopyPayload(data.habits.map { MobileRoutineCopyHabit(it, countsDate = data.date) })

    private fun counts(date: String, today: Int, week: Int, next: Int?) =
        MobileRoutineCountsDto("habit-read", date, todayCount = today, weekCount = week, nextSequence = next)

    /** 受領に数がある時は、その値で上書きする。読み直しと重なっても、送り直しで同じ受領が二度来ても、二重にならない。 */
    @Test
    fun aDeliveredRecordWritesTheReceiptCountsInsteadOfAddingOne() {
        val delivered = record(2)
        // 読み直しで既に数えた写し（今日2回）に、同じ記録の受領が来る。
        val reread = copyOf(server.copy(habits = listOf(habit.copy(todayCount = 2, weekCount = 3, nextSequence = 3))))
        val once = reread.withDeliveredRecord(delivered, counts("2026-11-16", 2, 3, 3))
        assertEquals("今日2回", once.habits.single().habit.todayLabel)
        assertEquals(once, once.withDeliveredRecord(delivered, counts("2026-11-16", 2, 3, 3)))

        // 前の日の写しの間に届いた今日の記録は、その Habit の数の日を今日へ進める。
        val yesterday = copyOf(server.copy(date = "2026-11-15"))
        val moved = yesterday.withDeliveredRecord(record(1), counts("2026-11-16", 1, 1, 2)).habits.single()
        assertEquals("2026-11-16", moved.countsDate)
        assertEquals("今日1回", moved.habit.todayLabel)
        assertEquals("今週1/3回", moved.habit.weekLabel)

        // 古い日の受領は、今日の数を戻さず、同じ週なら今週の数だけ使う。
        val late = copyOf(wednesday).withDeliveredRecord(record(1, date = "2026-11-17"), counts("2026-11-17", 1, 3, 2)).habits.single()
        assertEquals("2026-11-18", late.countsDate)
        assertEquals("今日1回", late.habit.todayLabel)
        assertEquals("今週3/3回", late.habit.weekLabel)
    }

    /** 受領に数が無い古い Desktop の時だけ、写しの数の日の記録を、番号が写しの次の番号以上の時だけ 1 足す。 */
    @Test
    fun withoutReceiptCountsOnlyARecordNotYetCountedIsAdded() {
        val copy = copyOf(server)
        val added = copy.withDeliveredRecord(record(2), null).habits.single().habit
        assertEquals("今日2回", added.todayLabel)
        assertEquals(3, added.nextSequence)
        // 読み直しで既に数えた番号（次の番号より小さい）は足さない。
        val reread = copyOf(server.copy(habits = listOf(habit.copy(todayCount = 2, nextSequence = 3))))
        assertEquals(reread, reread.withDeliveredRecord(record(2), null))
        // 同じ週の前の日は今週だけ。前の週は変えない。
        assertEquals("今週3/3回", copyOf(wednesday).withDeliveredRecord(record(1, date = "2026-11-17"), null).habits.single().habit.weekLabel)
        assertEquals(copy, copy.withDeliveredRecord(record(1, date = "2026-11-15"), null))
        // 写しの数の日より新しい日の記録は、その日に届いてまだ数に入っていない記録として持つ。
        val later = copyOf(server.copy(date = "2026-11-15"))
            .withDeliveredRecord(record(1), null)
            .withDeliveredRecord(record(2), null)
            .habits.single()
        assertEquals("2026-11-16", later.uncountedDate)
        assertEquals(2, later.uncounted)
        // ほかの Habit の記録は変えない。
        assertEquals(copy, copy.withDeliveredRecord(record(1, habitId = "habit-walk"), null))
    }

    @Test
    fun onlyHabitsWhoseCountsAreForTodayShowCountsAndOthersShowWhatWasAddedToday() {
        val two = server.copy(habits = listOf(habit, habit.copy(habitId = "habit-walk", title = "歩く")))
        val shown = overlayPendingRoutines(
            two,
            listOf(record(1, habitId = "habit-walk")),
            copyAt = "2026-11-15T21:00:00Z",
            knownHabits = setOf("habit-read"),
            uncountedToday = mapOf("habit-walk" to 2),
        )
        assertEquals(true, shown.habits[0].countsKnown)
        assertEquals(false, shown.habits[1].countsKnown)
        assertEquals(1, shown.habits[1].unsent)
        assertEquals(2, shown.habits[1].uncounted)
        assertEquals(false, shown.countsKnown)
    }
}
