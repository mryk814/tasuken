package jp.personal.tasken.companion

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** 送信の列に積む、続けることの1回記録の命令名。Gatewayの受け口（/v1/routine-actions）の action.name と同じ。 */
internal const val ROUTINE_RECORD_COMMAND = "RecordHabitEntry"

/** 古い Desktop に断られた続けることの記録に添える文。 */
internal const val ROUTINE_UPDATE_PC_REQUIRED = "PC が受け取れませんでした。PC の Tasken を新しくしてから送り直してください。"

/** Desktopの1日の上限（habitEntryId の sequence 1〜50）。 */
private const val ROUTINE_MAX_SEQUENCE = 50

/** まだDesktopに届いていない（か、断られた）続けることの1回記録。送信の列の1行から読む。 */
data class MobilePendingRoutineRecord(
    val commandId: String,
    val habitId: String,
    val performedOn: String,
    val sequence: Int,
    val state: String,
    /** 最後に送れなかった・断られた理由（画面に出す文）。 */
    val reason: String?,
) {
    val rejected: Boolean get() = state == OutboxState.Rejected
}

internal fun OutboxCommandEntity.toPendingRoutineRecord(): MobilePendingRoutineRecord? {
    if (commandName != ROUTINE_RECORD_COMMAND) return null
    val envelope = runCatching { MobileRoutineContract.decodeEnvelope(envelopeJson) }.getOrNull() ?: return null
    val action = envelope.action
    return MobilePendingRoutineRecord(
        commandId = commandId,
        habitId = action.habitId ?: return null,
        performedOn = action.performedOn,
        sequence = action.sequence ?: return null,
        state = state,
        reason = outboxReasonText(lastError),
    )
}

/** Todayに出す1件。[unsent] はまだ届いていない記録の数（数は既に足してある）、[returned] は断られた記録の数。 */
internal data class TodayRoutineHabit(
    val habit: MobileRoutineHabitDto,
    val unsent: Int = 0,
    val returned: Int = 0,
)

/**
 * [copyAt] は端末の写しを見せている時のその時刻（Desktop から読めた時は null）。
 * [countsKnown] が false の時は前の日の写しで、名前と頻度だけが確かで、今日の数は分からない（画面は数を出さない）。
 */
internal data class TodayRoutines(
    val date: String,
    val habits: List<TodayRoutineHabit>,
    val copyAt: String? = null,
    val countsKnown: Boolean = true,
) {
    val isEmpty: Boolean get() = habits.isEmpty()
}

/** 週の区切りは Desktop と同じく、ローカルの日付で月曜始まり（habit/progress.ts の weekRangeOf）。 */
internal fun sameRoutineWeek(day: String, today: String): Boolean = runCatching {
    val start = LocalDate.parse(today).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    val date = LocalDate.parse(day)
    !date.isBefore(start) && !date.isAfter(start.plusDays(6))
}.getOrDefault(false)

/** 数を [today] 回・[week] 回にした形。字の形（今日N回・今週n/m回）は Desktop の導出（habit/progress.ts）と同じ。 */
private fun MobileRoutineHabitDto.withCounts(today: Int, week: Int, next: Int): MobileRoutineHabitDto = copy(
    todayCount = today,
    weekCount = week,
    todayLabel = "今日${today}回",
    weekLabel = "今週$week/${weekTarget}回",
    met = week >= weekTarget,
    nextSequence = next.takeIf { it <= ROUTINE_MAX_SEQUENCE },
)

/**
 * 届いた記録を、端末の写しの数へ足した形（列から消すのと同じ取引で写しに書く）。
 * 写しは Desktop から読めた時にしか新しくならないので、足さないと、届いた記録が数から抜けて見え、
 * 本人がもう一度押して二重に記録してしまう。写しの日の記録なら今日と今週、同じ週の前の日なら今週だけ足す。
 * 次の番号は端末の数え（Desktop は「1回足す」で次の空いた回に入れる）なので、1 つ進めるだけでよい。
 */
internal fun MobileRoutinesDataDto.withDeliveredRecord(habitId: String, performedOn: String): MobileRoutinesDataDto {
    val sameDay = performedOn == date
    if (!sameDay && !sameRoutineWeek(performedOn, date)) return this
    return copy(
        habits = habits.map { habit ->
            if (habit.habitId != habitId) {
                habit
            } else {
                val next = (habit.nextSequence ?: (ROUTINE_MAX_SEQUENCE + 1)) + if (sameDay) 1 else 0
                habit.withCounts(
                    today = habit.todayCount + if (sameDay) 1 else 0,
                    week = habit.weekCount + 1,
                    next = next,
                )
            }
        },
    )
}

/**
 * Desktopが返した続けることに、端末にだけある記録を重ねる。押した時点で記録済みに見せ、届くまでは割印で分ける。
 *
 * 数え方: その日の記録は、Desktopの次の番号（nextSequence）以上の物だけ足す。番号がそれより小さい記録は、
 * Desktopが既に数えている（応答を失って列に残った再送など）ので、二重に足さない。
 * 同じ週の前の日の記録（圏外の間に前の日に押した物）は、今週の数と割印に足す。
 * 次の番号は、列にある同じ日の記録（断られた物も）より後にする。番号は端末の数えで、Desktopは「1回足す」として
 * 次の空いた回に入れるが、端末の中で同じ番号を二つ積まないため。
 * [countsKnown] が false（前の日の写し）の時は、Desktopの数が無いので、今日の記録をすべて割印の数として持つ。
 * 足す物が無い時はDesktopの字をそのまま使う。
 */
internal fun overlayPendingRoutines(
    server: MobileRoutinesDataDto,
    pending: List<MobilePendingRoutineRecord>,
    copyAt: String? = null,
    countsKnown: Boolean = true,
): TodayRoutines = TodayRoutines(
    date = server.date,
    copyAt = copyAt,
    countsKnown = countsKnown,
    habits = server.habits.map { habit ->
        val mine = pending.filter { it.habitId == habit.habitId }
        val waiting = mine.filterNot { it.rejected }
        val sameDay = mine.filter { it.performedOn == server.date }
        val sameDayMax = sameDay.maxOfOrNull { it.sequence } ?: 0
        if (!countsKnown) {
            val unsent = waiting.count { it.performedOn == server.date }
            return@map TodayRoutineHabit(
                habit.copy(nextSequence = (sameDayMax + 1).takeIf { it <= ROUTINE_MAX_SEQUENCE }),
                unsent = unsent,
                returned = mine.count { it.rejected },
            )
        }
        val serverNext = habit.nextSequence ?: (ROUTINE_MAX_SEQUENCE + 1)
        val addedToday = waiting.count { it.performedOn == server.date && it.sequence >= serverNext }
        val addedEarlier = waiting.count { it.performedOn < server.date && sameRoutineWeek(it.performedOn, server.date) }
        val next = maxOf(serverNext, sameDayMax + 1)
        val shown = if (addedToday + addedEarlier == 0) {
            habit.copy(nextSequence = next.takeIf { it <= ROUTINE_MAX_SEQUENCE })
        } else {
            habit.withCounts(
                today = habit.todayCount + addedToday,
                week = habit.weekCount + addedToday + addedEarlier,
                next = next,
            )
        }
        TodayRoutineHabit(shown, unsent = addedToday + addedEarlier, returned = mine.count { it.rejected })
    },
)

/**
 * 続けることの記録を、Task・Capture・作業記録と同じ送信の列（outbox_command）に先に書く。
 * 送るのは列の送り手（MobileOutbox.send）で、つながらない間は残り、つながったら同じ commandId のまま送り直す。
 * 記録は「1回足す」（mode: append）で送り、Desktop は commandId で送り直しを見分けるので、
 * 応答を失った再送でも記録は増えず、圏外の間に PC が同じ日に記録していても端末の 1 回は消えない。
 */
internal class MobileRoutineOutbox(
    private val dao: MobileLocalDao,
    private val deviceId: () -> String,
    private val schedule: () -> Unit,
    private val now: () -> Instant = Instant::now,
) {
    private val mutex = Mutex()

    /**
     * この端末が積んだ一番大きい番号（Habitと日ごと）。届いて列から消えた記録の番号を、
     * Desktopから読み直すまでの間に使い回さないための下限。プロセスが終われば読み直すので、覚えるのはこの間だけ。
     */
    private val queuedFloor = mutableMapOf<String, Int>()

    /** 記録を列に積み、積んだ commandId を返す。番号は [action] の番号と、列にある同じ日の記録より後にする。 */
    suspend fun record(action: MobileRoutineActionDto): String = mutex.withLock {
        require(action.name == ROUTINE_RECORD_COMMAND)
        val habitId = requireNotNull(action.habitId)
        val serverId = requireNotNull(dao.syncState()?.serverId) { "Taskを同期してから記録できます。" }
        val key = "$habitId|${action.performedOn}"
        val queued = dao.routineRecords().mapNotNull { it.toPendingRoutineRecord() }
            .filter { it.habitId == habitId && it.performedOn == action.performedOn }
            .maxOfOrNull { it.sequence } ?: 0
        val sequence = maxOf(requireNotNull(action.sequence), queued + 1, (queuedFloor[key] ?: 0) + 1)
        require(sequence <= ROUTINE_MAX_SEQUENCE) { "今日はこれ以上記録できません。" }
        val commandId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val envelope = MobileRoutineActionEnvelopeDto(
            apiVersion = TASKEN_MOBILE_API_VERSION,
            schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            requestId = UUID.randomUUID().toString(),
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            action = action.copy(sequence = sequence),
        )
        dao.insertOutbox(
            OutboxCommandEntity(
                commandId = commandId,
                idempotencyKey = commandId,
                requestId = envelope.requestId,
                clientDeviceId = envelope.clientDeviceId,
                issuedAt = issuedAt,
                commandName = ROUTINE_RECORD_COMMAND,
                envelopeJson = MobileRoutineContract.encode(envelope),
                serverId = serverId,
                state = OutboxState.Pending,
                attemptCount = 0,
                createdAt = issuedAt,
                lastAttemptAt = null,
                lastError = null,
            ),
        )
        queuedFloor[key] = sequence
        schedule()
        commandId
    }

    /** 断られた記録を、同じ commandId・同じ番号のまま列へ戻す。 */
    suspend fun retry(commandId: String) {
        check(dao.retryRejectedRoutineRecord(commandId) == 1) { "送り直せる記録が見つかりませんでした。" }
        schedule()
    }

    /** 断られた続けることの記録を、すべて同じ commandId のまま列へ戻す（1 件ずつ押さなくてよいように）。戻した数を返す。 */
    suspend fun retryAll(): Int {
        val serverId = dao.syncState()?.serverId ?: return 0
        val count = dao.retryAllRejectedRoutineRecords(serverId)
        if (count > 0) schedule()
        return count
    }

    /**
     * 断られた記録を、本人が選んで消す。送っている途中・送る前の物は消さない。
     * 消した行をそのまま返す（「元に戻す」で [restore] に渡す）。
     */
    suspend fun discard(commandId: String): OutboxCommandEntity {
        val row = dao.outbox(commandId)
        check(row != null && dao.discardRejectedRoutineRecord(commandId) == 1) { "消せる記録が見つかりませんでした。" }
        return row
    }

    /** 消した記録を、消す前の行のまま（断られた状態と理由ごと）列へ戻す。 */
    suspend fun restore(row: OutboxCommandEntity) {
        require(row.commandName == ROUTINE_RECORD_COMMAND && row.state == OutboxState.Rejected)
        if (dao.outbox(row.commandId) == null) dao.insertOutbox(row)
    }
}
